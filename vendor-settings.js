/**
 * VENDOR-SETTINGS.JS v3.4
 * ✅ Status da loja (online/offline) via Supabase, com horário automático
 *    aplicado no servidor (pg_cron) — client só relê e reflete
 * ✅ "Fechar a Loja Inteira" — botão de emergência que só o Admin Supremo
 *    (com permissão can_close_store) vê, dentro da aba "STATUS DA LOJA".
 *    Fecha o marketplace INTEIRO na hora (sobrepõe até o horário
 *    automático de Sabbath/noturno), até o próprio Admin Supremo reabrir
 *    manualmente. Protegido no banco: só quem tem role='supreme' e a
 *    permissão concedida consegue chamar as funções que ligam/desligam
 *    esse modo.
 * ✅ v3.4 NOVO — FIX CRÍTICO DE PERFORMANCE: init() rodava pra QUALQUER
 *    conta logada, inclusive Cliente comum — que nem tem acesso a essa
 *    tela. Isso fazia loadStatus() criar (silenciosamente) uma linha em
 *    vendor_status pra cada cliente que só compra, e ainda gastava 3
 *    idas ao banco em SÉRIE (status, histórico, chave Pix) à toa.
 *    Agora só roda pra quem realmente usa essa tela (seller/supreme), e
 *    as 3 buscas passam a rodar em paralelo (init() e refresh()).
 * ✅ v3.2 FIX CRÍTICO: removido um bloco de código duplicado que tinha
 *    sido colado por engano depois do fechamento do objeto (um
 *    "async refresh() {...}" solto, fora de qualquer objeto). Isso
 *    quebrava a SINTAXE do arquivo inteiro — e quando o navegador acha
 *    um erro de sintaxe num <script>, ele não executa NADA daquele
 *    arquivo, nem a parte que estava certa. Por isso "VendorSettings"
 *    nunca existia, o que travava o APP.init() logo na etapa 4 (a
 *    atribuição "window.APP.vendorSettings = VendorSettings" não tinha
 *    try/catch em app.js) — e é por isso que Products, Ads, Cart etc.
 *    nunca chegavam a carregar. Essa é a causa raiz de "os produtos não
 *    aparecem".
 * ✅ v3.3 NOVO: card "Minha Chave Pix" — o vendedor cadastra a chave Pix
 *    dele aqui (a mesma que ele já preenche ao virar vendedor pela
 *    primeira vez, no modal "QUERO VENDER") e pode trocá-la a qualquer
 *    momento. É essa chave que aparece pro comprador no checkout,
 *    dentro do bloco de pagamento Pix DESSE vendedor especificamente
 *    (cada vendedor tem a própria, ver orders.js).
 */

