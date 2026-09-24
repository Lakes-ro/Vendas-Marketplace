/**
 * STORE-STATUS.JS v3.1
 * v3.1 (auditoria):
 *  - não se inicializa mais sozinho (era iniciado 2x: aqui e no app.js)
 *  - suporta 'manual_closed' (loja fechada pelo Admin)
 *  - cálculo de emergência usa o fuso de Brasília, não o do aparelho
 *  - botões de compra encontrados por data-action (antes o seletor
 *    procurava onclick="cart.add" e não achava nada)
 *  - intervalo protegido contra duplicação
 */

const StoreStatus = {
    status: 'open',
    nextOpenAt: null,
    lastCheck: null,
    checkInterval: null,
    _countdownInterval: null,
    _initialized: false,

    async fetchStatus() {
        try {
            if (!window._supabase) throw new Error('Supabase não disponível');
            const { data, error } = await _supabase
                .from('store_settings')
                .select('status, next_open_at')
                .eq('id', 1)
                .single();
            if (error) throw error;
            this.status = data.status || 'open';
            this.nextOpenAt = data.next_open_at ? new Date(data.next_open_at) : null;
        } catch (err) {
            log(`⚠️ StoreStatus: cálculo local (${err.message})`, 'warning');
            this.status = this._computeStatusLocally();
            this.nextOpenAt = this._computeNextOpenLocally();
        }
    },

    /** Data/hora atual em Brasília, independente do fuso do aparelho. */
    _nowBR() {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(new Date());
        const get = (t) => parts.find(p => p.type === t)?.value;
        const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return { day: days[get('weekday')], minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
    },

    _computeStatusLocally() {
        const { day, minutes } = this._nowBR();
        if (day === 5 && minutes >= 18 * 60) return 'sabbath_closed';
        if (day === 6 && minutes < 18 * 60) return 'sabbath_closed';
        if (minutes >= 60 && minutes < 6 * 60) return 'night_closed';
        return 'open';
    },

    _computeNextOpenLocally() {
        const status = this._computeStatusLocally();
        if (status === 'open') return null;
        const { day, minutes } = this._nowBR();
        let minutesUntil;
        if (status === 'sabbath_closed') {
            minutesUntil = (day === 5 ? 1440 : 0) + 18 * 60 - minutes;
        } else {
            minutesUntil = 6 * 60 - minutes;
        }
        return new Date(Date.now() + minutesUntil * 60000);
    },

    getStatusMessage() {
        const messages = {
            night_closed: {
                icon: 'moon',
                title: 'Nossas lojas estão a descansar',
                subtitle: 'Voltamos às 06:00!',
                description: 'Nosso horário de funcionamento é das 06:00 à 01:00, todos os dias.'
            },
            sabbath_closed: {
                icon: 'sunrise',
                title: 'Feliz Sábado!',
                subtitle: 'Shalom 🕊️',
                description: 'Em observância aos princípios bíblicos, nossas operações de compra e venda estão pausadas até às 18h de sábado. Aproveite o dia para descanso e família.'
            },
            manual_closed: {
                icon: 'lock',
                title: 'Loja temporariamente fechada',
                subtitle: 'Voltamos em breve',
                description: 'A administração pausou as vendas por um momento. Você pode continuar olhando os produtos.'
            },
            open: {
                icon: 'check-circle',
                title: 'Loja Aberta',
                subtitle: 'Bem-vindo!',
                description: 'Estamos prontos para servi-lo!'
            }
        };
        return messages[this.status] || messages.manual_closed;
    },

    async init() {
        if (this._initialized) return;
        this._initialized = true;

        await this.fetchStatus();
        this.renderOverlay();
        this.updateButtonStates();
        this._startCountdown();

        if (this.checkInterval) clearInterval(this.checkInterval);
        this.checkInterval = setInterval(() => this.updateStatus(), 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.updateStatus(); });
    },

    async updateStatus(force = false) {
        const previous = this.status;
        await this.fetchStatus();
        if (force || this.status !== previous) {
            this.renderOverlay();
            this.updateButtonStates();
            this._startCountdown();
        }
        this.lastCheck = new Date();
    },

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

        const m = this.getStatusMessage();
        overlay.innerHTML = `
            <div class="store-closed-container">
                <div class="store-closed-content">
                    <div class="store-closed-icon-ring"><i data-lucide="${m.icon}" class="store-closed-icon"></i></div>
                    <h1 class="store-closed-title">${m.title}</h1>
                    <h2 class="store-closed-subtitle">${m.subtitle}</h2>
                    <p class="store-closed-description">${m.description}</p>
                    ${this.nextOpenAt ? `
                        <div class="store-closed-timer">
                            <p class="store-closed-reopens">⏰ Reabrimos em</p>
                            <p id="store-closed-countdown" class="store-closed-countdown">--:--:--</p>
                            <p class="store-closed-reopens-at">${this.nextOpenAt.toLocaleString('pt-BR', {
                                timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                            })}</p>
                        </div>` : ''}
                    <div class="store-closed-info">
                        <p>📱 Você pode continuar navegando, mas as operações de compra e venda estão desativadas.</p>
                    </div>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();
        void overlay.offsetHeight;
        overlay.classList.add('active');
    },

    _startCountdown() {
        if (this._countdownInterval) clearInterval(this._countdownInterval);
        this._countdownInterval = null;
        if (!this.nextOpenAt || this.status === 'open') return;

        const tick = () => {
            const el = document.getElementById('store-closed-countdown');
            if (!el) return;
            const diff = this.nextOpenAt.getTime() - Date.now();
            if (diff <= 0) {
                el.textContent = '00:00:00';
                clearInterval(this._countdownInterval);
                this._countdownInterval = null;
                setTimeout(() => this.updateStatus(), 5000);
                return;
            }
            const total = Math.floor(diff / 1000);
            const h = String(Math.floor(total / 3600)).padStart(2, '0');
            const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
            const s = String(total % 60).padStart(2, '0');
            el.textContent = `${h}:${mm}:${s}`;
        };
        tick();
        this._countdownInterval = setInterval(tick, 1000);
    },

    updateButtonStates() {
        const closed = this.status !== 'open';
        document.querySelectorAll('[data-action="checkout"]').forEach(btn => {
            btn.disabled = closed;
            btn.style.opacity = closed ? '0.4' : '';
            btn.style.cursor = closed ? 'not-allowed' : '';
        });
        document.body.classList.toggle('store-is-closed', closed);
    },

    canCheckout() {
        if (this.status !== 'open') {
            const m = this.getStatusMessage();
            alert(`🔒 ${m.title}\n\n${m.description}`);
            return false;
        }
        return true;
    },

    canAddToCart() {
        if (this.status !== 'open') {
            alert(`🔒 Operação não permitida\n\n${this.getStatusMessage().description}`);
            return false;
        }
        return true;
    }
};

window.StoreStatus = StoreStatus;
