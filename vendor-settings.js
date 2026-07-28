/**
 * VENDOR-SETTINGS.JS v3.1
 * ✅ Status da loja (online/offline) via Supabase, com horário automático
 *    aplicado no servidor (pg_cron) — client só relê e reflete
 * ✅ v3.1 NOVO: "Fechar a Loja Inteira" — botão de emergência que só o
 *    Admin Supremo vê, dentro da mesma aba "STATUS DA LOJA". Fecha o
 *    marketplace INTEIRO na hora (sobrepõe até o horário automático de
 *    Sabbath/noturno), até o próprio Admin Supremo reabrir manualmente.
 *    Protegido no banco: só quem tem role='supreme' consegue chamar as
 *    funções que ligam/desligam esse modo.
 */

const VendorSettings = {
    currentStatus: true,
    autoScheduleEnabled: false,
    openingTime: '09:00',
    closingTime: '18:00',
    statusHistory: [],
    _listenersAttached: false,
    _refreshInterval: null,

    // ✅ NOVO (v3.1): estado do fechamento global de emergência
    _globalOverride: null,

    async init() {
        try {
            await this.loadStatus();
            await this.loadHistory();
            this.render();
            this.attachListeners();
            this._startAutoRefresh();

            // ✅ NOVO: painel de emergência, só pro Admin Supremo
            this._setupGlobalOverrideUI();
        } catch (err) {
            console.error('Erro ao inicializar VendorSettings:', err);
        }
    },

    async refresh() {
        await this.loadStatus();
        await this.loadHistory();
        this.render();

        // ✅ NOVO: recarrega o painel de emergência toda vez que a aba abre
        this._setupGlobalOverrideUI();
    },

    _isSupreme() {
        return window.APP?.auth?.role === 'supreme';
    },

    /**
     * ✅ NOVO: a permissão de fechar a loja inteira não é mais automática
     * pra todo Admin Supremo — é concedida caso a caso pela conta
     * fundadora (ver Administradores Supremos, na aba Vendedores).
     */
    _canCloseStore() {
        return window.APP?.auth?.role === 'supreme' && !!window.APP?.auth?.profile?.can_close_store;
    },

    async loadStatus() {
        try {
            const userId = window.APP?.auth?.userId;
            if (!userId) return;

            const { data, error } = await _supabase
                .from('vendor_status')
                .select('*')
                .eq('owner_id', userId)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                const { data: created, error: insertError } = await _supabase
                    .from('vendor_status')
                    .insert([{ owner_id: userId }])
                    .select()
                    .single();

                if (insertError) throw insertError;
                this._applyStatusRow(created);
            } else {
                this._applyStatusRow(data);
            }
        } catch (err) {
            console.error('Erro ao carregar status:', err);
        }
    },

    _applyStatusRow(row) {
        this.currentStatus = !!row.is_online;
        this.autoScheduleEnabled = !!row.auto_schedule;
        this.openingTime = row.opening_time || '09:00';
        this.closingTime = row.closing_time || '18:00';
    },

    async loadHistory() {
        try {
            const userId = window.APP?.auth?.userId;
            if (!userId) return;

            const { data, error } = await _supabase
                .from('vendor_status_history')
                .select('*')
                .eq('vendor_id', userId)
                .order('changed_at', { ascending: false })
                .limit(10);

            if (error) throw error;
            this.statusHistory = data || [];
        } catch (err) {
            console.error('Erro ao carregar histórico:', err);
        }
    },

    render() {
        const statusBtn = document.getElementById('vendor-status-main-toggle');
        const statusText = document.getElementById('vendor-status-main-text');
        const statusValue = document.getElementById('vendor-status-main-value');
        const autoToggle = document.getElementById('vendor-auto-schedule-toggle');
        const scheduleInputs = document.getElementById('vendor-schedule-inputs');
        const historyList = document.getElementById('vendor-history-list');

        const isOnline = this.currentStatus;

        if (statusBtn) {
            statusBtn.style.background = isOnline ? '#22c55e' : '#6b7280';
            statusBtn.title = this.autoScheduleEnabled
                ? 'Horário automático ativo — alterar aqui é temporário até a próxima checagem do sistema'
                : '';
        }
        if (statusText) {
            statusText.textContent = isOnline ? 'Online' : 'Offline';
        }

        if (statusValue) {
            statusValue.textContent = isOnline ? 'Online' : 'Offline';
            statusValue.style.color = isOnline ? '#22c55e' : '#ef4444';
        }

        if (autoToggle) {
            autoToggle.checked = this.autoScheduleEnabled;
        }

        if (scheduleInputs) {
            scheduleInputs.style.display = this.autoScheduleEnabled ? 'block' : 'none';
        }

        const openingInput = document.getElementById('vendor-opening-time');
        const closingInput = document.getElementById('vendor-closing-time');
        if (openingInput) openingInput.value = this.openingTime;
        if (closingInput) closingInput.value = this.closingTime;

        if (historyList) {
            historyList.innerHTML = this.renderHistory();
        }
    },

    renderHistory() {
        if (!this.statusHistory.length) {
            return '<div class="text-slate-500 text-center py-4">Sem alterações recentes</div>';
        }

        return this.statusHistory.map(item => {
            const date = new Date(item.changed_at);
            const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const status = item.new_status ? 'Online' : 'Offline';
            const color = item.new_status ? '#22c55e' : '#ef4444';

            return `
                <div style="padding: 8px; background: rgba(0,0,0,0.2); border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
                    <span style="color: ${color}; font-weight: 600;">${status}</span>
                    <span style="color: #64748b; font-size: 11px;">${time}</span>
                </div>
            `;
        }).join('');
    },

    attachListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        const statusBtn = document.getElementById('vendor-status-main-toggle');
        const autoToggle = document.getElementById('vendor-auto-schedule-toggle');
        const scheduleInputs = document.getElementById('vendor-schedule-inputs');
        const saveBtn = document.getElementById('vendor-save-schedule-btn');

        if (statusBtn) {
            statusBtn.addEventListener('click', () => this.toggleStatus());
        }

        if (autoToggle) {
            autoToggle.addEventListener('change', (e) => {
                this.autoScheduleEnabled = e.target.checked;
                if (scheduleInputs) {
                    scheduleInputs.style.display = this.autoScheduleEnabled ? 'block' : 'none';
                }
                this.render();
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSchedule());
        }
    },

    async toggleStatus() {
        try {
            const userId = window.APP?.auth?.userId;
            if (!userId) {
                alert('❌ Você precisa estar logado');
                return;
            }

            const newStatus = !this.currentStatus;

            const { error } = await _supabase
                .from('vendor_status')
                .update({ is_online: newStatus, updated_at: new Date() })
                .eq('owner_id', userId);

            if (error) throw error;

            await _supabase.from('vendor_status_history').insert([{
                vendor_id: userId,
                new_status: newStatus
            }]);

            this.currentStatus = newStatus;
            await this.loadHistory();
            this.render();

            if (window.APP?.products?.fetchAll) {
                window.APP.products.fetchAll();
            }
        } catch (err) {
            console.error('Erro ao atualizar status:', err);
            alert('❌ Erro ao atualizar status');
        }
    },

    async saveSchedule() {
        const userId = window.APP?.auth?.userId;
        if (!userId) {
            alert('❌ Você precisa estar logado');
            return;
        }

        const openingTime = document.getElementById('vendor-opening-time')?.value;
        const closingTime = document.getElementById('vendor-closing-time')?.value;

        if (!openingTime || !closingTime) {
            alert('Preencha os horários');
            return;
        }

        try {
            const { error } = await _supabase
                .from('vendor_status')
                .update({
                    auto_schedule: this.autoScheduleEnabled,
                    opening_time: openingTime,
                    closing_time: closingTime,
                    updated_at: new Date()
                })
                .eq('owner_id', userId);

            if (error) throw error;

            this.openingTime = openingTime;
            this.closingTime = closingTime;

            alert('✅ Horário salvo! O sistema aplica automaticamente todo minuto (mesmo com essa aba fechada).');
            this.render();
        } catch (err) {
            console.error('Erro ao salvar horário:', err);
            alert('❌ Erro ao salvar horário');
        }
    },

    _startAutoRefresh() {
        if (this._refreshInterval) clearInterval(this._refreshInterval);

        this._refreshInterval = setInterval(async () => {
            await this.loadStatus();
            this.render();

            // ✅ NOVO: mantém o painel de emergência atualizado também
            if (this._canCloseStore()) this.loadGlobalOverrideStatus();
        }, 60000);
    },

    getNextChangeTime() {
        if (!this.autoScheduleEnabled) return '--:--';

        const now = new Date();
        const currentTime = now.getHours().toString().padStart(2, '0') + ':' +
                          now.getMinutes().toString().padStart(2, '0');

        if (currentTime < this.openingTime) {
            return this.openingTime;
        } else if (currentTime < this.closingTime) {
            return this.closingTime;
        } else {
            return `${this.openingTime} (amanhã)`;
        }
    },

    // ============================================================
    // ✅ NOVO (v3.1): FECHAMENTO DE EMERGÊNCIA DA LOJA INTEIRA
    // ============================================================

    /**
     * Mostra a seção de emergência só pro Admin Supremo, e carrega o
     * estado atual (fechada manualmente ou não).
     */
    _setupGlobalOverrideUI() {
        const section = document.getElementById('global-store-override-section');
        if (!section) return;

        if (!this._canCloseStore()) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        this.loadGlobalOverrideStatus();
    },

    async loadGlobalOverrideStatus() {
        try {
            const { data, error } = await _supabase
                .from('store_settings')
                .select('manual_override, manual_override_at, profiles!manual_override_by(full_name)')
                .eq('id', 1)
                .maybeSingle();

            if (error) throw error;

            this._globalOverride = data || { manual_override: false };
            this.renderGlobalOverride();
        } catch (err) {
            console.error('Erro ao carregar status de emergência:', err);
        }
    },

    renderGlobalOverride() {
        const statusDiv = document.getElementById('global-override-status');
        const btn = document.getElementById('global-override-toggle-btn');
        if (!statusDiv || !btn) return;

        const isClosed = !!this._globalOverride?.manual_override;

        if (isClosed) {
            const who = this._globalOverride?.profiles?.full_name || 'um Admin Supremo';
            const when = this._globalOverride?.manual_override_at
                ? new Date(this._globalOverride.manual_override_at).toLocaleString('pt-BR')
                : '—';

            statusDiv.innerHTML = `
                <span class="text-red-400 font-black">🔴 LOJA FECHADA MANUALMENTE</span>
                <div class="text-[11px] text-slate-500 mt-1">Fechada por ${window.escapeHtml(who)} em ${when}</div>
            `;
            btn.textContent = '🟢 REABRIR A LOJA (voltar ao normal)';
            btn.style.background = '#22c55e';
        } else {
            statusDiv.innerHTML = `<span class="text-green-400 font-black">🟢 Funcionando normalmente</span>`;
            btn.textContent = '🔴 FECHAR A LOJA INTEIRA AGORA';
            btn.style.background = '#ef4444';
        }
    },

    async toggleGlobalOverride() {
        const isClosed = !!this._globalOverride?.manual_override;

        try {
            if (isClosed) {
                if (!confirm('Reabrir o marketplace inteiro?\n\nAssim que reabrir, o sistema volta a seguir o horário automático normalmente (Sabbath/noturno).')) return;

                const { error } = await _supabase.rpc('clear_store_manual_override');
                if (error) throw error;

                alert('✅ Loja reaberta! Voltando ao horário automático.');
            } else {
                if (!confirm('⚠️ Isso fecha o marketplace INTEIRO agora — ninguém consegue comprar de nenhum vendedor até você reabrir manualmente.\n\nTem certeza?')) return;

                const { error } = await _supabase.rpc('set_store_manual_closed');
                if (error) throw error;

                alert('🔴 Loja fechada. Ninguém consegue comprar até você reabrir aqui mesmo.');
            }

            await this.loadGlobalOverrideStatus();

            // Atualiza o overlay de "loja fechada" pra quem estiver navegando agora
            if (window.APP?.storeStatus?.updateStatus) {
                await window.APP.storeStatus.updateStatus();
            }
        } catch (err) {
            console.error('Erro ao alterar fechamento manual:', err);
            alert(`❌ Erro: ${err.message}`);
        }
    }
};
    /**
     * Chamado sempre que a aba "vendor-settings" é aberta —
     * só recarrega dados e re-renderiza, sem duplicar listeners/intervalos
     */
    async refresh() {
        await this.loadStatus();
        await this.loadHistory();
        this.render();
    },

    async loadStatus() {
        try {
            const userId = window.APP?.auth?.userId;
            if (!userId) return;

            const { data, error } = await _supabase
                .from('vendor_status')
                .select('*')
                .eq('owner_id', userId)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                // Primeira vez do vendedor — cria linha padrão
                const { data: created, error: insertError } = await _supabase
                    .from('vendor_status')
                    .insert([{ owner_id: userId }])
                    .select()
                    .single();

                if (insertError) throw insertError;
                this._applyStatusRow(created);
            } else {
                this._applyStatusRow(data);
            }
        } catch (err) {
            console.error('Erro ao carregar status:', err);
        }
    },

    _applyStatusRow(row) {
        this.currentStatus = !!row.is_online;
        this.autoScheduleEnabled = !!row.auto_schedule;
        this.openingTime = row.opening_time || '09:00';
        this.closingTime = row.closing_time || '18:00';
    },

    async loadHistory() {
        try {
            const userId = window.APP?.auth?.userId;
            if (!userId) return;

            const { data, error } = await _supabase
                .from('vendor_status_history')
                .select('*')
                .eq('vendor_id', userId)
                .order('changed_at', { ascending: false })
                .limit(10);

            if (error) throw error;
            this.statusHistory = data || [];
        } catch (err) {
            console.error('Erro ao carregar histórico:', err);
        }
    },

    render() {
        const statusBtn = document.getElementById('vendor-status-main-toggle');
        const statusText = document.getElementById('vendor-status-main-text');
        const statusValue = document.getElementById('vendor-status-main-value');
        const autoToggle = document.getElementById('vendor-auto-schedule-toggle');
        const scheduleInputs = document.getElementById('vendor-schedule-inputs');
        const nextChange = document.getElementById('vendor-next-change');
        const modeText = document.getElementById('vendor-current-mode');
        const historyList = document.getElementById('vendor-history-list');

        const isOnline = this.currentStatus;

        if (statusBtn) {
            statusBtn.style.background = isOnline ? '#22c55e' : '#6b7280';
            // ✅ NOVO: se o horário automático está ativo, deixa claro que o
            // botão manual é só um override temporário (o cron pode corrigir
            // de volta no próximo minuto).
            statusBtn.title = this.autoScheduleEnabled
                ? 'Horário automático ativo — alterar aqui é temporário até a próxima checagem do sistema'
                : '';
        }
        if (statusText) {
            statusText.textContent = isOnline ? 'Online' : 'Offline';
        }

        if (statusValue) {
            statusValue.textContent = isOnline ? 'Online' : 'Offline';
            statusValue.style.color = isOnline ? '#22c55e' : '#ef4444';
        }

        if (autoToggle) {
            autoToggle.checked = this.autoScheduleEnabled;
        }

        if (scheduleInputs) {
            scheduleInputs.style.display = this.autoScheduleEnabled ? 'block' : 'none';
        }

        if (nextChange) {
            nextChange.textContent = this.getNextChangeTime();
        }

        if (modeText) {
            modeText.textContent = this.autoScheduleEnabled ? 'Automático' : 'Manual';
        }

        const openingInput = document.getElementById('vendor-opening-time');
        const closingInput = document.getElementById('vendor-closing-time');
        if (openingInput) openingInput.value = this.openingTime;
        if (closingInput) closingInput.value = this.closingTime;

        if (historyList) {
            historyList.innerHTML = this.renderHistory();
        }
    },

    renderHistory() {
        if (!this.statusHistory.length) {
            return '<div class="text-slate-500 text-center py-4">Sem alterações recentes</div>';
        }

        return this.statusHistory.map(item => {
            const date = new Date(item.changed_at);
            const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const status = item.new_status ? 'Online' : 'Offline';
            const color = item.new_status ? '#22c55e' : '#ef4444';

            return `
                <div style="padding: 8px; background: rgba(0,0,0,0.2); border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
                    <span style="color: ${color}; font-weight: 600;">${status}</span>
                    <span style="color: #64748b; font-size: 11px;">${time}</span>
                </div>
            `;
        }).join('');
    },

    attachListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        const statusBtn = document.getElementById('vendor-status-main-toggle');
        const autoToggle = document.getElementById('vendor-auto-schedule-toggle');
        const scheduleInputs = document.getElementById('vendor-schedule-inputs');
        const saveBtn = document.getElementById('vendor-save-schedule-btn');

        if (statusBtn) {
            statusBtn.addEventListener('click', () => this.toggleStatus());
        }

        if (autoToggle) {
            autoToggle.addEventListener('change', (e) => {
                this.autoScheduleEnabled = e.target.checked;
                if (scheduleInputs) {
                    scheduleInputs.style.display = this.autoScheduleEnabled ? 'block' : 'none';
                }
                this.render();
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSchedule());
        }
    },

    /**
     * Toggle manual (botão "Online/Offline"). Continua existindo pro
     * vendedor conseguir se colocar offline manualmente a qualquer momento
     * (ex: acabou o estoque, viagem) — independente do horário automático.
     * Se auto_schedule estiver ativo, essa mudança é só até o próximo
     * minuto, quando o cron pode corrigir de volta conforme o horário.
     */
    async toggleStatus() {
        try {
            const userId = window.APP?.auth?.userId;
            if (!userId) {
                alert('❌ Você precisa estar logado como vendedor');
                return;
            }

            const newStatus = !this.currentStatus;

            const { error } = await _supabase
                .from('vendor_status')
                .update({ is_online: newStatus, updated_at: new Date() })
                .eq('owner_id', userId);

            if (error) throw error;

            await _supabase.from('vendor_status_history').insert([{
                vendor_id: userId,
                new_status: newStatus
            }]);

            this.currentStatus = newStatus;
            await this.loadHistory();
            this.render();

            if (window.APP?.products?.fetchAll) {
                window.APP.products.fetchAll();
            }
        } catch (err) {
            console.error('Erro ao atualizar status:', err);
            alert('❌ Erro ao atualizar status');
        }
    },

    async saveSchedule() {
        const userId = window.APP?.auth?.userId;
        if (!userId) {
            alert('❌ Você precisa estar logado');
            return;
        }

        const openingTime = document.getElementById('vendor-opening-time')?.value;
        const closingTime = document.getElementById('vendor-closing-time')?.value;

        if (!openingTime || !closingTime) {
            alert('Preencha os horários');
            return;
        }

        try {
            const { error } = await _supabase
                .from('vendor_status')
                .update({
                    auto_schedule: this.autoScheduleEnabled,
                    opening_time: openingTime,
                    closing_time: closingTime,
                    updated_at: new Date()
                })
                .eq('owner_id', userId);

            if (error) throw error;

            this.openingTime = openingTime;
            this.closingTime = closingTime;

            alert('✅ Horário salvo! O sistema aplica automaticamente todo minuto (mesmo com essa aba fechada).');
            this.render();

            // ✅ Relê o status logo depois de salvar — no pior caso o cron
            // ainda não rodou nesse minuto, mas na próxima leitura já reflete.
        } catch (err) {
            console.error('Erro ao salvar horário:', err);
            alert('❌ Erro ao salvar horário');
        }
    },

    /**
     * ✅ v3.0: substitui o antigo startScheduleCheck() (que calculava e
     * ligava/desligava sozinho, só enquanto essa aba estivesse aberta).
     * Agora só relê o banco a cada minuto — o cron do servidor é quem
     * decide e aplica, então aqui é só reflexo do que já está correto.
     */
    _startAutoRefresh() {
        if (this._refreshInterval) clearInterval(this._refreshInterval);

        this._refreshInterval = setInterval(async () => {
            await this.loadStatus();
            this.render();
        }, 60000);
    },

    getNextChangeTime() {
        if (!this.autoScheduleEnabled) return '--:--';

        const now = new Date();
        const currentTime = now.getHours().toString().padStart(2, '0') + ':' +
                          now.getMinutes().toString().padStart(2, '0');

        if (currentTime < this.openingTime) {
            return this.openingTime;
        } else if (currentTime < this.closingTime) {
            return this.closingTime;
        } else {
            return `${this.openingTime} (amanhã)`;
        }
    }
};
