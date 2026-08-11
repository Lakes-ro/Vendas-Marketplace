/**
 * PRODUCTS.JS v5.0
 * ✅ v4.6: Categorias, filtro por categoria na vitrine
 * ✅ v4.7 (rodada anterior): busca por texto, favoritos (localStorage),
 *    selos de Novidade/Últimas Unidades/Vendidos, chips de categoria
 *    com ícone
 * ✅ v5.0 NOVO — GALERIA DE MÍDIA: cada produto agora pode ter até 5
 *    fotos/vídeos (tabela product_media no banco). O campo antigo
 *    products.image_url continua existindo e é mantido em dia
 *    sozinho pelo banco (sempre = a primeira foto da galeria) — assim
 *    carrinho, pedidos, BI e notificações continuam funcionando sem
 *    precisar saber que a galeria existe.
 * ✅ v5.0 NOVO — VITRINE PAGINADA (rolagem infinita): a vitrine pública
 *    não carrega mais o catálogo inteiro de uma vez — traz de 24 em
 *    24 produtos, e busca mais conforme a pessoa rola a tela (essencial
 *    pra aguentar catálogo grande sem pesar o celular de quem visita).
 *    Categoria e busca agora filtram DIRETO no banco (não só no que já
 *    tinha sido carregado), senão a busca não acharia produtos que
 *    ainda não tivessem "chegado" na paginação.
 * ✅ v5.0 NOVO: os painéis de Admin/Estoque agora leem de uma lista
 *    PRÓPRIA (`manageProducts`) — sempre completa (todos os produtos,
 *    pro Admin Supremo; só os próprios, pro vendedor), independente da
 *    paginação da vitrine pública. bi.js e notifications.js também
 *    passam a usar essa lista (antes liam `products.products`, que
 *    agora é só a "página atual" da vitrine — ver observação no bi.js).
 */

