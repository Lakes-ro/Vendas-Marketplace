/**
 * PRODUCTS.JS v5.8
 * v5.8 NOVO: GIRAR FOTO — botão ↻ na pré-visualização (qualquer pessoa
 *    gira pra ver; dono/Admin pode "Salvar foto girada") e em cada foto
 *    do formulário de produto (nova ou já publicada).
 * v5.7 (auditoria):
 *  - SEGURANÇA: chips de categoria sem onclick inline (XSS via nome de
 *    categoria); URLs de mídia e textos escapados
 *  - vitrine pública não baixa mais cost_price (custo/margem do vendedor)
 *  - editar produto NÃO manda mais active:true (burlava bloqueio da moderação)
 *  - busca/categoria nunca são ignoradas enquanto outra página carrega
 *  - excluir produto: apaga no banco primeiro, fotos do Storage depois
 *  - uploads em pasta do próprio usuário, com nome de arquivo limpo
 *  - erro ao salvar promoções agora aparece pro vendedor
 *  - sem vazamento de listeners/observers a cada re-render
 */

const PRODUCT_PLACEHOLDER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='160' viewBox='0 0 200 160'%3E%3Crect width='200' height='160' fill='%231e293b'/%3E%3Crect x='70' y='45' width='60' height='50' rx='6' fill='%23334155'/%3E%3Ccircle cx='100' cy='115' r='8' fill='%23334155'/%3E%3Ctext x='100' y='145' text-anchor='middle' font-size='11' fill='%2364748b' font-family='sans-serif'%3ESem imagem%3C/text%3E%3C/svg%3E`;

const PRODUCT_MEDIA_MAX = 5;
const PRODUCT_MEDIA_MAX_SIZE = 20 * 1024 * 1024;

const PUBLIC_PRODUCT_FIELDS = `
    id, name, price, stock, min_stock, category, description, image_url,
    owner_id, active, created_at, sales_count, bulk_min_qty, bulk_unit_price,
    profiles!owner_id(id, full_name, phone, pix_key)
`;
const MANAGE_PRODUCT_FIELDS = `
    id, name, price, cost_price, stock, min_stock, category, description, image_url,
    owner_id, active, flagged, flag_reason, created_at, sales_count,
    bulk_min_qty, bulk_unit_price,
    profiles!owner_id(id, full_name, phone, pix_key)
