/**
 * STORE-STATUS.JS v2.1
 * Sistema de Controle de Expediente + Sabbath Mode
 */

const StoreStatus = {
    status: 'open',
    lastCheck: null,
    checkInterval: null,

    /**
     * Verifica status da loja baseado na hora local
     * Horário noturno: 01:00 - 06:00
     * Sabbath: Sexta 18:00 - Sábado 18:00
     */
    checkStoreStatus() {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Dom, 1=Seg ... 5=Sex, 6=Sab
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const totalMinutes = hours * 60 + minutes;

        // REGRA 1: SABBATH MODE (Sexta 18:00 - Sábado 18:00)
        if (dayOfWeek === 5 && totalMinutes >= 18 * 60) {
            return 'sabbath_closed';
        }
        if (dayOfWeek === 6 && totalMinutes < 18 * 60) {
            return 'sabbath_closed';
        }

        // REGRA 2: FECHAMENTO NOTURNO (01:00 - 06:00)
        if (totalMinutes >= 1 * 60 && totalMinutes < 6 * 60) {
            return 'night_closed';
        }

        return 'open';
    },

    /**
     * Mensagens por status
     */
    getStatusMessage() {
        const messages = {
            night_closed: {
                emoji: '😴',
                title: 'Nossas lojas estão a descansar',
                subtitle: 'Voltamos às 06:00!',
                description: 'Nossos horários de funcionamento são de 06:00 às 01:00 todos os dias.'
            },
            sabbath_closed: {
                emoji: '🌅',
                title: 'Feliz Sábado!',
                subtitle: 'Shalom! 🕊️',
                description: 'Em observância aos princípios bíblicos, nossas operações de compra e venda estão pausadas até às 18h00 de sábado. Aproveite o dia para descanso e família.'
            },
            open: {
                emoji: '✅',
                title: 'Loja Aberta',
                subtitle: 'Bem-vindo!',
                description: 'Estamos prontos para servi-lo!'
            }
        };

        return messages[this.status] || messages.open;
    },

    /**
     * Próxima reabertura
     */
    getNextOpenTime() {
        const now = new Date();
        const dayOfWeek = now.getDay();

        if (this.status === 'sabbath_closed') {
            const nextOpen = new Date(now);
            if (dayOfWeek === 6) {
                // Sábado: reabre hoje às 18:00
                nextOpen.setHours(18, 0, 0, 0);
            } else {
                // Sexta após 18:00: reabre amanhã às 18:00
                nextOpen.setDate(nextOpen.getDate() + 1);
                nextOpen.setHours(18, 0, 0, 0);
            }
            return nextOpen.toLocaleString('pt-BR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        if (this.status === 'night_closed') {
            // Sempre reabre às 06:00 do mesmo dia (intervalo é 01:00-06:00)
            const nextOpen = new Date(now);
            nextOpen.setHours(6, 0, 0, 0);
            return nextOpen.toLocaleString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        return null;
    },

    /**
     * Inicializa o sistema
     */
    init() {
        try {
            log('🔍 Inicializando StoreStatus...', 'info');

            this.status = this.checkStoreStatus();
            this.renderOverlay();
            this.updateButtonStates();

            // Verificar a cada 1 minuto
            this.checkInterval = setInterval(() => {
                this.updateStatus();
            }, 60000);

            log('✅ StoreStatus inicializado', 'success');
        } catch (err) {
            log(`❌ Erro ao inicializar StoreStatus: ${err.message}`, 'error');
        }
    },

    /**
     * Atualiza status e re-renderiza se mudou
     */
    updateStatus() {
        const newStatus = this.checkStoreStatus();

        if (newStatus !== this.status) {
            this.status = newStatus;
            log(`📍 Status mudou para: ${this.status}`, 'info');
            this.renderOverlay();
            this.updateButtonStates();
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

        // data-mode para CSS seletores por status (sabbath vs night)
        overlay.dataset.mode = this.status;

        const message = this.getStatusMessage();
        const nextOpen = this.getNextOpenTime();

        overlay.innerHTML = `
            <div class="store-closed-container">
                <div class="store-closed-content">
                    <span class="store-closed-emoji">${message.emoji}</span>
                    <h1 class="store-closed-title">${message.title}</h1>
                    <h2 class="store-closed-subtitle">${message.subtitle}</h2>
                    <p class="store-closed-description">${message.description}</p>

                    ${nextOpen ? `
                        <div class="store-closed-timer">
                            <p class="store-closed-reopens">⏰ Reabrimos em:</p>
                            <p class="store-closed-time">${nextOpen}</p>
                        </div>
                    ` : ''}

                    <div class="store-closed-info">
                        <p>📱 Você pode continuar navegando, mas as operações de compra e venda estão desativadas.</p>
                    </div>
                </div>
            </div>
        `;

        // Força reflow antes de adicionar .active para a transição funcionar
        overlay.offsetHeight;
        overlay.classList.add('active');
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

// Expor globalmente
window.StoreStatus = StoreStatus;