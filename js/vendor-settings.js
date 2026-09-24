/**
 * VENDOR-SETTINGS.JS v4.1
 * v4.1 (auditoria):
 *  - Chaves Pix funcionando (tabela vendor_pix_keys): listar, adicionar,
 *    remover e salvar — antes os botões do HTML não faziam nada
 *  - "Fechar a Loja Inteira" (toggleGlobalOverride) usando as funções do
 *    banco set_store_manual_closed / clear_store_manual_override
 *  - desmarcar "Horário automático" agora salva na hora (antes o botão
 *    Salvar sumia junto com os campos e não dava pra desligar)
 *  - só roda pra vendedor/admin (cliente não cria mais linha em vendor_status)
 *  - teardown() para o intervalo ao sair da conta
 */

const VendorSettings = {
    currentStatus: true,
    autoScheduleEnabled: false,
    openingTime: '09:00',
    closingTime: '18:00',
    statusHistory: [],
    pixKeys: [],
    _removedPixIds: [],
    _listenersAttached: false,
    _refreshInterval: null,

    _userId() { return window.APP?.auth?.userId; },
    _isManager() { return !!window.APP?.auth?.hasSellerTools?.(); },

    async init() {
        if (!this._isManager()) return;
        this.attachListeners();
        await this.refresh();
        this._startAutoRefresh();
    },

    teardown() {
        if (this._refreshInterval) clearInterval(this._refreshInterval);
        this._refreshInterval = null;
        this.pixKeys = [];
        this._removedPixIds = [];
    },

    async refresh() {
        if (!this._isManager()) return;
        await Promise.all([this.loadStatus(), this.loadHistory(), this.loadPixKeys(), this.loadGlobalOverride()]);
        this.render();
        window.APP?.notifications?.renderPushCard?.();
    },

    // ── Status do vendedor ──────────────────────────────────────

    async loadStatus() {
        const userId = this._userId();
        if (!userId) return;
        try {
            const { data, error } = await _supabase.from('vendor_status').select('*').eq('owner_id', userId).maybeSingle();
            if (error) throw error;

            if (data) { this._applyStatusRow(data); return; }

            const { data: created, error: insErr } = await _supabase
                .from('vendor_status').insert([{ owner_id: userId }]).select().single();
            if (insErr) throw insErr;
            this._applyStatusRow(created);
        } catch (err) {
            log(`Erro ao carregar status: ${err.message}`, 'error');
        }
    },

    _applyStatusRow(row) {
        this.currentStatus = row.is_online !== false;
        this.autoScheduleEnabled = !!row.auto_schedule;
        this.openingTime = (row.opening_time || '09:00').slice(0, 5);
        this.closingTime = (row.closing_time || '18:00').slice(0, 5);
    },

    async loadHistory() {
        const userId = this._userId();
        if (!userId) return;
        try {
            const { data, error } = await _supabase
                .from('vendor_status_history').select('*').eq('vendor_id', userId)
                .order('changed_at', { ascending: false }).limit(10);
            if (error) throw error;
            this.statusHistory = data || [];
        } catch (err) {
            log(`Erro ao carregar histórico: ${err.message}`, 'error');
        }
    },

    // ── Chaves Pix ──────────────────────────────────────────────

    async loadPixKeys() {
        const userId = this._userId();
        if (!userId) return;
        try {
            const { data, error } = await _supabase
                .from('vendor_pix_keys').select('id, label, pix_key, created_at')
                .eq('owner_id', userId).order('created_at', { ascending: true });
            if (error) throw error;
            this.pixKeys = (data || []).map(k => ({ ...k }));
            this._removedPixIds = [];
            if (!this.pixKeys.length && window.APP?.auth?.profile?.pix_key) {
                // migra a chave antiga (campo único do perfil) pro formulário
                this.pixKeys = [{ id: null, label: 'Principal', pix_key: window.APP.auth.profile.pix_key }];
            }
        } catch (err) {
            log(`Erro ao carregar chaves Pix: ${err.message}`, 'error');
        }
    },

    _readPixInputs() {
        document.querySelectorAll('#vendor-pix-keys-list [data-pix-row]').forEach(row => {
            const i = Number(row.dataset.pixRow);
            if (!this.pixKeys[i]) return;
            this.pixKeys[i].label = row.querySelector('[data-pix-label]')?.value?.trim() || '';
            this.pixKeys[i].pix_key = row.querySelector('[data-pix-key]')?.value?.trim() || '';
        });
    },

    addPixKey() {
        this._readPixInputs();
        if (this.pixKeys.length >= 5) { alert('❌ Máximo de 5 chaves Pix.'); return; }
        this.pixKeys.push({ id: null, label: '', pix_key: '' });
        this.renderPixKeys();
        const inputs = document.querySelectorAll('#vendor-pix-keys-list [data-pix-key]');
        inputs[inputs.length - 1]?.focus();
    },

    removePixKey(index) {
        this._readPixInputs();
        const [removed] = this.pixKeys.splice(index, 1);
        if (removed?.id) this._removedPixIds.push(removed.id);
        this.renderPixKeys();
    },

    _validPixKey(key) {
        const k = key.trim();
        const digits = k.replace(/\D/g, '');
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return true;                 // email
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return true; // aleatória
        if (/^[\d\s().+\-/]+$/.test(k) && [10, 11, 12, 13, 14].includes(digits.length)) return true; // CPF/CNPJ/telefone
        return false;
    },

    async savePixKeys() {
        const userId = this._userId();
        if (!userId) return;
        this._readPixInputs();

        const keys = this.pixKeys.filter(k => k.pix_key);
        const invalid = keys.find(k => !this._validPixKey(k.pix_key));
        if (invalid) { alert(`❌ Chave Pix inválida: "${invalid.pix_key}"\n\nUse CPF, CNPJ, telefone, e-mail ou chave aleatória.`); return; }

        const btn = document.getElementById('vendor-save-pix-btn');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ Salvando...'; }

        try {
            // chaves apagadas (inclusive as que ficaram em branco)
            const blankIds = this.pixKeys.filter(k => k.id && !k.pix_key).map(k => k.id);
            const toDelete = [...this._removedPixIds, ...blankIds];
            if (toDelete.length) {
                const { error } = await _supabase.from('vendor_pix_keys').delete().in('id', toDelete).eq('owner_id', userId);
                if (error) throw error;
            }

            for (const k of keys.filter(k => k.id)) {
                const { error } = await _supabase.from('vendor_pix_keys')
                    .update({ label: k.label || 'Pix', pix_key: k.pix_key })
                    .eq('id', k.id).eq('owner_id', userId);
                if (error) throw error;
            }

            const toInsert = keys.filter(k => !k.id).map(k => ({ owner_id: userId, label: k.label || 'Pix', pix_key: k.pix_key }));
            if (toInsert.length) {
                const { error } = await _supabase.from('vendor_pix_keys').insert(toInsert);
                if (error) throw error;
            }

            await this.loadPixKeys();
            this.renderPixKeys();
            window.APP?.auth?._checkPixKeyReminder?.();
            if (keys.length) window.APP?.onboarding?.markMission?.('pix');
            alert('✅ Chaves Pix salvas!');
        } catch (err) {
            alert(`❌ Erro ao salvar chaves Pix: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '💾 Salvar Chaves Pix'; }
        }
    },

    renderPixKeys() {
        const list = document.getElementById('vendor-pix-keys-list');
        const warning = document.getElementById('vendor-pix-key-warning');
        if (warning) warning.classList.toggle('hidden', this.pixKeys.some(k => k.id && k.pix_key));
        if (!list) return;

        if (!this.pixKeys.length) {
            list.innerHTML = '<div class="text-[11px] text-slate-500 text-center py-2">Nenhuma chave cadastrada — clique em "Adicionar".</div>';
            return;
        }

        list.innerHTML = this.pixKeys.map((k, i) => `
            <div class="flex gap-2 items-center" data-pix-row="${i}">
                <input type="text" data-pix-label maxlength="30" placeholder="Nome (ex: Nubank)" value="${escapeHtml(k.label || '')}"
                    class="w-28 sm:w-36 flex-shrink-0 p-3 rounded-xl bg-slate-800 border border-white/10 text-white text-sm">
                <input type="text" data-pix-key maxlength="80" placeholder="CPF, telefone, e-mail ou chave aleatória" value="${escapeHtml(k.pix_key || '')}"
                    class="flex-1 min-w-0 p-3 rounded-xl bg-slate-800 border border-white/10 text-white text-sm font-mono">
                <button type="button" data-pix-remove="${i}" aria-label="Remover chave"
                    class="flex-shrink-0 w-9 h-9 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-400 font-black">✕</button>
            </div>`).join('');
    },

    // ── Fechar a loja inteira (Admin com permissão) ─────────────

    _canCloseStore() {
        const auth = window.APP?.auth;
        return !!(auth?.isSupreme() && (auth.profile?.can_close_store || auth.profile?.is_founder));
    },

    /** Botão "Fechar a loja" — fica no Admin Panel, funciona sem as ferramentas de vendedor. */
    async refreshGlobalOverride() {
        await this.loadGlobalOverride();
        this._renderGlobalOverride();
    },

    async loadGlobalOverride() {
        const section = document.getElementById('global-store-override-section');
        if (!this._canCloseStore()) { section?.classList.add('hidden'); return; }
        section?.classList.remove('hidden');
        try {
            const { data, error } = await _supabase
                .from('store_settings').select('status, manual_override, manual_override_at').eq('id', 1).single();
            if (error) throw error;
            this._globalOverride = !!data.manual_override;
            this._globalOverrideAt = data.manual_override_at;
        } catch (err) {
            log(`Erro ao ler status da loja: ${err.message}`, 'error');
        }
    },

    _renderGlobalOverride() {
        const statusEl = document.getElementById('global-override-status');
        const btn = document.getElementById('global-override-toggle-btn');
        if (!statusEl || !btn || !this._canCloseStore()) return;

        if (this._globalOverride) {
            const since = this._globalOverrideAt ? new Date(this._globalOverrideAt).toLocaleString('pt-BR') : '';
            statusEl.innerHTML = `<span class="text-red-400 font-bold">🔒 Loja FECHADA manualmente</span>${since ? `<span class="text-slate-500 text-xs block mt-1">desde ${escapeHtml(since)}</span>` : ''}`;
            btn.textContent = '🔓 Reabrir a loja';
            btn.style.background = '#16a34a';
        } else {
            statusEl.innerHTML = '<span class="text-green-400 font-bold">✅ Seguindo o horário automático</span>';
            btn.textContent = '🚨 Fechar a loja agora';
            btn.style.background = '#dc2626';
        }
    },

    async toggleGlobalOverride() {
        if (!this._canCloseStore()) { alert('❌ Você não tem permissão para fechar a loja.'); return; }
        const closing = !this._globalOverride;
        if (!confirm(closing
            ? 'Fechar o marketplace INTEIRO agora, para todos os vendedores?\n\nFica fechado até você reabrir aqui.'
            : 'Reabrir a loja? Ela volta a seguir o horário automático (Sabbath/noturno).')) return;

        const btn = document.getElementById('global-override-toggle-btn');
        if (btn) btn.disabled = true;
        try {
            const { error } = await _supabase.rpc(closing ? 'set_store_manual_closed' : 'clear_store_manual_override');
            if (error) throw error;
            await this.loadGlobalOverride();
            this._renderGlobalOverride();
            await window.APP?.storeStatus?.updateStatus?.(true);
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    // ── Render ──────────────────────────────────────────────────

    render() {
        const isOnline = this.currentStatus;
        const statusBtn = document.getElementById('vendor-status-main-toggle');
        if (statusBtn) {
            statusBtn.style.background = isOnline ? '#22c55e' : '#6b7280';
            statusBtn.title = this.autoScheduleEnabled
                ? 'Horário automático ativo — mudar aqui vale só até a próxima virada de horário'
                : '';
        }
        const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setText('vendor-status-main-text', isOnline ? 'Online' : 'Offline');
        const statusValue = document.getElementById('vendor-status-main-value');
        if (statusValue) {
            statusValue.textContent = isOnline ? 'Online' : 'Offline';
            statusValue.style.color = isOnline ? '#22c55e' : '#ef4444';
        }

        const autoToggle = document.getElementById('vendor-auto-schedule-toggle');
        if (autoToggle) autoToggle.checked = this.autoScheduleEnabled;
        const scheduleInputs = document.getElementById('vendor-schedule-inputs');
        if (scheduleInputs) scheduleInputs.style.display = this.autoScheduleEnabled ? 'block' : 'none';

        setText('vendor-next-change', this.getNextChangeTime());
        setText('vendor-current-mode', this.autoScheduleEnabled ? 'Automático' : 'Manual');

        const opening = document.getElementById('vendor-opening-time');
        const closing = document.getElementById('vendor-closing-time');
        if (opening && document.activeElement !== opening) opening.value = this.openingTime;
        if (closing && document.activeElement !== closing) closing.value = this.closingTime;

        const historyList = document.getElementById('vendor-history-list');
        if (historyList) historyList.innerHTML = this.renderHistory();

        this.renderPixKeys();
        this._renderGlobalOverride();
    },

    renderHistory() {
        if (!this.statusHistory.length) return '<div class="text-slate-500 text-center py-4">Sem alterações recentes</div>';
        return this.statusHistory.map(item => {
            const d = new Date(item.changed_at);
            const when = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const on = !!item.new_status;
            return `
                <div style="padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
                    <span style="color:${on ? '#22c55e' : '#ef4444'};font-weight:600;">${on ? 'Online' : 'Offline'}</span>
                    <span style="color:#64748b;font-size:11px;">${when}</span>
                </div>`;
        }).join('');
    },

    attachListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        document.getElementById('vendor-status-main-toggle')?.addEventListener('click', () => this.toggleStatus());
        document.getElementById('vendor-save-schedule-btn')?.addEventListener('click', () => this.saveSchedule());
        document.getElementById('vendor-add-pix-btn')?.addEventListener('click', () => this.addPixKey());
        document.getElementById('vendor-save-pix-btn')?.addEventListener('click', () => this.savePixKeys());
        document.getElementById('vendor-pix-keys-list')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pix-remove]');
            if (btn) this.removePixKey(Number(btn.dataset.pixRemove));
        });

        document.getElementById('vendor-auto-schedule-toggle')?.addEventListener('change', async (e) => {
            this.autoScheduleEnabled = e.target.checked;
            this.render();
            // Desligar salva na hora (o botão Salvar fica escondido junto dos campos)
            if (!this.autoScheduleEnabled) await this.saveSchedule(true);
        });
    },

    async toggleStatus() {
        const userId = this._userId();
        if (!userId) { alert('❌ Você precisa estar logado como vendedor'); return; }

        const newStatus = !this.currentStatus;
        try {
            const { error } = await _supabase.from('vendor_status')
                .update({ is_online: newStatus, updated_at: new Date().toISOString() })
                .eq('owner_id', userId);
            if (error) throw error;

            await _supabase.from('vendor_status_history').insert([{ vendor_id: userId, new_status: newStatus }]);

            this.currentStatus = newStatus;
            window.APP?.onboarding?.markMission?.('status');
            await this.loadHistory();
            this.render();
            window.APP?.products?.fetchAll?.();
        } catch (err) {
            alert(`❌ Erro ao atualizar status: ${err.message}`);
        }
    },

    async saveSchedule(silent = false) {
        const userId = this._userId();
        if (!userId) return;

        const openingTime = document.getElementById('vendor-opening-time')?.value || this.openingTime;
        const closingTime = document.getElementById('vendor-closing-time')?.value || this.closingTime;

        if (this.autoScheduleEnabled && openingTime === closingTime) {
            alert('❌ Abertura e fechamento não podem ser no mesmo horário');
            return;
        }

        try {
            const { error } = await _supabase.from('vendor_status').update({
                auto_schedule: this.autoScheduleEnabled,
                opening_time: openingTime,
                closing_time: closingTime,
                updated_at: new Date().toISOString()
            }).eq('owner_id', userId);
            if (error) throw error;

            this.openingTime = openingTime;
            this.closingTime = closingTime;
            window.APP?.onboarding?.markMission?.('status');
            this.render();
            if (!silent) alert('✅ Horário salvo! O sistema aplica sozinho a cada minuto, mesmo com esta aba fechada.');
        } catch (err) {
            alert(`❌ Erro ao salvar horário: ${err.message}`);
        }
    },

    _startAutoRefresh() {
        if (this._refreshInterval) clearInterval(this._refreshInterval);
        this._refreshInterval = setInterval(async () => {
            if (document.hidden || !this._isManager()) return;
            await this.loadStatus();
            this.render();
        }, 60000);
    },

    /** Próxima virada, inclusive quando o horário passa da meia-noite (ex: 18:00 → 02:00). */
    getNextChangeTime() {
        if (!this.autoScheduleEnabled) return '--:--';
        const now = new Date();
        const cur = now.getHours() * 60 + now.getMinutes();
        const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
        const open = toMin(this.openingTime);
        const close = toMin(this.closingTime);

        const candidates = [
            { t: open, label: this.openingTime },
            { t: close, label: this.closingTime }
        ].map(c => ({ ...c, diff: (c.t - cur + 1440) % 1440 || 1440 }))
         .sort((a, b) => a.diff - b.diff);

        const next = candidates[0];
        return cur + next.diff >= 1440 ? `${next.label} (amanhã)` : next.label;
    }
};
