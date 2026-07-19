/**
 * NOTIFICATIONS.JS v1.0
 * ✅ Aviso automático pro vendedor quando um produto dele é vendido.
 *
 * COMO FUNCIONA (importante entender a limitação):
 * - Usa Supabase Realtime pra "escutar" novos itens de pedido em tempo
 *   real, enquanto o vendedor está com o site ABERTO no navegador
 *   (aba em segundo plano também funciona, não precisa estar em foco).
 * - Quando um item de um produto dele é vendido, mostra um toast (igual
 *   ao do carrinho) + acende um selo vermelho com contador no botão BI
 *   (sidebar e bottom nav), que some quando ele entra na aba BI.
 * - LIMITAÇÃO HONESTA: isso NÃO é uma notificação push pro celular —
 *   se o vendedor fechar a aba/navegador, ele não recebe nada. Pra
 *   notificação push de verdade (com o app fechado) seria necessário um
 *   serviço pago à parte (ex: OneSignal, ou WhatsApp Business API) — dá
 *   pra evoluir pra isso depois, se fizer sentido pro volume de vendas.
 */

const Notifications = {
    channel: null,
    unseenCount: 0,

    init() {
        try {
            // Só faz sentido pra quem vende (vendedor ou admin supremo)
            if (!window.APP?.auth?.isSeller?.()) return;
            if (!window._supabase) return;

            this._subscribeRealtime();
            log('🔔 Notificações de venda ativadas', 'info');
        } catch (err) {
            log(`⚠️ Erro ao iniciar notificações: ${err.message}`, 'warning');
        }
    },

    /**
     * Escuta INSERTs na tabela order_items em tempo real. Como o filtro
     * do Realtime não alcança join com products.owner_id diretamente,
     * filtramos no navegador: cada novo item é comparado com a lista de
     * produtos do próprio vendedor (já carregada em window.APP.products).
     */
    _subscribeRealtime() {
        if (this.channel) return; // evita assinar duas vezes

        this.channel = _supabase
            .channel('vendas-em-tempo-real')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'order_items' },
                (payload) => this._handleNewItem(payload.new)
            )
            .subscribe();
    },

    _handleNewItem(item) {
        try {
            const myId = window.APP?.auth?.userId;
            const myProducts = window.APP?.products?.products || [];
            const product = myProducts.find(p => p.id === item.product_id);

            // Não é produto meu (ou sou supremo vendo tudo — supremo não
            // precisa de aviso de "própria venda" por produto de terceiro)
            if (!product || product.owner_id !== myId) return;

            this._showSaleToast(product.name, item.quantity || 1, item.unit_price || 0);
            this._bumpBadge();
        } catch (err) {
            log(`⚠️ Erro ao processar aviso de venda: ${err.message}`, 'warning');
        }
    },

    _showSaleToast(name, qty, unitPrice) {
        let container = document.getElementById('cart-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cart-toast-container';
            document.body.appendChild(container);
        }

        const total = (unitPrice || 0) * (qty || 1);
        const toast = document.createElement('div');
        toast.className = 'cart-toast sale-toast';
        toast.innerHTML = `
            <i data-lucide="party-popper" class="cart-toast-icon" style="color:#3b82f6"></i>
            <span>🎉 Venda! ${qty > 1 ? qty + 'x ' : ''}${name} — R$ ${window.formatBRL(total)}</span>
        `;
        container.appendChild(toast);

        if (window.lucide) lucide.createIcons();

        requestAnimationFrame(() => toast.classList.add('cart-toast-show'));

        setTimeout(() => {
            toast.classList.remove('cart-toast-show');
            toast.classList.add('cart-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 4500);
    },

    _bumpBadge() {
        this.unseenCount++;
        this._renderBadge();
    },

    _renderBadge() {
        ['bi-nav-btn', 'bnav-bi'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;

            let badge = btn.querySelector('.sale-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'sale-badge';
                btn.appendChild(badge);
            }

            badge.textContent = this.unseenCount > 9 ? '9+' : String(this.unseenCount);
            badge.style.display = this.unseenCount > 0 ? 'flex' : 'none';
        });
    },

    /**
     * Chamado pela Navigation quando o vendedor abre a aba BI —
     * "lê" as notificações e some com o selo vermelho.
     */
    clearUnseen() {
        this.unseenCount = 0;
        this._renderBadge();
    },

    /**
     * Chamado no logout — encerra a escuta em tempo real dessa sessão.
     */
    teardown() {
        if (this.channel) {
            _supabase.removeChannel(this.channel);
            this.channel = null;
        }
        this.unseenCount = 0;
    }
};

window.Notifications = Notifications;