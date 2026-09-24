/**
 * CART.JS v2.3
 * v2.3 (auditoria):
 *  - nome do produto escapado no carrinho e no toast (XSS)
 *  - estoque inválido/ausente não trava mais o carrinho
 *  - carrinho salvo antigo/corrompido é descartado com segurança
 *  - total da promoção igual ao do servidor (create_order):
 *    preço unitário da faixa × quantidade
 */

const Cart = {
    items: [],
    _cartHistoryPushed: false,
    _backHandlerAttached: false,

    init() {
        const saved = Storage.loadCart();
        this.items = Array.isArray(saved)
            ? saved.filter(i => i && i.id && Number.isFinite(Number(i.price)))
            : [];
        this.updateUI();
        this._attachBackButtonHandler();
    },

    _attachBackButtonHandler() {
        if (this._backHandlerAttached) return;
        this._backHandlerAttached = true;
        window.addEventListener('popstate', () => {
            if (this._cartHistoryPushed) {
                this._cartHistoryPushed = false;
                this._hideCartUI();
            }
        });
    },

    _hideCartUI() {
        document.getElementById('cart-drawer')?.classList.add('translate-x-full');
    },

    add(productId, productName, price, bulkTiers, stock) {
        if (window.StoreStatus?.canAddToCart && !StoreStatus.canAddToCart()) return;
        if (!productId || !Number.isFinite(Number(price))) return;

        const limit = Number.isFinite(stock) && stock >= 0 ? stock : Infinity;
        const currentQty = this.items.filter(i => i.id === productId).length;

        if (limit === 0) { alert('❌ Produto fora de estoque.'); return; }
        if (currentQty >= limit) {
            alert(`❌ Só temos ${limit} unidade${limit === 1 ? '' : 's'} desse produto em estoque — você já colocou o máximo no carrinho.`);
            return;
        }

        this.items.push({
            id: productId,
            name: String(productName || 'Produto'),
            price: Number(price),
            bulkTiers: Array.isArray(bulkTiers) ? bulkTiers : []
        });
        Storage.saveCart(this.items);
        this.updateUI();
        this.showAddedFeedback(productName);
        window.APP?.onboarding?.markMission?.('cart');
    },

    showAddedFeedback(productName) {
        this._showToast(productName);
        this._bumpCartIcons();
    },

    _showToast(productName) {
        let container = document.getElementById('cart-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cart-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'cart-toast';
        toast.innerHTML = `
            <i data-lucide="check-circle" class="cart-toast-icon"></i>
            <span>${escapeHtml(productName || 'Produto')} adicionado ao carrinho</span>`;
        container.appendChild(toast);
        if (window.lucide) lucide.createIcons();

        requestAnimationFrame(() => toast.classList.add('cart-toast-show'));
        setTimeout(() => {
            toast.classList.remove('cart-toast-show');
            toast.classList.add('cart-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    },

    _bumpCartIcons() {
        ['cart-count', 'bnav-cart-count'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.remove('cart-bump');
            void el.offsetWidth;
            el.classList.add('cart-bump');
        });
    },

    remove(index) {
        if (index < 0 || index >= this.items.length) return;
        this.items.splice(index, 1);
        Storage.saveCart(this.items);
        this.updateUI();
    },

    /** Mesma regra do create_order: maior faixa cuja qtd. mínima foi atingida. */
    _effectiveUnitPrice(item, qty) {
        const tiers = (item.bulkTiers && item.bulkTiers.length)
            ? item.bulkTiers
            : (item.bulkMinQty && item.bulkUnitPrice ? [{ min_qty: item.bulkMinQty, unit_price: item.bulkUnitPrice }] : []);

        const applicable = tiers
            .filter(t => qty >= Number(t.min_qty) && Number.isFinite(Number(t.unit_price)))
            .sort((a, b) => Number(b.min_qty) - Number(a.min_qty))[0];

        return applicable ? Number(applicable.unit_price) : Number(item.price);
    },

    _qtyById() {
        const map = {};
        this.items.forEach(i => { map[i.id] = (map[i.id] || 0) + 1; });
        return map;
    },

    updateUI() {
        const count = this.items.length;
        const cartCount = document.getElementById('cart-count');
        if (cartCount) cartCount.innerText = count;
        const bnavCount = document.getElementById('bnav-cart-count');
        if (bnavCount) bnavCount.innerText = count;

        const qtyById = this._qtyById();
        const priceOf = (item) => this._effectiveUnitPrice(item, qtyById[item.id] || 1);

        const itemsDiv = document.getElementById('cart-items');
        if (itemsDiv) {
            itemsDiv.innerHTML = count ? this.items.map((item, idx) => {
                const unit = priceOf(item);
                const discount = unit < Number(item.price);
                return `
                    <div class="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
                        <div class="flex flex-col flex-1 min-w-0">
                            <span class="text-white font-bold text-xs truncate">${escapeHtml(item.name)}</span>
                            <span class="text-blue-500 font-black text-[10px]">R$ ${formatBRL(unit)}</span>
                            ${discount ? `<span class="text-cyan-400 font-bold text-[9px] mt-0.5">🎉 Preço de promoção aplicado</span>` : ''}
                        </div>
                        <button onclick="window.APP.cart.remove(${idx})" class="text-red-500 hover:text-red-400 ml-2" aria-label="Remover">
                            <i data-lucide="x" class="w-4 h-4"></i>
                        </button>
                    </div>`;
            }).join('') : '<div class="text-slate-500 text-sm text-center py-10">Seu carrinho está vazio</div>';
        }

        const cartTotal = document.getElementById('cart-total');
        if (cartTotal) cartTotal.innerText = `R$ ${formatBRL(this.getTotal())}`;

        if (window.lucide) lucide.createIcons();
    },

    openCart() {
        document.getElementById('cart-drawer')?.classList.remove('translate-x-full');
        if (!this._cartHistoryPushed) {
            history.pushState({ ityrapuanCartOpen: true }, '');
            this._cartHistoryPushed = true;
        }
    },

    closeCart() {
        this._hideCartUI();
        if (this._cartHistoryPushed) {
            this._cartHistoryPushed = false;
            history.back();
        }
    },

    toggleCart() {
        const drawer = document.getElementById('cart-drawer');
        if (!drawer) return;
        if (drawer.classList.contains('translate-x-full')) this.openCart();
        else this.closeCart();
    },

    getTotal() {
        const qtyById = this._qtyById();
        return this.items.reduce((acc, item) => acc + this._effectiveUnitPrice(item, qtyById[item.id] || 1), 0);
    },

    clear() {
        this.items = [];
        Storage.saveCart([]);
        this.updateUI();
    },

    getCount() { return this.items.length; }
};
