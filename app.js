/**
 * APP.JS v5.2
 * ✅ Navigation.init() chamado corretamente (registra event listeners)
 * ✅ Removidas dependências de arquivos inexistentes
 * ✅ try/catch em cada módulo para não propagar falhas
 * ✅ Adicionado VendorSettings (Status da Loja via Supabase)
 * ✅ v5.2 NOVO: Notifications — avisa o vendedor em tempo real quando um
 *    produto dele é vendido (toast + selo no botão BI)
 */

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

    async init() {
        try {
            log('🚀 Inicializando APP v5.2...', 'info');

            if (!window._supabase) {
                throw new Error('Supabase não disponível — verifique o CDN antes de config.js');
            }

            // 1. NAVIGATION — precisa estar antes de tudo pois registra event listeners
            window.APP.navigation = Navigation;
            try {
                window.APP.navigation.init();
            } catch (navErr) {
                log(`⚠️ Navigation.init falhou: ${navErr.message}`, 'warning');
            }

            // 2. AUTH
            window.APP.auth = Auth;
            try {
                await window.APP.auth.init();
            } catch (authErr) {
                log(`⚠️ Auth.init falhou: ${authErr.message}`, 'warning');
            }

            // 3. STORE STATUS
            window.APP.storeStatus = StoreStatus;
            try {
                if (!StoreStatus.checkInterval) StoreStatus.init();
            } catch (ssErr) {
                log(`⚠️ StoreStatus.init falhou: ${ssErr.message}`, 'warning');
            }

            // 4. VENDOR SETTINGS (Status da Loja — Supabase)
            window.APP.vendorSettings = VendorSettings;
            try {
                await window.APP.vendorSettings.init();
            } catch (vsErr) {
                log(`⚠️ VendorSettings.init falhou: ${vsErr.message}`, 'warning');
            }

            // 5. PRODUCTS
            window.APP.products = Products;
            try {
                await window.APP.products.fetchAll();
            } catch (prodErr) {
                log(`⚠️ Products.fetchAll falhou: ${prodErr.message}`, 'warning');
            }

            // 6. ADS
            window.APP.ads = Ads;
            try {
                await window.APP.ads.init();
            } catch (adsErr) {
                log(`⚠️ Ads.init falhou: ${adsErr.message}`, 'warning');
            }

            // 7. MÓDULOS SÍNCRONOS
            window.APP.tenants = Tenants;
            window.APP.bi = BI;

            // 8. NAVIGATION — mostra aba inicial
            try {
                window.APP.navigation.showTab('market');
            } catch (navErr) {
                log(`⚠️ showTab('market') falhou: ${navErr.message}`, 'warning');
            }

            // 9. CART
            window.APP.cart = Cart;
            try {
                window.APP.cart.init();
            } catch (cartErr) {
                log(`⚠️ Cart.init falhou: ${cartErr.message}`, 'warning');
            }

            // 10. ORDERS
            window.APP.orders = Orders;

            // 11. ✅ NOVO: NOTIFICATIONS (aviso de venda em tempo real)
            window.APP.notifications = Notifications;
            try {
                window.APP.notifications.init();
            } catch (notifErr) {
                log(`⚠️ Notifications.init falhou: ${notifErr.message}`, 'warning');
            }

            // 12. Renderizar ícones Lucide
            if (window.lucide) lucide.createIcons();

            log('✅ APP v5.2 inicializado com sucesso!', 'success');

        } catch (err) {
            log(`❌ Erro crítico: ${err.message}`, 'error');
            console.error(err);
        }
    }
};

window.APP = APP;

// Funções globais de compatibilidade
window.goToTab    = (tab) => Navigation.showTab(tab);
window.toggleCart = ()    => window.APP?.cart?.toggleCart?.();
window.openLogin  = (tab) => window.APP?.auth?.openAuthModal?.(tab || 'login');
window.doLogout   = ()    => window.APP?.auth?.logout?.();
window.addToCart  = (id, name, price) => window.APP?.cart?.add?.(id, name, price);
window.doCheckout = ()    => window.APP?.orders?.checkout?.();

function log(message, type = 'info') {
    const styles = {
        success: 'color:#10b981;font-weight:bold;',
        error:   'color:#ef4444;font-weight:bold;',
        warning: 'color:#f59e0b;font-weight:bold;',
        info:    'color:#3b82f6;font-weight:bold;'
    };
    const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    console.log(`%c${icons[type]||'•'} ${message}`, styles[type]||'');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => APP.init());
} else {
    APP.init();
}