/**
 * NAVIGATION.JS v3.5
 * v3.5 (auditoria):
 *  - bloqueia abrir aba que o cargo atual não pode ver
 *  - aba "ads" recarrega também as solicitações do Admin
 *  - aba "ads-requests" usa o cargo atual direto do Auth
 */

const Navigation = {
    sections: ['market', 'bi', 'admin', 'seller', 'ads', 'ads-requests', 'vendor-settings', 'tenants', 'moderation'],
    activeTab: 'market',
    _initialized: false,

    init() {
        if (this._initialized) return;
        this._initialized = true;
        this._registerDataNavButtons();
        this._registerDataActionButtons();
        this._registerAuthTabs();
        this._registerForms();
    },

    _registerDataNavButtons() {
        document.querySelectorAll('[data-nav]').forEach(btn => {
            btn.addEventListener('click', () => this.showTab(btn.getAttribute('data-nav')));
        });
    },

    _registerDataActionButtons() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            this._handleAction(btn.getAttribute('data-action'), btn, e);
        });
    },

    _handleAction(action, btn) {
        const app = window.APP || {};
        switch (action) {
            case 'open-login':          app.auth?.openAuthModal('login'); break;
            case 'open-profile':        app.auth?.openProfileModal(); break;
            case 'close-profile-modal': app.auth?.closeProfileModal(); break;
            case 'logout':              app.auth?.logout(); break;
            case 'close-auth-modal':    app.auth?.closeAuthModal(); break;
            case 'toggle-cart':         app.cart?.toggleCart(); break;
            case 'close-cart':          app.cart?.closeCart(); break;
            case 'checkout':            app.orders?.checkout(); break;
            case 'open-product-modal':  app.products?.openModal(); break;
            case 'close-product-modal': app.products?.closeModal(); break;
            case 'close-checkout-modal': app.orders?.closeCustomerModal?.(); break;
            case 'close-tenant-modal':  app.tenants?.closeTenantDetailsModal?.(); break;
            case 'toggle-ad-type':      app.ads?.toggleAdType?.(btn.getAttribute('data-type')); break;

            case 'add-to-cart': {
                const id = btn.getAttribute('data-id');
                const name = btn.getAttribute('data-name');
                const price = parseFloat(btn.getAttribute('data-price'));
                const stock = parseInt(btn.getAttribute('data-stock'), 10);
                let bulkTiers = [];
                try { bulkTiers = JSON.parse(btn.getAttribute('data-bulk-tiers') || '[]'); } catch { bulkTiers = []; }

                if (app.cart) {
                    const before = app.cart.getCount();
                    app.cart.add(id, name, price, bulkTiers, stock);
                    if (app.cart.getCount() > before) this._flashAddButton(btn);
                }
                break;
            }
            default: break;
        }
    },

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
                const auth = window.APP?.auth;
                if (!auth) return;
                if (tab === 'login') auth.showLoginTab();
                else if (tab === 'signup') auth.showSignupTab();
                else if (tab === 'forgot') auth.showForgotTab();
            });
        });
    },

    _registerForms() {
        document.addEventListener('submit', (e) => {
            const form = e.target.closest('[data-form]');
            if (!form) return;
            e.preventDefault();

            const app = window.APP || {};
            const formType = form.getAttribute('data-form');
            const subType = form.getAttribute('data-type');

            if (formType === 'auth') {
                if (subType === 'login') app.auth?.loginDirect();
                else if (subType === 'signup') app.auth?.signupDirect();
                else if (subType === 'forgot') app.auth?.resetPasswordDirect();
            } else if (formType === 'product') {
                app.products?.saveProductDirect();
            } else if (formType === 'checkout') {
                app.orders?.sendOrderDirect();
            } else if (formType === 'ads') {
                app.ads?.saveAd(null, subType || app.ads?.adType || 'image');
            } else if (formType === 'new-password') {
                app.auth?.updatePasswordDirect();
            }
        });
    },

    showTab(tab) {
        try {
            if (!this.sections.includes(tab)) return;

            const auth = window.APP?.auth;
            if (tab !== 'market' && auth && !auth.canAccessTab(tab)) {
                if (!auth.isLoggedIn()) auth.openAuthModal('login');
                tab = 'market';
            }

            this.sections.forEach(s => document.getElementById(`${s}-section`)?.classList.add('hidden'));

            const target = document.getElementById(`${tab}-section`);
            if (!target) return;

            target.classList.remove('hidden');
            this.activeTab = tab;
            this._updateActiveButtons(tab);
            this._loadDataForTab(tab);
            document.getElementById('whatsapp-fab')?.classList.toggle('show', tab === 'market');
        } catch (err) {
            log(`❌ Erro na navegação: ${err.message}`, 'error');
        }
    },

    _updateActiveButtons(activeTab) {
        document.querySelectorAll('[data-nav]').forEach(btn => {
            const on = btn.getAttribute('data-nav') === activeTab;
            btn.classList.toggle('bg-white/10', on);
            btn.classList.toggle('text-white', on);
            if (btn.classList.contains('bnav-btn')) btn.classList.toggle('active', on);
        });
    },

    _loadDataForTab(tab) {
        const app = window.APP;
        if (!app) return;
        try {
            switch (tab) {
                case 'bi':
                    app.bi?.loadDashboard();
                    app.notifications?.clearUnseen?.();
                    break;
                case 'admin':
                    app.products?.renderAdmin();
                    window.ImageOptimizer?.renderPanel?.();
                    app.vendorSettings?.refreshGlobalOverride?.();
                    break;
                case 'seller':
                    app.products?.renderSeller();
                    break;
                case 'tenants':
                    app.tenants?.loadDashboard();
                    break;
                case 'ads':
                    app.ads?.refreshForRole();
                    app.ads?.loadAds();
                    break;
                case 'ads-requests':
                    app.ads?._renderVendorRequestForm();
                    app.ads?._loadVendorRequests();
                    break;
                case 'vendor-settings':
                    app.vendorSettings?.refresh();
                    break;
                case 'moderation':
                    app.moderation?.loadQueue?.();
                    app.moderation?.clearUnseen?.();
                    break;
            }
        } catch (err) {
            log(`⚠️ Erro ao carregar aba ${tab}: ${err.message}`, 'warning');
        }
    },

    getActiveTab() { return this.activeTab; }
};

window.goToTab = function (tab) { Navigation.showTab(tab); };
