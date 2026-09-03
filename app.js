/**
 * APP.JS v5.4
 * ✅ Navigation.init() chamado corretamente (registra event listeners)
 * ✅ Removidas dependências de arquivos inexistentes
 * ✅ try/catch em cada módulo para não propagar falhas
 * ✅ Adicionado VendorSettings (Status da Loja via Supabase)
 * ✅ v5.2: Notifications — avisa o vendedor em tempo real quando um
 *    produto dele é vendido (toast + selo no botão BI)
 * ✅ v5.2: Moderation — avisa o Admin Supremo em tempo real toda vez
 *    que um produto novo é publicado (nome do vendedor, produto, imagem,
 *    descrição), com fila de aprovação/bloqueio e lista de palavras
 *    proibidas editável
 * ✅ v5.3: RestockAlerts — avisa quem favoritou um produto esgotado
 *    assim que ele volta a ter estoque (toast + conferência periódica)
 * ✅ v5.4 NOVO: Onboarding — tutorial passo a passo (comprador e
 *    vendedor) + missões simples de gamificação, revisável a qualquer
 *    hora pelo botão "❓" flutuante
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
    moderation: null,
    restockAlerts: null,
    onboarding: null,

    async init() {
        try {
            log('🚀 Inicializando APP v5.4...', 'info');

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

            // 12. ✅ NOVO: MODERATION (aviso de produto novo + fila de aprovação)
            window.APP.moderation = Moderation;
            try {
                window.APP.moderation.init();
            } catch (modErr) {
                log(`⚠️ Moderation.init falhou: ${modErr.message}`, 'warning');
            }

            // 13. ✅ NOVO: RESTOCK ALERTS (avisa quem favoritou um produto
            // esgotado assim que ele volta a ter estoque)
            window.APP.restockAlerts = RestockAlerts;
            try {
                window.APP.restockAlerts.startWatching();
            } catch (raErr) {
                log(`⚠️ RestockAlerts falhou: ${raErr.message}`, 'warning');
            }

            // 14. ✅ NOVO: ONBOARDING (tutorial passo a passo + missões)
            window.APP.onboarding = Onboarding;
            try {
                window.APP.onboarding.init();
            } catch (onbErr) {
                log(`⚠️ Onboarding.init falhou: ${onbErr.message}`, 'warning');
            }

            // 15. ✅ NOVO: PWA INSTALL (banner de instalar na tela inicial)
            try {
                PwaInstall.init();
            } catch (pwaErr) {
                log(`⚠️ PwaInstall.init falhou: ${pwaErr.message}`, 'warning');
            }

            // 16. Renderizar ícones Lucide
            if (window.lucide) lucide.createIcons();

            log('✅ APP v5.4 inicializado com sucesso!', 'success');

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
window.addToCart  = (id, name, price, bulkMinQty, bulkUnitPrice) => window.APP?.cart?.add?.(id, name, price, bulkMinQty, bulkUnitPrice);
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
