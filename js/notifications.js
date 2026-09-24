/**
 * NOTIFICATIONS.JS v2.0
 * ✅ Aviso de venda com o site ABERTO: toast + som + selo no botão BI
 *    (Supabase Realtime) — igual à v1.0.
 * ✅ v2.0 NOVO — NOTIFICAÇÃO PUSH: o vendedor recebe "🎉 Nova venda!" na
 *    tela do celular/computador mesmo com o site FECHADO.
 *    • O vendedor ativa uma vez por aparelho (Configurações da Loja, ou
 *      o aviso que aparece depois do login).
 *    • A cada pedido, o banco (create_order) chama a Edge Function
 *      "send-push", que envia pro(s) aparelho(s) de cada vendedor.
 *    • Android / computador (Chrome, Edge, Firefox): funciona direto.
 *    • iPhone/iPad: só funciona com o site INSTALADO na tela de início
 *      (Safari → Compartilhar → "Adicionar à Tela de Início"), iOS 16.4+.
 *    • Ao sair da conta, o aparelho para de receber avisos daquela conta.
 */

const Notifications = {
    channel: null,
    unseenCount: 0,

    init() {
        try {
            if (!window.APP?.auth?.hasSellerTools?.()) return;
            if (!window._supabase) return;

            this._subscribeRealtime();
            this._syncPushSubscription();   // aparelho já autorizado: garante o vínculo com esta conta
            this._maybeShowPushPrompt();
            this.renderPushCard();
        } catch (err) {
            log(`⚠️ Erro ao iniciar notificações: ${err.message}`, 'warning');
        }
    },

    // ============================================================
    // AVISO COM O SITE ABERTO (Realtime)
    // ============================================================

    _subscribeRealtime() {
        if (this.channel) return;
        this.channel = _supabase
            .channel('vendas-em-tempo-real')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_items' },
                (payload) => this._handleNewItem(payload.new))
            .subscribe();
    },

    _handleNewItem(item) {
        try {
            const myId = window.APP?.auth?.userId;
            const product = (window.APP?.products?.manageProducts || []).find(p => p.id === item.product_id);
            if (!product || product.owner_id !== myId) return;
            this._showSaleToast(product.name, item.quantity || 1, item.unit_price || 0);
            this._bumpBadge();
        } catch (err) {
            log(`⚠️ Erro ao processar aviso de venda: ${err.message}`, 'warning');
        }
    },

    _toastContainer() {
        let c = document.getElementById('cart-toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'cart-toast-container';
            document.body.appendChild(c);
        }
        return c;
    },

    _showSaleToast(name, qty, unitPrice) {
        const total = (unitPrice || 0) * (qty || 1);
        const toast = document.createElement('div');
        toast.className = 'cart-toast sale-toast';
        toast.innerHTML = `
            <i data-lucide="party-popper" class="cart-toast-icon" style="color:#3b82f6"></i>
            <span>🎉 Venda! ${qty > 1 ? qty + 'x ' : ''}${escapeHtml(name)} — R$ ${formatBRL(total)} · confirme em até 2h</span>`;
        this._toastContainer().appendChild(toast);
        window.playNotificationSound?.('sale');
        if (window.lucide) lucide.createIcons();
        requestAnimationFrame(() => toast.classList.add('cart-toast-show'));
        setTimeout(() => {
            toast.classList.remove('cart-toast-show');
            toast.classList.add('cart-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 4500);
    },

    _bumpBadge() {
        this.unseenCount++;
        this._renderBadge();
    },

    _renderBadge() {
        ['bi-nav-btn', 'bnav-bi'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            let badge = btn.querySelector('.sale-badge:not(.pix-badge)');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'sale-badge';
                btn.appendChild(badge);
            }
            badge.textContent = this.unseenCount > 9 ? '9+' : String(this.unseenCount);
            badge.style.display = this.unseenCount > 0 ? 'flex' : 'none';
        });
    },

    clearUnseen() {
        this.unseenCount = 0;
        this._renderBadge();
    },

    /** Logout: para a escuta e desvincula este aparelho da conta (sem mais push). */
    async teardown() {
        if (this.channel) {
            _supabase.removeChannel(this.channel);
            this.channel = null;
        }
        this.unseenCount = 0;
        document.getElementById('push-prompt-banner')?.remove();
    },

    // ============================================================
    // NOTIFICAÇÃO PUSH (site fechado)
    // ============================================================

    _isIOS() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    },

    _isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    },

    _pushSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    },

    /** 'enabled' | 'disabled' | 'denied' | 'ios-install' | 'unsupported' */
    async getPushStatus() {
        if (this._isIOS() && !this._isStandalone()) return 'ios-install';
        if (!this._pushSupported()) return 'unsupported';
        if (Notification.permission === 'denied') return 'denied';
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            return (sub && Notification.permission === 'granted') ? 'enabled' : 'disabled';
        } catch {
            return 'disabled';
        }
    },

    _urlB64ToUint8Array(base64) {
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
    },

    async _saveSubscription(sub) {
        const userId = window.APP?.auth?.userId;
        if (!userId || !sub) return;
        const json = sub.toJSON();
        // Função do banco: vincula este aparelho à conta logada (mesmo que
        // antes estivesse ligado a outro vendedor no mesmo celular).
        const { error } = await _supabase.rpc('claim_push_subscription', {
            p_endpoint: json.endpoint,
            p_p256dh: json.keys.p256dh,
            p_auth: json.keys.auth,
            p_user_agent: navigator.userAgent
        });
        if (error) throw error;
    },

    /** Precisa ser chamado a partir de um toque/clique (regra dos navegadores). */
    async enablePush() {
        const status = await this.getPushStatus();
        if (status === 'ios-install') { this._showIOSInstallHelp(); return false; }
        if (status === 'unsupported') { alert('Este navegador não suporta notificações. Use o Chrome ou o Edge.'); return false; }
        if (status === 'denied') { this._showDeniedHelp(); return false; }

        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                if (permission === 'denied') this._showDeniedHelp();
                return false;
            }

            const reg = await navigator.serviceWorker.register('sw.js');
            await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: this._urlB64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY)
                });
            }
            await this._saveSubscription(sub);
            document.getElementById('push-prompt-banner')?.remove();
            await this.renderPushCard();
            await this.sendTestPush(true);
            return true;
        } catch (err) {
            log(`❌ Erro ao ativar push: ${err.message}`, 'error');
            alert(`❌ Não foi possível ativar os avisos: ${err.message}`);
            return false;
        }
    },

    async disablePush() {
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (sub) {
                await _supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
                await sub.unsubscribe();
            }
        } catch (err) {
            log(`⚠️ Erro ao desativar push: ${err.message}`, 'warning');
        }
        await this.renderPushCard();
    },

    /** Chamado no logout, ANTES de sair (ainda com login válido pra apagar o vínculo). */
    async removePushForThisDevice() {
        try {
            if (!this._pushSupported()) return;
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (sub) await _supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        } catch { /* sem problema: o servidor limpa aparelhos inválidos sozinho */ }
    },

    /** Aparelho já autorizado antes: garante que está vinculado à conta logada agora. */
    async _syncPushSubscription() {
        try {
            if ((await this.getPushStatus()) !== 'enabled') return;
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (!sub) return;
            const { data } = await _supabase.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
            if (!data) await this._saveSubscription(sub);
        } catch { /* silencioso */ }
    },

    async sendTestPush(silent = false) {
        try {
            const { data: { session } } = await _supabase.auth.getSession();
            const res = await fetch(CONFIG.PUSH_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session?.access_token || ''}`,
                    apikey: CONFIG.SUPABASE_KEY
                },
                body: JSON.stringify({ test: true })
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
            if (!silent) {
                alert(out.sent > 0
                    ? `✅ Teste enviado para ${out.sent} aparelho(s). A notificação deve aparecer em alguns segundos.`
                    : '⚠️ Nenhum aparelho ativado encontrado. Toque em "Ativar avisos" primeiro.');
            }
        } catch (err) {
            if (!silent) alert(`❌ Erro ao enviar teste: ${err.message}`);
        }
    },

    _showIOSInstallHelp() {
        alert('📱 No iPhone, os avisos de venda só funcionam com o site instalado:\n\n1. Abra este site no Safari\n2. Toque em Compartilhar (quadrado com a seta pra cima)\n3. Toque em "Adicionar à Tela de Início"\n4. Abra a loja pelo ícone que apareceu na tela\n5. Entre na sua conta e toque em "Ativar avisos" de novo\n\n(Precisa do iOS 16.4 ou mais novo.)');
    },

    _showDeniedHelp() {
        alert('🔕 As notificações deste site estão bloqueadas no navegador.\n\nPara liberar: toque no cadeado 🔒 ao lado do endereço do site → Permissões/Configurações do site → Notificações → Permitir. Depois toque em "Ativar avisos" de novo.');
    },

    /** Cartão em Configurações da Loja com o status e os botões. */
    async renderPushCard() {
        const section = document.getElementById('vendor-settings-section');
        if (!section || !window.APP?.auth?.hasSellerTools?.()) return;

        let card = document.getElementById('push-settings-card');
        if (!card) {
            card = document.createElement('div');
            card.id = 'push-settings-card';
            card.className = 'bg-slate-900/50 p-6 rounded-2xl border border-white/5 mb-6';
            const anchor = document.getElementById('vendor-pix-key-section');
            if (anchor) anchor.insertAdjacentElement('beforebegin', card);
            else section.appendChild(card);

            card.addEventListener('click', (e) => {
                const action = e.target.closest('[data-push-action]')?.dataset.pushAction;
                if (action === 'enable') this.enablePush();
                else if (action === 'disable') this.disablePush();
                else if (action === 'test') this.sendTestPush();
                else if (action === 'ios') this._showIOSInstallHelp();
                else if (action === 'denied') this._showDeniedHelp();
            });
        }

        const status = await this.getPushStatus();
        const btn = (action, label, color) =>
            `<button type="button" data-push-action="${action}" style="flex:1;min-height:46px;padding:10px 14px;border-radius:12px;border:none;font-weight:800;font-size:14px;cursor:pointer;color:#fff;background:${color}">${label}</button>`;

        const states = {
            enabled: {
                badge: '<span style="color:#22c55e;font-weight:800">✅ Ativado neste aparelho</span>',
                text: 'Você recebe "🎉 Nova venda!" na tela, mesmo com o site fechado.',
                buttons: btn('test', '🔔 Enviar teste', '#3b82f6') + btn('disable', 'Desativar', '#475569')
            },
            disabled: {
                badge: '<span style="color:#f59e0b;font-weight:800">⚠️ Desativado neste aparelho</span>',
                text: 'Ative para receber um aviso na tela a cada venda, mesmo com o site fechado. Faça isso em cada aparelho que você usa.',
                buttons: btn('enable', '🔔 Ativar avisos de venda', '#16a34a')
            },
            denied: {
                badge: '<span style="color:#ef4444;font-weight:800">🔕 Bloqueado no navegador</span>',
                text: 'As notificações deste site foram bloqueadas. Libere nas configurações do navegador.',
                buttons: btn('denied', 'Como liberar', '#475569')
            },
            'ios-install': {
                badge: '<span style="color:#f59e0b;font-weight:800">📱 Instale o app primeiro</span>',
                text: 'No iPhone, os avisos só funcionam com o site adicionado à Tela de Início.',
                buttons: btn('ios', 'Ver como instalar', '#3b82f6')
            },
            unsupported: {
                badge: '<span style="color:#94a3b8;font-weight:800">Não suportado</span>',
                text: 'Este navegador não suporta notificações. Use o Chrome ou o Edge.',
                buttons: ''
            }
        };
        const s = states[status] || states.unsupported;

        card.innerHTML = `
            <h3 class="text-lg font-black text-slate-300 mb-2">🔔 Avisos de venda no celular</h3>
            <div style="font-size:13px;margin-bottom:6px">${s.badge}</div>
            <p class="text-xs text-slate-500 mb-4 leading-relaxed">${s.text}</p>
            ${s.buttons ? `<div style="display:flex;gap:10px;flex-wrap:wrap">${s.buttons}</div>` : ''}`;
    },

    /** Convite depois do login (vendedor sem push ativo), dispensável por 7 dias. */
    async _maybeShowPushPrompt() {
        const KEY = 'ityrapuan_push_prompt_dismissed_at';
        try {
            const at = Number(localStorage.getItem(KEY) || 0);
            if (Date.now() - at < 7 * 86400000) return;
        } catch {}
        const status = await this.getPushStatus();
        if (status !== 'disabled' && status !== 'ios-install') return;
        if (document.getElementById('push-prompt-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'push-prompt-banner';
        banner.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--bottom-nav-height,72px) + 16px);z-index:260;width:calc(100% - 32px);max-width:420px;background:#111827;color:#f1f5f9;border:1px solid rgba(59,130,246,.35);border-radius:18px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.45);font-family:Inter,sans-serif';
        banner.innerHTML = `
            <div style="display:flex;gap:12px;align-items:flex-start">
                <div style="font-size:26px;line-height:1">🔔</div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:900;font-size:15px;margin-bottom:4px">Não perca nenhuma venda</div>
                    <div style="font-size:13px;color:#94a3b8;line-height:1.45">Receba um aviso na tela do celular a cada venda, mesmo com o site fechado.</div>
                    <div style="display:flex;gap:8px;margin-top:12px">
                        <button type="button" data-yes style="flex:1;min-height:42px;border:none;border-radius:12px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer">Ativar avisos</button>
                        <button type="button" data-no style="min-height:42px;padding:0 14px;border:none;border-radius:12px;background:rgba(148,163,184,.15);color:#cbd5e1;font-weight:700;cursor:pointer">Agora não</button>
                    </div>
                </div>
            </div>`;
        banner.querySelector('[data-yes]').addEventListener('click', () => this.enablePush());
        banner.querySelector('[data-no]').addEventListener('click', () => {
            try { localStorage.setItem(KEY, String(Date.now())); } catch {}
            banner.remove();
        });
        setTimeout(() => document.body.appendChild(banner), 2500);
    }
};

window.Notifications = Notifications;