const PRODUCT_PLACEHOLDER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='160' viewBox='0 0 200 160'%3E%3Crect width='200' height='160' fill='%231e293b'/%3E%3Crect x='70' y='45' width='60' height='50' rx='6' fill='%23334155'/%3E%3Ccircle cx='100' cy='115' r='8' fill='%23334155'/%3E%3Ctext x='100' y='145' text-anchor='middle' font-size='11' fill='%2364748b' font-family='sans-serif'%3ESem imagem%3C/text%3E%3C/svg%3E`;

const PRODUCT_MEDIA_MAX = 5;
const PRODUCT_MEDIA_MAX_SIZE = 20 * 1024 * 1024; // 20MB (mesmo limite do bucket no servidor)

const Products = {
    editingId: null,

    products: [],        // ✅ vitrine pública — só a fatia paginada atual
    manageProducts: [],  // ✅ Admin/Estoque — lista própria, sempre completa

    activeCategory: 'Todas',
    searchQuery: '',
    showFavoritesOnly: false,

    _page: 0,
    _pageSize: 24,
    _hasMore: true,
    _loadingMore: false,

    _mediaState: { existing: [], newFiles: [], removedIds: [] },

    CATEGORY_ICONS: {
        'Todas': '🏬',
        'Alimentos': '🍎',
        'Bebidas': '🥤',
        'Roupas e Acessórios': '👕',
        'Eletrônicos': '📱',
        'Casa e Decoração': '🏠',
        'Beleza e Higiene': '🧴',
        'Brinquedos': '🧸',
        'Livros e Papelaria': '📚',
        'Serviços': '🛠️',
        'Outros': '📦'
    },

    // ============================================================
    // CARREGAMENTO
    // ============================================================

    _baseQuery() {
        return _supabase
            .from('products')
            .select(`
                id,
                name,
                price,
                cost_price,
                stock,
                min_stock,
                category,
                description,
                image_url,
                owner_id,
                active,
                created_at,
                sales_count,
                profiles!owner_id(id, full_name, email, phone)
            `)
            .eq('active', true);
    },

    /**
     * ✅ NOVO (v5.0, ajustado): busca a galeria de mídia (product_media)
     * numa consulta SEPARADA da consulta principal de produtos — em vez
     * de pedir tudo junto num select aninhado. Isso evita depender do
     * PostgREST já ter "percebido" a relação entre as tabelas (o cache
     * de schema do Supabase pode demorar um instante pra reconhecer uma
     * tabela/FK recém-criada, e um select aninhado falharia até lá).
     * Uma consulta simples em `product_media` sempre funciona.
     */
    async _attachMedia(list) {
        if (!list || !list.length) return;
        try {
            const ids = list.map(p => p.id);
            const { data, error } = await _supabase
                .from('product_media')
                .select('id, product_id, media_url, media_type, sort_order')
                .in('product_id', ids);

            if (error) throw error;

            const byProduct = {};
            (data || []).forEach(m => {
                (byProduct[m.product_id] = byProduct[m.product_id] || []).push(m);
            });

            list.forEach(p => { p.product_media = byProduct[p.id] || []; });
        } catch (err) {
            log(`⚠️ Não foi possível carregar a galeria de mídia: ${err.message}`, 'warning');
            list.forEach(p => { if (!p.product_media) p.product_media = []; });
        }
    },

    async fetchAll() {
        try {
            log('📦 Carregando produtos...', 'info');
            this._bindSearch();
            this._bindInfiniteScroll();

            this._page = 0;
            this._hasMore = true;
            await this._fetchStorefrontPage(true);
            await this._fetchManageableProducts();

            log(`✅ Vitrine carregada (${this.products.length} produto(s) na página atual)`, 'success');
            return this.products;
        } catch (err) {
            log(`❌ Erro ao carregar produtos: ${err.message}`, 'error');
            return [];
        }
    },

    /**
     * ✅ NOVO (v5.0): busca a próxima página da vitrine pública (ou
     * recarrega do zero, se reset=true — usado ao trocar categoria,
     * digitar na busca, ou favoritar). Categoria e busca já filtram
     * direto no banco, então a "página" volta só com o que interessa.
     */
    async _fetchStorefrontPage(reset = false) {
        if (this._loadingMore) return;
        if (!reset && !this._hasMore) return;

        this._loadingMore = true;
        this._updateLoadMoreIndicator(true);

        try {
            // Modo "❤️ Favoritos": lista naturalmente pequena (só o que a
            // pessoa marcou) — busca tudo de uma vez, sem paginação.
            if (this.showFavoritesOnly) {
                const ids = this.getFavorites();
                if (!ids.length) {
                    this.products = [];
                    this._hasMore = false;
                    this.render();
                    return;
                }

                const { data, error } = await this._baseQuery().in('id', ids);
                if (error) throw error;

                this.products = data || [];
                this._hasMore = false;
                await this._attachVendorOnlineStatus(this.products);
                await this._attachMedia(this.products);
                this.render();
                return;
            }

            const from = this._page * this._pageSize;
            const to = from + this._pageSize - 1;

            let query = this._baseQuery();

            if (this.activeCategory !== 'Todas') {
                query = query.eq('category', this.activeCategory);
            }

            const q = this.searchQuery.trim();
            if (q) {
                const safe = q.replace(/[%,]/g, ''); // evita quebrar o filtro OR do PostgREST
                query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
            }

            query = query.order('created_at', { ascending: false }).range(from, to);

            const { data, error } = await query;
            if (error) throw error;

            const page = data || [];
            this.products = reset ? page : [...this.products, ...page];
            this._page++;
            this._hasMore = page.length === this._pageSize;

            await this._attachVendorOnlineStatus(page);
            await this._attachMedia(page);
            this.render();
        } catch (err) {
            log(`❌ Erro ao carregar vitrine: ${err.message}`, 'error');
        } finally {
            this._loadingMore = false;
            this._updateLoadMoreIndicator(false);
        }
    },

    /**
     * ✅ NOVO (v5.0): lista completa (sem paginação) pros painéis de
     * gestão — Admin Supremo vê tudo, vendedor só os próprios produtos.
     * Não sofre com o problema de escala da vitrine pública porque o
     * catálogo de UM vendedor (ou o painel interno do Admin) continua
     * naturalmente pequeno mesmo se a vitrine pública crescer bastante.
     */
    async _fetchManageableProducts() {
        if (!window.APP?.auth?.userId) { this.manageProducts = []; return; }

        try {
            let query = this._baseQuery();
            if (window.APP.auth.role === 'seller') {
                query = query.eq('owner_id', window.APP.auth.userId);
            }

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;

            this.manageProducts = data || [];
            await this._attachVendorOnlineStatus(this.manageProducts);
            await this._attachMedia(this.manageProducts);

            this.renderAdmin();
            if (window.APP.auth.role === 'seller') this.renderSeller();
        } catch (err) {
            log(`❌ Erro ao carregar produtos para gestão: ${err.message}`, 'error');
        }
    },

    /**
     * Busca o status online/offline de cada vendedor dono dos produtos
     * da LISTA passada, e anexa `p.vendor_online` em cada item dela.
     * Produto sem linha em vendor_status é tratado como disponível
     * (mesmo padrão do banco: is_online default = true).
     */
    async _attachVendorOnlineStatus(list) {
        try {
            if (!list || !list.length) return;
            const ownerIds = [...new Set(list.map(p => p.owner_id).filter(Boolean))];
            if (!ownerIds.length) return;

            const { data, error } = await _supabase
                .from('vendor_status')
                .select('owner_id, is_online')
                .in('owner_id', ownerIds);

            if (error) throw error;

            const onlineMap = {};
            (data || []).forEach(v => { onlineMap[v.owner_id] = v.is_online; });

            list.forEach(p => {
                p.vendor_online = onlineMap.hasOwnProperty(p.owner_id) ? onlineMap[p.owner_id] : true;
            });
        } catch (err) {
            log(`⚠️ Não foi possível verificar status dos vendedores: ${err.message}`, 'warning');
            (list || []).forEach(p => { if (p.vendor_online === undefined) p.vendor_online = true; });
        }
    },

    // ============================================================
    // ROLAGEM INFINITA
    // ============================================================

    /**
     * ✅ NOVO (v5.0): cria (uma única vez) uma "sentinela" logo abaixo
     * da vitrine — quando ela entra na tela (a pessoa rolou até perto
     * do fim), busca a próxima página sozinho. Preferido a um número
     * de página clicável porque combina com o resto do sistema
     * (pensado pra "ficar de bobeira rolando").
     */
    _bindInfiniteScroll() {
        if (this._scrollObserver) return;

        const grid = document.getElementById('product-grid');
        if (!grid) return;

        let sentinel = document.getElementById('product-grid-sentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'product-grid-sentinel';
            sentinel.className = 'col-span-full';
            sentinel.style.height = '4px';
            grid.insertAdjacentElement('afterend', sentinel);
        }

        let loadingEl = document.getElementById('product-grid-loading');
        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.id = 'product-grid-loading';
            loadingEl.className = 'col-span-full text-center text-slate-500 text-xs py-6 hidden';
            loadingEl.textContent = '⏳ Carregando mais produtos...';
            sentinel.insertAdjacentElement('afterend', loadingEl);
        }

        this._scrollObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && this._hasMore && !this._loadingMore && !this.showFavoritesOnly) {
                this._fetchStorefrontPage(false);
            }
        }, { rootMargin: '600px' });

        this._scrollObserver.observe(sentinel);
    },

    _toggleSentinel(show) {
        const sentinel = document.getElementById('product-grid-sentinel');
        if (sentinel) sentinel.style.display = show ? 'block' : 'none';
    },

    _updateLoadMoreIndicator(loading) {
        const el = document.getElementById('product-grid-loading');
        if (el) el.classList.toggle('hidden', !loading);
    },

    // ============================================================
    // RENDER — VITRINE PÚBLICA
    // ============================================================

    render() {
        try {
            const grid = document.getElementById('product-grid');
            if (!grid) {
                log('⚠️ #product-grid não encontrado', 'warning');
                return;
            }

            this._renderCategoryFilterBar();

            const visiveis = this.products;

            if (!visiveis || visiveis.length === 0) {
                const q = this.searchQuery.trim();
                const emptyMsg = q
                    ? `Nenhum produto encontrado para "${window.escapeHtml(q)}"`
                    : this.showFavoritesOnly
                        ? 'Você ainda não favoritou nenhum produto'
                        : this.activeCategory === 'Todas'
                            ? 'Nenhum produto disponível'
                            : `Nenhum produto em "${window.escapeHtml(this.activeCategory)}" no momento`;
                grid.innerHTML = `<div class="col-span-full text-slate-600 text-center py-12">${emptyMsg}</div>`;
                this._toggleSentinel(false);
                return;
            }

            grid.innerHTML = visiveis.map((p, idx) => this._renderProductCard(p, idx)).join('');

            if (window.lucide) lucide.createIcons();
            this._bindGalleryObservers();
            this._toggleSentinel(!this.showFavoritesOnly && this._hasMore);
            log('✅ Marketplace renderizado', 'success');

        } catch (err) {
            log(`❌ Erro ao renderizar marketplace: ${err.message}`, 'error');
        }
    },

    _renderProductCard(p, idx) {
        const estoque = p.stock || 0;
        const vendorOnline = p.vendor_online !== false;
        const disponivel = estoque > 0 && vendorOnline;

        // Nome/descrição/vendedor sempre escapados — vitrine é pública,
        // sem login, então texto de terceiro nunca entra cru no innerHTML.
        const nome = window.escapeHtml(p.name);
        const descricao = window.escapeHtml(p.description || '');
        const vendedor = window.escapeHtml(p.profiles?.full_name || 'Vendedor');
        const categoria = p.category || 'Outros';

        const waLink = window.buildWhatsAppLink ? window.buildWhatsAppLink(p.profiles?.phone) : null;

        const isNew = p.created_at && (Date.now() - new Date(p.created_at).getTime()) < 3 * 86400000;
        const isUrgent = vendorOnline && estoque > 0 && estoque <= 3;
        const sold = p.sales_count || 0;
        const badges = `${isNew ? '<span class="product-badge badge-new">🆕 Novidade</span>' : ''}${isUrgent ? `<span class="product-badge badge-urgent">🔥 Só ${estoque} restam</span>` : ''}`;
        const soldBadge = sold > 0 ? `<span class="product-sold-count">🛍️ ${sold} vendido${sold > 1 ? 's' : ''}</span>` : '';

        return `
            <div style="--i:${idx}" class="bg-slate-900/40 p-6 rounded-[32px] border border-white/5 flex flex-col gap-4 hover:border-blue-500/30 transition-all ${!vendorOnline ? 'opacity-60' : ''}">
                <div class="relative">
                    ${this._renderGallery(p, nome)}
                    <button type="button"
                        onclick="window.APP.products.toggleFavorite('${p.id}')"
                        class="product-fav-btn ${this.isFavorite(p.id) ? 'is-fav' : ''}"
                        aria-label="Favoritar produto"
                        title="Favoritar">
                        <i data-lucide="heart"></i>
                    </button>
                </div>

                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <span class="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-blue-500/15 text-blue-300">${window.escapeHtml(categoria)}</span>
                    ${badges ? `<div class="product-badge-row">${badges}</div>` : ''}
                </div>

                <h3 class="text-xl font-bold text-white">${nome}</h3>
                <p class="text-slate-500 text-xs line-clamp-2">${descricao}</p>

                <div class="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-lg border border-white/5">
                    <i data-lucide="store" class="w-3 h-3 text-yellow-500"></i>
                    <span class="text-xs text-yellow-300 font-semibold truncate">Vendido por: ${vendedor}</span>
                </div>

                <div class="flex justify-between items-center">
                    <div class="text-2xl font-black text-white">R$ ${window.formatBRL(p.price)}</div>
                    <div class="text-xs font-black ${!vendorOnline ? 'text-orange-400' : disponivel ? 'text-green-500' : 'text-red-500'}">
                        ${!vendorOnline ? '🔌 Vendedor Offline' : disponivel ? `${estoque} em estoque` : 'Fora de estoque'}
                    </div>
                </div>
                ${soldBadge ? `<div class="-mt-2">${soldBadge}</div>` : ''}

                ${waLink ? `
                    <a href="${waLink}" target="_blank" rel="noopener"
                       class="flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-xs uppercase bg-green-600/15 hover:bg-green-600/25 text-green-400 transition-all">
                        <i data-lucide="message-circle" class="w-4 h-4"></i>
                        Falar com o Vendedor
                    </a>
                ` : ''}

                <button
                    data-action="add-to-cart"
                    data-id="${p.id}"
                    data-name="${nome}"
                    data-price="${p.price}"
                    class="bg-blue-600 py-4 rounded-2xl font-black text-xs uppercase text-white hover:bg-blue-500 transition-all ${!disponivel ? 'opacity-50 cursor-not-allowed' : ''}"
                    ${!disponivel ? 'disabled' : ''}>
                    Adicionar ao Carrinho
                </button>
            </div>
        `;
    },

    /**
     * ✅ NOVO (v5.0): galeria de mídia do produto — rolagem horizontal
     * nativa (funciona por toque, sem precisar de biblioteca nenhuma)
     * com bolinhas indicando a posição. Vídeo entra com os controles
     * nativos do navegador (sem autoplay, pra não pesar a página com
     * vários vídeos carregando ao mesmo tempo).
     */
    _renderGallery(p, nome) {
        const media = (p.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order);

        if (!media.length) {
            return `<div class="w-full h-44 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-600">SEM IMAGEM</div>`;
        }

        const slides = media.map(m => m.media_type === 'video'
            ? `<video class="product-gallery-item" src="${m.media_url}" controls muted playsinline preload="metadata"></video>`
            : `<img class="product-gallery-item" src="${m.media_url}" alt="${nome}" loading="lazy" onerror="if(!this.dataset.err){this.dataset.err=1;this.src=PRODUCT_PLACEHOLDER}">`
        ).join('');

        const dots = media.length > 1
            ? `<div class="product-gallery-dots">${media.map((_, i) => `<span class="product-gallery-dot ${i === 0 ? 'active' : ''}"></span>`).join('')}</div>`
            : '';

        return `<div class="product-gallery"><div class="product-gallery-track">${slides}</div>${dots}</div>`;
    },

    /**
     * ✅ NOVO (v5.0): atualiza a bolinha ativa de cada galeria conforme
     * a pessoa arrasta o dedo pelas fotos/vídeos.
     */
    _bindGalleryObservers() {
        document.querySelectorAll('.product-gallery').forEach(gallery => {
            const track = gallery.querySelector('.product-gallery-track');
            const dots = gallery.querySelectorAll('.product-gallery-dot');
            if (!track || dots.length < 2) return;

            const slides = track.querySelectorAll('.product-gallery-item');

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
                        const idx = Array.from(slides).indexOf(entry.target);
                        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
                    }
                });
            }, { root: track, threshold: 0.6 });

            slides.forEach(s => observer.observe(s));
        });
    },

    /**
     * ✅ NOVO (v4.6, ajustado v5.0): barra de categorias com ícone —
     * agora troca de categoria refazendo a busca no banco (não só
     * filtrando o que já tinha carregado), pra a paginação funcionar
     * certo em catálogo grande.
     */
    _renderCategoryFilterBar() {
        const bar = document.getElementById('category-filter-bar');
        if (!bar) return;

        // ✅ FIX: antes a lista de categorias era calculada a partir dos
        // produtos JÁ CARREGADOS na tela — com a vitrine agora paginada
        // (rolagem infinita), uma categoria sem nenhum produto entre os
        // mais recentes simplesmente sumia do filtro, mesmo tendo
        // produtos mais pra frente no catálogo. As categorias são um
        // conjunto fixo (mesmo do formulário de cadastro), então usa
        // sempre a lista completa — nunca depende do que já carregou.
        const categorias = ['Todas', ...Object.keys(this.CATEGORY_ICONS).filter(c => c !== 'Todas')];
        const favCount = this.getFavorites().length;

        const chips = categorias.map(cat => {
            const isActive = !this.showFavoritesOnly && cat === this.activeCategory;
            const icon = this.CATEGORY_ICONS[cat] || '📦';
            return `
                <button onclick="window.APP.products.filterByCategory('${cat.replace(/'/g, "\\'")}')"
                    class="category-chip ${isActive ? 'category-chip-active' : ''}">
                    <span class="category-chip-icon">${icon}</span>
                    ${window.escapeHtml(cat)}
                </button>
            `;
        }).join('');

        const favChip = favCount > 0 ? `
            <button onclick="window.APP.products.toggleShowFavorites()"
                class="category-chip ${this.showFavoritesOnly ? 'category-chip-active category-chip-fav' : ''}">
                <span class="category-chip-icon">❤️</span>
                Favoritos <span class="category-chip-count">${favCount}</span>
            </button>
        ` : '';

        bar.innerHTML = chips + favChip;
    },

    filterByCategory(category) {
        this.activeCategory = category;
        this.showFavoritesOnly = false;
        this._page = 0;
        this._hasMore = true;
        this._fetchStorefrontPage(true);
    },

    toggleShowFavorites() {
        this.showFavoritesOnly = !this.showFavoritesOnly;
        this._page = 0;
        this._hasMore = true;
        this._fetchStorefrontPage(true);
    },

    // ===== BUSCA =====
    _bindSearch() {
        if (this._searchBound) return;
        const input = document.getElementById('market-search-input');
        const clearBtn = document.getElementById('market-search-clear');
        if (!input) return;

        this._searchBound = true;
        let debounceTimer = null;

        const runSearch = () => {
            this.searchQuery = input.value;
            if (clearBtn) clearBtn.classList.toggle('hidden', !input.value);
            this._page = 0;
            this._hasMore = true;
            this._fetchStorefrontPage(true);
        };

        // ✅ v5.0: debounce de 350ms — agora cada letra digitada pode
        // disparar uma consulta no banco (busca deixou de ser só
        // client-side), então espera a pessoa parar de digitar.
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(runSearch, 350);
        });

        clearBtn?.addEventListener('click', () => {
            input.value = '';
            clearTimeout(debounceTimer);
            runSearch();
            input.focus();
        });
    },

    // ===== FAVORITOS (guardados no aparelho, via Storage — sem precisar
    // de conta/login pra favoritar) =====
    getFavorites() {
        return window.Storage ? Storage.get('favorites', []) : [];
    },

    isFavorite(productId) {
        return this.getFavorites().includes(productId);
    },

    toggleFavorite(productId) {
        if (!window.Storage) return;
        const favs = this.getFavorites();
        const idx = favs.indexOf(productId);

        if (idx >= 0) favs.splice(idx, 1);
        else favs.push(productId);

        Storage.set('favorites', favs);

        if (this.showFavoritesOnly) {
            // Já filtrando só favoritos — some da lista na hora, sem
            // precisar buscar tudo de novo no banco.
            this.products = this.products.filter(p => p.id !== productId || favs.includes(p.id));
            if (!this.products.length) { this._fetchStorefrontPage(true); return; }
        }

        this.render();
    },

    // ============================================================
    // PAINÉIS DE GESTÃO — ADMIN / ESTOQUE
    // (leem de `manageProducts`, sempre completo — não sofrem com a
    // paginação da vitrine pública)
    // ============================================================

    renderAdmin() {
        try {
            const list = document.getElementById('admin-list');
            if (!list) return;

            let filtrado = this.manageProducts;

            if (window.APP?.auth?.role === 'seller') {
                filtrado = this.manageProducts.filter(p => p.owner_id === window.APP.auth.userId);
            }

            if (!filtrado || filtrado.length === 0) {
                list.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhum produto</div>';
                return;
            }

            list.innerHTML = filtrado.map(p => `
                <div class="flex justify-between items-center bg-slate-900/50 p-4 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-all">
                    <div class="flex-1">
                        <span class="font-bold text-white block">${window.escapeHtml(p.name)}</span>
                        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 inline-block mt-1">${window.escapeHtml(p.category || 'Outros')}</span>
                        <span class="text-xs text-yellow-400 font-semibold mt-1 block">👤 ${window.escapeHtml(p.profiles?.full_name || 'Desconhecido')}</span>
                        <span class="text-xs text-slate-500 mt-1 block">R$ ${window.formatBRL(p.price)} · 📷 ${(p.product_media || []).length}/${PRODUCT_MEDIA_MAX}</span>
                        <span class="text-xs ${p.stock > (p.min_stock ?? 5) ? 'text-green-500' : p.stock > 0 ? 'text-yellow-500' : 'text-red-500'} font-black mt-1 block">
                            Estoque: ${p.stock} <span class="text-slate-600 font-normal">(mín: ${p.min_stock ?? 5})</span>
                        </span>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="window.APP.products.editById('${p.id}')" class="text-blue-500 p-2 hover:bg-blue-500/10 rounded-lg transition-all">
                            <i data-lucide="edit-3" class="w-4 h-4"></i>
                        </button>
                        <button onclick="window.APP.products.delete('${p.id}')" class="text-red-500 p-2 hover:bg-red-500/10 rounded-lg transition-all">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            if (window.lucide) lucide.createIcons();
            log('✅ Admin list renderizado', 'success');

        } catch (err) {
            log(`❌ Erro ao renderizar admin: ${err.message}`, 'error');
        }
    },

    renderSeller() {
        try {
            const list = document.getElementById('seller-list');
            if (!list) return;

            if (!window.APP?.auth?.userId) {
                list.innerHTML = '<div class="text-slate-600 text-center py-8">Você precisa estar logado</div>';
                return;
            }

            const meus = this.manageProducts.filter(p => p.owner_id === window.APP.auth.userId);

            if (!meus || meus.length === 0) {
                list.innerHTML = '<div class="text-slate-600 text-center py-8">Você não tem produtos ainda</div>';
                return;
            }

            list.innerHTML = meus.map(p => `
                <div class="bg-slate-900/40 p-6 rounded-[32px] border border-white/5 flex flex-col gap-4 hover:border-blue-500/30 transition-all">
                    ${p.image_url
                        ? `<img src="${p.image_url}" alt="${window.escapeHtml(p.name)}" class="w-full h-44 object-cover rounded-2xl" onerror="if(!this.dataset.err){this.dataset.err=1;this.src=PRODUCT_PLACEHOLDER}">`
                        : `<div class="w-full h-44 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-600">SEM IMAGEM</div>`
                    }

                    <div class="flex items-center justify-between gap-2 flex-wrap">
                        <span class="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-blue-500/15 text-blue-300">${window.escapeHtml(p.category || 'Outros')}</span>
                        <span class="text-[10px] text-slate-500 font-bold">📷 ${(p.product_media || []).length}/${PRODUCT_MEDIA_MAX}</span>
                    </div>
                    <h3 class="text-xl font-bold text-white">${window.escapeHtml(p.name)}</h3>
                    <p class="text-slate-500 text-xs line-clamp-2">${window.escapeHtml(p.description || '')}</p>

                    <div class="flex justify-between items-center">
                        <div class="text-2xl font-black text-white">R$ ${window.formatBRL(p.price)}</div>
                        <div class="text-xs font-bold text-slate-400">Estoque: ${p.stock} <span class="text-slate-600">(mín: ${p.min_stock ?? 5})</span></div>
                    </div>

                    <div class="flex gap-2">
                        <button onclick="window.APP.products.editById('${p.id}')" class="flex-1 bg-blue-600 hover:bg-blue-500 py-2 rounded-2xl font-bold text-xs text-white transition-all">
                            ✏️ EDITAR
                        </button>
                        <button onclick="window.APP.products.delete('${p.id}')" class="flex-1 bg-red-600 hover:bg-red-500 py-2 rounded-2xl font-bold text-xs text-white transition-all">
                            🗑️ DELETAR
                        </button>
                    </div>
                </div>
            `).join('');

            if (window.lucide) lucide.createIcons();
            log('✅ Seller grid renderizado', 'success');

        } catch (err) {
            log(`❌ Erro ao renderizar seller: ${err.message}`, 'error');
        }
    },

    // ============================================================
    // MODAL DE PRODUTO — CRIAR / EDITAR (com galeria de mídia)
    // ============================================================

    openModal() {
        try {
            if (!window.APP?.auth?.isLoggedIn()) {
                alert('❌ Você precisa fazer login');
                window.APP.auth.openAuthModal();
                return;
            }

            if (!window.APP.auth.userId) {
                alert('❌ Erro ao identificar usuário. Tente fazer login novamente.');
                log('❌ userId undefined ao abrir modal', 'error');
                return;
            }

            this.editingId = null;
            this._mediaState = { existing: [], newFiles: [], removedIds: [] };

            ['p-name', 'p-price', 'p-cost', 'p-stock', 'p-desc'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });

            const minStockEl = document.getElementById('p-min-stock');
            if (minStockEl) minStockEl.value = 5;

            const categoryEl = document.getElementById('p-category');
            if (categoryEl) categoryEl.value = '';

            const mediaInput = document.getElementById('p-media-input');
            if (mediaInput) mediaInput.value = '';

            this._bindMediaInput();
            this._renderMediaPreview();

            const title = document.querySelector('#admin-modal h3');
            if (title) title.innerText = 'NOVO PRODUTO';

            document.getElementById('admin-modal')?.classList.remove('hidden');
            log('✅ Modal de produto aberto', 'success');

        } catch (err) {
            log(`❌ Erro ao abrir modal: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    closeModal() {
        try {
            document.getElementById('admin-modal')?.classList.add('hidden');
            this.editingId = null;
        } catch (err) {
            log(`❌ Erro ao fechar modal: ${err.message}`, 'error');
        }
    },

    /**
     * ✅ NOVO (v5.0): busca o produto na lista de gestão (já carregada)
     * pelo id e abre o modal de edição — substitui o padrão antigo de
     * passar o objeto inteiro em JSON dentro do onclick (ficou grande
     * demais depois que cada produto passou a carregar até 5 itens de
     * mídia junto).
     */
    editById(productId) {
        const product = this.manageProducts.find(p => p.id === productId);
        if (!product) { alert('❌ Produto não encontrado'); return; }
        this.edit(product);
    },

    edit(product) {
        try {
            if (!window.APP.auth.canEditProduct(product.owner_id)) {
                alert('❌ Você não tem permissão para editar este produto');
                return;
            }

            this.editingId = product.id;
            this._mediaState = {
                existing: (product.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order),
                newFiles: [],
                removedIds: []
            };

            document.getElementById('p-name').value = product.name || '';
            document.getElementById('p-price').value = product.price || 0;
            document.getElementById('p-cost').value = product.cost_price || 0;
            document.getElementById('p-stock').value = product.stock || 0;
            document.getElementById('p-desc').value = product.description || '';

            const minStockEl = document.getElementById('p-min-stock');
            if (minStockEl) minStockEl.value = product.min_stock ?? 5;

            const categoryEl = document.getElementById('p-category');
            if (categoryEl) categoryEl.value = product.category || '';

            const mediaInput = document.getElementById('p-media-input');
            if (mediaInput) mediaInput.value = '';

            this._bindMediaInput();
            this._renderMediaPreview();

            const title = document.querySelector('#admin-modal h3');
            if (title) title.innerText = `✏️ EDITAR: ${product.name}`;

            document.getElementById('admin-modal')?.classList.remove('hidden');
            log(`✏️ Editando: ${product.name}`, 'info');

        } catch (err) {
            log(`❌ Erro ao editar: ${err.message}`, 'error');
        }
    },

    // ===== GALERIA DE MÍDIA NO FORMULÁRIO =====

    _bindMediaInput() {
        const input = document.getElementById('p-media-input');
        if (!input || input.dataset.bound) return;
        input.dataset.bound = '1';

        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);

            for (const file of files) {
                const existingCount = this._mediaState.existing.filter(m => !this._mediaState.removedIds.includes(m.id)).length;
                const currentTotal = existingCount + this._mediaState.newFiles.length;

                if (currentTotal >= PRODUCT_MEDIA_MAX) {
                    alert(`❌ Máximo de ${PRODUCT_MEDIA_MAX} fotos/vídeos por produto.`);
                    break;
                }

                const isImage = file.type.startsWith('image/');
                const isVideo = file.type.startsWith('video/');

                if (!isImage && !isVideo) {
                    alert(`❌ "${file.name}" não é uma imagem nem um vídeo válido.`);
                    continue;
                }
                if (file.size > PRODUCT_MEDIA_MAX_SIZE) {
                    alert(`❌ "${file.name}" passa de 20MB.`);
                    continue;
                }

                this._mediaState.newFiles.push(file);
            }

            input.value = ''; // permite escolher o mesmo arquivo de novo, se removido depois
            this._renderMediaPreview();
        });
    },

    _renderMediaPreview() {
        const wrap = document.getElementById('p-media-preview');
        if (!wrap) return;

        const existing = this._mediaState.existing.filter(m => !this._mediaState.removedIds.includes(m.id));
        const totalCount = existing.length + this._mediaState.newFiles.length;

        const existingTiles = existing.map(m => `
            <div class="media-tile">
                ${m.media_type === 'video'
                    ? `<div class="media-tile-video">🎥</div>`
                    : `<img src="${m.media_url}" alt="">`
                }
                <button type="button" class="media-tile-remove" onclick="window.APP.products._removeExistingMedia('${m.id}')" aria-label="Remover">✕</button>
            </div>
        `).join('');

        const newTiles = this._mediaState.newFiles.map((file, i) => {
            const isVideo = file.type.startsWith('video/');
            const url = URL.createObjectURL(file);
            return `
                <div class="media-tile">
                    ${isVideo ? `<div class="media-tile-video">🎥</div>` : `<img src="${url}" alt="">`}
                    <button type="button" class="media-tile-remove" onclick="window.APP.products._removeNewMedia(${i})" aria-label="Remover">✕</button>
                </div>
            `;
        }).join('');

        wrap.innerHTML = existingTiles + newTiles || `<div class="media-tile-empty">Nenhuma foto/vídeo ainda</div>`;

        const counterEl = document.getElementById('p-media-count');
        if (counterEl) counterEl.textContent = `(${totalCount}/${PRODUCT_MEDIA_MAX})`;

        const input = document.getElementById('p-media-input');
        if (input) input.disabled = totalCount >= PRODUCT_MEDIA_MAX;
    },

    _removeExistingMedia(mediaId) {
        this._mediaState.removedIds.push(mediaId);
        this._renderMediaPreview();
    },

    _removeNewMedia(index) {
        this._mediaState.newFiles.splice(index, 1);
        this._renderMediaPreview();
    },

    /**
     * Sobe as fotos/vídeos novos e apaga (Storage + banco) os que
     * foram removidos na tela. Chamado depois que o produto já tem um
     * id (seja recém-criado, seja em edição). O gatilho do banco cuida
     * sozinho de manter products.image_url = primeira foto da galeria.
     */
    async _syncProductMedia(productId) {
        for (const mediaId of this._mediaState.removedIds) {
            const item = this._mediaState.existing.find(m => m.id === mediaId);
            if (item) await this._deleteMediaStorageFile(item.media_url);
            await _supabase.from('product_media').delete().eq('id', mediaId);
        }

        if (!this._mediaState.newFiles.length) return;

        const remaining = this._mediaState.existing.filter(m => !this._mediaState.removedIds.includes(m.id));
        let nextOrder = remaining.length ? Math.max(...remaining.map(m => m.sort_order)) + 1 : 0;

        for (const file of this._mediaState.newFiles) {
            const isVideo = file.type.startsWith('video/');
            const fileName = `${productId}-${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;

            const { error: uploadError } = await _supabase.storage.from('product-images').upload(fileName, file);
            if (uploadError) { log(`⚠️ Falha ao subir "${file.name}": ${uploadError.message}`, 'warning'); continue; }

            const { data: publicUrl } = _supabase.storage.from('product-images').getPublicUrl(fileName);

            const { error: insertError } = await _supabase.from('product_media').insert([{
                product_id: productId,
                media_url: publicUrl.publicUrl,
                media_type: isVideo ? 'video' : 'image',
                sort_order: nextOrder
            }]);
            if (insertError) log(`⚠️ Falha ao registrar mídia "${file.name}": ${insertError.message}`, 'warning');

            nextOrder++;
        }
    },

    _deleteMediaStorageFile(url) {
        try {
            const path = url.split('/product-images/')[1];
            if (!path) return Promise.resolve();
            return _supabase.storage.from('product-images').remove([decodeURIComponent(path)]);
        } catch {
            return Promise.resolve();
        }
    },

    async saveProductDirect() {
        const btn = document.getElementById('btn-save');
        const originalText = btn?.innerText;

        try {
            if (btn) { btn.disabled = true; btn.innerText = '⏳ SALVANDO...'; }

            if (!window.APP.auth.isLoggedIn()) throw new Error('Você precisa estar logado');
            if (!window.APP.auth.userId) throw new Error('Erro ao identificar usuário');

            const name = document.getElementById('p-name')?.value?.trim();
            const price = parseFloat(document.getElementById('p-price')?.value);
            const category = document.getElementById('p-category')?.value?.trim();

            if (!name) throw new Error('Nome é obrigatório');
            if (!price || price < 0) throw new Error('Preço deve ser válido');
            if (!category) throw new Error('Selecione uma categoria');

            // owner_id NÃO entra aqui por padrão. Só é adicionado
            // explicitamente no ramo de CRIAÇÃO (insert), logo abaixo.
            const productData = {
                name,
                price,
                category,
                cost_price: parseFloat(document.getElementById('p-cost')?.value) || 0,
                stock: parseInt(document.getElementById('p-stock')?.value) || 0,
                min_stock: parseInt(document.getElementById('p-min-stock')?.value) || 5,
                description: document.getElementById('p-desc')?.value?.trim() || '',
                active: true
            };

            let productId = this.editingId;

            if (this.editingId) {
                const product = this.manageProducts.find(p => p.id === this.editingId);
                if (!window.APP.auth.canEditProduct(product?.owner_id)) {
                    throw new Error('Você não tem permissão para editar este produto');
                }

                // UPDATE nunca inclui owner_id — o dono original do
                // produto é preservado (o banco também garante isso via
                // gatilho, como segunda camada de defesa).
                const { error } = await _supabase.from('products').update(productData).eq('id', this.editingId);
                if (error) throw error;
            } else {
                productData.owner_id = window.APP.auth.userId;

                const { data, error } = await _supabase.from('products').insert([productData]).select('id');
                if (error) throw error;
                productId = data[0].id;
            }

            // Galeria de mídia (até 5 fotos/vídeos) — image_url é
            // mantido em dia sozinho pelo gatilho do banco.
            await this._syncProductMedia(productId);

            log(this.editingId ? '✅ Produto atualizado' : '✅ Produto criado', 'success');
            alert(this.editingId ? '✅ Produto atualizado!' : '✅ Produto criado!');

            this.closeModal();
            await this.fetchAll();

        } catch (err) {
            log(`❌ Erro ao salvar: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
        }
    },

    async saveProduct(event) {
        if (event) event.preventDefault();
        await this.saveProductDirect();
    },

    async delete(productId) {
        try {
            const product = this.manageProducts.find(p => p.id === productId);

            if (!window.APP.auth.canEditProduct(product?.owner_id)) {
                alert('❌ Você não tem permissão para deletar este produto');
                return;
            }

            if (!confirm(`⚠️ Deletar "${product.name}"?`)) return;
            if (!confirm('❌ ATENÇÃO: IRREVERSÍVEL!')) return;

            log(`🗑️ Deletando ${productId}...`, 'info');

            // Apaga os arquivos da galeria no Storage — o banco já apaga
            // as LINHAS de product_media sozinho (ON DELETE CASCADE),
            // mas isso não apaga os arquivos de dentro do bucket.
            for (const m of (product.product_media || [])) {
                await this._deleteMediaStorageFile(m.media_url);
            }

            const { error } = await _supabase.from('products').delete().eq('id', productId);
            if (error) throw error;

            log('✅ Produto deletado', 'success');
            alert('✅ Produto removido!');
            await this.fetchAll();

        } catch (err) {
            log(`❌ Erro ao deletar: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    }
};
