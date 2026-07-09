/**
 * ORDER-MANAGEMENT.JS
 * Gerenciamento de pedidos (exclusão de itens)
 */

const OrderManagement = {
    orders: [],
    orderItems: [],

    async loadOrders() {
        try {
            if (!window.APP.auth.isSupreme()) {
                log('❌ Acesso negado', 'error');
                return;
            }

            // Carregar pedidos
            const { data: orders, error: ordersError } = await _supabase
                .from('orders')
                .select('*')
                .order('created_at', { ascending: false });

            if (ordersError) throw ordersError;

            // Carregar itens dos pedidos
            const { data: items, error: itemsError } = await _supabase
                .from('order_items')
                .select(`
                    id,
                    order_id,
                    product_id,
                    quantity,
                    unit_price,
                    unit_cost,
                    products!product_id(name, owner_id, profiles!owner_id(full_name))
                `)
                .order('created_at', { ascending: false });

            if (itemsError) throw itemsError;

            this.orders = orders || [];
            this.orderItems = items || [];
            this.renderOrders();
            log('✅ Pedidos carregados', 'success');
        } catch (err) {
            log(`❌ Erro ao carregar pedidos: ${err.message}`, 'error');
        }
    },

    renderOrders() {
        const list = document.getElementById('orders-management-list');
        if (!list) return;

        list.innerHTML = this.orders.map(order => {
            const items = this.orderItems.filter(i => i.order_id === order.id);
            const total = items.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0);

            return `
                <div class="bg-slate-900/50 p-4 rounded-2xl border border-white/5 mb-4">
                    <div class="flex justify-between mb-3">
                        <div>
                            <span class="font-bold text-white block">Pedido #${order.id.slice(0, 8).toUpperCase()}</span>
                            <span class="text-xs text-slate-500">${order.customer_name} - ${order.customer_phone}</span>
                        </div>
                        <span class="text-green-500 font-bold">R$ ${total.toFixed(2)}</span>
                    </div>
                    
                    <!-- Itens do pedido -->
                    <div class="space-y-2 mt-3 pt-3 border-t border-white/5">
                        ${items.map(item => `
                            <div class="flex justify-between items-center text-xs bg-white/5 p-2 rounded">
                                <div>
                                    <span class="text-white font-bold">${item.products?.name}</span>
                                    <span class="text-slate-500 ml-2">👤 ${item.products?.profiles?.full_name}</span>
                                    <span class="text-slate-600 ml-2">R$ ${item.unit_price.toFixed(2)}</span>
                                </div>
                                <button onclick="window.APP.orderManagement.deleteItem('${item.id}')" class="text-red-500 hover:text-red-400 font-bold">
                                    ✕ Remover
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();
    },

    async deleteItem(itemId) {
        if (!confirm('Remover este item do pedido?')) return;

        try {
            const { error } = await _supabase
                .from('order_items')
                .delete()
                .eq('id', itemId);

            if (error) throw error;

            log('✅ Item removido', 'success');
            await this.loadOrders();
        } catch (err) {
            log(`❌ Erro: ${err.message}`, 'error');
            alert('❌ Erro: ' + err.message);
        }
    }
};