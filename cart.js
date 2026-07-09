/**
 * CART.JS v2.0
 * Gerencia carrinho de compras
 * ✅ v2.0: feedback visual ao adicionar item — toast + bounce no
 *    ícone/contador do carrinho (antes só atualizava o número, sem
 *    dar nenhuma confirmação visível pro usuário)
 */

const Cart = {
    items: [],

    /**
     * Inicializa carrinho com dados salvos
     */
    init() {
        this.items = Storage.loadCart();
        this.updateUI();
    },

    /**
     * Adiciona item ao carrinho
     */
    add(productId, productName, price) {
        // Verifica se loja está aberta
        if (window.StoreStatus && typeof StoreStatus.canAddToCart === 'function') {
            if (!StoreStatus.canAddToCart()) return;
        }

        this.items.push({ id: productId, name: productName, price });
        Storage.saveCart(this.items);
        this.updateUI();

        // ✅ v2.0: feedback visual de confirmação
        this.showAddedFeedback(productName);

        log(`Item adicionado: ${productName}`, 'success');
    },

    /**
     * ✅ NOVO (v2.0): dispara o toast de confirmação + bounce nos ícones
     * do carrinho (sidebar e bottom nav)
     */
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

        // Força o navegador a registrar o estado inicial antes de animar
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
            void el.offsetWidth; // força reflow pra poder re-disparar a animação
            el.classList.add('cart-bump');
        });
    },

    /**
     * Remove item do carrinho
     */
    remove(index) {
        if (index < 0 || index >= this.items.length) return;
        
        const removed = this.items.splice(index, 1)[0];
        Storage.saveCart(this.items);
        this.updateUI();
        
        log(`Item removido: ${removed.name}`, 'success');
    },

    /**
     * Atualiza UI do carrinho
     */
    updateUI() {
        const count = this.items.length;

        // Atualizar contador sidebar (desktop)
        const cartCount = document.getElementById('cart-count');
        if (cartCount) cartCount.innerText = count;

        // Atualizar contador bottom nav (mobile)
        const bnavCount = document.getElementById('bnav-cart-count');
        if (bnavCount) bnavCount.innerText = count;

        // Renderizar itens
        const itemsDiv = document.getElementById('cart-items');
        if (itemsDiv) {
            itemsDiv.innerHTML = this.items.map((item, idx) => `
                <div class="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div class="flex flex-col flex-1">
                        <span class="text-white font-bold text-xs">${item.name}</span>
                        <span class="text-blue-500 font-black text-[10px]">R$ ${Number(item.price).toFixed(2)}</span>
                    </div>
                    <button onclick="window.APP.cart.remove(${idx})" class="text-red-500 hover:text-red-400 ml-2">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
            `).join('');
        }

        // Calcular total
        const total = this.items.reduce((acc, item) => acc + Number(item.price), 0);
        const cartTotal = document.getElementById('cart-total');
        if (cartTotal) cartTotal.innerText = `R$ ${total.toFixed(2)}`;

        if (window.lucide) lucide.createIcons();
    },

    /**
     * Alterna visibilidade do drawer
     */
    toggleCart() {
        const drawer = document.getElementById('cart-drawer');
        if (drawer) drawer.classList.toggle('translate-x-full');
    },

    closeCart() {
        const drawer = document.getElementById('cart-drawer');
        if (drawer) drawer.classList.add('translate-x-full');
    },

    openCart() {
        const drawer = document.getElementById('cart-drawer');
        if (drawer) drawer.classList.remove('translate-x-full');
    },

    /**
     * Retorna total do carrinho
     */
    getTotal() {
        return this.items.reduce((acc, item) => acc + Number(item.price), 0);
    },

    /**
     * Limpa carrinho
     */
    clear() {
        this.items = [];
        Storage.saveCart([]);
        this.updateUI();
        log('Carrinho limpo', 'success');
    },

    /**
     * Retorna quantidade de itens
     */
    getCount() {
        return this.items.length;
    }
};  