/**
 * STORE-STATUS.JS v3.0
 * ✅ v3.0: status (Sabbath / Noturno / Aberto) agora vem do banco
 *    (tabela store_settings), calculado no servidor por uma função
 *    agendada (pg_cron, a cada 1 minuto) — não depende mais de nenhum
 *    navegador estar aberto no horário exato da virada.
 * ✅ Fallback local: se o Supabase estiver fora do ar, calcula localmente
 *    (mesma lógica de antes) pra não deixar a loja "travada" sem resposta.
 */

const StoreStatus = {
    status: 'open',
    nextOpenAt: null,
    lastCheck: null,
    checkInterval: null,
    _countdownInterval: null,

    /**
     * ✅ NOVO (v3.0): busca o status atual direto do banco.
     * Se falhar (rede/Supabase fora do ar), cai no cálculo local
     * (mesma regra de negócio, só que sem garantia de estar
     * sincronizado com outros usuários).
     */
    async fetchStatus() {
        try {
            if (!window._supabase) throw new Error('Supabase não disponível');

            const { data, error } = await _supabase
                .from('store_settings')
                .select('status, next_open_at')
                .eq('id', 1)
                .single();

            if (error) throw error;

            this.status = data.status;
            this.nextOpenAt = data.next_open_at ? new Date(data.next_open_at) : null;
        } catch (err) {
            log(`⚠️ StoreStatus: fallback local (${err.message})`, 'warning');
            this.status = this._computeStatusLocally();
            this.nextOpenAt = this._computeNextOpenLocally();
        }
    },

    /**
     * Cálculo local de emergência — mesma regra do servidor,
     * usada só se o Supabase não responder.
     */
    _computeStatusLocally() {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const totalMinutes = now.getHours() * 60 + now.getMinutes();

        if (dayOfWeek === 5 && totalMinutes >= 18 * 60) return 'sabbath_closed';
        if (dayOfWeek === 6 && totalMinutes < 18 * 60) return 'sabbath_closed';
        if (totalMinutes >= 1 * 60 && totalMinutes < 6 * 60) return 'night_closed';
        return 'open';
    },

    _computeNextOpenLocally() {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const status = this._computeStatusLocally();

        if (status === 'sabbath_closed') {
            const next = new Date(now);
            next.setHours(18, 0, 0, 0);
            if (dayOfWeek === 5) next.setDate(next.getDate() + 1);
            return next;
        }
        if (status === 'night_closed') {
            const next = new Date(now);
            next.setHours(6, 0, 0, 0);
            return next;
        }
        return null;
    },

    /**
     * Mensagens por status
     */
    getStatusMessage() {
        const messages = {
            night_closed: {
                icon: 'moon',
                title: 'Nossas lojas estão a descansar',
                subtitle: 'Voltamos às 06:00!',
                description: 'Nossos horários de funcionamento são de 06:00 às 01:00 todos os dias.'
            },
            sabbath_closed: {
                icon: 'sunrise',
                title: 'Feliz Sábado!',
                subtitle: 'Shalom 🕊️',
                description: 'Em observância aos princípios bíblicos, nossas operações de compra e venda estão pausadas até às 18h de sábado. Aproveite o dia para descanso e família.'
            },
            open: {
                icon: 'check-circle',
                title: 'Loja Aberta',
                subtitle: 'Bem-vindo!',
                description: 'Estamos prontos para servi-lo!'
            }
        };

        return messages[this.status] || messages.open;
    },

    /**
     * Inicializa o sistema
     */
    async init() {
        try {
            log('🔍 Inicializando StoreStatus...', 'info');

            await this.fetchStatus();
            this.renderOverlay();
            this.updateButtonStates();
            this._startCountdown();

            // ✅ v3.0: não recalcula mais localmente — só relê o banco,
            // que já é mantido correto pelo cron a cada minuto.
            this.checkInterval = setInterval(() => this.updateStatus(), 60000);

            log('✅ StoreStatus inicializado', 'success');
        } catch (err) {
            log(`❌ Erro ao inicializar StoreStatus: ${err.message}`, 'error');
        }
    },

    /**
     * Relê o status do banco e re-renderiza se mudou
     */
    async updateStatus() {
        const previousStatus = this.status;
        await this.fetchStatus();

        if (this.status !== previousStatus) {
            log(`📍 Status mudou para: ${this.status}`, 'info');
            this.renderOverlay();
            this.updateButtonStates();
            this._startCountdown();
        }

        this.lastCheck = new Date();
    },

    /**
     * Renderiza overlay de bloqueio
     */
    renderOverlay() {
        let overlay = document.getElementById('store-closed-overlay');

        if (this.status === 'open') {
            if (overlay) {
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 400);
            }
            return;
        }

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'store-closed-overlay';
            document.body.appendChild(overlay);
        }

        overlay.dataset.mode = this.status;

        const message = this.getStatusMessage();

        overlay.innerHTML = `
            <div class="store-closed-container">
                <div class="store-closed-content">
                    <div class="store-closed-icon-ring">
                        <i data-lucide="${message.icon}" class="store-closed-icon"></i>
                    </div>
                    <h1 class="store-closed-title">${message.title}</h1>
                    <h2 class="store-closed-subtitle">${message.subtitle}</h2>
                    <p class="store-closed-description">${message.description}</p>

                    ${this.nextOpenAt ? `
                        <div class="store-closed-timer">
                            <p class="store-closed-reopens">⏰ Reabrimos em</p>
                            <p id="store-closed-countdown" class="store-closed-countdown">--:--:--</p>
                            <p class="store-closed-reopens-at">${this.nextOpenAt.toLocaleString('pt-BR', {
                                weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                            })}</p>
                        </div>
                    ` : ''}

                    <div class="store-closed-info">
                        <p>📱 Você pode continuar navegando, mas as operações de compra e venda estão desativadas.</p>
                    </div>
                </div>
            </div>
        `;

        if (window.lucide) lucide.createIcons();

        overlay.offsetHeight;
        overlay.classList.add('active');
    },

    /**
     * ✅ NOVO (v3.0): contagem regressiva ao vivo (hh:mm:ss) até a reabertura,
     * atualizada a cada segundo — puramente visual, não afeta a lógica.
     */
    _startCountdown() {
        if (this._countdownInterval) clearInterval(this._countdownInterval);
        if (!this.nextOpenAt) return;

        const tick = () => {
            const el = document.getElementById('store-closed-countdown');
            if (!el) return;

            const diff = this.nextOpenAt.getTime() - Date.now();
            if (diff <= 0) {
                el.textContent = '00:00:00';
                return;
            }

            const totalSeconds = Math.floor(diff / 1000);
            const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
            const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
            const s = String(totalSeconds % 60).padStart(2, '0');
            el.textContent = `${h}:${m}:${s}`;
        };

        tick();
        this._countdownInterval = setInterval(tick, 1000);
    },

    /**
     * Desativa/ativa botões de compra conforme status
     */
    updateButtonStates() {
        try {
            const buyButtons = document.querySelectorAll(
                '[onclick*="cart.add"], ' +
                '[onclick*="checkout"], ' +
                '[class*="btn-buy"], ' +
                '[class*="btn-add-cart"]'
            );

            buyButtons.forEach(btn => {
                if (this.status === 'open') {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                } else {
                    btn.disabled = true;
                    btn.style.opacity = '0.4';
                    btn.style.cursor = 'not-allowed';
                }
            });
        } catch (err) {
            log(`⚠️ Erro ao atualizar botões: ${err.message}`, 'warning');
        }
    },

    /**
     * Trava para checkout
     */
    canCheckout() {
        if (this.status !== 'open') {
            const message = this.getStatusMessage();
            alert(`🔒 ${message.title}\n\n${message.description}`);
            return false;
        }
        return true;
    },

    /**
     * Trava para adicionar ao carrinho
     */
    canAddToCart() {
        if (this.status !== 'open') {
            const message = this.getStatusMessage();
            alert(`🔒 Operação não permitida\n\n${message.description}`);
            return false;
        }
        return true;
    }
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    StoreStatus.init();
});

window.StoreStatus = StoreStatus;   