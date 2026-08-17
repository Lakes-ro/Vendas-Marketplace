/**
 * APP.JS v6.1
 * ✅ Navigation.init() chamado corretamente (registra event listeners)
 * ✅ Removidas dependências de arquivos inexistentes
 * ✅ try/catch em cada módulo para não propagar falhas
 * ✅ Notifications — avisa o vendedor em tempo real quando um
 *    produto dele é vendido (toast + selo no botão BI)
 * ✅ v6.0 PERFORMANCE (auditoria): StoreStatus, VendorSettings,
 *    Products.fetchAll e Ads.init eram 4 idas ao banco que NÃO
 *    dependem umas das outras, mas rodavam uma atrás da outra
 *    (await em série) — cada uma esperando a anterior terminar antes
 *    de sequer começar. Agora rodam em paralelo com Promise.allSettled
 *    (que, assim como o try/catch de cada uma antes, garante que uma
 *    falha isolada não trava as outras nem o restante do app). Isso
 *    reduz o tempo de inicialização ao tempo da mais lenta das quatro,
 *    em vez da SOMA das quatro. Auth continua rodando ANTES desse
 *    bloco, porque Products/Ads dependem do cargo (role) do usuário
 *    pra saber o que carregar.
 * ✅ v6.1 NOVO — PRIMEIRA IMPRESSÃO: index.html agora mostra uma tela
 *    de carregamento (splash, puramente HTML/CSS, aparece instantâneo)
 *    logo que a página abre — sem isso, quem entra pela primeira vez
 *    via internet mais lenta via alguns segundos de sidebar/vitrine
 *    vazias, parecendo que o site travou. Essa splash só desaparece
 *    quando o APP termina de inicializar (ou, no pior caso, depois de
 *    um tempo máximo de segurança — ver _hideBootSplash abaixo) —
 *    nunca fica presa na tela pra sempre, mesmo se algo falhar.
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

    /**
     * ✅ NOVO (v6.1): esconde a tela de carregamento inicial (splash)
     * com uma transição suave. Chamada tanto no caminho de sucesso
     * quanto no de erro do init() (bloco finally, mais abaixo) — e
     * também por um temporizador de segurança independente, lá no
     * final deste arquivo, pro caso de algo travar de um jeito que
     * nem o try/catch consiga pegar.
     */
    _hideBootSplash() {
        const el = document.getElementById('app-boot-splash');
        if (!el || el.dataset.hidden === '1') return;
        el.dataset.hidden = '1';
        el.classList.add('boot-splash-hide');
        setTimeout(() => el.remove(), 400);
    },

    async init() {
        try {
            log('🚀 Inicializando APP v6.1...', 'info');

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

            // 2. AUTH — precisa terminar primeiro: Products (manageProducts) e
            // Ads (setup por cargo) dependem de saber o role/userId do usuário.
            window.APP.auth = Auth;
            try {
                await window.APP.auth.init();
            } catch (authErr) {
                log(`⚠️ Auth.init falhou: ${authErr.message}`, 'warning');
            }

            // 3-6. ✅ PARALELO: StoreStatus, VendorSettings, Products e Ads não
            // dependem uns dos outros — rodam juntos em vez de em fila.
            window.APP.storeStatus = StoreStatus;
            window.APP.vendorSettings = VendorSettings;
            window.APP.products = Products;
            window.APP.ads = Ads;

            const results = await Promise.allSettled([
                (!StoreStatus.checkInterval ? StoreStatus.init() : Promise.resolve()),
                VendorSettings.init(),
                Products.fetchAll(),
                Ads.init()
            ]);

            const labels = ['StoreStatus.init', 'VendorSettings.init', 'Products.fetchAll', 'Ads.init'];
            results.forEach((r, i) => {
                if (r.status === 'rejected') {
                    log(`⚠️ ${labels[i]} falhou: ${r.reason?.message || r.reason}`, 'warning');
                }
            });

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

            // 11. NOTIFICATIONS (aviso de venda em tempo real) — depende de
            // Products.manageProducts já carregado, por isso vem depois do
            // bloco paralelo acima.
            window.APP.notifications = Notifications;
            try {
                window.APP.notifications.init();
            } catch (notifErr) {
                log(`⚠️ Notifications.init falhou: ${notifErr.message}`, 'warning');
            }

            // 12. PWA INSTALL (banner de instalar na tela inicial)
            try {
                PwaInstall.init();
            } catch (pwaErr) {
                log(`⚠️ PwaInstall.init falhou: ${pwaErr.message}`, 'warning');
            }

            // 13. Renderizar ícones Lucide
            if (window.lucide) lucide.createIcons();

            log('✅ APP v6.1 inicializado com sucesso!', 'success');

        } catch (err) {
            log(`❌ Erro crítico: ${err.message}`, 'error');
            console.error(err);
        } finally {
            // ✅ NOVO (v6.1): a splash some daqui, não importa se deu
            // tudo certo ou se algo falhou no meio do caminho — a
            // pessoa nunca fica olhando pra uma tela de carregamento
            // parada, mesmo em caso de erro.
            this._hideBootSplash();
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

// ✅ NOVO (v6.1): rede de segurança TOTALMENTE independente do fluxo
// normal do init() — mesmo que algo trave de um jeito bizarro que nem
// o try/catch/finally do APP.init() consiga capturar, a splash some
// sozinha depois de 8 segundos. Prefere mostrar o site "cru" (mesmo
// que algo não tenha carregado) a deixar a pessoa presa numa tela de
// carregamento pra sempre — que é o pior cenário possível pra quem tá
// entrando pela primeira vez.
setTimeout(() => {
    if (window.APP?._hideBootSplash) window.APP._hideBootSplash();
}, 8000);
