/**
 * AUTH.JS v8.3
 * ✅ Botão de logout mostra avatar, nome, email e role do usuário logado
 * ✅ Bottom nav sincronizado
 * ✅ loginDirect / signupDirect / resetPasswordDirect
 * ✅ Logout limpa StoreStatus interval
 * ✅ 'ads-nav-btn' exclusivo do Admin Supremo; vendedor usa 'ads-requests-nav-btn'
 * ✅ 'bi-nav-btn' liberado pro vendedor — bi.js escopa os dados por role
 * ✅ Botão de conta abre cartão de perfil (nome, role, email, telefone)
 * ✅ v8.3 NOVO: logout agora também encerra a escuta em tempo real de
 *    notificações de venda (Notifications.teardown()), evitando que a
 *    assinatura Realtime continue ativa depois que o usuário saiu.
 */

const Auth = {
    session: null,
    profile: null,
    role: 'client',
    userId: null,

    SUPREME_ADMINS: ['rogeralmeida15000@gmail.com'],

    ROLE_LABELS: {
        supreme: { label: 'Admin Supremo', color: '#ef4444', icon: '👑' },
        seller:  { label: 'Vendedor',       color: '#3b82f6', icon: '🪪' },
        client:  { label: 'Cliente',        color: '#94a3b8', icon: '👤' }
    },

    async init() {
        try {
            if (!window._supabase) { log('❌ Supabase não disponível', 'error'); return; }
            const { data: { session }, error } = await _supabase.auth.getSession();
            if (error) throw error;
            if (session) {
                this.session = session;
                this.userId  = session.user.id;
                await this.loadProfile();
            } else {
                this.role   = 'client';
                this.userId = null;
            }
            this.renderUIByRole();
            log('✅ Auth inicializado', 'info');
        } catch (err) {
            log(`❌ Erro auth: ${err.message}`, 'error');
            this.role = 'client';
        }
    },

    async loadProfile() {
        try {
            if (!this.session?.user?.id) return;
            const { data, error } = await _supabase
                .from('profiles').select('*').eq('id', this.session.user.id).single();

            if (error?.code === 'PGRST116') {
                // Perfil não existe — criar
                const userEmail    = this.session.user.email;
                const isSuperAdmin = this.SUPREME_ADMINS.includes(userEmail);
                const { error: insertError } = await _supabase.from('profiles').insert([{
                    id:        this.session.user.id,
                    email:     userEmail,
                    full_name: this.session.user.user_metadata?.full_name || 'Usuário',
                    phone:     this.session.user.user_metadata?.phone || '',
                    role:      isSuperAdmin ? 'supreme' : 'seller',
                    status:    'active'
                }]);
                if (insertError) throw insertError;
                this.profile = {
                    id: this.session.user.id, email: userEmail,
                    full_name: this.session.user.user_metadata?.full_name || 'Usuário',
                    role: isSuperAdmin ? 'supreme' : 'seller', status: 'active'
                };
                this.role = this.profile.role;
                log(`✅ Perfil criado: ${this.role}`, 'success');
                return;
            }

            if (error) throw error;
            this.profile = data;
            this.role    = data?.role || 'client';

            if (data?.status === 'banned') {
                alert('⛔ Sua conta foi banida');
                await this.logout();
                return;
            }
            log(`✅ Perfil carregado: ${data.full_name} (${data.role})`, 'success');
        } catch (err) {
            log(`❌ Erro ao carregar perfil: ${err.message}`, 'error');
            this.profile = null;
        }
    },

    renderUIByRole() {
        const show = (id) => { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); };
        const hide = (id) => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); };

        // Sidebar — reset
        ['bi-nav-btn','admin-nav-btn','seller-nav-btn','ads-nav-btn','tenants-nav-btn',
         'ads-requests-nav-btn','vendor-settings-nav-btn'].forEach(hide);
        hide('logout-btn');
        show('login-btn');

        if (this.role === 'supreme') {
            ['bi-nav-btn','admin-nav-btn','ads-nav-btn','tenants-nav-btn'].forEach(show);
            hide('login-btn');
            show('logout-btn');
            log('👑 UI: ADMIN SUPREMO', 'success');
        } else if (this.role === 'seller') {
            ['seller-nav-btn','bi-nav-btn','ads-requests-nav-btn','vendor-settings-nav-btn'].forEach(show);
            hide('login-btn');
            show('logout-btn');
            log('🪪 UI: VENDEDOR', 'success');
        } else if (this.session) {
            hide('login-btn');
            show('logout-btn');
            log('👤 UI: CLIENTE LOGADO', 'success');
        } else {
            show('login-btn');
            log('🚫 UI: ANÔNIMO', 'info');
        }

        this._updateLogoutButton();
        this._syncBottomNav();
    },

    /**
     * Atualiza o botão de logout/conta com avatar, nome, email e role
     */
    _updateLogoutButton() {
        const logoutBtn = document.getElementById('logout-btn');
        if (!logoutBtn) return;

        if (!this.session) {
            logoutBtn.innerHTML = `
                <i data-lucide="log-out" class="flex-shrink-0"></i>
                <span class="hidden lg:block">Sair</span>`;
            if (window.lucide) lucide.createIcons();
            return;
        }

        const name   = this.profile?.full_name || this.session?.user?.email?.split('@')[0] || 'Usuário';
        const email  = this.profile?.email || this.session?.user?.email || '';
        const role   = this.role || 'client';
        const meta   = this.ROLE_LABELS[role] || this.ROLE_LABELS.client;
        const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

        logoutBtn.innerHTML = `
            <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-xs text-white"
                 style="background: linear-gradient(135deg, ${meta.color}, ${meta.color}99);">
                ${initials}
            </div>
            <div class="hidden lg:flex flex-col items-start min-w-0 flex-1">
                <span class="font-bold text-xs text-white truncate max-w-[130px]">${name}</span>
                <span class="text-[10px] truncate max-w-[130px]" style="color:${meta.color}">
                    ${meta.icon} ${meta.label}
                </span>
            </div>
            <i data-lucide="log-out" class="flex-shrink-0 w-4 h-4 text-slate-400 hidden lg:block"></i>`;

        logoutBtn.title = `${name} · ${meta.label} · Clique para sair`;

        if (window.lucide) lucide.createIcons();
    },

    _syncBottomNav() {
        const roleMap = {
            'bnav-bi':      ['seller', 'supreme'],
            'bnav-admin':   ['supreme'],
            'bnav-seller':  ['seller', 'supreme'],
            'bnav-ads':     ['supreme'],
            'bnav-tenants': ['supreme'],
            'bnav-ads-requests':    ['seller'],
            'bnav-vendor-settings': ['seller'],
        };

        Object.keys(roleMap).forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            if (roleMap[id].includes(this.role)) btn.classList.remove('hidden');
            else btn.classList.add('hidden');
        });

        const bnavLogin  = document.getElementById('bnav-login-btn');
        const bnavLogout = document.getElementById('bnav-logout-btn');

        if (this.session) {
            if (bnavLogin)  bnavLogin.classList.add('hidden');
            if (bnavLogout) {
                bnavLogout.classList.remove('hidden');
                const name = this.profile?.full_name || this.session?.user?.email?.split('@')[0] || '';
                const meta = this.ROLE_LABELS[this.role] || this.ROLE_LABELS.client;
                bnavLogout.title = `${name} · ${meta.label}`;
                const span = bnavLogout.querySelector('span');
                if (span) span.textContent = name.split(' ')[0] || 'Sair';
            }
        } else {
            if (bnavLogin)  bnavLogin.classList.remove('hidden');
            if (bnavLogout) bnavLogout.classList.add('hidden');
        }

        if (window.lucide) lucide.createIcons();
    },

    // ── Helpers ─────────────────────────────────────────────
    isSupreme()  { return this.role === 'supreme'; },
    isSeller()   { return this.role === 'seller' || this.role === 'supreme'; },
    isLoggedIn() { return !!this.session; },
    canEditProduct(ownerId) {
        if (this.role === 'supreme') return true;
        return this.role === 'seller' && this.userId === ownerId;
    },
    getUsername() {
        return this.profile?.full_name || this.session?.user?.email || 'Anônimo';
    },

    // ── Modal Auth ───────────────────────────────────────────
    openAuthModal(tab = 'login') {
        const modal = document.getElementById('auth-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        if (tab === 'signup') this.showSignupTab();
        else if (tab === 'forgot') this.showForgotTab();
        else this.showLoginTab();
    },
    closeAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (modal) modal.classList.add('hidden');
    },

    // ── Modal Perfil ─────────────────────────────────────────
    openProfileModal() {
        if (!this.session) {
            this.openAuthModal('login');
            return;
        }
        this._populateProfileModal();
        const modal = document.getElementById('profile-modal');
        if (modal) modal.classList.remove('hidden');
    },
    closeProfileModal() {
        const modal = document.getElementById('profile-modal');
        if (modal) modal.classList.add('hidden');
    },
    _populateProfileModal() {
        const name  = this.profile?.full_name || this.session?.user?.email?.split('@')[0] || 'Usuário';
        const email = this.profile?.email || this.session?.user?.email || '—';
        const phone = this.profile?.phone || '—';
        const role  = this.role || 'client';
        const meta  = this.ROLE_LABELS[role] || this.ROLE_LABELS.client;
        const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

        const avatarEl = document.getElementById('profile-modal-avatar');
        if (avatarEl) {
            avatarEl.textContent = initials;
            avatarEl.style.background = `linear-gradient(135deg, ${meta.color}, ${meta.color}99)`;
        }

        const nameEl = document.getElementById('profile-modal-name');
        if (nameEl) nameEl.textContent = name;

        const roleEl = document.getElementById('profile-modal-role');
        if (roleEl) {
            roleEl.textContent = `${meta.icon} ${meta.label}`;
            roleEl.style.color = meta.color;
        }

        const emailEl = document.getElementById('profile-modal-email');
        if (emailEl) emailEl.textContent = email;

        const phoneEl = document.getElementById('profile-modal-phone');
        if (phoneEl) phoneEl.textContent = phone;

        if (window.lucide) lucide.createIcons();
    },

    _setActiveTab(active) {
        ['login','signup','forgot'].forEach(t => {
            const tab = document.getElementById(`${t}-tab`);
            const btn = document.getElementById(`${t}-tab-btn`);
            if (!tab || !btn) return;
            if (t === active) {
                tab.classList.remove('hidden');
                btn.classList.add('bg-blue-600','text-white');
                btn.classList.remove('text-slate-400');
            } else {
                tab.classList.add('hidden');
                btn.classList.remove('bg-blue-600','text-white');
                btn.classList.add('text-slate-400');
            }
        });
    },
    showLoginTab()  { this._setActiveTab('login'); },
    showSignupTab() { this._setActiveTab('signup'); },
    showForgotTab() { this._setActiveTab('forgot'); },

    // ── Login ────────────────────────────────────────────────
    async loginDirect() {
        const email    = document.getElementById('login-email')?.value;
        const password = document.getElementById('login-password')?.value;
        const btn      = document.querySelector('#login-tab button[type="submit"]');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ ENTRANDO...'; }
        try {
            if (!email || !password) throw new Error('Preencha email e senha');
            const { error } = await _supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            await this.init();
            this.closeAuthModal();
            alert('✅ Bem-vindo!');
        } catch (err) {
            log(`❌ Erro login: ${err.message}`, 'error');
            alert('❌ Email ou senha incorretos');
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = 'ENTRAR'; }
        }
    },

    // ── Signup ───────────────────────────────────────────────
    async signupDirect() {
        const email    = document.getElementById('signup-email')?.value;
        const password = document.getElementById('signup-password')?.value;
        const fullName = document.getElementById('signup-name')?.value;
        const phone    = document.getElementById('signup-phone')?.value;
        const btn      = document.querySelector('#signup-tab button[type="submit"]');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ CRIANDO...'; }
        try {
            if (!email || !password || !fullName || !phone) throw new Error('Preencha todos os campos');
            if (password.length < 6) throw new Error('Senha deve ter mínimo 6 caracteres');
            const { data: { user }, error } = await _supabase.auth.signUp({
                email, password, options: { data: { full_name: fullName, phone } }
            });
            if (error) throw error;
            if (!user) throw new Error('Usuário não foi criado');
            alert('✅ Cadastro realizado!\nVerifique seu email para confirmar.');
            this.closeAuthModal();
            setTimeout(() => this.showLoginTab(), 500);
        } catch (err) {
            log(`❌ Erro signup: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = 'CADASTRAR'; }
        }
    },

    // ── Reset Senha ──────────────────────────────────────────
    async resetPasswordDirect() {
        const email = document.getElementById('forgot-email')?.value;
        if (!email) { alert('❌ Digite seu email'); return; }
        const btn = document.querySelector('#forgot-tab button[type="submit"]');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ ENVIANDO...'; }
        try {
            const { error } = await _supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`
            });
            if (error) throw error;
            alert('✅ Email de recuperação enviado!\nVerifique sua caixa de entrada (e spam).');
            document.getElementById('forgot-email').value = '';
            setTimeout(() => this.showLoginTab(), 2000);
        } catch (err) {
            log(`❌ Erro ao enviar email: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '📧 ENVIAR LINK DE RECUPERAÇÃO'; }
        }
    },

    // ── Logout ───────────────────────────────────────────────
    async logout() {
        if (!confirm('Desconectar?')) return;
        try {
            const { error } = await _supabase.auth.signOut();
            if (error) throw error;
            this.session = null; this.profile = null; this.role = 'client'; this.userId = null;
            if (window.APP?.storeStatus?.checkInterval) {
                clearInterval(window.APP.storeStatus.checkInterval);
                window.APP.storeStatus.checkInterval = null;
            }
            // ✅ NOVO (v8.3): encerra a escuta em tempo real de vendas
            if (window.APP?.notifications?.teardown) {
                window.APP.notifications.teardown();
            }
            this.renderUIByRole();
            window.APP?.navigation?.showTab('market');
            alert('✅ Você foi desconectado');
        } catch (err) {
            log(`❌ Erro logout: ${err.message}`, 'error');
        }
    },

    // ── Aliases para compatibilidade ─────────────────────────
    async login(e)               { if (e) e.preventDefault(); await this.loginDirect(); },
    async signup(e)              { if (e) e.preventDefault(); await this.signupDirect(); },
    async sendPasswordReset(e)   { if (e) e.preventDefault(); await this.resetPasswordDirect(); }
};