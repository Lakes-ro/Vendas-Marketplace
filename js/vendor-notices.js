/**
 * VENDOR-NOTICES.JS v1.0
 * Avisos do Admin para o vendedor.
 *
 * Admin: depois de criar, editar ou excluir o produto de um vendedor,
 *   askAndNotify() pergunta se quer avisar e deixa editar o texto.
 *   Pode avisar pelo app e, se quiser, abrir o WhatsApp com a mensagem pronta.
 * Vendedor: ao entrar (e na hora, se estiver com o app aberto) aparece
 *   a janela "Avisos do administrador"; "Entendi" marca como lido.
 *
 * Tabela: vendor_notifications (supabase/sql/04-admin-controle-total.sql)
 */

const VendorNotices = {
    _channel: null,
    _unread: [],

    // ------------------------------------------------------------
    // Vendedor
    // ------------------------------------------------------------

    async init() {
        this.teardown();
        const auth = window.APP?.auth;
        if (!auth?.isLoggedIn?.() || auth.role !== 'seller' || !auth.userId) return;

        await this._loadUnread();
        if (this._unread.length) this._showInbox();

        this._channel = _supabase
            .channel(`avisos-${auth.userId}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'vendor_notifications', filter: `vendor_id=eq.${auth.userId}` },
                (payload) => {
                    if (!payload?.new || this._unread.some(n => n.id === payload.new.id)) return;
                    this._unread.unshift(payload.new);
                    window.playNotificationSound?.('sale');
                    this._showInbox();
                })
            .subscribe();
    },

    teardown() {
        if (this._channel) {
            try { _supabase.removeChannel(this._channel); } catch { /* ignora */ }
        }
        this._channel = null;
        this._unread = [];
        document.getElementById('vendor-notices-modal')?.remove();
    },

    async _loadUnread() {
        try {
            const { data, error } = await _supabase
                .from('vendor_notifications')
                .select('id, title, message, created_at, product_id')
                .eq('vendor_id', window.APP.auth.userId)
                .is('read_at', null)
                .order('created_at', { ascending: false })
                .limit(20);
            if (error) throw error;
            this._unread = data || [];
        } catch (err) {
            // tabela ainda não criada (SQL 04) — não atrapalha o resto
            log(`⚠️ Avisos do admin: ${err.message}`, 'warning');
            this._unread = [];
        }
    },

    _fmtDate(iso) {
        try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
    },

    _showInbox() {
        this._injectStyles();
        let modal = document.getElementById('vendor-notices-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'vendor-notices-modal';
            modal.className = 'vn-overlay';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="vn-box" role="dialog" aria-modal="true" aria-labelledby="vn-title">
                <div class="vn-head">
                    <div class="vn-icon">📬</div>
                    <div>
                        <div id="vn-title" class="vn-title">Avisos do administrador</div>
                        <div class="vn-sub">${this._unread.length} aviso(s) novo(s)</div>
                    </div>
                </div>
                <div class="vn-list">
                    ${this._unread.map(n => `
                        <div class="vn-item">
                            <div class="vn-item-title">${escapeHtml(n.title)}</div>
                            <div class="vn-item-msg">${escapeHtml(n.message)}</div>
                            <div class="vn-item-date">${escapeHtml(this._fmtDate(n.created_at))}</div>
                        </div>`).join('')}
                </div>
                <button type="button" class="vn-btn vn-btn-main" onclick="window.VendorNotices.markAllRead()">Entendi</button>
            </div>`;
    },

    async markAllRead() {
        const ids = this._unread.map(n => n.id);
        document.getElementById('vendor-notices-modal')?.remove();
        this._unread = [];
        if (!ids.length) return;
        try {
            const { error } = await _supabase
                .from('vendor_notifications')
                .update({ read_at: new Date().toISOString() })
                .in('id', ids);
            if (error) throw error;
        } catch (err) {
            log(`⚠️ Não marcou os avisos como lidos: ${err.message}`, 'warning');
        }
        // o admin pode ter mexido nos produtos: atualiza a lista
        window.APP?.products?.fetchManageable?.({ force: true });
    },

    // ------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------

    /**
     * Pergunta se o Admin quer avisar o dono do produto.
     * @param {object} opts { vendorId, vendorName, vendorPhone, productId, title, message }
     * @returns {Promise<'app'|'app+whatsapp'|'skip'>}
     */
    askAndNotify(opts) {
        const auth = window.APP?.auth;
        if (!auth?.isSupreme?.() || !opts?.vendorId || opts.vendorId === auth.userId) return Promise.resolve('skip');

        this._injectStyles();
        document.getElementById('vendor-notify-ask')?.remove();

        return new Promise((resolve) => {
            const wrap = document.createElement('div');
            wrap.id = 'vendor-notify-ask';
            wrap.className = 'vn-overlay';
            const phone = String(opts.vendorPhone || '').replace(/\D/g, '');

            wrap.innerHTML = `
                <div class="vn-box" role="dialog" aria-modal="true" aria-labelledby="vna-title">
                    <div class="vn-head">
                        <div class="vn-icon">🔔</div>
                        <div>
                            <div id="vna-title" class="vn-title">Avisar ${escapeHtml(opts.vendorName || 'o vendedor')}?</div>
                            <div class="vn-sub">O aviso aparece quando o vendedor abrir o app (ou na hora, se ele já estiver com o app aberto).</div>
                        </div>
                    </div>
                    <label class="vn-label" for="vna-msg">Mensagem</label>
                    <textarea id="vna-msg" class="vn-textarea" maxlength="1000" rows="5"></textarea>
                    <div class="vn-actions">
                        <button type="button" class="vn-btn vn-btn-main" data-vna="app">🔔 Avisar no app</button>
                        ${phone ? '<button type="button" class="vn-btn vn-btn-wa" data-vna="app+whatsapp">💬 App + WhatsApp</button>' : ''}
                        <button type="button" class="vn-btn vn-btn-ghost" data-vna="skip">Não avisar</button>
                    </div>
                    <div id="vna-error" class="vn-error hidden"></div>
                </div>`;
            document.body.appendChild(wrap);

            const textarea = wrap.querySelector('#vna-msg');
            textarea.value = opts.message || '';

            wrap.addEventListener('click', async (e) => {
                const choice = e.target.closest('[data-vna]')?.getAttribute('data-vna');
                if (!choice) return;
                if (choice === 'skip') { wrap.remove(); resolve('skip'); return; }

                const message = textarea.value.trim();
                if (!message) { textarea.focus(); return; }

                // abre o WhatsApp já no clique (celular bloqueia janela aberta depois de await)
                let waWindow = null;
                if (choice === 'app+whatsapp' && phone) {
                    waWindow = window.open(buildWhatsAppLink(phone, `*${opts.title}*\n\n${message}`), '_blank');
                }

                wrap.querySelectorAll('button').forEach(b => { b.disabled = true; });
                try {
                    const { error } = await _supabase.from('vendor_notifications').insert([{
                        vendor_id: opts.vendorId,
                        product_id: opts.productId || null,
                        title: String(opts.title || 'Aviso do administrador').slice(0, 120),
                        message: message.slice(0, 1000)
                    }]);
                    if (error) throw error;
                    wrap.remove();
                    resolve(choice);
                } catch (err) {
                    const box = wrap.querySelector('#vna-error');
                    const missing = /vendor_notifications|relation|schema cache/i.test(err.message);
                    box.textContent = missing
                        ? '❌ Falta rodar o SQL 04-admin-controle-total.sql no Supabase.'
                        : `❌ Não foi possível avisar: ${err.message}`;
                    box.classList.remove('hidden');
                    wrap.querySelectorAll('button').forEach(b => { b.disabled = false; });
                    if (waWindow) resolve('app+whatsapp');
                }
            });
        });
    },

    // ------------------------------------------------------------
    // Estilo
    // ------------------------------------------------------------

    _injectStyles() {
        if (document.getElementById('vn-styles')) return;
        const st = document.createElement('style');
        st.id = 'vn-styles';
        st.textContent = `
            .vn-overlay { position: fixed; inset: 0; z-index: 400; background: rgba(0,0,0,.7); backdrop-filter: blur(4px);
                display: flex; align-items: center; justify-content: center; padding: 16px; }
            .vn-box { width: 100%; max-width: 440px; max-height: 90vh; overflow-y: auto; background: #161b2c;
                border: 1px solid rgba(255,255,255,.1); border-radius: 24px; padding: 22px; color: #e2e8f0; }
            .vn-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
            .vn-icon { font-size: 26px; line-height: 1; }
            .vn-title { font-weight: 900; font-size: 17px; color: #fff; }
            .vn-sub { font-size: 12px; color: #94a3b8; margin-top: 3px; line-height: 1.4; }
            .vn-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
            .vn-item { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); border-radius: 14px; padding: 12px 14px; }
            .vn-item-title { font-weight: 800; font-size: 14px; color: #fff; }
            .vn-item-msg { font-size: 13px; color: #cbd5e1; margin-top: 4px; white-space: pre-wrap; line-height: 1.45; }
            .vn-item-date { font-size: 11px; color: #64748b; margin-top: 6px; }
            .vn-label { display: block; font-size: 12px; font-weight: 700; color: #94a3b8; margin-bottom: 6px; }
            .vn-textarea { width: 100%; box-sizing: border-box; background: #0f172a; color: #fff; border: 1px solid rgba(255,255,255,.1);
                border-radius: 14px; padding: 12px; font-size: 14px; line-height: 1.45; resize: vertical; }
            .vn-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
            .vn-btn { flex: 1 1 auto; font-weight: 800; font-size: 14px; padding: 12px 14px; border-radius: 14px; transition: .15s; }
            .vn-btn:disabled { opacity: .5; }
            .vn-btn-main { background: #2563eb; color: #fff; width: 100%; }
            .vn-actions .vn-btn-main { width: auto; }
            .vn-btn-wa { background: #16a34a; color: #fff; }
            .vn-btn-ghost { background: rgba(148,163,184,.12); color: #e2e8f0; }
            .vn-error { margin-top: 10px; font-size: 12px; color: #fca5a5; font-weight: 700; }
            html[data-theme="light"] .vn-box { background: #fff; color: #0f172a; border-color: #e2e8f0; }
            html[data-theme="light"] .vn-title, html[data-theme="light"] .vn-item-title { color: #0f172a; }
            html[data-theme="light"] .vn-item { background: #f8fafc; border-color: #e2e8f0; }
            html[data-theme="light"] .vn-item-msg { color: #334155; }
            html[data-theme="light"] .vn-textarea { background: #f8fafc; color: #0f172a; border-color: #e2e8f0; }
            html[data-theme="light"] .vn-btn-ghost { background: #f1f5f9; color: #0f172a; }
        `;
        document.head.appendChild(st);
    }
};

window.VendorNotices = VendorNotices;
