/**
 * PRODUCTS.JS v5.1
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
 * ✅ v5.1 NOVO: a consulta de perfil do vendedor (já pública, usada pra
 *    mostrar nome/telefone na vitrine) agora também traz `pix_key` —
 *    é o que permite ao checkout (orders.js) montar um bloco de Pix
 *    PRÓPRIO por vendedor, em vez de uma chave única da loja inteira.
 * ✅ v5.2 NOVO — PERFORMANCE:
 *    • fetchAll() buscava a vitrine pública e a lista de gestão em
 *      SÉRIE (uma esperava a outra terminar) — agora rodam em
 *      PARALELO (Promise.all), já que não dependem uma da outra.
 *    • Dentro de cada busca, "status online do vendedor" e "galeria de
 *      mídia" também rodavam em série — agora também em paralelo.
 *    • Fotos novas de produto passam por window.compressImage()
 *      (config.js) antes do upload — resolve a lentidão de subir foto
 *      tirada direto da câmera do celular (que costuma vir com
 *      8-15MB). Vídeos nunca são comprimidos aqui.
 * ✅ v5.3 NOVO — PRIMEIRA IMPRESSÃO: enquanto a primeira leva de
 *    produtos ainda está chegando do banco, a vitrine mostra cartões
 *    "esqueleto" (efeito de brilho/carregamento) no lugar de produtos
 *    de verdade — sem isso, quem entra pela primeira vez via internet
 *    mais lenta via um espaço em branco por alguns segundos, parecendo
 *    que a página travou.
 * ✅ v5.4 NOVO — PERFORMANCE CRÍTICA: fetchAll() foi dividido em dois
 *    métodos independentes — fetchStorefront() (a vitrine pública, que
 *    NÃO depende de login nem de cargo/role) e fetchManageable() (a
 *    lista de Admin/Estoque, que só faz sentido depois de saber quem
 *    está logado).
 * ✅ v5.5 NOVO:
 *    • FIX: o botão de favoritar (❤️) dependia do Lucide desenhar o
 *      ícone via JS depois do HTML já estar na tela — se isso demorasse
 *      um pouco (ou falhasse), o botão ficava com o círculo vazio, sem
 *      coração dentro. Trocado por um SVG desenhado direto no próprio
 *      HTML — nunca mais depende de nada carregar depois.
 *    • NOVO: setas de navegação na barra de categorias (◀ ▶), visíveis
 *      só em quem usa mouse/trackpad — no toque (celular/tablet) o
 *      gesto de arrastar já resolve, então elas ficam escondidas lá.
 * ✅ v5.6 NOVO — FIX CRÍTICO DE PERFORMANCE: _fetchManageableProducts()
 *    só filtrava por owner_id quando role === 'seller'. Pra role ===
 *    'client' (COMPRADOR COMUM logado, o tipo de conta mais comum do
 *    sistema), a condição não batia e a busca ficava SEM FILTRO NENHUM
 *    — ou seja, todo cliente logado baixava o CATÁLOGO INTEIRO da loja
 *    escondido, sem paginação, sem servir pra nada na tela dele (ele
 *    nem acessa as abas Admin/Estoque). Isso rodava a cada login,
 *    crescendo junto com o catálogo — provável maior causa isolada de
 *    lentidão pra quem só compra. Agora só busca essa lista pra quem
 *    realmente precisa (seller ou supreme); cliente comum nem dispara
 *    a consulta.
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

    // ✅ NOVO: estado do modal de pré-visualização (Admin/Estoque) —
    // galeria de fotos/vídeos do produto sendo visualizado no momento.
    _previewMedia: [],
    _previewIndex: 0,

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
                bulk_min_qty,
                bulk_unit_price,
                profiles!owner_id(id, full_name, email, phone, pix_key)
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

            // ✅ v5.4 PERFORMANCE: as duas metades são independentes —
            // rodar em paralelo corta esse tempo praticamente pela
            // metade quando fetchAll() é chamado direto (ex: depois de
            // finalizar uma compra, ou trocar status do vendedor).
            await Promise.all([
                this.fetchStorefront(),
                this.fetchManageable()
            ]);

            log(`✅ Vitrine carregada (${this.products.length} produto(s) na página atual)`, 'success');
            return this.products;
        } catch (err) {
            log(`❌ Erro ao carregar produtos: ${err.message}`, 'error');
            return [];
        }
    },

    /**
     * ✅ NOVO (v5.4): só a VITRINE PÚBLICA — não depende de login nem
     * de cargo/role nenhum, então pode (e deve) começar imediatamente,
     * sem esperar Auth.init() terminar. Chamada direto por app.js logo
     * no início do boot, em paralelo com o Auth.
     */
    async fetchStorefront() {
        this._bindSearch();
        this._bindInfiniteScroll();
        this._renderSkeleton();

        this._page = 0;
        this._hasMore = true;
        await this._fetchStorefrontPage(true);
    },

    /**
     * ✅ NOVO (v5.4): só a lista de gestão (Admin/Estoque) — essa sim
     * depende de saber quem está logado (role/userId), então só faz
     * sentido chamar DEPOIS que Auth.init() já terminou.
     */
    async fetchManageable() {
        await this._fetchManageableProducts();
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
                // ✅ v5.2 PERFORMANCE: consultas independentes (tabelas
                // diferentes, campos diferentes em cada produto) — sem
                // motivo pra uma esperar a outra.
                await Promise.all([
                    this._attachVendorOnlineStatus(this.products),
                    this._attachMedia(this.products)
                ]);
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

            // ✅ v5.2 PERFORMANCE: idem — em paralelo.
            await Promise.all([
                this._attachVendorOnlineStatus(page),
                this._attachMedia(page)
            ]);
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
     * ✅ FIX CRÍTICO v5.6: o filtro por owner_id só era aplicado quando
     * role === 'seller'. Pra role === 'client' (COMPRADOR COMUM
     * logado — o tipo de conta mais comum do sistema), a condição não
     * batia e a busca ficava SEM FILTRO NENHUM — ou seja, todo cliente
     * logado baixava o CATÁLOGO INTEIRO da loja escondido, sem
     * paginação, sem servir pra absolutamente nada na tela dele (ele
     * nem tem acesso às abas Admin/Estoque). Isso rodava silenciosamente
     * a cada login, e crescia junto com o catálogo — provavelmente a
     * maior causa isolada de lentidão pra quem compra. Agora só busca
     * essa lista pra quem realmente PRECISA dela (seller ou supreme);
     * cliente comum nem dispara a consulta.
     */
    async _fetchManageableProducts() {
        const role = window.APP?.auth?.role;
        const isManager = role === 'seller' || role === 'supreme';

        if (!window.APP?.auth?.userId || !isManager) {
            this.manageProducts = [];
            return;
        }

        try {
            let query = this._baseQuery();
            if (role === 'seller') {
                query = query.eq('owner_id', window.APP.auth.userId);
            }

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;

            this.manageProducts = data || [];
            // ✅ v5.2 PERFORMANCE: idem — em paralelo.
            await Promise.all([
                this._attachVendorOnlineStatus(this.manageProducts),
                this._attachMedia(this.manageProducts)
            ]);

            this.renderAdmin();
            if (role === 'seller') this.renderSeller();
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

    /**
     * ✅ NOVO (v5.3): cartões "esqueleto" — só efeito visual de
     * carregamento (sem dado nenhum ainda), mostrados por
     * fetchAll()/filterByCategory()/toggleShowFavorites() enquanto a
     * consulta de verdade ainda não voltou do banco. render() (chamado
     * assim que os dados chegam) sobrescreve isso normalmente, já que
     * ambos escrevem direto em #product-grid.
     */
    _renderSkeleton(count = 8) {
        const grid = document.getElementById('product-grid');
        if (!grid) return;

        grid.innerHTML = Array.from({ length: count }).map(() => `
            <div class="skeleton-card" aria-hidden="true">
                <div class="skeleton-block skeleton-img"></div>
                <div class="skeleton-block skeleton-line" style="width:40%"></div>
                <div class="skeleton-block skeleton-line" style="width:80%"></div>
                <div class="skeleton-block skeleton-line" style="width:55%"></div>
                <div class="skeleton-block skeleton-line" style="width:100%;height:2.5rem"></div>
            </div>
        `).join('');
    },

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

        // ✅ NOVO: preço por atacado — se o produto tem desconto configurado
        // pro vendedor, mostra o aviso na vitrine ("compre X ou mais e cada
        // unidade sai por R$Y"). O valor cobrado de verdade é sempre
        // recalculado no banco (create_order), então esse selo é só o
        // reflexo do que já vale de fato.
        const hasBulkPricing = !!(p.bulk_min_qty && p.bulk_unit_price);
        const bulkBadge = hasBulkPricing ? `
            <div class="product-bulk-badge">
                📦 Compre <strong>${p.bulk_min_qty}+</strong> e pague <strong>R$ ${window.formatBRL(p.bulk_unit_price)}</strong> cada
            </div>
        ` : '';

        return `
            <div style="--i:${idx}" class="bg-slate-900/40 p-6 rounded-[32px] border border-white/5 flex flex-col gap-4 hover:border-blue-500/30 transition-all ${!vendorOnline ? 'opacity-60' : ''}">
                <div class="relative">
                    ${this._renderGallery(p, nome)}
                    <button type="button"
                        onclick="window.APP.products.toggleFavorite('${p.id}')"
                        class="product-fav-btn ${this.isFavorite(p.id) ? 'is-fav' : ''}"
                        aria-label="Favoritar produto"
                        title="Favoritar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                        </svg>
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
                ${bulkBadge}
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
                    data-bulk-min-qty="${p.bulk_min_qty || ''}"
                    data-bulk-unit-price="${p.bulk_unit_price || ''}"
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

        // ✅ NOVO: garante que as setas de navegação (desktop) estão
        // ligadas e com o estado (mostrar/esconder) certo pro conteúdo
        // que acabou de ser montado.
        this._bindCategoryScrollArrows();
        this._updateCategoryScrollArrows?.();
    },

    /**
     * ✅ NOVO: rola a faixa de categorias pro lado — chamada pelas
     * setinhas que só aparecem em quem usa mouse/trackpad (no toque, o
     * gesto de arrastar já resolve sozinho).
     */
    scrollCategoryBar(direction) {
        const bar = document.getElementById('category-filter-bar');
        if (!bar) return;
        bar.scrollBy({ left: direction * 240, behavior: 'smooth' });
    },

    /**
     * ✅ NOVO: liga (uma única vez) o listener que mostra/esconde cada
     * seta conforme o ponto em que a faixa está rolada — não faz
     * sentido mostrar "← anteriores" já no início, nem "próximas →"
     * quando já chegou no fim.
     */
    _bindCategoryScrollArrows() {
        if (this._categoryArrowsBound) return;

        const bar = document.getElementById('category-filter-bar');
        const leftBtn = document.getElementById('category-scroll-left');
        const rightBtn = document.getElementById('category-scroll-right');
        if (!bar || !leftBtn || !rightBtn) return;

        this._categoryArrowsBound = true;

        const update = () => {
            const maxScroll = bar.scrollWidth - bar.clientWidth;
            const atStart = bar.scrollLeft <= 4;
            const atEnd = maxScroll <= 4 || bar.scrollLeft >= maxScroll - 4;

            leftBtn.classList.toggle('is-hidden', atStart);
            rightBtn.classList.toggle('is-hidden', atEnd);

            // ✅ NOVO: indicador visual (esmaecido nas bordas) de que há
            // mais categorias pra ver — funciona em qualquer tela, mas é
            // especialmente importante no celular, onde as setinhas
            // ficam escondidas (lá o gesto de arrastar já resolve, mas
            // sem esmaecimento não dava pra "ver" que tinha mais coisa).
            bar.classList.toggle('has-more-left', !atStart);
            bar.classList.toggle('has-more-right', !atEnd);
        };

        bar.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);

        this._updateCategoryScrollArrows = update;
        update();
    },

    filterByCategory(category) {
        this.activeCategory = category;
        this.showFavoritesOnly = false;
        this._page = 0;
        this._hasMore = true;
        this._renderSkeleton();
        this._fetchStorefrontPage(true);
    },

    toggleShowFavorites() {
        this.showFavoritesOnly = !this.showFavoritesOnly;
        this._page = 0;
        this._hasMore = true;
        this._renderSkeleton();
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

        if (idx >= 0) {
            favs.splice(idx, 1);
        } else {
            favs.push(productId);
            // ✅ NOVO: conta como missão de onboarding só quando ADICIONA
            // (não quando desfavorita).
            window.APP?.onboarding?.markMission?.('fav');
        }

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
                list.innerHTML = '<div class="col-span-full text-slate-600 text-center py-8">Nenhum produto</div>';
                return;
            }

            // ✅ NOVO: cartão compacto com miniatura da foto — cabem bem
            // mais produtos na tela de uma vez (grid, não lista empilhada),
            // e o botão 👁️ abre uma pré-visualização rápida (foto grande
            // + todos os dados) sem precisar entrar no modo de edição.
            list.innerHTML = filtrado.map(p => {
                const thumbUrl = p.image_url || (p.product_media || [])[0]?.media_url || '';
                const thumb = thumbUrl
                    ? `<img src="${thumbUrl}" alt="${window.escapeHtml(p.name)}" class="admin-card-thumb" loading="lazy" onerror="if(!this.dataset.err){this.dataset.err=1;this.src=PRODUCT_PLACEHOLDER}">`
                    : `<div class="admin-card-thumb admin-card-thumb-empty">SEM<br>IMAGEM</div>`;

                const stock = p.stock || 0;
                const minStock = p.min_stock ?? 5;
                const stockColor = stock > minStock ? 'text-green-500' : stock > 0 ? 'text-yellow-500' : 'text-red-500';

                return `
                    <div class="admin-card">
                        <div class="admin-card-top">
                            ${thumb}
                            <div class="admin-card-info">
                                <span class="admin-card-name" title="${window.escapeHtml(p.name)}">${window.escapeHtml(p.name)}</span>
                                <span class="admin-card-badge">${window.escapeHtml(p.category || 'Outros')}</span>
                                <span class="admin-card-vendor" title="${window.escapeHtml(p.profiles?.full_name || 'Desconhecido')}">👤 ${window.escapeHtml(p.profiles?.full_name || 'Desconhecido')}</span>
                            </div>
                        </div>

                        <div class="admin-card-meta">
                            <span class="admin-card-price">R$ ${window.formatBRL(p.price)}</span>
                            <span class="admin-card-stock ${stockColor}">Estoque: ${stock} <span class="text-slate-600 font-normal">(mín: ${minStock})</span></span>
                        </div>

                        ${p.bulk_min_qty && p.bulk_unit_price ? `<div class="admin-card-bulk">📦 ${p.bulk_min_qty}+ un. = R$ ${window.formatBRL(p.bulk_unit_price)} cada</div>` : ''}

                        <div class="admin-card-actions">
                            <button onclick="window.APP.products.previewById('${p.id}')" class="admin-card-btn admin-card-btn-view" title="Visualizar">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>
                            <button onclick="window.APP.products.editById('${p.id}')" class="admin-card-btn admin-card-btn-edit" title="Editar">
                                <i data-lucide="edit-3" class="w-4 h-4"></i>
                            </button>
                            <button onclick="window.APP.products.delete('${p.id}')" class="admin-card-btn admin-card-btn-delete" title="Deletar">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

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
                    ${p.bulk_min_qty && p.bulk_unit_price ? `<div class="text-xs text-cyan-400 font-semibold -mt-2">📦 Atacado: ${p.bulk_min_qty}+ un. = R$ ${window.formatBRL(p.bulk_unit_price)} cada</div>` : ''}

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

            const bulkMinQtyEl = document.getElementById('p-bulk-min-qty');
            const bulkUnitPriceEl = document.getElementById('p-bulk-unit-price');
            if (bulkMinQtyEl) bulkMinQtyEl.value = '';
            if (bulkUnitPriceEl) bulkUnitPriceEl.value = '';

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

    /**
     * ✅ NOVO: abre o modal de pré-visualização (só leitura) — o botão
     * 👁️ no painel Admin/Estoque, pra conferir rapidamente as fotos e
     * os dados de um produto sem precisar entrar no modo de edição.
     */
    previewById(productId) {
        const product = this.manageProducts.find(p => p.id === productId);
        if (!product) { alert('❌ Produto não encontrado'); return; }
        this.openPreview(product);
    },

    openPreview(product) {
        this._previewMedia = (product.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order);
        this._previewIndex = 0;

        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

        set('preview-category', product.category || 'Outros');
        set('preview-name', product.name || 'Sem nome');
        set('preview-vendor', `👤 ${product.profiles?.full_name || 'Desconhecido'}`);
        set('preview-desc', product.description || 'Sem descrição.');
        set('preview-price', `R$ ${window.formatBRL(product.price)}`);

        const stock = product.stock || 0;
        const minStock = product.min_stock ?? 5;
        const stockEl = document.getElementById('preview-stock');
        if (stockEl) {
            stockEl.textContent = `Estoque: ${stock} (mín: ${minStock})`;
            stockEl.className = `text-xs font-black ${stock > minStock ? 'text-green-500' : stock > 0 ? 'text-yellow-500' : 'text-red-500'}`;
        }

        const bulkEl = document.getElementById('preview-bulk');
        if (bulkEl) {
            bulkEl.textContent = (product.bulk_min_qty && product.bulk_unit_price)
                ? `📦 Atacado: ${product.bulk_min_qty}+ un. = R$ ${window.formatBRL(product.bulk_unit_price)} cada`
                : '';
        }

        // O botão "Editar" do preview leva direto pro modo de edição
        // desse mesmo produto, fechando o preview antes.
        const editBtn = document.getElementById('preview-edit-btn');
        if (editBtn) {
            editBtn.onclick = () => {
                this.closePreview();
                this.editById(product.id);
            };
        }

        this._renderPreviewMedia();

        document.getElementById('product-preview-modal')?.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    },

    closePreview() {
        document.getElementById('product-preview-modal')?.classList.add('hidden');
        const video = document.getElementById('preview-media-video');
        if (video) video.pause?.();
    },

    /**
     * Desenha a foto/vídeo atual da galeria do produto em preview,
     * junto com as setas ◀ ▶ e o contador (1/3, 2/3...) — só aparecem
     * quando o produto tem mais de uma foto/vídeo cadastrado.
     */
    _renderPreviewMedia() {
        const img = document.getElementById('preview-media-img');
        const video = document.getElementById('preview-media-video');
        const empty = document.getElementById('preview-media-empty');
        const prevBtn = document.getElementById('preview-media-prev');
        const nextBtn = document.getElementById('preview-media-next');
        const counter = document.getElementById('preview-media-counter');
        if (!img || !video || !empty || !prevBtn || !nextBtn || !counter) return;

        const media = this._previewMedia;
        const total = media.length;

        video.pause?.();

        if (!total) {
            img.classList.add('hidden');
            video.classList.add('hidden');
            empty.classList.remove('hidden');
            prevBtn.classList.add('hidden');
            nextBtn.classList.add('hidden');
            counter.classList.add('hidden');
            return;
        }

        empty.classList.add('hidden');
        const current = media[this._previewIndex];

        if (current.media_type === 'video') {
            img.classList.add('hidden');
            video.classList.remove('hidden');
            video.src = current.media_url;
        } else {
            video.classList.add('hidden');
            img.classList.remove('hidden');
            img.dataset.err = '';
            img.onerror = () => { if (!img.dataset.err) { img.dataset.err = '1'; img.src = PRODUCT_PLACEHOLDER; } };
            img.src = current.media_url;
        }

        const showControls = total > 1;
        prevBtn.classList.toggle('hidden', !showControls);
        nextBtn.classList.toggle('hidden', !showControls);
        counter.classList.toggle('hidden', !showControls);
        counter.textContent = `${this._previewIndex + 1}/${total}`;
    },

    _previewStep(direction) {
        const total = this._previewMedia.length;
        if (!total) return;
        this._previewIndex = (this._previewIndex + direction + total) % total;
        this._renderPreviewMedia();
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

            const bulkMinQtyEl = document.getElementById('p-bulk-min-qty');
            const bulkUnitPriceEl = document.getElementById('p-bulk-unit-price');
            if (bulkMinQtyEl) bulkMinQtyEl.value = product.bulk_min_qty ?? '';
            if (bulkUnitPriceEl) bulkUnitPriceEl.value = product.bulk_unit_price ?? '';

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

            // ✅ v5.2 PERFORMANCE: comprime a foto antes de subir (vídeo
            // nunca passa por aqui — window.compressImage() já ignora
            // qualquer arquivo que não seja imagem, mas o check aqui
            // deixa explícito e evita gastar tempo chamando a função à
            // toa pra vídeo).
            const uploadFile = isVideo
                ? file
                : await (window.compressImage ? window.compressImage(file) : Promise.resolve(file));

            const fileName = `${productId}-${Date.now()}-${Math.random().toString(36).slice(2)}-${uploadFile.name}`;

            const { error: uploadError } = await _supabase.storage.from('product-images').upload(fileName, uploadFile);
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

            // ✅ NOVO: preço por atacado — opcional. Se o vendedor
            // preencher só um dos dois campos, avisa (o banco também
            // recusaria, mas é melhor avisar aqui antes de tentar salvar).
            const bulkMinQtyRaw = document.getElementById('p-bulk-min-qty')?.value?.trim();
            const bulkUnitPriceRaw = document.getElementById('p-bulk-unit-price')?.value?.trim();
            const bulkMinQty = bulkMinQtyRaw ? parseInt(bulkMinQtyRaw) : null;
            const bulkUnitPrice = bulkUnitPriceRaw ? parseFloat(bulkUnitPriceRaw) : null;

            if ((bulkMinQty && !bulkUnitPrice) || (!bulkMinQty && bulkUnitPrice)) {
                throw new Error('Preencha os DOIS campos do preço por atacado (quantidade mínima e preço por unidade), ou deixe os dois em branco');
            }
            if (bulkMinQty && bulkMinQty < 2) {
                throw new Error('A quantidade mínima do preço por atacado precisa ser 2 ou mais');
            }
            if (bulkUnitPrice && bulkUnitPrice >= price) {
                throw new Error('O preço por atacado precisa ser MENOR que o preço normal (senão não é desconto nenhum)');
            }

            // owner_id NÃO entra aqui por padrão. Só é adicionado
            // explicitamente no ramo de CRIAÇÃO (insert), logo abaixo.
            const productData = {
                name,
                price,
                category,
                cost_price: parseFloat(document.getElementById('p-cost')?.value) || 0,
                stock: parseInt(document.getElementById('p-stock')?.value) || 0,
                min_stock: parseInt(document.getElementById('p-min-stock')?.value) || 5,
                bulk_min_qty: bulkMinQty,
                bulk_unit_price: bulkUnitPrice,
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

            // ✅ NOVO: missão de onboarding — só conta na CRIAÇÃO
            // (edição de um produto já existente não é "o primeiro").
            if (!this.editingId) window.APP?.onboarding?.markMission?.('product');

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
