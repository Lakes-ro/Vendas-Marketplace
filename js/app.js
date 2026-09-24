/**
 * APP.JS v5.5
 * v5.5 (auditoria):
 *  - espera o Supabase ficar pronto (onSupabaseReady) em vez de falhar no boot
 *  - módulos opcionais (notifications, moderation, restock, onboarding, pwa)
 *    só são usados se o arquivo foi carregado — um arquivo faltando não
 *    derruba mais o resto do app
 *  - APP.onAuthChanged(): recarrega tudo que depende do login
 *    (chamado depois de login, logout e "Quero vender")
 *  - removida a função log() local que sobrescrevia window.log (DEBUG)
 */

function _optional(getter) {
    try { return getter(); } catch { return null; }
}

const APP = {
    auth: null,
    products: null,
    ads: null,
    bi: null,
    navigation: null,
    storeStatus: null,
    cart: null,
    orders: null,
    tenants: null,
    vendorSettings: null,
    notifications: null,
    moderation: null,
    restockAlerts: null,
    onboarding: null,
    orderManagement: null,
    adminWarnings: null,
    _started: false,

    async init() {
        if (this._started) return;
        this._started = true;

        const step = async (name, fn) => {
            try { await fn(); }
            catch (err) { log(`⚠️ ${name} falhou: ${err.message}`, 'warning'); }
        };

        this.navigation = Navigation;
        this.auth = Auth;
        this.storeStatus = StoreStatus;
        this.vendorSettings = VendorSettings;
        this.products = Products;
        this.ads = Ads;
        this.tenants = Tenants;
        this.bi = BI;
        this.cart = Cart;
        this.orders = Orders;
        this.orderManagement = _optional(() => OrderManagement);
        this.adminWarnings = _optional(() => AdminWarnings);
        this.notifications = _optional(() => Notifications);
        this.moderation = _optional(() => Moderation);
        this.restockAlerts = _optional(() => RestockAlerts);
        this.onboarding = _optional(() => Onboarding);
        this.vendorNotices = _optional(() => VendorNotices);

        await step('Navigation.init', () => this.navigation.init());
        await step('Cart.init', () => this.cart.init());

        // Vitrine pública não depende de login — começa já, em paralelo com o Auth
        const storefront = this.products.fetchStorefront().catch(() => {});

        await step('Auth.init', () => this.auth.init());

        // Painel do vendedor/admin: começa assim que sabemos quem logou,
        // sem esperar status da loja, anúncios e vitrine.
        this.products.fetchManageable().catch(() => {});
        await step('StoreStatus.init', () => this.storeStatus.init());
        await step('Ads.init', () => this.ads.init());

        await storefront;
        await this.onAuthChanged({ initial: true });

        await step('showTab', () => this.navigation.showTab('market'));

        await step('Notifications.init', () => this.notifications?.init?.());
        await step('Moderation.init', () => this.moderation?.init?.());
        await step('VendorNotices.init', () => this.vendorNotices?.init?.());
        await step('RestockAlerts', () => this.restockAlerts?.startWatching?.());
        await step('Onboarding.init', () => this.onboarding?.init?.());
        await step('PwaInstall.init', () => _optional(() => PwaInstall)?.init?.());

        // Tocou na notificação "Nova venda" → abre o BI
        this._bindOpenSales();

        // Comprovante de Pix pendente (a pessoa saiu pra pagar e a página recarregou)
        await step('Receipts', () => this.orders?.restorePendingReceipt?.());

        if (window.lucide) lucide.createIcons();
        log('✅ APP inicializado', 'success');
    },

    _bindOpenSales() {
        const openSales = () => {
            if (this.auth?.hasSellerTools?.()) this.navigation.showTab('bi');
            else if (this.auth?.isSupreme?.()) this.navigation.showTab('admin');
            else this.auth?.openAuthModal('login');
        };
        if (location.hash === '#vendas') {
            history.replaceState(null, '', location.pathname + location.search);
            openSales();
        }
        navigator.serviceWorker?.addEventListener('message', (e) => {
            if (e.data?.type === 'OPEN_SALES') openSales();
        });
    },

    /**
     * Tudo que muda quando alguém entra, sai ou troca de cargo.
     */
    async onAuthChanged({ initial = false } = {}) {
        const role = this.auth?.role;
        const isManager = !!this.auth?.hasSellerTools?.();

        // no início reaproveita a busca já disparada; depois de login/logout busca de novo
        try { await this.products?.fetchManageable({ force: !initial }); } catch (e) { log(e.message, 'warning'); }

        try {
            if (isManager) await this.vendorSettings?.init();
            else this.vendorSettings?.teardown?.();
        } catch (e) { log(e.message, 'warning'); }

        try { this.ads?.refreshForRole?.(); } catch (e) { log(e.message, 'warning'); }

        if (this.bi) {
            this.bi._allOrders = [];
            this.bi.currentPeriod = null;
        }

        if (!initial) {
            try {
                this.notifications?.teardown?.();
                if (this.auth?.isLoggedIn()) this.notifications?.init?.();
            } catch (e) { log(e.message, 'warning'); }
            try { this.moderation?.init?.(); } catch (e) { log(e.message, 'warning'); }
            try { await this.vendorNotices?.init?.(); } catch (e) { log(e.message, 'warning'); }
            try { this.onboarding?.refreshForRole?.(); } catch (e) { log(e.message, 'warning'); }
        }
    }
};

window.APP = APP;

// Funções globais de compatibilidade
window.goToTab    = (tab) => Navigation.showTab(tab);
window.toggleCart = () => window.APP?.cart?.toggleCart?.();
window.openLogin  = (tab) => window.APP?.auth?.openAuthModal?.(tab || 'login');
window.doLogout   = () => window.APP?.auth?.logout?.();
window.addToCart  = (id, name, price, bulkTiers, stock) => window.APP?.cart?.add?.(id, name, price, bulkTiers, stock);
window.doCheckout = () => window.APP?.orders?.checkout?.();

function _startApp() {
    window.onSupabaseReady(() => APP.init());
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startApp);
} else {
    _startApp();
}
