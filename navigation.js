/**
 * NAVIGATION.JS v3.3
 * ✅ Event listeners para data-nav e data-action (sidebar + bottom nav)
 * ✅ Todas as seções registradas (incluindo ads-requests, vendor-settings)
 * ✅ Sem dependência de onclick no HTML
 * ✅ goToTab() exposta globalmente
 * ✅ open-profile / close-profile-modal — botão de conta abre cartão de perfil
 * ✅ v3.3 NOVO: ao abrir a aba BI, limpa o selo de "nova venda" (Notifications)
 */

const Navigation = {
    sections: ['market', 'bi', 'admin', 'seller', 'ads', 'ads-requests', 'vendor-settings', 'tenants'],
    activeTab: 'market',

    init() {
        this._registerDataNavButtons();
        this._registerDataActionButtons();
        this._registerAuthTabs();
        this._registerForms();
        log('✅ Navigation v3.3 inicializado', 'success');
    },

    _registerDataNavButtons() {
        document.querySelectorAll('[data-nav]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-nav');
                this.showTab(tab);
            });
        });
    },

    _registerDataActionButtons() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            this._handleAction(action, btn, e);
        });
    },

    _handleAction(action, btn, e) {
        switch (action) {
            case 'open-login':
                if (window.APP?.auth) window.APP.auth.openAuthModal('login');
                break;
            case 'open-profile':
                if (window.APP?.auth) window.APP.auth.openProfileModal();
                break;
            case 'close-profile-modal':
                if (window.APP?.auth) window.APP.auth.closeProfileModal();
                break;
            case 'logout':
                if (window.APP?.auth) window.APP.auth.logout();
                break;
            case 'add-to-cart': {
                const id    = btn.getAttribute('data-id');
                const name  = btn.getAttribute('data-name');
                const price = parseFloat(btn.getAttribute('data-price'));
                if (window.APP?.cart) {
                    const beforeCount = window.APP.cart.getCount();
                    window.APP.cart.add(id, name, price);
                    // Só anima o botão se o item realmente entrou (loja pode estar fechada)
                    if (window.APP.cart.getCount() > beforeCount) {
                        this._flashAddButton(btn);
                    }
                }
                break;
            }
            case 'toggle-cart':
                if (window.APP?.cart) window.APP.cart.toggleCart();
                break;
            case 'close-cart':
                if (window.APP?.cart) window.APP.cart.closeCart();
                break;
            case 'checkout':
                if (window.APP?.orders) window.APP.orders.checkout();
                break;
            case 'open-product-modal':
                if (window.APP?.products) window.APP.products.openModal();
                break;
            case 'close-product-modal':
                if (window.APP?.products) window.APP.products.closeModal();
                break;
            case 'close-auth-modal':
                if (window.APP?.auth) window.APP.auth.closeAuthModal();
                break;
            case 'close-checkout-modal': {
                const cm = document.getElementById('customer-modal');
                if (cm) cm.classList.add('hidden');
                break;
            }
            case 'close-tenant-modal': {
                const tm = document.getElementById('tenant-details-modal');
                if (tm) tm.classList.add('hidden');
                break;
            }
            case 'toggle-ad-type': {
                const type = btn.getAttribute('data-type');
                if (window.APP?.ads?.toggleAdType) window.APP.ads.toggleAdType(type);
                else if (window.APP?.ads) window.APP.ads.adType = type;
                break;
            }
            default:
                break;
        }
    },

    /**
     * Feedback visual no botão "Adicionar ao Carrinho" — mostra
     * "✓ Adicionado!" por instantes, sem perder o texto/estado original.
     */
    _flashAddButton(btn) {
        if (!btn || btn.dataset.flashing === '1') return;

        const original = btn.innerHTML;
        btn.dataset.flashing = '1';
        btn.classList.add('btn-add-success');
        btn.innerHTML = '✓ Adicionado!';

        setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove('btn-add-success');
            btn.dataset.flashing = '0';
        }, 1100);
    },


    _registerAuthTabs() {
        document.querySelectorAll('[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                if (!window.APP?.auth) return;
                if (tab === 'login') window.APP.auth.showLoginTab();
                else if (tab === 'signup') window.APP.auth.showSignupTab();
                else if (tab === 'forgot') window.APP.auth.showForgotTab();
            });
        });
    },

    _registerForms() {
        document.addEventListener('submit', (e) => {
            const form = e.target.closest('[data-form]');
            if (!form) return;
            e.preventDefault();

            const formType = form.getAttribute('data-form');
            const subType = form.getAttribute('data-type');

            if (formType === 'auth') {
                if (subType === 'login' && window.APP?.auth) window.APP.auth.loginDirect();
                else if (subType === 'signup' && window.APP?.auth) window.APP.auth.signupDirect();
                else if (subType === 'forgot' && window.APP?.auth) window.APP.auth.resetPasswordDirect();
            } else if (formType === 'product' && window.APP?.products) {
                window.APP.products.saveProductDirect();
            } else if (formType === 'checkout' && window.APP?.orders) {
                window.APP.orders.sendOrderDirect();
            } else if (formType === 'ads' && window.APP?.ads) {
                window.APP.ads.saveAd(null, subType || window.APP.ads.adType || 'image');
            }
        });
    },

    showTab(tab) {
        try {
            if (!this.sections.includes(tab)) {
                log(`⚠️ Tab inválida: "${tab}"`, 'warning');
                return;
            }

            this.sections.forEach(s => {
                const el = document.getElementById(`${s}-section`);
                if (el) el.classList.add('hidden');
            });

            const target = document.getElementById(`${tab}-section`);
            if (target) {
                target.classList.remove('hidden');
                this.activeTab = tab;
                this._updateActiveButtons(tab);
                this._loadDataForTab(tab);
                log(`📍 Navegou para: ${tab}`, 'success');
            } else {
                log(`⚠️ Seção não encontrada: #${tab}-section`, 'warning');
            }
        } catch (err) {
            log(`❌ Erro na navegação: ${err.message}`, 'error');
        }
    },

    _updateActiveButtons(activeTab) {
        document.querySelectorAll('[data-nav]').forEach(btn => {
            const tab = btn.getAttribute('data-nav');
            btn.classList.toggle('bg-white/10', tab === activeTab);
            btn.classList.toggle('text-white', tab === activeTab);
        });

        document.querySelectorAll('.bnav-btn[data-nav]').forEach(btn => {
            const tab = btn.getAttribute('data-nav');
            btn.classList.toggle('active', tab === activeTab);
        });
    },

    _loadDataForTab(tab) {
        if (!window.APP) return;
        try {
            if (tab === 'bi') {
                if (window.APP.bi?.loadDashboard) window.APP.bi.loadDashboard();
                // ✅ NOVO: entrar no BI "lê" as notificações de venda pendentes
                window.APP.notifications?.clearUnseen?.();
            }
            else if (tab === 'admin' && window.APP.products?.renderAdmin) window.APP.products.renderAdmin();
            else if (tab === 'seller' && window.APP.products?.renderSeller) window.APP.products.renderSeller();
            else if (tab === 'tenants' && window.APP.tenants?.loadDashboard) window.APP.tenants.loadDashboard();
            else if (tab === 'ads' && window.APP.ads?.loadAds) window.APP.ads.loadAds();
            else if (tab === 'vendor-settings' && window.APP.vendorSettings?.refresh) window.APP.vendorSettings.refresh();
        } catch (err) {
            log(`⚠️ Erro ao carregar aba ${tab}: ${err.message}`, 'warning');
        }
    },

    getActiveTab() { return this.activeTab; }
};

window.goToTab = function(tab) { Navigation.showTab(tab); };