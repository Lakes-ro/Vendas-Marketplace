/**
 * RESTOCK-ALERTS.JS v1.0
 * ✅ Avisa a pessoa (com um toast, igual ao do carrinho) quando um
 *    produto que ela favoritou — e que estava esgotado — volta a ter
 *    estoque.
 *
 * COMO FUNCIONA (importante entender a limitação):
 * - Favoritos não exigem login (ficam salvos no aparelho, via
 *   Storage/localStorage) — então não existe "conta" pra mandar um
 *   push de verdade quando o app está fechado. O aviso aparece
 *   enquanto a pessoa está com o site ABERTO (aba em segundo plano
 *   também funciona).
 * - Pra cobrir quem deixa a aba aberta um tempo, o site confere de
 *   novo a cada alguns minutos sozinho, sem precisar recarregar a
 *   página.
 * - Só compara os produtos que a PRÓPRIA pessoa favoritou (lista
 *   sempre pequena), então essa conferência é leve.
 */

const RestockAlerts = {
    STATE_KEY: 'restock_watch_state', // guardado via Storage (prefixo ityrapuan_)
    _intervalId: null,

    /**
     * Busca o estoque atual de cada produto favoritado e compara com o
     * último estado conhecido. Quando um produto que estava esgotado
     * aparece com estoque > 0, mostra o toast de "voltou ao estoque".
     */
    async check() {
        try {
            if (!window._supabase || !window.Storage) return;

            const favIds = window.APP?.products?.getFavorites?.() || [];
            if (!favIds.length) return;

            const { data, error } = await _supabase
                .from('products')
                .select('id, name, stock, active')
                .in('id', favIds);

            if (error) throw error;

            const state = Storage.get(this.STATE_KEY, {}) || {};
            let changed = false;

            (data || []).forEach(p => {
                const isOutNow = !p.active || (p.stock || 0) <= 0;
                const wasOut = !!state[p.id];

                if (wasOut && !isOutNow) {
                    this._showRestockToast(p.name);
                }

                if (state[p.id] !== isOutNow) {
                    state[p.id] = isOutNow;
                    changed = true;
                }
            });

            // Limpa do estado produtos que já não estão mais favoritados
            // (evita esse objeto crescer pra sempre no localStorage).
            Object.keys(state).forEach(id => {
                if (!favIds.includes(id)) {
                    delete state[id];
                    changed = true;
                }
            });

            if (changed) Storage.set(this.STATE_KEY, state);
        } catch (err) {
            log?.(`⚠️ Erro ao checar reposição de favoritos: ${err.message}`, 'warning');
        }
    },

    _showRestockToast(productName) {
        let container = document.getElementById('cart-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cart-toast-container';
            document.body.appendChild(container);
        }

        const safeName = window.escapeHtml ? window.escapeHtml(productName) : productName;
        const toast = document.createElement('div');
        toast.className = 'cart-toast restock-toast';
        toast.style.cursor = 'pointer';
        toast.innerHTML = `
            <i data-lucide="package-check" class="cart-toast-icon" style="color:#22c55e"></i>
            <span>🎉 Voltou ao estoque: ${safeName} — um dos seus favoritos!</span>
        `;
        toast.addEventListener('click', () => {
            window.APP?.navigation?.showTab('market');
            window.APP?.products?.toggleShowFavorites?.();
        });
        container.appendChild(toast);

        // ✅ NOVO: som de notificação
        window.playNotificationSound?.('restock');

        if (window.lucide) lucide.createIcons();

        requestAnimationFrame(() => toast.classList.add('cart-toast-show'));

        setTimeout(() => {
            toast.classList.remove('cart-toast-show');
            toast.classList.add('cart-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 6000);
    },

    /**
     * Liga a checagem periódica (além da checagem imediata no boot do
     * app) — assim quem deixa a aba aberta um tempo também é avisado.
     */
    startWatching(intervalMs = 3 * 60 * 1000) {
        this.check();
        if (this._intervalId) clearInterval(this._intervalId);
        this._intervalId = setInterval(() => this.check(), intervalMs);
    }
};

window.RestockAlerts = RestockAlerts;
