/**
 * AUTH.JS v8.9
 * v8.9: ao sair da conta, o aparelho para de receber avisos de venda (push).
 * v8.8 (auditoria):
 *  - nome/email escapados antes de ir pro innerHTML (XSS)
 *  - "Quero vender" agora abre o modal de aceite (#become-seller-modal)
 *    e só promove depois do aceite (_confirmBecomeSeller)
 *  - recuperação de senha funcionando: o link volta pra própria página,
 *    o evento PASSWORD_RECOVERY abre #new-password-modal e
 *    updatePasswordDirect() grava a nova senha
 *  - depois de login / logout / virar vendedor chama APP.onAuthChanged()
 *    (recarrega Estoque, Anúncios, Configurações sem precisar dar F5)
 *  - logout não mata mais o intervalo global do StoreStatus
 *  - cargo/status são protegidos no banco (trigger protect_profile_role_status)
 */

const Auth = {
    session: null,
    profile: null,
    role: 'client',
    userId: null,
    _authListenerBound: false,

    ROLE_LABELS: {
        supreme: { label: 'Admin Supremo', color: '#ef4444', icon: '👑' },
        seller:  { label: 'Vendedor',      color: '#3b82f6', icon: '🪪' },
        client:  { label: 'Cliente',       color: '#94a3b8', icon: '👤' }
    },

    async init() {
        try {
            if (!window._supabase) { log('❌ Supabase não disponível', 'error'); return; }
            this._bindAuthListener();

            const { data: { session }, error } = await _supabase.auth.getSession();
            if (error) throw error;

            if (session) {
                this.session = session;
                this.userId = session.user.id;
                await this.loadProfile();
            } else {
                this.session = null;
                this.profile = null;
                this.role = 'client';
                this.userId = null;
            }
            this.renderUIByRole();
            this._checkPixKeyReminder();
        } catch (err) {
            log(`❌ Erro auth: ${err.message}`, 'error');
            this.role = 'client';
        }
    },

    _bindAuthListener() {
        if (this._authListenerBound) return;
        this._authListenerBound = true;
        _supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                setTimeout(() => this.openNewPasswordModal(), 300);
            }
        });
        // Link de recuperação chegou com #type=recovery na URL
        if (/type=recovery/.test(window.location.hash)) {
            setTimeout(() => this.openNewPasswordModal(), 800);
        }
    },

    async loadProfile() {
        try {
            if (!this.session?.user?.id) return;
            const { data, error } = await _supabase
                .from('profiles').select('*').eq('id', this.session.user.id).maybeSingle();
            if (error) throw error;

            if (!data) {
                // Perfil não existe — cria como 'client' (o banco decide o cargo final)
                const meta = this.session.user.user_metadata || {};
                const { data: created, error: insertError } = await _supabase.from('profiles').insert([{
                    id: this.session.user.id,
                    email: this.session.user.email,
                    full_name: meta.full_name || 'Usuário',
                    phone: meta.phone || '',
                    role: 'client',
                    status: 'active'
                }]).select().single();
                if (insertError) throw insertError;
                this.profile = created;
                this.role = created?.role || 'client';
                return;
            }

            this.profile = data;
            this.role = data.role || 'client';

            if (data.status === 'banned') {
                alert('⛔ Sua conta foi banida');
                await this.logout(true);
            }
        } catch (err) {
            log(`❌ Erro ao carregar perfil: ${err.message}`, 'error');
            this.profile = null;
            this.role = 'client';
        }
    },

    renderUIByRole() {
        const show = (id) => document.getElementById(id)?.classList.remove('hidden');
        const hide = (id) => document.getElementById(id)?.classList.add('hidden');

        ['bi-nav-btn', 'admin-nav-btn', 'seller-nav-btn', 'ads-nav-btn', 'tenants-nav-btn',
         'ads-requests-nav-btn', 'vendor-settings-nav-btn', 'moderation-nav-btn'].forEach(hide);

        if (this.role === 'supreme') {
            ['admin-nav-btn', 'ads-nav-btn', 'tenants-nav-btn', 'moderation-nav-btn'].forEach(show);
            if (this.hasSellerTools()) ['bi-nav-btn', 'vendor-settings-nav-btn'].forEach(show);
        } else if (this.role === 'seller') {
            ['seller-nav-btn', 'bi-nav-btn', 'ads-requests-nav-btn', 'vendor-settings-nav-btn'].forEach(show);
        }

        if (this.session) { hide('login-btn'); show('logout-btn'); }
        else { show('login-btn'); hide('logout-btn'); }

        this._updateLogoutButton();
        this._syncBottomNav();

        // Se a aba aberta não é mais permitida pro cargo atual, volta pra Loja
        const active = window.APP?.navigation?.getActiveTab?.();
        if (active && active !== 'market' && !this.canAccessTab(active)) {
            window.APP.navigation.showTab('market');
        }
    },

    canAccessTab(tab) {
        const map = {
            market: ['client', 'seller', 'supreme'],
            bi: ['seller', 'supreme'],
            seller: ['seller', 'supreme'],
            'vendor-settings': ['seller', 'supreme'],
            'ads-requests': ['seller'],
            admin: ['supreme'],
            ads: ['supreme'],
            tenants: ['supreme'],
            moderation: ['supreme']
        };
        if (this.role === 'supreme' && !this.hasSellerTools() && this.SELLER_ONLY_TABS.includes(tab)) return false;
        return (map[tab] || []).includes(this.role);
    },

    SELLER_ONLY_TABS: ['bi', 'seller', 'vendor-settings'],

    _displayName() {
        return this.profile?.full_name || this.session?.user?.email?.split('@')[0] || 'Usuário';
    },

    _initials(name) {
        return String(name).split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
    },

    _updateLogoutButton() {
        const btn = document.getElementById('logout-btn');
        if (!btn) return;

        if (!this.session) {
            btn.innerHTML = `<i data-lucide="log-out" class="flex-shrink-0"></i><span class="hidden lg:block">Sair</span>`;
            if (window.lucide) lucide.createIcons();
            return;
        }

        const name = this._displayName();
        const meta = this.ROLE_LABELS[this.role] || this.ROLE_LABELS.client;

        btn.innerHTML = `
            <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-xs text-white"
                 style="background: linear-gradient(135deg, ${meta.color}, ${meta.color}99);">
                ${escapeHtml(this._initials(name))}
            </div>
            <div class="hidden lg:flex flex-col items-start min-w-0 flex-1">
                <span class="font-bold text-xs text-white truncate max-w-[130px]">${escapeHtml(name)}</span>
                <span class="text-[10px] truncate max-w-[130px]" style="color:${meta.color}">${meta.icon} ${meta.label}</span>
            </div>
            <i data-lucide="log-out" class="flex-shrink-0 w-4 h-4 text-slate-400 hidden lg:block"></i>`;
        btn.title = `${name} · ${meta.label} · Ver perfil`;
        if (window.lucide) lucide.createIcons();
    },

    _syncBottomNav() {
        const roleMap = {
            'bnav-bi': ['seller', 'supreme'],
            'bnav-admin': ['supreme'],
            'bnav-seller': ['seller'],
            'bnav-ads': ['supreme'],
            'bnav-tenants': ['supreme'],
            'bnav-moderation': ['supreme'],
            'bnav-ads-requests': ['seller'],
            'bnav-vendor-settings': ['seller', 'supreme']
        };
        Object.keys(roleMap).forEach(id => {
            const tab = id.replace('bnav-', '');
            document.getElementById(id)?.classList.toggle('hidden', !roleMap[id].includes(this.role) || !this.canAccessTab(tab));
        });

        const bLogin = document.getElementById('bnav-login-btn');
        const bLogout = document.getElementById('bnav-logout-btn');
        if (this.session) {
            bLogin?.classList.add('hidden');
            if (bLogout) {
                bLogout.classList.remove('hidden');
                const name = this._displayName();
                const meta = this.ROLE_LABELS[this.role] || this.ROLE_LABELS.client;
                bLogout.title = `${name} · ${meta.label}`;
                const span = bLogout.querySelector('span');
                if (span) span.textContent = name.split(' ')[0] || 'Conta';
            }
        } else {
            bLogin?.classList.remove('hidden');
            bLogout?.classList.add('hidden');
        }
        if (window.lucide) lucide.createIcons();
    },

    // ── Helpers ─────────────────────────────────────────────
    isSupreme()  { return this.role === 'supreme'; },
    isSeller()   { return this.role === 'seller' || this.role === 'supreme'; },
    /** Usa as ferramentas de vendedor? Admin só se CONFIG.ADMIN_SELLER_TOOLS = true. */
    hasSellerTools() {
        if (this.role === 'seller') return true;
        return this.role === 'supreme' && !!window.CONFIG?.ADMIN_SELLER_TOOLS;
    },
    isLoggedIn() { return !!this.session; },
    canEditProduct(ownerId) {
        if (this.role === 'supreme') return true;
        return this.role === 'seller' && !!ownerId && this.userId === ownerId;
    },
    getUsername() { return this.profile?.full_name || this.session?.user?.email || 'Anônimo'; },

    // ── Lembrete de chave Pix ───────────────────────────────
    async _checkPixKeyReminder() {
        if (this.role !== 'seller' || !this.userId) {
            this._togglePixReminderBadge(false);
            this._hidePixReminderBanner();
            return;
        }

        let hasPixKey = false;
        try {
            const { count, error } = await _supabase
                .from('vendor_pix_keys')
                .select('id', { count: 'exact', head: true })
                .eq('owner_id', this.userId);
            if (error) throw error;
            hasPixKey = (count || 0) > 0;
        } catch {
            hasPixKey = !!(this.profile?.pix_key && this.profile.pix_key.trim());
        }

        this._togglePixReminderBadge(!hasPixKey);

        const KEY = 'ityrapuan_pix_reminder_dismissed';
        if (hasPixKey) {
            this._hidePixReminderBanner();
            try { sessionStorage.removeItem(KEY); } catch {}
        } else {
            let dismissed = false;
            try { dismissed = sessionStorage.getItem(KEY) === '1'; } catch {}
            if (!dismissed) this._showPixReminderBanner();
        }
    },

    _togglePixReminderBadge(show) {
        ['vendor-settings-nav-btn', 'bnav-vendor-settings'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            let badge = btn.querySelector('.sale-badge.pix-badge');
            if (show && !badge) {
                badge = document.createElement('span');
                badge.className = 'sale-badge pix-badge';
                badge.textContent = '!';
                btn.appendChild(badge);
            }
            if (badge) badge.style.display = show ? 'flex' : 'none';
        });
    },

    _showPixReminderBanner() {
        if (document.getElementById('pix-reminder-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'pix-reminder-banner';
        banner.className = 'pix-reminder-banner';
        banner.innerHTML = `
            <span class="pix-reminder-text">⚠️ Você ainda não cadastrou sua <strong>chave Pix</strong> — sem ela, o comprador não recebe onde pagar e a venda depende de combinar tudo pelo WhatsApp.</span>
            <div class="pix-reminder-actions">
                <button id="pix-reminder-cta" type="button">Cadastrar agora</button>
                <button id="pix-reminder-dismiss" type="button" aria-label="Fechar">✕</button>
            </div>`;
        document.body.appendChild(banner);
        requestAnimationFrame(() => banner.classList.add('pix-reminder-show'));

        document.getElementById('pix-reminder-cta')?.addEventListener('click', () => {
            window.APP?.navigation?.showTab('vendor-settings');
            setTimeout(() => document.getElementById('vendor-pix-key-section')?.scrollIntoView({ behavior: 'smooth' }), 300);
        });
        document.getElementById('pix-reminder-dismiss')?.addEventListener('click', () => {
            try { sessionStorage.setItem('ityrapuan_pix_reminder_dismissed', '1'); } catch {}
            this._hidePixReminderBanner();
        });
    },

    _hidePixReminderBanner() {
        document.getElementById('pix-reminder-banner')?.remove();
    },

    // ── Modal de login ──────────────────────────────────────
    openAuthModal(tab = 'login') {
        const modal = document.getElementById('auth-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        if (tab === 'signup') this.showSignupTab();
        else if (tab === 'forgot') this.showForgotTab();
        else this.showLoginTab();
    },
    closeAuthModal() { document.getElementById('auth-modal')?.classList.add('hidden'); },

    // ── Modal de perfil ─────────────────────────────────────
    openProfileModal() {
        if (!this.session) { this.openAuthModal('login'); return; }
        this._populateProfileModal();
        document.getElementById('profile-modal')?.classList.remove('hidden');
    },
    closeProfileModal() { document.getElementById('profile-modal')?.classList.add('hidden'); },

    _populateProfileModal() {
        const name = this._displayName();
        const meta = this.ROLE_LABELS[this.role] || this.ROLE_LABELS.client;
        const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

        const avatar = document.getElementById('profile-modal-avatar');
        if (avatar) {
            avatar.textContent = this._initials(name);
            avatar.style.background = `linear-gradient(135deg, ${meta.color}, ${meta.color}99)`;
        }
        setText('profile-modal-name', name);
        const roleEl = document.getElementById('profile-modal-role');
        if (roleEl) { roleEl.textContent = `${meta.icon} ${meta.label}`; roleEl.style.color = meta.color; }
        setText('profile-modal-email', this.profile?.email || this.session?.user?.email || '—');
        setText('profile-modal-phone', this.profile?.phone || '—');

        document.getElementById('profile-become-seller-btn')?.classList.toggle('hidden', this.role !== 'client');
        if (window.lucide) lucide.createIcons();
    },

    // ── Virar vendedor (com aceite das regras) ──────────────
    becomeSeller() {
        if (!this.session || !this.userId) { this.openAuthModal('signup'); return; }
        if (this.role !== 'client') { alert('ℹ️ Sua conta já é de vendedor.'); return; }
        this.openBecomeSellerModal();
    },

    openBecomeSellerModal() {
        const modal = document.getElementById('become-seller-modal');
        if (!modal) {
            // Fallback se o modal não existir no HTML
            if (confirm('Deseja se tornar um Vendedor?\n\nVocê declara ser o(a) único(a) responsável pelos produtos que anunciar e que não vai anunciar nada ilegal ou proibido.')) {
                this._confirmBecomeSeller();
            }
            return;
        }
        const check = document.getElementById('become-seller-accept');
        const btn = document.getElementById('become-seller-confirm-btn');
        if (check) check.checked = false;
        if (btn) btn.disabled = true;
        this.closeProfileModal();
        modal.classList.remove('hidden');
    },

    closeBecomeSellerModal() {
        document.getElementById('become-seller-modal')?.classList.add('hidden');
    },

    async _confirmBecomeSeller() {
        const check = document.getElementById('become-seller-accept');
        if (check && !check.checked) { alert('Marque o aceite para continuar.'); return; }

        const btn = document.getElementById('become-seller-confirm-btn');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ Processando...'; }

        try {
            const { error } = await _supabase.from('profiles').update({ role: 'seller' }).eq('id', this.userId);
            if (error) throw error;

            this.closeBecomeSellerModal();
            await this.init();
            await window.APP?.onAuthChanged?.();
            alert('✅ Pronto! Agora você é um vendedor.');
            window.APP?.navigation?.showTab('seller');
        } catch (err) {
            log(`❌ Erro ao virar vendedor: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '✅ Confirmar e Virar Vendedor'; }
        }
    },

    _setActiveTab(active) {
        ['login', 'signup', 'forgot'].forEach(t => {
            const tab = document.getElementById(`${t}-tab`);
            const btn = document.getElementById(`${t}-tab-btn`);
            if (!tab || !btn) return;
            const on = t === active;
            tab.classList.toggle('hidden', !on);
            btn.classList.toggle('bg-blue-600', on);
            btn.classList.toggle('text-white', on);
            btn.classList.toggle('text-slate-400', !on);
        });
    },
    showLoginTab()  { this._setActiveTab('login'); },
    showSignupTab() { this._setActiveTab('signup'); },
    showForgotTab() { this._setActiveTab('forgot'); },

    _redirectUrl() {
        return window.location.origin + window.location.pathname;
    },

    // ── Login ───────────────────────────────────────────────
    async loginDirect() {
        const email = document.getElementById('login-email')?.value?.trim();
        const password = document.getElementById('login-password')?.value;
        const btn = document.querySelector('#login-tab button[type="submit"]');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ ENTRANDO...'; }
        try {
            if (!email || !password) throw new Error('Preencha email e senha');
            const { error } = await _supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            await this.init();
            if (!this.session) return; // conta banida
            await window.APP?.onAuthChanged?.();
            this.closeAuthModal();
        } catch (err) {
            log(`❌ Erro login: ${err.message}`, 'error');
            alert(/confirm/i.test(err.message)
                ? '❌ Confirme seu email antes de entrar (veja a caixa de entrada e o spam).'
                : '❌ Email ou senha incorretos');
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = 'ENTRAR'; }
        }
    },

    // ── Cadastro ────────────────────────────────────────────
    async signupDirect() {
        const email = document.getElementById('signup-email')?.value?.trim();
        const password = document.getElementById('signup-password')?.value;
        const fullName = document.getElementById('signup-name')?.value?.trim();
        const phone = document.getElementById('signup-phone')?.value?.trim();
        const btn = document.querySelector('#signup-tab button[type="submit"]');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ CRIANDO...'; }
        try {
            if (!email || !password || !fullName || !phone) throw new Error('Preencha todos os campos');
            if (password.length < 6) throw new Error('Senha deve ter mínimo 6 caracteres');
            if (phone.replace(/\D/g, '').length < 10) throw new Error('Telefone inválido (use DDD + número)');

            const { data, error } = await _supabase.auth.signUp({
                email, password,
                options: {
                    data: { full_name: fullName, phone },
                    emailRedirectTo: this._redirectUrl()
                }
            });
            if (error) throw error;
            if (!data?.user) throw new Error('Usuário não foi criado');

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

    // ── Esqueci a senha ─────────────────────────────────────
    async resetPasswordDirect() {
        const input = document.getElementById('forgot-email');
        const email = input?.value?.trim();
        if (!email) { alert('❌ Digite seu email'); return; }
        const btn = document.querySelector('#forgot-tab button[type="submit"]');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ ENVIANDO...'; }
        try {
            // Volta pra própria página; o evento PASSWORD_RECOVERY abre o modal
            const { error } = await _supabase.auth.resetPasswordForEmail(email, {
                redirectTo: this._redirectUrl()
            });
            if (error) throw error;
            alert('✅ Email de recuperação enviado!\nVerifique sua caixa de entrada (e spam).');
            if (input) input.value = '';
            setTimeout(() => this.showLoginTab(), 1500);
        } catch (err) {
            log(`❌ Erro ao enviar email: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '📧 ENVIAR LINK DE RECUPERAÇÃO'; }
        }
    },

    openNewPasswordModal() {
        this.closeAuthModal();
        document.getElementById('new-password-modal')?.classList.remove('hidden');
    },
    closeNewPasswordModal() {
        document.getElementById('new-password-modal')?.classList.add('hidden');
    },

    async updatePasswordDirect() {
        const pass = document.getElementById('new-password-input')?.value || '';
        const confirmPass = document.getElementById('new-password-confirm')?.value || '';
        const btn = document.querySelector('#new-password-modal button[type="submit"]');

        if (pass.length < 6) { alert('❌ A senha precisa ter no mínimo 6 caracteres'); return; }
        if (pass !== confirmPass) { alert('❌ As senhas não conferem'); return; }

        if (btn) { btn.disabled = true; btn.innerText = '⏳ SALVANDO...'; }
        try {
            const { error } = await _supabase.auth.updateUser({ password: pass });
            if (error) throw error;
            this.closeNewPasswordModal();
            history.replaceState(null, '', this._redirectUrl());
            await this.init();
            await window.APP?.onAuthChanged?.();
            alert('✅ Senha alterada com sucesso!');
        } catch (err) {
            log(`❌ Erro ao trocar senha: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}\n\nSe o link expirou, peça um novo em "Senha".`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '💾 SALVAR NOVA SENHA'; }
        }
    },

    // ── Logout ──────────────────────────────────────────────
    async logout(skipConfirm = false) {
        if (!skipConfirm && !confirm('Desconectar?')) return;
        // Desliga os avisos de venda deste aparelho pra esta conta (antes de
        // sair — depois do signOut o banco não deixa mais apagar).
        try { await window.APP?.notifications?.removePushForThisDevice?.(); } catch {}
        try {
            const { error } = await _supabase.auth.signOut();
            if (error) throw error;
        } catch (err) {
            log(`❌ Erro logout: ${err.message}`, 'error');
        }

        this.session = null;
        this.profile = null;
        this.role = 'client';
        this.userId = null;

        this.closeProfileModal();
        this.closeAuthModal();
        this.closeBecomeSellerModal();

        this.renderUIByRole();
        this._checkPixKeyReminder();
        await window.APP?.onAuthChanged?.();
        window.APP?.navigation?.showTab('market');
        if (!skipConfirm) alert('✅ Você foi desconectado');
    },

    // ── Aliases ─────────────────────────────────────────────
    async login(e)             { e?.preventDefault?.(); await this.loginDirect(); },
    async signup(e)            { e?.preventDefault?.(); await this.signupDirect(); },
    async sendPasswordReset(e) { e?.preventDefault?.(); await this.resetPasswordDirect(); }
};
