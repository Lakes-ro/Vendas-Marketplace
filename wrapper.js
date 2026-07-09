/**
 * WRAPPER.JS v1.0
 * Funções que aguardam APP estar pronto antes de executar
 * Coloque ANTES de app.js no index.html
 */

function withAppReady(callback) {
    if (window.APP) {
        callback();
    } else {
        const maxAttempts = 50;
        let attempts = 0;

        const checkApp = setInterval(() => {
            attempts++;
            
            if (window.APP) {
                clearInterval(checkApp);
                callback();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkApp);
                console.error('❌ APP não inicializou a tempo');
                alert('⚠️ Erro ao inicializar aplicação. Recarregue a página.');
            }
        }, 100);
    }
}

window.goToTab = function(tabName) {
    withAppReady(() => {
        if (window.APP && window.APP.navigation && window.APP.navigation.showTab) {
            window.APP.navigation.showTab(tabName);
        }
    });
};

window.toggleCart = function() {
    withAppReady(() => {
        if (window.APP && window.APP.cart && window.APP.cart.toggleCart) {
            window.APP.cart.toggleCart();
        }
    });
};

window.openLogin = function(tab = 'login') {
    withAppReady(() => {
        if (window.APP && window.APP.auth && window.APP.auth.openAuthModal) {
            window.APP.auth.openAuthModal(tab);
        }
    });
};

window.doLogout = function() {
    withAppReady(() => {
        if (window.APP && window.APP.auth && window.APP.auth.logout) {
            window.APP.auth.logout();
        }
    });
};

window.clickAds = function() {
    withAppReady(() => {
        if (window.APP && window.APP.ads && window.APP.ads.clickAd) {
            window.APP.ads.clickAd();
        }
    });
};

window.addToCart = function(productId, productName, price) {
    withAppReady(() => {
        if (window.APP && window.APP.cart && window.APP.cart.add) {
            window.APP.cart.add(productId, productName, price);
        }
    });
};

window.doCheckout = function() {
    withAppReady(() => {
        if (window.APP && window.APP.orders && window.APP.orders.checkout) {
            window.APP.orders.checkout();
        }
    });
};

console.log('✅ Wrapper functions carregadas');