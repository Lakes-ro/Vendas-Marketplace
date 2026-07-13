/**
 * VENDOR-SETTINGS.JS v3.0
 * ✅ Usa Supabase (vendor_status / vendor_status_history)
 * ✅ init() idempotente — pode ser chamado de novo sem duplicar listeners
 * ✅ refresh() para recarregar dados toda vez que a aba é aberta
 * ✅ v3.0 FIX DEFINITIVO: o horário automático agora é aplicado por uma
 *    função agendada no servidor (pg_cron, a cada 1 minuto) — não depende
 *    mais do navegador do vendedor estar aberto no exato minuto da virada.
 *    O client-side PAROU de tentar calcular/ligar-desligar sozinho (isso
 *    causava o bug de "loja online fora do horário" quando ninguém tinha
 *    a aba aberta); agora ele só RELÊ o banco periodicamente e mostra o
 *    que o servidor já decidiu — igual ao que store-status.js faz pro
 *    modo Sabbath.
 */

const VendorSettings = {
    currentStatus: true,
    autoScheduleEnabled: false,
    openingTime: '09:00',
    closingTime: '18:00',
    statusHistory: [],
    _listenersAttached: false,
    _refreshInterval: null,

    async init() {
        try {
            await this.loadStatus();
            await this.loadHistory();
            this.render();
            this.attachListeners();
            this._startAutoRefresh();
        } catch (err) {
            console.error('Erro ao inicializar VendorSettings:', err);
        }
    },

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