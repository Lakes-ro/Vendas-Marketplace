/**
 * ORDER-MANAGEMENT.JS v1.1
 * Gerenciamento de pedidos (remover itens) — só Admin Supremo.
 * v1.1 (auditoria): textos escapados (XSS), erro do banco checado de
 * verdade, busca de itens sem depender de coluna inexistente.
 */

const OrderManagement = {
    orders: [],

    async loadOrders() {
        if (!window.APP?.auth?.isSupreme()) return;
        try {
            const { data, error } = await _supabase
                .from('orders')
                .select(`
                    id, customer_name, customer_phone, created_at,
                    order_items ( id, product_id, quantity, unit_price, unit_cost,
                        products!product_id ( name, profiles!owner_id ( full_name ) ) )`)
                .order('created_at', { ascending: false })
                .limit(200);
            if (error) throw error;
            this.orders = data || [];
            this.renderOrders();
        } catch (err) {
            log(`❌ Erro ao carregar pedidos: ${err.message}`, 'error');
        }
    },

    renderOrders() {
        const list = document.getElementById('orders-management-list');
        if (!list) return;

        if (!this.orders.length) {
            list.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhum pedido</div>';
            return;
        }

        list.innerHTML = this.orders.map(order => {
            const items = order.order_items || [];
            const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 1), 0);
            return `
                <div class="bg-slate-900/50 p-4 rounded-2xl border border-white/5 mb-4">
                    <div class="flex justify-between mb-3 gap-3">
                        <div class="min-w-0">
                            <span class="font-bold text-white block">Pedido #${escapeHtml(String(order.id).slice(0, 8).toUpperCase())}</span>
                            <span class="text-xs text-slate-500">${escapeHtml(order.customer_name)} - ${escapeHtml(order.customer_phone)}</span>
                        </div>
                        <span class="text-green-500 font-bold flex-shrink-0">R$ ${formatBRL(total)}</span>
                    </div>
                    <div class="space-y-2 mt-3 pt-3 border-t border-white/5">
                        ${items.map(item => `
                            <div class="flex justify-between items-center text-xs bg-white/5 p-2 rounded gap-2">
                                <div class="min-w-0">
                                    <span class="text-white font-bold">${Number(item.quantity) || 1}x ${escapeHtml(item.products?.name || 'Produto removido')}</span>
                                    <span class="text-slate-500 ml-2">👤 ${escapeHtml(item.products?.profiles?.full_name || '—')}</span>
                                    <span class="text-slate-600 ml-2">R$ ${formatBRL(item.unit_price)}</span>
                                </div>
                                <button onclick="window.APP.orderManagement.deleteItem('${escapeHtml(item.id)}')" class="text-red-500 hover:text-red-400 font-bold flex-shrink-0">✕ Remover</button>
                            </div>`).join('')}
                    </div>
                </div>`;
        }).join('');
    },

    async deleteItem(itemId) {
        if (!confirm('Remover este item do pedido?')) return;
        try {
            const { data, error } = await _supabase.from('order_items').delete().eq('id', itemId).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('O banco recusou a exclusão');
            await this.loadOrders();
        } catch (err) {
            alert('❌ Erro: ' + err.message);
        }
    }
};
