/**
 * CART.JS v2.2
 * Gerencia carrinho de compras
 * ✅ v2.0: feedback visual ao adicionar item — toast + bounce
 * ✅ v2.1: valores em R$ agora usam window.formatBRL() (padrão brasileiro)
 * ✅ v2.2 NOVO: botão "voltar" do celular agora FECHA o carrinho em vez de
 *    sair do app/PWA. Como o carrinho é uma gaveta sobreposta (não uma
 *    página nova), o navegador não sabia que devia só fechá-la — ele
 *    tratava o "voltar" como navegação normal e saía do sistema. Agora,
 *    ao abrir o carrinho, empilhamos uma entrada de histórico; ao fechar
 *    (pelo X ou pelo botão voltar do telefone), essa entrada é consumida
 *    sem sair da página, e o usuário volta a ver os produtos por trás.
 */

const Cart = {
    items: [],
    _cartHistoryPushed: false,
    _backHandlerAttached: false,

    init() {
        this.items = Storage.loadCart();
        this.updateUI();
        this._attachBackButtonHandler();
    },

    /**
     * ✅ NOVO (v2.2): escuta o evento popstate (disparado pelo botão
     * "voltar" do navegador/celular). Se o carrinho estiver aberto na
     * hora, só fecha a gaveta — não deixa o navegador sair da página.
     */
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
        const drawer = document.getElementById('cart-drawer');
        if (drawer) drawer.classList.add('translate-x-full');
    },

    add(productId, productName, price) {
        if (window.StoreStatus && typeof StoreStatus.canAddToCart === 'function') {
            if (!StoreStatus.canAddToCart()) return;
        }

        this.items.push({ id: productId, name: productName, price });
        Storage.saveCart(this.items);
        this.updateUI();

        this.showAddedFeedback(productName);

        log(`Item adicionado: ${productName}`, 'success');
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
        const safeName = (productName || 'Produto').toString();
        toast.innerHTML = `
            <i data-lucide="check-circle" class="cart-toast-icon"></i>
            <span>${safeName} adicionado ao carrinho</span>
        `;
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
        
        const removed = this.items.splice(index, 1)[0];
        Storage.saveCart(this.items);
        this.updateUI();
        
        log(`Item removido: ${removed.name}`, 'success');
    },

    updateUI() {
        const count = this.items.length;

        const cartCount = document.getElementById('cart-count');
        if (cartCount) cartCount.innerText = count;

        const bnavCount = document.getElementById('bnav-cart-count');
        if (bnavCount) bnavCount.innerText = count;

        const itemsDiv = document.getElementById('cart-items');
        if (itemsDiv) {
            itemsDiv.innerHTML = this.items.map((item, idx) => `
                <div class="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div class="flex flex-col flex-1">
                        <span class="text-white font-bold text-xs">${item.name}</span>
                        <span class="text-blue-500 font-black text-[10px]">R$ ${window.formatBRL(item.price)}</span>
                    </div>
                    <button onclick="window.APP.cart.remove(${idx})" class="text-red-500 hover:text-red-400 ml-2">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
            `).join('');
        }

        const total = this.items.reduce((acc, item) => acc + Number(item.price), 0);
        const cartTotal = document.getElementById('cart-total');
        if (cartTotal) cartTotal.innerText = `R$ ${window.formatBRL(total)}`;

        if (window.lucide) lucide.createIcons();
    },

    /**
     * ✅ v2.2: abrir o carrinho agora empilha uma entrada de histórico,
     * pra que o botão "voltar" feche a gaveta em vez de sair do app.
     */
    openCart() {
        const drawer = document.getElementById('cart-drawer');
        if (drawer) drawer.classList.remove('translate-x-full');

        if (!this._cartHistoryPushed) {
            history.pushState({ ityrapuanCartOpen: true }, '');
            this._cartHistoryPushed = true;
        }
    },

    /**
     * ✅ v2.2: fechar pelo X consome a entrada de histórico empilhada
     * (via history.back()), pra não deixar "lixo" na pilha que exigiria
     * apertar voltar duas vezes depois.
     */
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

        const isOpen = !drawer.classList.contains('translate-x-full');
        if (isOpen) this.closeCart();
        else this.openCart();
    },

    getTotal() {
        return this.items.reduce((acc, item) => acc + Number(item.price), 0);
    },

    clear() {
        this.items = [];
        Storage.saveCart([]);
        this.updateUI();
        log('Carrinho limpo', 'success');
    },

    getCount() {
        return this.items.length;
    }
};