const VendorSettings = {
    currentStatus: true,
    autoScheduleEnabled: false,
    openingTime: '09:00',
    closingTime: '18:00',
    statusHistory: [],
    _listenersAttached: false,
    _refreshInterval: null,

    // Estado do fechamento global de emergência
    _globalOverride: null,

    // ✅ NOVO (v3.3): chave Pix do próprio vendedor
    pixKey: '',

    /**
     * ✅ FIX CRÍTICO v3.4: rodava pra QUALQUER conta logada, inclusive
     * Cliente comum — que nem tem acesso a essa tela. Isso fazia
     * loadStatus() criar (silenciosamente) uma linha em vendor_status
     * pra cada cliente que só compra, e ainda gastava 3 idas ao banco
     * em SÉRIE (status, depois histórico, depois chave Pix) à toa.
     * Agora só roda pra quem realmente usa essa tela (seller/supreme),
     * e as 3 buscas passam a rodar em paralelo.
     */
    async init() {
        try {
            const role = window.APP?.auth?.role;
            if (role !== 'seller' && role !== 'supreme') return;

            await Promise.all([
                this.loadStatus(),
                this.loadHistory(),
                this.loadPixKey()
            ]);
            this.render();
            this.attachListeners();
            this._startAutoRefresh();

            // Painel de emergência, só pro Admin Supremo
            this._setupGlobalOverrideUI();
        } catch (err) {
            console.error('Erro ao inicializar VendorSettings:', err);
        }
    },

    /**
     * Chamado sempre que a aba "vendor-settings" é aberta —
     * só recarrega dados e re-renderiza, sem duplicar listeners/intervalos
     */
    async refresh() {
        await Promise.all([
            this.loadStatus(),
            this.loadHistory(),
            this.loadPixKey()
        ]);
        this.render();

        // Recarrega o painel de emergência toda vez que a aba abre
        this._setupGlobalOverrideUI();
    },

    _isSupreme() {
        return window.APP?.auth?.role === 'supreme';
    },

    /**
     * A permissão de fechar a loja inteira não é automática pra todo
     * Admin Supremo — é concedida caso a caso pela conta fundadora
     * (ver Administradores Supremos, na aba Vendedores).
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

    /**
     * ✅ NOVO (v3.3): busca a chave Pix atual do vendedor logado.
     */
    async loadPixKey() {
        try {
            const userId = window.APP?.auth?.userId;
            if (!userId) return;

            const { data, error } = await _supabase
                .from('profiles')
                .select('pix_key')
                .eq('id', userId)
                .maybeSingle();

            if (error) throw error;
            this.pixKey = data?.pix_key || '';
        } catch (err) {
            console.error('Erro ao carregar chave Pix:', err);
        }
    },

    /**
     * ✅ NOVO (v3.3): salva/atualiza a chave Pix do vendedor logado.
     * Essa é a chave que aparece pro comprador no checkout, no bloco
     * de pagamento Pix específico desse vendedor.
     */
    async savePixKey() {
        const userId = window.APP?.auth?.userId;
        if (!userId) {
            alert('❌ Você precisa estar logado');
            return;
        }

        const input = document.getElementById('vendor-pix-key-input');
        const value = input?.value?.trim();

        if (!value) {
            alert('❌ Digite uma chave Pix válida (CPF/CNPJ, e-mail, telefone ou chave aleatória).');
            return;
        }

        try {
            const { error } = await _supabase
                .from('profiles')
                .update({ pix_key: value })
                .eq('id', userId);

            if (error) throw error;

            this.pixKey = value;
            if (window.APP?.auth?.profile) window.APP.auth.profile.pix_key = value;

            this.render();
            window.APP?.auth?._checkPixKeyReminder?.();

            // ✅ NOVO: missão de onboarding
            window.APP?.onboarding?.markMission?.('pix');

            alert('✅ Chave Pix salva! É essa chave que vai aparecer pros compradores no checkout.');
        } catch (err) {
            console.error('Erro ao salvar chave Pix:', err);
            alert(`❌ Erro ao salvar chave Pix: ${err.message}`);
        }
    },

    render() {
        const statusBtn = document.getElementById('vendor-status-main-toggle');
        const statusText = document.getElementById('vendor-status-main-text');
        const statusValue = document.getElementById('vendor-status-main-value');
        const autoToggle = document.getElementById('vendor-auto-schedule-toggle');
        const scheduleInputs = document.getElementById('vendor-schedule-inputs');
        const historyList = document.getElementById('vendor-history-list');
        const pixInput = document.getElementById('vendor-pix-key-input');

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

        // ✅ NOVO (v3.3)
        if (pixInput && document.activeElement !== pixInput) {
            pixInput.value = this.pixKey || '';
        }

        // ✅ NOVO: acende o aviso vermelho quando a chave ainda não foi
        // cadastrada — reforça, dentro da própria tela, por que isso
        // importa (evita que a venda dependa de combinar tudo no
        // WhatsApp).
        const pixWarning = document.getElementById('vendor-pix-key-warning');
        if (pixWarning) pixWarning.classList.toggle('hidden', !!(this.pixKey && this.pixKey.trim()));

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
        const savePixBtn = document.getElementById('vendor-save-pix-btn');

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

        // ✅ NOVO (v3.3)
        if (savePixBtn) {
            savePixBtn.addEventListener('click', () => this.savePixKey());
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

            // ✅ NOVO: missão de onboarding
            window.APP?.onboarding?.markMission?.('status');

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

            // ✅ NOVO: missão de onboarding
            window.APP?.onboarding?.markMission?.('status');

            alert('✅ Horário salvo! O sistema aplica automaticamente todo minuto (mesmo com essa aba fechada).');
            this.render();
        } catch (err) {
            console.error('Erro ao salvar horário:', err);
            alert('❌ Erro ao salvar horário');
        }
    },

    /**
     * Só relê o banco a cada minuto — o cron do servidor é quem decide e
     * aplica; aqui é só reflexo do que já está correto.
     */
    _startAutoRefresh() {
        if (this._refreshInterval) clearInterval(this._refreshInterval);

        this._refreshInterval = setInterval(async () => {
            await this.loadStatus();
            this.render();

            // Mantém o painel de emergência atualizado também
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
    // FECHAMENTO DE EMERGÊNCIA DA LOJA INTEIRA
    // ============================================================

    /**
     * Mostra a seção de emergência só pro Admin Supremo com permissão, e
     * carrega o estado atual (fechada manualmente ou não).
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
