/**
 * ONBOARDING.JS v1.1
 * ✅ Tutorial passo a passo (tour guiado) — explica o que cada botão faz,
 *    pensado pra quem nunca usou o sistema não ficar perdido.
 * ✅ Mostrado sozinho na primeira visita (comprador) e assim que a
 *    pessoa vira vendedora — sempre pode ser revisto de novo pelo botão
 *    "❓" flutuante (canto inferior esquerdo).
 * ✅ Gamificação leve: um cartãozinho de "Missões" marca sozinho o que
 *    a pessoa já experimentou (favoritar, carrinho, primeira compra —
 *    ou, pro vendedor: primeiro produto, chave Pix, status da loja).
 *    Sem prêmio nenhum de verdade, é só reforço visual (❤️ psicologia
 *    de progresso) — ninguém é obrigado a completar.
 * ✅ v1.1: removido "rapidinho" do texto do passo de busca/categorias.
 */

const Onboarding = {
    BUYER_SEEN_KEY: 'onboarding_buyer_seen',
    SELLER_SEEN_KEY: 'onboarding_seller_seen',
    MISSIONS_KEY: 'onboarding_missions',
    WIDGET_DISMISS_KEY: 'onboarding_widget_dismissed',

    _steps: [],
    _stepIndex: 0,
    _seenKey: null,
    _onFinish: null,

    BUYER_STEPS: [
        {
            icon: '👋',
            title: 'Bem-vindo(a) à Ityrapuã Store!',
            text: 'Aqui você pode comprar dos vendedores da nossa comunidade, ou virar vendedor(a) e vender os seus próprios produtos. Isso aqui leva menos de 1 minuto — vamos lá?'
        },
        {
            icon: '🔍',
            title: 'Encontre o que precisa',
            text: 'Use a barra de busca no topo, ou toque numa categoria (🍎 Alimentos, 🥤 Bebidas...) pra filtrar. No celular, arraste o dedo pra ver mais categorias.'
        },
        {
            icon: '❤️',
            title: 'Favorite o que curtir',
            text: 'Toque no coração de qualquer produto pra guardar na sua lista de favoritos. Se ele esgotar, a gente te avisa assim que voltar ao estoque!'
        },
        {
            icon: '🛒',
            title: 'Adicione ao carrinho',
            text: 'Toque em "Adicionar ao Carrinho" quantas vezes quiser. O carrinho abre pelo ícone 🛒 — na barra lateral no computador, ou na barra de baixo no celular.'
        },
        {
            icon: '✅',
            title: 'Finalize sua compra',
            text: 'Dentro do carrinho, toque em "Finalizar Compra". Só precisa do seu nome e WhatsApp — não precisa criar conta pra comprar! Escolha a forma de pagamento e pronto.'
        },
        {
            icon: '💬',
            title: 'Fale direto com o vendedor',
            text: 'Ficou com dúvida sobre um produto? Toque em "Falar com o Vendedor" e converse direto pelo WhatsApp dele.'
        },
        {
            icon: '🚀',
            title: 'Quer vender também?',
            text: 'Toque em "Entrar" e crie sua conta. Depois, no seu perfil, toque em "🚀 QUERO VENDER" — você vira vendedor(a) na hora e ganha um painel completo pra cadastrar produtos e acompanhar suas vendas.'
        }
    ],

    SELLER_STEPS: [
        {
            icon: '🎉',
            title: 'Parabéns, agora você é vendedor(a)!',
            text: 'Apareceram uns botões novos no seu menu. Vamos mostrar rapidinho pra que serve cada um — menos de 1 minuto.'
        },
        {
            icon: '📦',
            title: 'ESTOQUE — seus produtos',
            text: 'É aqui que você cadastra produtos novos, edita preço, fotos e estoque. Toque em "➕ NOVO PRODUTO" pra cadastrar o primeiro.',
            cta: { label: 'Ver aba ESTOQUE', tab: 'seller' }
        },
        {
            icon: '💳',
            title: 'STATUS DA LOJA — sua Chave Pix',
            text: 'Cadastre sua chave Pix aqui — é ela que aparece pro comprador pagar direto pra você. Sem isso preenchido, a venda acontece do mesmo jeito, mas trava até vocês combinarem tudo pelo WhatsApp.',
            cta: { label: 'Ver aba STATUS DA LOJA', tab: 'vendor-settings' }
        },
        {
            icon: '🟢',
            title: 'Online / Offline',
            text: 'Na mesma tela, você liga e desliga sua loja quando quiser (ex: sem tempo de entregar agora), ou deixa no automático com um horário fixo de funcionamento.'
        },
        {
            icon: '📊',
            title: 'BI / GESTÃO — seu desempenho',
            text: 'Acompanhe faturamento, lucro, produtos mais vendidos e estoque crítico — tudo em tempo real, com filtro por período.',
            cta: { label: 'Ver aba BI / GESTÃO', tab: 'bi' }
        },
        {
            icon: '🔔',
            title: 'Fique de olho nos avisos',
            text: 'Você recebe um aviso na hora quando alguém compra um produto seu. Assim que receber o comprovante do Pix, é só confirmar o recebimento ali mesmo no BI.'
        }
    ],

    // ============================================================
    // INICIALIZAÇÃO
    // ============================================================

    init() {
        try {
            this._ensureModal();
            this._ensureHelpButton();
            this._renderMissionsWidget();

            const role = window.APP?.auth?.role || 'client';

            if (role === 'seller') {
                if (!Storage.get(this.SELLER_SEEN_KEY, false)) {
                    setTimeout(() => { if (!this._isModalOpen()) this.startSellerTour(); }, 1200);
                }
            } else if (!Storage.get(this.BUYER_SEEN_KEY, false)) {
                setTimeout(() => { if (!this._isModalOpen()) this.startBuyerTour(); }, 1200);
            }
        } catch (err) {
            log?.(`⚠️ Onboarding.init falhou: ${err.message}`, 'warning');
        }
    },

    _isModalOpen() {
        const modal = document.getElementById('onboarding-modal');
        return !!modal && !modal.classList.contains('hidden');
    },

    /**
     * Chamado de novo depois do login/logout (o papel da pessoa pode
     * ter mudado) — decide se precisa mostrar algum tour automático,
     * e sempre atualiza o cartão de missões pro papel atual.
     */
    refreshForRole() {
        this._renderMissionsWidget();

        const role = window.APP?.auth?.role || 'client';
        if (role === 'seller' && !Storage.get(this.SELLER_SEEN_KEY, false)) {
            setTimeout(() => { if (!this._isModalOpen()) this.startSellerTour(); }, 800);
        }
    },

    // ============================================================
    // TOUR — MODAL PASSO A PASSO
    // ============================================================

    startBuyerTour(force = false) {
        this._steps = this.BUYER_STEPS;
        this._seenKey = this.BUYER_SEEN_KEY;
        this._stepIndex = 0;
        this._openModal();
    },

    startSellerTour(force = false) {
        this._steps = this.SELLER_STEPS;
        this._seenKey = this.SELLER_SEEN_KEY;
        this._stepIndex = 0;
        this._openModal();
    },

    _ensureModal() {
        if (document.getElementById('onboarding-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'onboarding-modal';
        modal.className = 'hidden fixed inset-0 bg-black/80 flex items-center justify-center z-[150] backdrop-blur-sm p-4';
        modal.innerHTML = `
            <div class="bg-[#161b2c] rounded-[40px] w-full max-w-sm border border-white/10 shadow-2xl p-8 text-center">
                <div id="onboarding-icon" class="text-6xl mb-4">👋</div>
                <h3 id="onboarding-title" class="text-2xl font-black text-white mb-3 leading-tight">Título</h3>
                <p id="onboarding-text" class="text-slate-400 text-sm leading-relaxed mb-6">Texto</p>

                <div id="onboarding-cta-wrap" class="hidden mb-4">
                    <button id="onboarding-cta-btn" class="w-full bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-300 font-bold text-xs uppercase py-3 rounded-2xl transition-all"></button>
                </div>

                <div id="onboarding-dots" class="flex justify-center gap-2 mb-6"></div>

                <div class="flex gap-3">
                    <button id="onboarding-back" class="flex-1 py-3 rounded-2xl font-bold text-sm text-slate-400 hover:text-white transition-all">Voltar</button>
                    <button id="onboarding-next" class="flex-1 py-3 rounded-2xl font-black text-sm bg-blue-600 hover:bg-blue-500 text-white transition-all">Próximo</button>
                </div>
                <button id="onboarding-skip" class="mt-5 text-[11px] text-slate-500 hover:text-slate-300 font-bold uppercase tracking-wide">Pular tutorial</button>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('onboarding-back').addEventListener('click', () => this._goStep(-1));
        document.getElementById('onboarding-next').addEventListener('click', () => this._goStep(1));
        document.getElementById('onboarding-skip').addEventListener('click', () => this._closeModal(true));

        modal.addEventListener('click', (e) => {
            if (e.target === modal) this._closeModal(true);
        });
    },

    _openModal() {
        this._ensureModal();
        document.getElementById('onboarding-modal')?.classList.remove('hidden');
        this._renderStep();
    },

    _closeModal(markSeen) {
        document.getElementById('onboarding-modal')?.classList.add('hidden');
        if (markSeen && this._seenKey) {
            Storage.set(this._seenKey, true);
        }
    },

    _renderStep() {
        const step = this._steps[this._stepIndex];
        if (!step) return;

        const iconEl = document.getElementById('onboarding-icon');
        const titleEl = document.getElementById('onboarding-title');
        const textEl = document.getElementById('onboarding-text');
        const backBtn = document.getElementById('onboarding-back');
        const nextBtn = document.getElementById('onboarding-next');
        const ctaWrap = document.getElementById('onboarding-cta-wrap');
        const ctaBtn = document.getElementById('onboarding-cta-btn');
        const dots = document.getElementById('onboarding-dots');

        if (iconEl) iconEl.textContent = step.icon || '✨';
        if (titleEl) titleEl.textContent = step.title || '';
        if (textEl) textEl.textContent = step.text || '';

        if (backBtn) backBtn.style.visibility = this._stepIndex === 0 ? 'hidden' : 'visible';

        const isLast = this._stepIndex === this._steps.length - 1;
        if (nextBtn) nextBtn.textContent = isLast ? '🎉 Concluir' : 'Próximo';

        if (step.cta && ctaWrap && ctaBtn) {
            ctaWrap.classList.remove('hidden');
            ctaBtn.textContent = step.cta.label;
            ctaBtn.onclick = () => {
                window.APP?.navigation?.showTab(step.cta.tab);
                this._closeModal(false);
            };
        } else if (ctaWrap) {
            ctaWrap.classList.add('hidden');
        }

        if (dots) {
            dots.innerHTML = this._steps.map((_, i) => `
                <span class="onboarding-dot ${i === this._stepIndex ? 'onboarding-dot-active' : ''}"></span>
            `).join('');
        }
    },

    _goStep(direction) {
        const isLast = this._stepIndex === this._steps.length - 1;

        if (direction > 0 && isLast) {
            this._closeModal(true);
            this._renderMissionsWidget();
            return;
        }

        this._stepIndex = Math.max(0, Math.min(this._steps.length - 1, this._stepIndex + direction));
        this._renderStep();
    },

    // ============================================================
    // BOTÃO FLUTUANTE "❓ COMO FUNCIONA" — reabre o tour a qualquer hora
    // ============================================================

    _ensureHelpButton() {
        if (document.getElementById('onboarding-help-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'onboarding-help-btn';
        btn.className = 'onboarding-help-btn';
        btn.setAttribute('aria-label', 'Como funciona o sistema');
        btn.title = 'Rever o tutorial';
        btn.innerHTML = '❓';
        document.body.appendChild(btn);

        btn.addEventListener('click', () => {
            const role = window.APP?.auth?.role || 'client';
            if (role === 'seller') this.startSellerTour();
            else this.startBuyerTour();
        });
    },

    // ============================================================
    // MISSÕES (GAMIFICAÇÃO LEVE)
    // ============================================================

    _getMissionsState() {
        return Storage.get(this.MISSIONS_KEY, { buyer: {}, seller: {} }) || { buyer: {}, seller: {} };
    },

    /**
     * Chamado pelos outros módulos (cart.js, products.js, orders.js,
     * vendor-settings.js) quando a pessoa faz algo que conta como
     * "missão" — nunca trava nada, é só reforço visual.
     */
    markMission(id) {
        try {
            const role = window.APP?.auth?.role === 'seller' ? 'seller' : 'buyer';
            const state = this._getMissionsState();
            if (!state[role]) state[role] = {};
            if (state[role][id]) return; // já estava marcada

            state[role][id] = true;
            Storage.set(this.MISSIONS_KEY, state);
            this._renderMissionsWidget();
        } catch (err) {
            log?.(`⚠️ Onboarding.markMission falhou: ${err.message}`, 'warning');
        }
    },

    _missionList(role) {
        return role === 'seller'
            ? [
                { id: 'product', label: '📦 Cadastrar seu primeiro produto' },
                { id: 'pix', label: '💳 Cadastrar sua chave Pix' },
                { id: 'status', label: '🟢 Configurar o status da loja' }
            ]
            : [
                { id: 'fav', label: '❤️ Favoritar um produto' },
                { id: 'cart', label: '🛒 Adicionar algo ao carrinho' },
                { id: 'purchase', label: '✅ Finalizar sua primeira compra' }
            ];
    },

    _renderMissionsWidget() {
        try {
            const role = window.APP?.auth?.role === 'seller' ? 'seller' : 'buyer';
            const dismissKey = `${this.WIDGET_DISMISS_KEY}_${role}`;

            let widget = document.getElementById('onboarding-missions-widget');

            if (Storage.get(dismissKey, false)) {
                if (widget) widget.remove();
                return;
            }

            const state = this._getMissionsState()[role] || {};
            const missions = this._missionList(role);
            const doneCount = missions.filter(m => state[m.id]).length;
            const allDone = doneCount === missions.length;

            if (!widget) {
                widget = document.createElement('div');
                widget.id = 'onboarding-missions-widget';
                widget.className = 'onboarding-missions-widget';
                document.body.appendChild(widget);
            }

            widget.innerHTML = `
                <button class="onboarding-missions-header" type="button">
                    <span>🎯 Missões (${doneCount}/${missions.length})</span>
                    <span class="onboarding-missions-close" title="Esconder">✕</span>
                </button>
                <div class="onboarding-missions-body ${allDone ? '' : 'hidden'}">
                    ${allDone
                        ? `<div class="onboarding-missions-done">🎉 Você já experimentou tudo! Mandou bem.</div>`
                        : missions.map(m => `
                            <div class="onboarding-mission-item ${state[m.id] ? 'is-done' : ''}">
                                <span class="onboarding-mission-check">${state[m.id] ? '✅' : '⬜'}</span>
                                <span>${m.label}</span>
                            </div>
                        `).join('')
                    }
                </div>
            `;

            const header = widget.querySelector('.onboarding-missions-header');
            const body = widget.querySelector('.onboarding-missions-body');
            const closeBtn = widget.querySelector('.onboarding-missions-close');

            header?.addEventListener('click', (e) => {
                if (e.target === closeBtn) return;
                body?.classList.toggle('hidden');
            });

            closeBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                Storage.set(dismissKey, true);
                widget.remove();
            });
        } catch (err) {
            log?.(`⚠️ Erro ao renderizar missões: ${err.message}`, 'warning');
        }
    }
};

window.Onboarding = Onboarding;