`;

const Products = {
    editingId: null,
    products: [],
    manageProducts: [],
    _manageState: 'idle',
    _managePromise: null,
    _manageKey: '',
    activeCategory: 'Todas',
    _allCategories: [],
    _bulkTiers: [],
    searchQuery: '',
    showFavoritesOnly: false,

    _page: 0,
    _pageSize: 24,
    _hasMore: true,
    _loadingMore: false,
    _requestToken: 0,

    _mediaState: { existing: [], newFiles: [], removedIds: [] },
    _objectUrls: [],
    _galleryObservers: [],

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

    _baseQuery(manage = false) {
        let query = _supabase.from('products').select(manage ? MANAGE_PRODUCT_FIELDS : PUBLIC_PRODUCT_FIELDS);
        if (!manage) query = query.eq('active', true);
        return query;
    },

    /**
     * .in() com muitos ids gera URL gigante (erro 414 / lentidão).
     * Busca em lotes de 100 e junta o resultado.
     */
    async _selectInChunks(table, fields, column, ids, orderBy) {
        const CHUNK = 100;
        const batches = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
            let q = _supabase.from(table).select(fields).in(column, ids.slice(i, i + CHUNK));
            if (orderBy) q = q.order(orderBy, { ascending: true });
            batches.push(q);
        }
        const results = await Promise.all(batches);
        const rows = [];
        for (const r of results) {
            if (r.error) throw r.error;
            rows.push(...(r.data || []));
        }
        return rows;
    },

    async _attachMedia(list) {
        if (!list || !list.length) return;
        try {
            const data = await this._selectInChunks('product_media',
                'id, product_id, media_url, media_type, sort_order', 'product_id', list.map(p => p.id));

            const byProduct = {};
            (data || []).forEach(m => { (byProduct[m.product_id] = byProduct[m.product_id] || []).push(m); });
            list.forEach(p => { p.product_media = byProduct[p.id] || []; });
        } catch (err) {
            log(`⚠️ Galeria de mídia: ${err.message}`, 'warning');
            list.forEach(p => { if (!p.product_media) p.product_media = []; });
        }
    },

    async _attachBulkTiers(list) {
        if (!list || !list.length) return;
        try {
            const data = await this._selectInChunks('product_bulk_tiers',
                'id, product_id, min_qty, unit_price, total_price', 'product_id', list.map(p => p.id), 'min_qty');

            const byProduct = {};
            (data || []).forEach(t => { (byProduct[t.product_id] = byProduct[t.product_id] || []).push(t); });
            list.forEach(p => { p.bulk_tiers = byProduct[p.id] || []; });
        } catch (err) {
            log(`⚠️ Faixas de atacado: ${err.message}`, 'warning');
            list.forEach(p => { if (!p.bulk_tiers) p.bulk_tiers = []; });
        }
    },

    async _attachVendorOnlineStatus(list) {
        try {
            if (!list || !list.length) return;
            const ownerIds = [...new Set(list.map(p => p.owner_id).filter(Boolean))];
            if (!ownerIds.length) return;

            const data = await this._selectInChunks('vendor_status', 'owner_id, is_online', 'owner_id', ownerIds);

            const onlineMap = {};
            (data || []).forEach(v => { onlineMap[v.owner_id] = v.is_online; });
            list.forEach(p => {
                p.vendor_online = Object.prototype.hasOwnProperty.call(onlineMap, p.owner_id) ? onlineMap[p.owner_id] : true;
            });
        } catch (err) {
            log(`⚠️ Status dos vendedores: ${err.message}`, 'warning');
            (list || []).forEach(p => { if (p.vendor_online === undefined) p.vendor_online = true; });
        }
    },

    async _enrich(list) {
        await Promise.all([
            this._attachVendorOnlineStatus(list),
            this._attachMedia(list),
            this._attachBulkTiers(list)
        ]);
    },

    _resolveBulkTiers(product) {
        if (product?.bulk_tiers && product.bulk_tiers.length) {
            return product.bulk_tiers.map(t => ({
                min_qty: Number(t.min_qty),
                unit_price: Number(t.unit_price),
                total_price: t.total_price != null ? Number(t.total_price) : Number(t.unit_price) * Number(t.min_qty)
            }));
        }
        if (product?.bulk_min_qty && product?.bulk_unit_price) {
            return [{
                min_qty: Number(product.bulk_min_qty),
                unit_price: Number(product.bulk_unit_price),
                total_price: Number(product.bulk_unit_price) * Number(product.bulk_min_qty)
            }];
        }
        return [];
    },

    async _loadAllCategories() {
        const fixed = Object.keys(this.CATEGORY_ICONS).filter(c => c !== 'Todas');
        try {
            const { data, error } = await _supabase
                .from('products')
                .select('category')
                .eq('active', true)
                .not('category', 'is', null);
            if (error) throw error;

            const merged = [...fixed];
            (data || []).forEach(row => {
                const cat = (row.category || '').trim();
                if (cat && !merged.includes(cat)) merged.push(cat);
            });
            this._allCategories = merged;
        } catch (err) {
            log(`⚠️ Categorias: ${err.message}`, 'warning');
            if (!this._allCategories.length) this._allCategories = fixed;
        }
    },

    async fetchAll() {
        try {
            await Promise.all([this.fetchStorefront(), this.fetchManageable({ force: true })]);
            return this.products;
        } catch (err) {
            log(`❌ Erro ao carregar produtos: ${err.message}`, 'error');
            return [];
        }
    },

    async fetchStorefront() {
        this._bindSearch();
        this._bindCategoryClicks();
        this._bindInfiniteScroll();
        this._bindGalleryDrag();
        this._renderSkeleton();

        if (!this._allCategories.length) {
            this._loadAllCategories().then(() => this._renderCategoryFilterBar());
        }
        await this._fetchStorefrontPage(true);
    },

    /**
     * Reaproveita a busca que já está em andamento para o mesmo usuário
     * (o app dispara logo após o login e o onAuthChanged pede de novo).
     */
    fetchManageable({ force = false } = {}) {
        const key = `${window.APP?.auth?.userId || ''}|${window.APP?.auth?.role || ''}`;
        if (!force && this._managePromise && this._manageKey === key) return this._managePromise;
        this._manageKey = key;
        this._managePromise = this._fetchManageableProducts();
        return this._managePromise;
    },

    /**
     * reset=true sempre vence: descarta respostas antigas por token,
     * em vez de ignorar a busca/categoria nova enquanto outra carrega.
     */
    async _fetchStorefrontPage(reset = false) {
        if (!reset && (this._loadingMore || !this._hasMore)) return;

        const token = ++this._requestToken;
        if (reset) { this._page = 0; this._hasMore = true; }

        this._loadingMore = true;
        this._updateLoadMoreIndicator(true);

        try {
            if (this.showFavoritesOnly) {
                const ids = this.getFavorites();
                let data = [];
                if (ids.length) {
                    const res = await this._baseQuery().in('id', ids);
                    if (res.error) throw res.error;
                    data = res.data || [];
                }
                await this._enrich(data);
                if (token !== this._requestToken) return;
                this.products = data;
                this._hasMore = false;
                this.render();
                return;
            }

            const from = this._page * this._pageSize;
            const to = from + this._pageSize - 1;

            let query = this._baseQuery();
            if (this.activeCategory !== 'Todas') query = query.eq('category', this.activeCategory);

            const q = this.searchQuery.trim();
            if (q) {
                // tira caracteres que quebram o filtro OR do PostgREST
                const safe = q.replace(/[%,()*\\]/g, ' ').trim();
                if (safe) query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
            }

            const { data, error } = await query.order('created_at', { ascending: false }).range(from, to);
            if (error) throw error;

            const page = data || [];
            await this._enrich(page);
            if (token !== this._requestToken) return; // chegou uma busca mais nova

            this.products = reset ? page : [...this.products, ...page];
            this._page++;
            this._hasMore = page.length === this._pageSize;
            this.render();
        } catch (err) {
            log(`❌ Erro ao carregar vitrine: ${err.message}`, 'error');
            if (token === this._requestToken && reset) {
                const grid = document.getElementById('product-grid');
                if (grid) grid.innerHTML = '<div class="col-span-full text-slate-500 text-center py-12">Não foi possível carregar os produtos. Verifique sua conexão.</div>';
            }
        } finally {
            if (token === this._requestToken) {
                this._loadingMore = false;
                this._updateLoadMoreIndicator(false);
            }
        }
    },

    async _fetchManageableProducts() {
        const role = window.APP?.auth?.role;
        const userId = window.APP?.auth?.userId;
        const isManager = role === 'seller' || role === 'supreme';

        if (!userId || !isManager) {
            this.manageProducts = [];
            this._manageState = 'idle';
            this.renderAdmin();
            this.renderSeller();
            return;
        }

        this._manageState = 'loading';
        if (!this.manageProducts.length) { this.renderAdmin(); this.renderSeller(); }

        try {
            let query = this._baseQuery(true);
            if (role === 'seller') query = query.eq('owner_id', userId);

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;

            // 1ª pintura: já mostra a lista (foto principal, preço, estoque)
            const list = data || [];
            list.forEach(p => { p.product_media = p.product_media || []; p.bulk_tiers = p.bulk_tiers || []; });
            this.manageProducts = list;
            this._manageState = 'ready';
            this.renderAdmin();
            this.renderSeller();

            // 2ª pintura: galeria, faixas de atacado e status do vendedor
            await this._enrich(list);
            if (this.manageProducts === list) { this.renderAdmin(); this.renderSeller(); }
        } catch (err) {
            log(`❌ Produtos para gestão: ${err.message}`, 'error');
            this._manageState = 'error';
            if (!this.manageProducts.length) { this.renderAdmin(); this.renderSeller(); }
        }
    },

    _manageStatusHtml() {
        if (this._manageState === 'loading') {
            return '<div class="col-span-full text-slate-500 text-center py-8">⏳ Carregando produtos...</div>';
        }
        if (this._manageState === 'error') {
            return `<div class="col-span-full text-slate-500 text-center py-8">
                Não foi possível carregar os produtos.
                <button onclick="window.APP.products.fetchManageable({ force: true })" class="block mx-auto mt-3 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold">Tentar novamente</button>
            </div>`;
        }
        return '';
    },

    // ============================================================
    // ROLAGEM INFINITA
    // ============================================================

    _bindInfiniteScroll() {
        if (this._scrollObserver) return;
        const grid = document.getElementById('product-grid');
        if (!grid) return;

        let sentinel = document.getElementById('product-grid-sentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'product-grid-sentinel';
            sentinel.style.height = '4px';
            grid.insertAdjacentElement('afterend', sentinel);
        }

        let loadingEl = document.getElementById('product-grid-loading');
        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.id = 'product-grid-loading';
            loadingEl.className = 'text-center text-slate-500 text-xs py-6 hidden';
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
        const s = document.getElementById('product-grid-sentinel');
        if (s) s.style.display = show ? 'block' : 'none';
    },

    _updateLoadMoreIndicator(loading) {
        document.getElementById('product-grid-loading')?.classList.toggle('hidden', !loading);
    },

    // ============================================================
    // VITRINE PÚBLICA
    // ============================================================

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
            </div>`).join('');
    },

    render() {
        try {
            const grid = document.getElementById('product-grid');
            if (!grid) return;

            this._renderCategoryFilterBar();
            const list = this.products;

            if (!list || !list.length) {
                const q = this.searchQuery.trim();
                const isTrulyEmpty = !q && !this.showFavoritesOnly && this.activeCategory === 'Todas';

                if (isTrulyEmpty) {
                    grid.innerHTML = `
                        <div class="col-span-full flex flex-col items-center text-center py-16 px-4">
                            <div class="text-6xl mb-4">🏪</div>
                            <h3 class="text-xl font-bold text-white mb-2">Nenhum produto disponível ainda</h3>
                            <p class="text-slate-500 text-sm max-w-sm mb-6">Em breve novidades. Se você é da comunidade e quer vender aqui, cadastre-se como vendedor.</p>
                            <button type="button" data-product-action="become-seller" class="bg-green-600 hover:bg-green-500 text-white font-bold px-6 py-3 rounded-2xl transition-all">🚀 Quero vender</button>
                        </div>`;
                } else {
                    const msg = q
                        ? `Nenhum produto encontrado para "${escapeHtml(q)}"`
                        : this.showFavoritesOnly
                            ? 'Você ainda não favoritou nenhum produto'
                            : `Nenhum produto em "${escapeHtml(this.activeCategory)}" no momento`;
                    grid.innerHTML = `<div class="col-span-full text-slate-600 text-center py-12">${msg}</div>`;
                }
                this._toggleSentinel(false);
                return;
            }

            grid.innerHTML = list.map((p, idx) => this._renderProductCard(p, idx)).join('');
            if (window.lucide) lucide.createIcons();
            this._bindGalleryObservers();
            this._toggleSentinel(!this.showFavoritesOnly && this._hasMore);
        } catch (err) {
            log(`❌ Erro ao renderizar vitrine: ${err.message}`, 'error');
        }
    },

    _renderProductCard(p, idx) {
        const estoque = Number(p.stock) || 0;
        const vendorOnline = p.vendor_online !== false;
        const disponivel = estoque > 0 && vendorOnline;

        const nome = escapeHtml(p.name);
        const descricao = escapeHtml(p.description || '');
        const vendedor = escapeHtml(p.profiles?.full_name || 'Vendedor');
        const categoria = escapeHtml(p.category || 'Outros');
        const waLink = window.buildWhatsAppLink(p.profiles?.phone, `Olá! Vi o produto "${p.name}" na Ityrapuã Store.`);

        const isNew = p.created_at && (Date.now() - new Date(p.created_at).getTime()) < 3 * 86400000;
        const isUrgent = vendorOnline && estoque > 0 && estoque <= 3;
        const sold = Number(p.sales_count) || 0;
        const badges = `${isNew ? '<span class="product-badge badge-new">🆕 Novidade</span>' : ''}${isUrgent ? `<span class="product-badge badge-urgent">🔥 Só ${estoque} restam</span>` : ''}`;
        const soldBadge = sold > 0 ? `<span class="product-sold-count">🛍️ ${sold} vendido${sold > 1 ? 's' : ''}</span>` : '';

        const bulkTiers = this._resolveBulkTiers(p);
        const bulkBadge = bulkTiers.length ? `
            <div class="product-bulk-badge">
                <div class="product-bulk-badge-title">🏷️ Promoções</div>
                <div class="product-bulk-badge-tiers">
                    ${bulkTiers.map(t => `<span class="product-bulk-tier-pill">Leve ${t.min_qty} por <strong>R$ ${formatBRL(t.total_price)}</strong></span>`).join('')}
                </div>
            </div>` : '';

        return `
            <div style="--i:${idx}" class="bg-slate-900/40 p-6 rounded-[32px] border border-white/5 flex flex-col gap-4 hover:border-blue-500/30 transition-all ${!vendorOnline ? 'opacity-60' : ''}">
                <div class="relative">
                    ${this._renderGallery(p, nome)}
                    <button type="button" data-product-action="favorite" data-id="${escapeHtml(p.id)}"
                        class="product-fav-btn ${this.isFavorite(p.id) ? 'is-fav' : ''}" aria-label="Favoritar produto" title="Favoritar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                        </svg>
                    </button>
                </div>

                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <span class="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-blue-500/15 text-blue-300">${categoria}</span>
                    ${badges ? `<div class="product-badge-row">${badges}</div>` : ''}
                </div>

                <h3 class="text-xl font-bold text-white">${nome}</h3>
                <p class="text-slate-500 text-xs line-clamp-2">${descricao}</p>

                <div class="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-lg border border-white/5">
                    <i data-lucide="store" class="w-3 h-3 text-yellow-500"></i>
                    <span class="text-xs text-yellow-300 font-semibold truncate">Vendido por: ${vendedor}</span>
                </div>

                <div class="flex justify-between items-center">
                    <div class="text-2xl font-black text-white">R$ ${formatBRL(p.price)}</div>
                    <div class="text-xs font-black ${!vendorOnline ? 'text-orange-400' : disponivel ? 'text-green-500' : 'text-red-500'}">
                        ${!vendorOnline ? '🔌 Vendedor Offline' : disponivel ? `${estoque} em estoque` : 'Fora de estoque'}
                    </div>
                </div>
                ${bulkBadge}
                ${soldBadge ? `<div class="-mt-2">${soldBadge}</div>` : ''}

                ${waLink ? `
                    <a href="${escapeHtml(waLink)}" target="_blank" rel="noopener"
                       class="flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-xs uppercase bg-green-600/15 hover:bg-green-600/25 text-green-400 transition-all">
                        <i data-lucide="message-circle" class="w-4 h-4"></i> Falar com o Vendedor
                    </a>` : ''}

                <button
                    data-action="add-to-cart"
                    data-id="${escapeHtml(p.id)}"
                    data-name="${nome}"
                    data-price="${Number(p.price) || 0}"
                    data-stock="${estoque}"
                    data-bulk-tiers="${escapeHtml(JSON.stringify(bulkTiers))}"
                    class="bg-blue-600 py-4 rounded-2xl font-black text-xs uppercase text-white hover:bg-blue-500 transition-all ${!disponivel ? 'opacity-50 cursor-not-allowed' : ''}"
                    ${!disponivel ? 'disabled' : ''}>
                    Adicionar ao Carrinho
                </button>
            </div>`;
    },

    _mediaUrl(m) {
        return escapeHtml(safeUrl(m?.media_url) || PRODUCT_PLACEHOLDER);
    },

    _renderGallery(p, nomeEscapado) {
        const media = (p.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order);
        if (!media.length) {
            return `<div class="w-full h-44 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-600">SEM IMAGEM</div>`;
        }

        const slides = media.map(m => m.media_type === 'video'
            ? `<video class="product-gallery-item" src="${this._mediaUrl(m)}" controls muted playsinline preload="metadata"></video>`
            : `<img class="product-gallery-item" src="${this._mediaUrl(m)}" alt="${nomeEscapado}" loading="lazy" onerror="if(!this.dataset.err){this.dataset.err=1;this.src=PRODUCT_PLACEHOLDER}">`
        ).join('');

        const dots = media.length > 1
            ? `<div class="product-gallery-dots">${media.map((_, i) => `<span class="product-gallery-dot ${i === 0 ? 'active' : ''}"></span>`).join('')}</div>`
            : '';

        return `<div class="product-gallery" data-product-id="${escapeHtml(p.id)}"><div class="product-gallery-track">${slides}</div>${dots}</div>`;
    },

    _bindGalleryObservers() {
        this._galleryObservers.forEach(o => o.disconnect());
        this._galleryObservers = [];

        document.querySelectorAll('#product-grid .product-gallery').forEach(gallery => {
            const track = gallery.querySelector('.product-gallery-track');
            const dots = gallery.querySelectorAll('.product-gallery-dot');
            if (!track || dots.length < 2) return;

            const slides = Array.from(track.querySelectorAll('.product-gallery-item'));
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
                        const idx = slides.indexOf(entry.target);
                        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
                    }
                });
            }, { root: track, threshold: 0.6 });
            slides.forEach(s => observer.observe(s));
            this._galleryObservers.push(observer);
        });
    },

    /**
     * Arrastar fotos com o mouse — listeners registrados UMA vez só
     * (delegação), não um par por card a cada render.
     */
    _bindGalleryDrag() {
        if (this._dragBound) return;
        this._dragBound = true;

        let track = null, startX = 0, scrollStart = 0, moved = false;

        document.addEventListener('mousedown', (e) => {
            const t = e.target.closest('.product-gallery-track');
            if (!t || e.target.tagName === 'VIDEO') return;
            track = t;
            moved = false;
            startX = e.pageX;
            scrollStart = t.scrollLeft;
            t.classList.add('is-dragging');
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!track) return;
            if (Math.abs(e.pageX - startX) > 6) moved = true;
            track.scrollLeft = scrollStart - (e.pageX - startX);
        });

        window.addEventListener('mouseup', () => {
            if (!track) return;
            track.classList.remove('is-dragging');
            track = null;
        });

        document.addEventListener('click', (e) => {
            const t = e.target.closest('.product-gallery-track');
            if (!t) return;
            if (moved) { moved = false; return; }
            if (e.target.tagName === 'VIDEO') return;
            const productId = t.closest('.product-gallery')?.dataset.productId;
            if (!productId) return;
            const index = t.clientWidth ? Math.round(t.scrollLeft / t.clientWidth) : 0;
            this.previewById(productId, index);
        });
    },

    /** Cliques da vitrine (categoria, favorito, quero vender) — delegados. */
    _bindCategoryClicks() {
        if (this._clicksBound) return;
        this._clicksBound = true;

        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-product-action]');
            if (!el) return;
            const action = el.dataset.productAction;

            if (action === 'category') this.filterByCategory(el.dataset.category);
            else if (action === 'favorites') this.toggleShowFavorites();
            else if (action === 'favorite') this.toggleFavorite(el.dataset.id);
            else if (action === 'become-seller') {
                const auth = window.APP?.auth;
                if (auth?.isLoggedIn()) auth.becomeSeller(); else auth?.openAuthModal('signup');
            }
        });
    },

    _renderCategoryFilterBar() {
        const bar = document.getElementById('category-filter-bar');
        if (!bar) return;

        const base = this._allCategories.length
            ? this._allCategories
            : Object.keys(this.CATEGORY_ICONS).filter(c => c !== 'Todas');
        const categorias = ['Todas', ...base];
        const favCount = this.getFavorites().length;

        const chips = categorias.map(cat => {
            const isActive = !this.showFavoritesOnly && cat === this.activeCategory;
            const icon = this.CATEGORY_ICONS[cat] || '📦';
            return `
                <button type="button" data-product-action="category" data-category="${escapeHtml(cat)}"
                    class="category-chip ${isActive ? 'category-chip-active' : ''}">
                    <span class="category-chip-icon">${icon}</span>${escapeHtml(cat)}
                </button>`;
        }).join('');

        const favChip = favCount > 0 ? `
            <button type="button" data-product-action="favorites"
                class="category-chip ${this.showFavoritesOnly ? 'category-chip-active category-chip-fav' : ''}">
                <span class="category-chip-icon">❤️</span>Favoritos <span class="category-chip-count">${favCount}</span>
            </button>` : '';

        bar.innerHTML = chips + favChip;
        this._bindCategoryScrollArrows();
        this._updateCategoryScrollArrows?.();
    },

    scrollCategoryBar(direction) {
        document.getElementById('category-filter-bar')?.scrollBy({ left: direction * 240, behavior: 'smooth' });
    },

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
            bar.classList.toggle('has-more-left', !atStart);
            bar.classList.toggle('has-more-right', !atEnd);
        };
        bar.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        this._updateCategoryScrollArrows = update;
        update();
    },

    filterByCategory(category) {
        this.activeCategory = category || 'Todas';
        this.showFavoritesOnly = false;
        this._renderSkeleton();
        this._fetchStorefrontPage(true);
    },

    toggleShowFavorites() {
        this.showFavoritesOnly = !this.showFavoritesOnly;
        this._renderSkeleton();
        this._fetchStorefrontPage(true);
    },

    _bindSearch() {
        if (this._searchBound) return;
        const input = document.getElementById('market-search-input');
        const clearBtn = document.getElementById('market-search-clear');
        if (!input) return;
        this._searchBound = true;

        let timer = null;
        const run = () => {
            this.searchQuery = input.value;
            clearBtn?.classList.toggle('hidden', !input.value);
            this._fetchStorefrontPage(true);
        };
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
        clearBtn?.addEventListener('click', () => {
            input.value = '';
            clearTimeout(timer);
            run();
            input.focus();
        });
    },

    // ===== FAVORITOS =====
    getFavorites() {
        const favs = typeof Storage !== 'undefined' && Storage.get ? Storage.get('favorites', []) : [];
        return Array.isArray(favs) ? favs : [];
    },
    isFavorite(id) { return this.getFavorites().includes(id); },

    toggleFavorite(productId) {
        if (!productId) return;
        const favs = this.getFavorites();
        const idx = favs.indexOf(productId);
        if (idx >= 0) favs.splice(idx, 1);
        else {
            favs.push(productId);
            window.APP?.onboarding?.markMission?.('fav');
        }
        Storage.set('favorites', favs);

        if (this.showFavoritesOnly) {
            this.products = this.products.filter(p => favs.includes(p.id));
        }
        this.render();
    },

    // ============================================================
    // PAINÉIS DE GESTÃO
    // ============================================================

    _thumb(p, cls) {
        const url = safeUrl(p.image_url) || safeUrl((p.product_media || []).find(m => m.media_type !== 'video')?.media_url);
        return url
            ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(p.name)}" class="${cls}" loading="lazy" onerror="if(!this.dataset.err){this.dataset.err=1;this.src=PRODUCT_PLACEHOLDER}">`
            : '';
    },

    _blockedBanner(p) {
        return p.flagged ? `
            <div class="admin-card-blocked">
                🚫 Bloqueado pela moderação — motivo: "${escapeHtml(p.flag_reason || 'não especificado')}"
            </div>` : '';
    },

    _tiersText(p) {
        const tiers = this._resolveBulkTiers(p);
        return tiers.map(t => `${t.min_qty} por R$ ${formatBRL(t.total_price)}`).join(' · ');
    },

    renderAdmin() {
        try {
            const list = document.getElementById('admin-list');
            if (!list) return;

            const items = this.manageProducts || [];
            if (!items.length) {
                list.innerHTML = this._manageStatusHtml() || '<div class="col-span-full text-slate-600 text-center py-8">Nenhum produto</div>';
                return;
            }

            list.innerHTML = items.map(p => {
                const stock = Number(p.stock) || 0;
                const minStock = p.min_stock ?? 5;
                const stockColor = stock > minStock ? 'text-green-500' : stock > 0 ? 'text-yellow-500' : 'text-red-500';
                const thumb = this._thumb(p, 'admin-card-thumb') || `<div class="admin-card-thumb admin-card-thumb-empty">SEM<br>IMAGEM</div>`;
                const tiers = this._tiersText(p);
                const id = escapeHtml(p.id);

                return `
                    <div class="admin-card ${p.flagged ? 'admin-card-is-blocked' : ''}">
                        ${this._blockedBanner(p)}
                        <div class="admin-card-top">
                            ${thumb}
                            <div class="admin-card-info">
                                <span class="admin-card-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                                <span class="admin-card-badge">${escapeHtml(p.category || 'Outros')}</span>
                                <span class="admin-card-vendor">👤 ${escapeHtml(p.profiles?.full_name || 'Desconhecido')}</span>
                            </div>
                        </div>
                        <div class="admin-card-meta">
                            <span class="admin-card-price">R$ ${formatBRL(p.price)}</span>
                            <span class="admin-card-stock ${stockColor}">Estoque: ${stock} <span class="text-slate-600 font-normal">(mín: ${minStock})</span></span>
                        </div>
                        ${tiers ? `<div class="admin-card-bulk">🏷️ ${tiers}</div>` : ''}
                        <div class="admin-card-actions">
                            <button onclick="window.APP.products.previewById('${id}')" class="admin-card-btn admin-card-btn-view" title="Visualizar"><i data-lucide="eye" class="w-4 h-4"></i></button>
                            <button onclick="window.APP.products.editById('${id}')" class="admin-card-btn admin-card-btn-edit" title="Editar"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
                            <button onclick="window.APP.products.delete('${id}')" class="admin-card-btn admin-card-btn-delete" title="Deletar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                        </div>
                    </div>`;
            }).join('');

            if (window.lucide) lucide.createIcons();
        } catch (err) {
            log(`❌ Erro ao renderizar admin: ${err.message}`, 'error');
        }
    },

    renderSeller() {
        try {
            const list = document.getElementById('seller-list');
            if (!list) return;

            const userId = window.APP?.auth?.userId;
            if (!userId) {
                list.innerHTML = '<div class="text-slate-600 text-center py-8">Você precisa estar logado</div>';
                return;
            }

            const meus = (this.manageProducts || []).filter(p => p.owner_id === userId);
            if (!meus.length) {
                list.innerHTML = this._manageStatusHtml() || '<div class="text-slate-600 text-center py-8">Você não tem produtos ainda</div>';
                return;
            }

            list.innerHTML = meus.map(p => {
                const img = this._thumb(p, 'w-full h-44 object-cover rounded-2xl')
                    || `<div class="w-full h-44 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-600">SEM IMAGEM</div>`;
                const tiers = this._tiersText(p);
                const id = escapeHtml(p.id);
                return `
                    <div class="bg-slate-900/40 p-6 rounded-[32px] border ${p.flagged ? 'border-red-500/40' : 'border-white/5'} flex flex-col gap-4 hover:border-blue-500/30 transition-all">
                        ${this._blockedBanner(p)}
                        ${img}
                        <div class="flex items-center justify-between gap-2 flex-wrap">
                            <span class="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-blue-500/15 text-blue-300">${escapeHtml(p.category || 'Outros')}</span>
                            <span class="text-[10px] text-slate-500 font-bold">📷 ${(p.product_media || []).length}/${PRODUCT_MEDIA_MAX}</span>
                        </div>
                        <h3 class="text-xl font-bold text-white">${escapeHtml(p.name)}</h3>
                        <p class="text-slate-500 text-xs line-clamp-2">${escapeHtml(p.description || '')}</p>
                        <div class="flex justify-between items-center">
                            <div class="text-2xl font-black text-white">R$ ${formatBRL(p.price)}</div>
                            <div class="text-xs font-bold text-slate-400">Estoque: ${Number(p.stock) || 0} <span class="text-slate-600">(mín: ${p.min_stock ?? 5})</span></div>
                        </div>
                        ${tiers ? `<div class="text-xs text-cyan-400 font-semibold -mt-2">🏷️ Promoções: ${tiers}</div>` : ''}
                        <div class="flex gap-2">
                            <button onclick="window.APP.products.editById('${id}')" class="flex-1 bg-blue-600 hover:bg-blue-500 py-2 rounded-2xl font-bold text-xs text-white transition-all">✏️ EDITAR</button>
                            <button onclick="window.APP.products.delete('${id}')" class="flex-1 bg-red-600 hover:bg-red-500 py-2 rounded-2xl font-bold text-xs text-white transition-all">🗑️ DELETAR</button>
                        </div>
                    </div>`;
            }).join('');

            if (window.lucide) lucide.createIcons();
        } catch (err) {
            log(`❌ Erro ao renderizar estoque: ${err.message}`, 'error');
        }
    },

    // ============================================================
    // MODAL DE PRODUTO
    // ============================================================

    _bindCategorySelect() {
        const select = document.getElementById('p-category');
        const newInput = document.getElementById('p-category-new');
        if (!select || !newInput || select.dataset.bound) return;
        select.dataset.bound = '1';
        select.addEventListener('change', () => {
            const isNew = select.value === '__new__';
            newInput.classList.toggle('hidden', !isNew);
            if (isNew) newInput.focus();
        });
    },

    _ensureCategoryOption(category) {
        const select = document.getElementById('p-category');
        if (!select || !category) return;
        if (Array.from(select.options).some(o => o.value === category)) return;
        const opt = document.createElement('option');
        opt.value = category;
        opt.textContent = `📁 ${category}`;
        const newOpt = select.querySelector('option[value="__new__"]');
        if (newOpt) select.insertBefore(opt, newOpt); else select.appendChild(opt);
    },

    _bindBulkTierAddButton() {
        const btn = document.getElementById('p-bulk-tier-add-btn');
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => this._addBulkTier());
    },

    _addBulkTier() {
        if (this._bulkTiers.length >= 8) { alert('❌ Máximo de 8 promoções por produto.'); return; }
        this._bulkTiers.push({ min_qty: '', total_price: '' });
        this._renderBulkTiersForm();
        const rows = document.querySelectorAll('#p-bulk-tiers-list [data-tier-qty]');
        rows[rows.length - 1]?.focus();
    },

    _removeBulkTier(index) {
        this._bulkTiers.splice(index, 1);
        this._renderBulkTiersForm();
    },

    _renderBulkTiersForm() {
        const list = document.getElementById('p-bulk-tiers-list');
        if (!list) return;
        if (!this._bulkTiers.length) {
            list.innerHTML = '<div class="text-[11px] text-slate-500 text-center py-2">Nenhuma promoção configurada ainda</div>';
            return;
        }
        list.innerHTML = this._bulkTiers.map((tier, i) => `
            <div class="flex gap-2 items-center">
                <div class="w-24 flex-shrink-0">
                    <input type="number" min="1" placeholder="Qtd." value="${escapeHtml(tier.min_qty ?? '')}" data-tier-qty
                        oninput="window.APP.products._bulkTiers[${i}].min_qty = this.value"
                        class="w-full p-3 rounded-xl bg-slate-800 border border-white/5 text-white placeholder-slate-500 text-sm">
                </div>
                <div class="flex-1">
                    <input type="number" step="0.01" min="0" placeholder="Preço total da promoção" value="${escapeHtml(tier.total_price ?? '')}"
                        oninput="window.APP.products._bulkTiers[${i}].total_price = this.value"
                        class="w-full p-3 rounded-xl bg-slate-800 border border-white/5 text-white placeholder-slate-500 text-sm">
                </div>
                <button type="button" onclick="window.APP.products._removeBulkTier(${i})"
                    class="flex-shrink-0 w-9 h-9 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-400 flex items-center justify-center font-black transition-all"
                    aria-label="Remover promoção" title="Remover promoção">✕</button>
            </div>`).join('');
    },

    _prepareModal() {
        const mediaInput = document.getElementById('p-media-input');
        if (mediaInput) mediaInput.value = '';
        this._bindMediaInput();
        this._bindCategorySelect();
        this._bindBulkTierAddButton();
        this._renderBulkTiersForm();
        this._renderMediaPreview();
    },

    // ============================================================
    // DONO DO PRODUTO (Admin escolhe o vendedor)
    // ============================================================

    _owners: [],

    async _setupOwnerSelect(selectedId) {
        const wrap = document.getElementById('p-owner-wrap');
        const select = document.getElementById('p-owner');
        const auth = window.APP?.auth;
        if (!wrap || !select) return;
        if (!auth?.isSupreme?.()) { wrap.classList.add('hidden'); return; }

        wrap.classList.remove('hidden');
        select.innerHTML = '<option value="">⏳ Carregando vendedores...</option>';
        select.disabled = true;

        try {
            const { data, error } = await _supabase
                .from('profiles')
                .select('id, full_name, email, phone, role, status')
                .in('role', ['seller', 'supreme'])
                .order('full_name', { ascending: true });
            if (error) throw error;
            this._owners = data || [];
        } catch (err) {
            log(`⚠️ Lista de vendedores: ${err.message}`, 'warning');
            this._owners = [];
        }

        const me = auth.userId;
        const label = (o) => {
            const name = o.full_name || (o.email || '').split('@')[0] || 'Sem nome';
            if (o.id === me) return `${name} (eu - Admin)`;
            return `${name}${o.status === 'banned' ? ' (banido)' : ''}${o.role === 'supreme' ? ' (Admin)' : ''}`;
        };
        const sellers = this._owners.filter(o => o.id !== me);
        const self = this._owners.find(o => o.id === me);

        select.innerHTML = [
            '<option value="">Selecione o vendedor</option>',
            ...sellers.map(o => `<option value="${escapeHtml(o.id)}" ${o.status === 'banned' && o.id !== selectedId ? 'disabled' : ''}>${escapeHtml(label(o))}</option>`),
            self ? `<option value="${escapeHtml(self.id)}">${escapeHtml(label(self))}</option>` : ''
        ].join('');
        select.value = selectedId || '';
        select.disabled = false;
    },

    _ownerInfo(id) {
        const o = this._owners.find(x => x.id === id);
        const fromList = (this.manageProducts || []).find(p => p.owner_id === id)?.profiles;
        return {
            name: o?.full_name || fromList?.full_name || 'o vendedor',
            phone: o?.phone || fromList?.phone || ''
        };
    },

    /** Texto do aviso para o vendedor, com o que mudou. */
    _describeChanges(before, after, extras = {}) {
        const lines = [];
        const money = (v) => `R$ ${formatBRL(Number(v) || 0)}`;
        if (!before) {
            lines.push(`Cadastrei o produto "${after.name}" na sua loja: ${money(after.price)}, estoque ${after.stock}.`);
        } else {
            if (extras.transferred) lines.push(`O produto "${after.name}" agora está no seu nome.`);
            if (before.name !== after.name) lines.push(`Nome: "${before.name}" → "${after.name}"`);
            if (Number(before.price) !== Number(after.price)) lines.push(`Preço: ${money(before.price)} → ${money(after.price)}`);
            if (Number(before.stock) !== Number(after.stock)) lines.push(`Estoque: ${before.stock} → ${after.stock}`);
            if ((before.category || '') !== (after.category || '')) lines.push(`Categoria: ${before.category || '-'} → ${after.category}`);
            if ((before.description || '') !== (after.description || '')) lines.push('Descrição atualizada');
            if (Number(before.cost_price || 0) !== Number(after.cost_price || 0)) lines.push(`Custo: ${money(before.cost_price)} → ${money(after.cost_price)}`);
            if (Number(before.min_stock ?? 5) !== Number(after.min_stock)) lines.push(`Estoque mínimo: ${before.min_stock ?? 5} → ${after.min_stock}`);
            if (extras.photos) lines.push('Fotos alteradas');
            if (extras.tiers) lines.push('Promoções alteradas');
            if (!lines.length) lines.push(`Revisei o produto "${after.name}" (sem mudanças nos dados principais).`);
            else lines.unshift(`Alterei o seu produto "${before.name}":`);
        }
        return lines.join('\n');
    },

    openModal() {
        const auth = window.APP?.auth;
        if (!auth?.isLoggedIn()) { alert('❌ Você precisa fazer login'); auth?.openAuthModal(); return; }
        if (!auth.isSeller()) { auth.becomeSeller(); return; }

        this.editingId = null;
        this._mediaState = { existing: [], newFiles: [], removedIds: [], rotations: {} };

        ['p-name', 'p-price', 'p-cost', 'p-stock', 'p-desc'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const minStockEl = document.getElementById('p-min-stock');
        if (minStockEl) minStockEl.value = 5;

        this._bulkTiers = [];
        const cat = document.getElementById('p-category');
        if (cat) cat.value = '';
        const catNew = document.getElementById('p-category-new');
        if (catNew) { catNew.value = ''; catNew.classList.add('hidden'); }

        this._prepareModal();
        this._setupOwnerSelect(null);

        const title = document.querySelector('#admin-modal h3');
        if (title) title.innerText = 'NOVO PRODUTO';
        document.getElementById('admin-modal')?.classList.remove('hidden');
    },

    closeModal() {
        document.getElementById('admin-modal')?.classList.add('hidden');
        this.editingId = null;
        this._revokeObjectUrls();
    },

    editById(productId) {
        const product = this.manageProducts.find(p => p.id === productId);
        if (!product) { alert('❌ Produto não encontrado'); return; }
        this.edit(product);
    },

    previewById(productId, startIndex = 0) {
        const product = this.manageProducts.find(p => p.id === productId) || this.products.find(p => p.id === productId);
        if (!product) return;
        this.openPreview(product, startIndex);
    },

    openPreview(product, startIndex = 0) {
        this._previewProduct = product;
        this._previewRotation = 0;
        this._previewMedia = (product.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order);
        this._previewIndex = Math.max(0, Math.min(startIndex, this._previewMedia.length - 1));

        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        set('preview-category', product.category || 'Outros');
        set('preview-name', product.name || 'Sem nome');
        set('preview-vendor', `👤 ${product.profiles?.full_name || 'Desconhecido'}`);
        set('preview-desc', product.description || 'Sem descrição.');
        set('preview-price', `R$ ${formatBRL(product.price)}`);

        const stock = Number(product.stock) || 0;
        const minStock = product.min_stock ?? 5;
        const stockEl = document.getElementById('preview-stock');
        if (stockEl) {
            stockEl.textContent = `Estoque: ${stock} (mín: ${minStock})`;
            stockEl.className = `text-xs font-black ${stock > minStock ? 'text-green-500' : stock > 0 ? 'text-yellow-500' : 'text-red-500'}`;
        }

        const tiers = this._tiersText(product);
        set('preview-bulk', tiers ? `🏷️ Promoções: ${tiers}` : '');

        const editBtn = document.getElementById('preview-edit-btn');
        const canEdit = !!window.APP?.auth?.canEditProduct?.(product.owner_id);
        if (editBtn) {
            editBtn.classList.toggle('hidden', !canEdit);
            editBtn.onclick = canEdit ? () => { this.closePreview(); this.editById(product.id); } : null;
        }

        this._renderPreviewMedia();
        document.getElementById('product-preview-modal')?.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    },

    closePreview() {
        document.getElementById('product-preview-modal')?.classList.add('hidden');
        document.getElementById('preview-media-video')?.pause?.();
    },

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
            [img, video, prevBtn, nextBtn, counter].forEach(el => el.classList.add('hidden'));
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');
        const current = media[this._previewIndex];
        const url = safeUrl(current.media_url) || PRODUCT_PLACEHOLDER;

        if (current.media_type === 'video') {
            img.classList.add('hidden');
            video.classList.remove('hidden');
            video.src = url;
        } else {
            video.classList.add('hidden');
            img.classList.remove('hidden');
            img.dataset.err = '';
            img.onerror = () => { if (!img.dataset.err) { img.dataset.err = '1'; img.src = PRODUCT_PLACEHOLDER; } };
            img.src = url;
        }

        const multi = total > 1;
        prevBtn.classList.toggle('hidden', !multi);
        nextBtn.classList.toggle('hidden', !multi);
        counter.classList.toggle('hidden', !multi);
        counter.textContent = `${this._previewIndex + 1}/${total}`;

        this._applyPreviewRotation(current);
    },

    // ============================================================
    // GIRAR IMAGEM
    // ============================================================

    /** Botões ↻ e "Salvar foto girada" dentro da pré-visualização. */
    _ensureRotateControls() {
        const wrap = document.querySelector('#product-preview-modal .preview-media-wrap');
        if (!wrap || document.getElementById('preview-rotate-btn')) return;

        const rot = document.createElement('button');
        rot.type = 'button';
        rot.id = 'preview-rotate-btn';
        rot.title = 'Girar foto';
        rot.setAttribute('aria-label', 'Girar foto');
        rot.style.cssText = 'position:absolute;top:12px;left:12px;height:32px;padding:0 12px;border-radius:999px;border:none;background:rgba(0,0,0,.55);color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;gap:6px;cursor:pointer;z-index:2';
        rot.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>Girar';
        rot.addEventListener('click', (e) => { e.stopPropagation(); this.rotatePreview(); });
        wrap.appendChild(rot);

        const save = document.createElement('button');
        save.type = 'button';
        save.id = 'preview-rotate-save';
        save.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);min-height:38px;padding:0 16px;border-radius:999px;border:none;background:#16a34a;color:#fff;font-size:13px;font-weight:900;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35);z-index:2;display:none;white-space:nowrap';
        save.textContent = '💾 Salvar foto girada';
        save.addEventListener('click', (e) => { e.stopPropagation(); this.saveRotatedPreview(); });
        wrap.appendChild(save);
    },

    _applyPreviewRotation(current) {
        this._ensureRotateControls();
        const img = document.getElementById('preview-media-img');
        const rotBtn = document.getElementById('preview-rotate-btn');
        const saveBtn = document.getElementById('preview-rotate-save');
        const isImage = current && current.media_type !== 'video';

        if (rotBtn) rotBtn.style.display = isImage ? 'flex' : 'none';
        if (!img) return;

        const deg = ((this._previewRotation % 360) + 360) % 360;
        if (deg === 0) {
            img.style.transform = '';
            img.style.objectFit = '';
        } else {
            // Mostra a foto inteira enquanto está girada (pra conferir o resultado)
            const wrap = img.parentElement.getBoundingClientRect();
            const sideways = deg === 90 || deg === 270;
            const scale = sideways && wrap.width && wrap.height ? Math.min(wrap.width / wrap.height, wrap.height / wrap.width) : 1;
            img.style.objectFit = 'contain';
            img.style.transform = `rotate(${deg}deg) scale(${scale})`;
        }
        img.style.transition = 'transform .25s ease';

        const canSave = isImage && deg !== 0 && !!window.APP?.auth?.canEditProduct?.(this._previewProduct?.owner_id);
        if (saveBtn) saveBtn.style.display = canSave ? 'block' : 'none';
    },

    rotatePreview() {
        const current = this._previewMedia[this._previewIndex];
        if (!current || current.media_type === 'video') return;
        this._previewRotation = (this._previewRotation + 90) % 360;
        this._applyPreviewRotation(current);
    },

    /** Gira uma imagem (File/Blob) de verdade, via canvas. Devolve um File novo. */
    async _rotateImageFile(blob, degrees, name = 'foto.jpg') {
        const deg = ((degrees % 360) + 360) % 360;
        if (!deg) return blob;

        const url = URL.createObjectURL(blob);
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('Não foi possível ler a imagem'));
                i.src = url;
            });
            const sideways = deg === 90 || deg === 270;
            const canvas = document.createElement('canvas');
            canvas.width = sideways ? img.naturalHeight : img.naturalWidth;
            canvas.height = sideways ? img.naturalWidth : img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((deg * Math.PI) / 180);
            ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

            const isPng = blob.type === 'image/png';
            const type = isPng ? 'image/png' : 'image/jpeg';
            const out = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
            if (!out) throw new Error('Não foi possível gerar a imagem girada');
            const base = String(name).replace(/\.\w+$/, '') || 'foto';
            return new File([out], `${base}.${isPng ? 'png' : 'jpg'}`, { type, lastModified: Date.now() });
        } finally {
            URL.revokeObjectURL(url);
        }
    },

    /** Baixa a foto já publicada, gira, sobe a versão nova e troca no produto. */
    async _replaceMediaRotated(media, productId, degrees) {
        const res = await fetch(media.media_url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Não foi possível baixar a foto (HTTP ${res.status})`);
        const rotated = await this._rotateImageFile(await res.blob(), degrees, 'foto-girada.jpg');
        const upload = await compressImage(rotated);

        const userId = window.APP.auth.userId;
        const path = `${userId}/${productId}-${Date.now()}-rot-${sanitizeFileName(upload.name)}`;
        const { error: upErr } = await _supabase.storage.from('product-images').upload(path, upload, { contentType: upload.type });
        if (upErr) throw upErr;

        const newUrl = _supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
        const { data, error } = await _supabase.from('product_media').update({ media_url: newUrl }).eq('id', media.id).select('id');
        if (error || !data?.length) {
            await _supabase.storage.from('product-images').remove([path]);
            throw error || new Error('O banco recusou a alteração');
        }
        await this._deleteMediaStorageFile(media.media_url);
        return newUrl;
    },

    async saveRotatedPreview() {
        const product = this._previewProduct;
        const media = this._previewMedia[this._previewIndex];
        const deg = ((this._previewRotation % 360) + 360) % 360;
        if (!product || !media || !deg) return;
        if (!window.APP?.auth?.canEditProduct?.(product.owner_id)) { alert('❌ Você não tem permissão para editar este produto'); return; }

        const btn = document.getElementById('preview-rotate-save');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
        try {
            const newUrl = await this._replaceMediaRotated(media, product.id, deg);
            media.media_url = newUrl;
            [this.manageProducts, this.products].forEach(list => list.forEach(p => {
                (p.product_media || []).forEach(m => { if (m.id === media.id) m.media_url = newUrl; });
            }));
            this._previewRotation = 0;
            this._renderPreviewMedia();
            this.render();
            this.renderAdmin();
            this.renderSeller();
        } catch (err) {
            alert(`❌ Não foi possível salvar a foto girada: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar foto girada'; }
        }
    },

    /** Formulário: gira uma foto (nova ou já publicada). */
    async rotateFormMedia(kind, key) {
        if (kind === 'new') {
            const i = Number(key);
            const file = this._mediaState.newFiles[i];
            if (!file || !file.type.startsWith('image/')) return;
            try {
                this._mediaState.newFiles[i] = await this._rotateImageFile(file, 90, file.name);
            } catch (err) {
                alert(`❌ ${err.message}`);
            }
        } else {
            const r = this._mediaState.rotations || (this._mediaState.rotations = {});
            r[key] = ((r[key] || 0) + 90) % 360;
        }
        this._renderMediaPreview();
    },

    _previewStep(direction) {
        const total = this._previewMedia.length;
        if (!total) return;
        this._previewIndex = (this._previewIndex + direction + total) % total;
        this._previewRotation = 0;
        this._renderPreviewMedia();
    },

    openImageZoom() {
        const images = this._previewMedia.filter(m => m.media_type !== 'video');
        const current = this._previewMedia[this._previewIndex];
        let idx = Math.max(0, images.indexOf(current));
        const urlAt = (i) => safeUrl(images[i]?.media_url);
        if (!urlAt(idx)) return;

        if (!window.ImageZoom?.open) { window.open(urlAt(idx), '_blank', 'noopener'); return; }

        const multi = images.length > 1;
        const step = (dir) => {
            idx = (idx + dir + images.length) % images.length;
            window.ImageZoom.setImage(urlAt(idx), `${idx + 1}/${images.length}`);
        };
        window.ImageZoom.open(urlAt(idx), multi
            ? { onPrev: () => step(-1), onNext: () => step(1), counter: `${idx + 1}/${images.length}` }
            : {});
    },

    edit(product) {
        if (!window.APP.auth.canEditProduct(product.owner_id)) {
            alert('❌ Você não tem permissão para editar este produto');
            return;
        }

        this.editingId = product.id;
        this._mediaState = {
            existing: (product.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order),
            newFiles: [],
            removedIds: [],
            rotations: {}
        };

        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        setVal('p-name', product.name || '');
        setVal('p-price', product.price || 0);
        setVal('p-cost', product.cost_price || 0);
        setVal('p-stock', product.stock || 0);
        setVal('p-desc', product.description || '');
        setVal('p-min-stock', product.min_stock ?? 5);

        this._bulkTiers = this._resolveBulkTiers(product).map(t => ({ min_qty: t.min_qty, total_price: t.total_price }));

        this._ensureCategoryOption(product.category);
        setVal('p-category', product.category || '');
        const catNew = document.getElementById('p-category-new');
        if (catNew) { catNew.value = ''; catNew.classList.add('hidden'); }

        this._prepareModal();
        this._setupOwnerSelect(product.owner_id);

        const title = document.querySelector('#admin-modal h3');
        if (title) title.innerText = `✏️ EDITAR: ${product.name}`;
        document.getElementById('admin-modal')?.classList.remove('hidden');
    },

    // ===== GALERIA NO FORMULÁRIO =====

    _bindMediaInput() {
        const input = document.getElementById('p-media-input');
        if (!input || input.dataset.bound) return;
        input.dataset.bound = '1';

        input.addEventListener('change', () => {
            for (const file of Array.from(input.files || [])) {
                const existingCount = this._mediaState.existing.filter(m => !this._mediaState.removedIds.includes(m.id)).length;
                if (existingCount + this._mediaState.newFiles.length >= PRODUCT_MEDIA_MAX) {
                    alert(`❌ Máximo de ${PRODUCT_MEDIA_MAX} fotos/vídeos por produto.`);
                    break;
                }
                const isImage = file.type.startsWith('image/');
                const isVideo = file.type.startsWith('video/');
                if (!isImage && !isVideo) { alert(`❌ "${file.name}" não é imagem nem vídeo.`); continue; }
                if (file.size > PRODUCT_MEDIA_MAX_SIZE) { alert(`❌ "${file.name}" passa de 20MB.`); continue; }
                this._mediaState.newFiles.push(file);
            }
            input.value = '';
            this._renderMediaPreview();
        });
    },

    _revokeObjectUrls() {
        this._objectUrls.forEach(u => URL.revokeObjectURL(u));
        this._objectUrls = [];
    },

    _renderMediaPreview() {
        const wrap = document.getElementById('p-media-preview');
        if (!wrap) return;
        this._revokeObjectUrls();

        const existing = this._mediaState.existing.filter(m => !this._mediaState.removedIds.includes(m.id));
        const total = existing.length + this._mediaState.newFiles.length;

        const rotations = this._mediaState.rotations || {};
        const existingTiles = existing.map(m => {
            const deg = rotations[m.id] || 0;
            return `
            <div class="media-tile">
                ${m.media_type === 'video'
                    ? `<div class="media-tile-video">🎥</div>`
                    : `<img src="${this._mediaUrl(m)}" alt="" style="transform:rotate(${deg}deg);transition:transform .2s ease">`}
                <button type="button" class="media-tile-remove" onclick="window.APP.products._removeExistingMedia('${escapeHtml(m.id)}')" aria-label="Remover">✕</button>
                ${m.media_type === 'video' ? '' : `<button type="button" class="media-tile-rotate" onclick="window.APP.products.rotateFormMedia('existing', '${escapeHtml(m.id)}')" aria-label="Girar foto" title="Girar foto" style="position:absolute;bottom:3px;left:3px;width:24px;height:24px;border-radius:50%;border:none;background:rgba(0,0,0,.7);color:#fff;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;line-height:1;cursor:pointer">↻</button>`}
            </div>`;
        }).join('');

        const newTiles = this._mediaState.newFiles.map((file, i) => {
            const isVideo = file.type.startsWith('video/');
            let inner = `<div class="media-tile-video">🎥</div>`;
            if (!isVideo) {
                const url = URL.createObjectURL(file);
                this._objectUrls.push(url);
                inner = `<img src="${url}" alt="">`;
            }
            return `
                <div class="media-tile">
                    ${inner}
                    <button type="button" class="media-tile-remove" onclick="window.APP.products._removeNewMedia(${i})" aria-label="Remover">✕</button>
                    ${isVideo ? '' : `<button type="button" class="media-tile-rotate" onclick="window.APP.products.rotateFormMedia('new', '${i}')" aria-label="Girar foto" title="Girar foto" style="position:absolute;bottom:3px;left:3px;width:24px;height:24px;border-radius:50%;border:none;background:rgba(0,0,0,.7);color:#fff;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;line-height:1;cursor:pointer">↻</button>`}
                </div>`;
        }).join('');

        wrap.innerHTML = (existingTiles + newTiles) || `<div class="media-tile-empty">Nenhuma foto/vídeo ainda</div>`;

        const counterEl = document.getElementById('p-media-count');
        if (counterEl) counterEl.textContent = `(${total}/${PRODUCT_MEDIA_MAX})`;
        const input = document.getElementById('p-media-input');
        if (input) input.disabled = total >= PRODUCT_MEDIA_MAX;
    },

    _removeExistingMedia(mediaId) {
        this._mediaState.removedIds.push(mediaId);
        this._renderMediaPreview();
    },

    _removeNewMedia(index) {
        this._mediaState.newFiles.splice(index, 1);
        this._renderMediaPreview();
    },

    async _syncProductMedia(productId) {
        const failures = [];

        for (const mediaId of this._mediaState.removedIds) {
            const item = this._mediaState.existing.find(m => m.id === mediaId);
            const { error } = await _supabase.from('product_media').delete().eq('id', mediaId);
            if (error) { failures.push('remover mídia'); continue; }
            if (item) await this._deleteMediaStorageFile(item.media_url);
        }

        const rotations = this._mediaState.rotations || {};
        for (const m of this._mediaState.existing) {
            const deg = rotations[m.id] || 0;
            if (!deg || this._mediaState.removedIds.includes(m.id) || m.media_type === 'video') continue;
            try { await this._replaceMediaRotated(m, productId, deg); }
            catch (err) { failures.push('girar uma foto'); log(err.message, 'warning'); }
        }

        if (!this._mediaState.newFiles.length) return failures;

        const remaining = this._mediaState.existing.filter(m => !this._mediaState.removedIds.includes(m.id));
        let nextOrder = remaining.length ? Math.max(...remaining.map(m => m.sort_order)) + 1 : 0;
        const userId = window.APP.auth.userId;

        for (const file of this._mediaState.newFiles) {
            const isVideo = file.type.startsWith('video/');
            const uploadFile = isVideo ? file : await compressImage(file);
            const path = `${userId}/${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFileName(uploadFile.name)}`;

            const { error: upErr } = await _supabase.storage.from('product-images').upload(path, uploadFile, {
                contentType: uploadFile.type || undefined
            });
            if (upErr) { failures.push(`enviar "${file.name}"`); log(upErr.message, 'warning'); continue; }

            const { data: pub } = _supabase.storage.from('product-images').getPublicUrl(path);
            const { error: insErr } = await _supabase.from('product_media').insert([{
                product_id: productId,
                media_url: pub.publicUrl,
                media_type: isVideo ? 'video' : 'image',
                sort_order: nextOrder++
            }]);
            if (insErr) {
                failures.push(`registrar "${file.name}"`);
                await _supabase.storage.from('product-images').remove([path]);
            }
        }
        return failures;
    },

    async _deleteMediaStorageFile(url) {
        try {
            const path = String(url || '').split('/product-images/')[1];
            if (!path) return;
            await _supabase.storage.from('product-images').remove([decodeURIComponent(path.split('?')[0])]);
        } catch { /* arquivo órfão não impede nada */ }
    },

    /** Substitui as faixas de promoção do produto. Lança erro se falhar. */
    async _syncBulkTiers(productId) {
        const { error: delErr } = await _supabase.from('product_bulk_tiers').delete().eq('product_id', productId);
        if (delErr) throw delErr;
        if (!this._bulkTiers.length) return;

        const rows = this._bulkTiers.map(t => ({
            product_id: productId,
            min_qty: parseInt(t.min_qty, 10),
            unit_price: Number(t.unit_price),
            total_price: Number(t.total_price)
        }));
        const { error } = await _supabase.from('product_bulk_tiers').insert(rows);
        if (error) throw error;
    },

    async saveProductDirect() {
        const btn = document.getElementById('btn-save');
        const originalText = btn?.innerText;
        const wasEditing = !!this.editingId;

        try {
            if (btn) { btn.disabled = true; btn.innerText = '⏳ SALVANDO...'; }

            const auth = window.APP.auth;
            if (!auth.isLoggedIn() || !auth.userId) throw new Error('Você precisa estar logado');
            if (!auth.isSeller()) throw new Error('Apenas vendedores podem cadastrar produtos');

            const name = document.getElementById('p-name')?.value?.trim();
            const price = parseFloat(document.getElementById('p-price')?.value);
            let category = document.getElementById('p-category')?.value?.trim();
            if (category === '__new__') {
                category = document.getElementById('p-category-new')?.value?.trim().slice(0, 40);
                if (!category) throw new Error('Digite o nome da nova categoria');
            }

            if (!name) throw new Error('Nome é obrigatório');
            if (!Number.isFinite(price) || price <= 0) throw new Error('Preço deve ser maior que zero');
            if (!category) throw new Error('Selecione uma categoria');

            const stock = parseInt(document.getElementById('p-stock')?.value, 10);
            const minStock = parseInt(document.getElementById('p-min-stock')?.value, 10);
            const cost = parseFloat(document.getElementById('p-cost')?.value);
            if (Number.isFinite(stock) && stock < 0) throw new Error('Estoque não pode ser negativo');

            // Promoções: descarta linhas vazias e calcula o preço unitário
            const tiers = this._bulkTiers.filter(t => String(t.min_qty ?? '') !== '' || String(t.total_price ?? '') !== '');
            const seenQty = new Set();
            for (const t of tiers) {
                const qty = parseInt(t.min_qty, 10);
                const total = parseFloat(t.total_price);
                if (!Number.isFinite(qty) || qty < 1) throw new Error('Cada promoção precisa de uma quantidade válida (1 ou mais)');
                if (!Number.isFinite(total) || total <= 0) throw new Error('Cada promoção precisa de um preço total válido');
                if (seenQty.has(qty)) throw new Error(`Há duas promoções para ${qty} unidade(s)`);
                seenQty.add(qty);
                const unit = Math.round((total / qty) * 100) / 100;
                if (unit >= price) throw new Error(`A promoção "${qty} por R$ ${formatBRL(total)}" precisa ser menor que o preço normal`);
                t.min_qty = qty;
                t.total_price = total;
                t.unit_price = unit;
            }
            this._bulkTiers = tiers;

            // ⚠️ "active" NÃO vai aqui: na criação o padrão do banco vale,
            // e na edição não pode reativar produto bloqueado pela moderação.
            const productData = {
                name,
                price,
                category,
                cost_price: Number.isFinite(cost) && cost >= 0 ? cost : 0,
                stock: Number.isFinite(stock) ? stock : 0,
                min_stock: Number.isFinite(minStock) && minStock >= 0 ? minStock : 5,
                description: document.getElementById('p-desc')?.value?.trim() || ''
            };

            let productId = this.editingId;
            const isAdmin = auth.isSupreme();
            let ownerId = auth.userId;
            if (isAdmin) {
                ownerId = document.getElementById('p-owner')?.value || '';
                if (!ownerId) throw new Error('Escolha o vendedor dono do produto');
            }
            const before = this.editingId ? { ...this.manageProducts.find(p => p.id === this.editingId) } : null;
            const photosChanged = !!(this._mediaState.newFiles.length || this._mediaState.removedIds.length
                || Object.values(this._mediaState.rotations || {}).some(d => d % 360));
            const oldTiers = before ? JSON.stringify(this._resolveBulkTiers(before).map(t => [t.min_qty, t.total_price])) : '[]';

            if (this.editingId) {
                const product = this.manageProducts.find(p => p.id === this.editingId);
                if (!auth.canEditProduct(product?.owner_id)) throw new Error('Você não tem permissão para editar este produto');
                if (isAdmin && ownerId !== product.owner_id) productData.owner_id = ownerId;

                const { data, error } = await _supabase.from('products').update(productData).eq('id', this.editingId).select('id');
                if (error) throw error;
                if (!data || !data.length) throw new Error('O banco recusou a alteração (sem permissão)');
            } else {
                productData.owner_id = ownerId;
                productData.active = true;
                const { data, error } = await _supabase.from('products').insert([productData]).select('id, active, flagged');
                if (error) throw error;
                productId = data[0].id;
                if (data[0].flagged) alert('⚠️ Produto salvo, mas ficou RETIDO pela moderação (palavra proibida). O Admin vai revisar.');
            }

            const mediaFailures = await this._syncProductMedia(productId);

            let tierError = null;
            try { await this._syncBulkTiers(productId); }
            catch (e) { tierError = e; }

            const warnings = [];
            if (mediaFailures.length) warnings.push(`Falha ao ${mediaFailures.join(', ')}.`);
            if (tierError) warnings.push(`As promoções não foram salvas: ${tierError.message}`);

            alert((wasEditing ? '✅ Produto atualizado!' : '✅ Produto criado!') + (warnings.length ? `\n\n⚠️ ${warnings.join('\n')}` : ''));

            if (!wasEditing) window.APP?.onboarding?.markMission?.('product');

            this.closeModal();

            // Admin mexeu no produto de outra pessoa → pergunta se quer avisar
            if (isAdmin && ownerId !== auth.userId) {
                const newTiers = JSON.stringify(this._bulkTiers.map(t => [t.min_qty, t.total_price]));
                const info = this._ownerInfo(ownerId);
                const after = { ...productData };
                await window.VendorNotices?.askAndNotify?.({
                    vendorId: ownerId,
                    vendorName: info.name,
                    vendorPhone: info.phone,
                    productId,
                    title: wasEditing ? `Produto alterado: ${name}` : `Produto novo na sua loja: ${name}`,
                    message: this._describeChanges(before, after, {
                        transferred: !!(before && before.owner_id !== ownerId),
                        photos: photosChanged,
                        tiers: oldTiers !== newTiers
                    })
                });
            }

            this._allCategories = [];
            await this.fetchAll();
            this._loadAllCategories().then(() => this._renderCategoryFilterBar());
        } catch (err) {
            log(`❌ Erro ao salvar: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
        }
    },

    async saveProduct(event) {
        event?.preventDefault?.();
        await this.saveProductDirect();
    },

    async delete(productId) {
        try {
            const product = this.manageProducts.find(p => p.id === productId);
            if (!product || !window.APP.auth.canEditProduct(product.owner_id)) {
                alert('❌ Você não tem permissão para deletar este produto');
                return;
            }

            if (!confirm(`⚠️ Deletar "${product.name}"?\n\nIsso é IRREVERSÍVEL.`)) return;

            // 1) apaga no banco; 2) só depois apaga os arquivos
            const { data, error } = await _supabase.from('products').delete().eq('id', productId).select('id');
            if (error) {
                if (error.code === '23503') {
                    throw new Error('Este produto já tem pedidos registrados. Zere o estoque em vez de deletar, para manter o histórico de vendas.');
                }
                throw error;
            }
            if (!data || !data.length) throw new Error('O banco recusou a exclusão (sem permissão)');

            for (const m of (product.product_media || [])) {
                await this._deleteMediaStorageFile(m.media_url);
            }

            alert('✅ Produto removido!');

            const auth = window.APP.auth;
            if (auth.isSupreme() && product.owner_id !== auth.userId) {
                const info = this._ownerInfo(product.owner_id);
                await window.VendorNotices?.askAndNotify?.({
                    vendorId: product.owner_id,
                    vendorName: info.name,
                    vendorPhone: info.phone,
                    productId: null,
                    title: `Produto excluído: ${product.name}`,
                    message: `Excluí o seu produto "${product.name}" da loja.`
                });
            }

            await this.fetchAll();
        } catch (err) {
            log(`❌ Erro ao deletar: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    }
};
