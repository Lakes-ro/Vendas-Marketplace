/**
 * ORDERS.JS v4.0 - CORRIGIDO
 * ✅ sendOrderDirect() para botão onclick sem form
 * ✅ StoreStatus.canCheckout() validado antes de processar
 */

const Orders = {
    checkout() {
        if (window.APP.cart.getCount() === 0) {
            alert('❌ Seu carrinho está vazio!');
            return;
        }

        // ✅ Verificar se loja está aberta
        if (window.APP?.storeStatus?.canCheckout) {
            if (!window.APP.storeStatus.canCheckout()) return;
        }

        const modal = document.getElementById('customer-modal');
        if (modal) modal.classList.remove('hidden');
    },

    closeCustomerModal() {
        const modal = document.getElementById('customer-modal');
        if (modal) {
            modal.classList.add('hidden');
            // Limpar campos manualmente
            ['cust-name', 'cust-phone'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            const payment = document.getElementById('cust-payment');
            if (payment) payment.value = '';
        }
    },

    // ✅ Versão Direct — chamada pelo botão onclick sem form
    async sendOrderDirect() {
        const customerName = document.getElementById('cust-name')?.value?.trim();
        const customerPhone = document.getElementById('cust-phone')?.value?.trim();
        const paymentMethod = document.getElementById('cust-payment')?.value;
        const totalAmount = window.APP.cart.getTotal();
        const items = [...window.APP.cart.items];

        const btn = document.getElementById('btn-finish');
        const originalText = btn?.innerText;

        if (btn) {
            btn.disabled = true;
            btn.innerText = '⏳ PROCESSANDO...';
        }

        try {
            if (!customerName || !customerPhone) {
                throw new Error('Nome e telefone são obrigatórios');
            }

            if (items.length === 0) {
                throw new Error('Carrinho vazio');
            }

            if (!paymentMethod) {
                throw new Error('Escolha uma forma de pagamento');
            }

            log('🚀 Iniciando processamento do pedido...', 'info');

            // CRIAR PEDIDO
            const { data: orderData, error: orderError } = await _supabase
                .from('orders')
                .insert([{
                    customer_name: customerName,
                    customer_phone: customerPhone,
                    payment_method: paymentMethod,
                    total_amount: totalAmount,
                    status: 'pending'
                }])
                .select();

            if (orderError) throw orderError;
            if (!orderData || orderData.length === 0) throw new Error('Erro ao criar pedido');

            const orderId = orderData[0].id;
            log('✅ Pedido criado: ' + orderId, 'success');

            // CRIAR ITENS DO PEDIDO
            // Buscar cost_price real de cada produto para calcular lucro correto no BI
            const productIds = [...new Set(items.map(i => i.id))];
            const { data: productCosts } = await _supabase
                .from('products')
                .select('id, cost_price, stock')
                .in('id', productIds);

            const costMap = {};
            (productCosts || []).forEach(p => { costMap[p.id] = p.cost_price || 0; });

            const orderItems = items.map(item => ({
                order_id: orderId,
                product_id: item.id,
                quantity: 1,
                unit_price: item.price,
                unit_cost: costMap[item.id] || 0
            }));

            const { error: itemsError } = await _supabase
                .from('order_items')
                .insert(orderItems);

            if (itemsError) throw itemsError;

            log('✅ Itens do pedido criados', 'success');

            // DECREMENTAR ESTOQUE de cada produto vendido
            const stockUpdates = [];
            const stockMap = {};
            (productCosts || []).forEach(p => { stockMap[p.id] = p.stock || 0; });

            // Contar quantidades por produto (caso haja duplicatas no carrinho)
            const qtdMap = {};
            items.forEach(item => {
                qtdMap[item.id] = (qtdMap[item.id] || 0) + 1;
            });

            for (const [productId, qty] of Object.entries(qtdMap)) {
                const currentStock = stockMap[productId] || 0;
                const newStock = Math.max(0, currentStock - qty);
                stockUpdates.push(
                    _supabase
                        .from('products')
                        .update({ stock: newStock })
                        .eq('id', productId)
                );
            }

            await Promise.all(stockUpdates);
            log('✅ Estoque atualizado', 'success');

            // Recarregar produtos para refletir novo estoque
            if (window.APP?.products?.fetchAll) {
                setTimeout(() => window.APP.products.fetchAll(), 500);
            }

            window.APP.cart.clear();
            this.closeCustomerModal();

            await this.showReceipt({
                order_id: orderId,
                customer_name: customerName,
                customer_phone: customerPhone,
                payment_method: paymentMethod,
                total_amount: totalAmount,
                items,
                timestamp: new Date()
            });

        } catch (err) {
            log(`❌ Erro no checkout: ${err.message}`, 'error');
            alert(`❌ Erro na compra:\n${err.message}\n\nTente novamente`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = originalText;
            }
        }
    },

    // Mantido para retrocompatibilidade
    async sendOrder(event) {
        if (event) event.preventDefault();
        await this.sendOrderDirect();
    },

    async showReceipt(orderData) {
        const receiptHTML = `
            <div class="fixed inset-0 z-[5000] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md">
                <div class="bg-[#161b2c] p-8 rounded-[40px] w-full max-w-md border border-slate-800 max-h-[90vh] overflow-y-auto">

                    <div class="text-center border-b border-slate-700 pb-6 mb-6">
                        <div class="text-5xl mb-2">✅</div>
                        <h2 class="text-2xl font-black text-green-500 uppercase">Compra Realizada!</h2>
                        <p class="text-slate-400 text-xs mt-2">Pedido processado com sucesso</p>
                    </div>

                    <div class="bg-white/5 p-4 rounded-2xl mb-6 text-center border border-white/10">
                        <div class="text-xs text-slate-500 uppercase mb-1">Número do Pedido</div>
                        <div class="font-black text-white text-lg">#${orderData.order_id.slice(0, 8).toUpperCase()}</div>
                    </div>

                    <div class="mb-6">
                        <div class="text-xs text-slate-500 uppercase font-black mb-3">Dados da Compra</div>
                        <div class="space-y-2 text-sm">
                            <div class="flex justify-between">
                                <span class="text-slate-400">Cliente:</span>
                                <span class="text-white font-bold">${orderData.customer_name}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-slate-400">Telefone:</span>
                                <span class="text-white font-bold">${orderData.customer_phone}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-slate-400">Data/Hora:</span>
                                <span class="text-white font-bold">${orderData.timestamp.toLocaleString('pt-BR')}</span>
                            </div>
                        </div>
                    </div>

                    <div class="mb-6">
                        <div class="text-xs text-slate-500 uppercase font-black mb-3">Itens</div>
                        <div class="space-y-2 max-h-40 overflow-y-auto">
                            ${orderData.items.map(item => `
                                <div class="text-xs bg-white/5 p-2 rounded-lg flex justify-between">
                                    <span class="text-slate-300">${item.name}</span>
                                    <span class="text-green-500 font-bold">R$ ${item.price.toFixed(2)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="bg-gradient-to-r from-blue-900/50 to-slate-900/50 p-4 rounded-2xl mb-6 border border-blue-500/20">
                        <div class="flex justify-between items-center">
                            <span class="text-slate-300 font-bold">TOTAL</span>
                            <span class="text-3xl font-black text-blue-500">R$ ${orderData.total_amount.toFixed(2)}</span>
                        </div>
                    </div>

                    <div class="mb-6 p-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10">
                        <div class="text-xs text-slate-500 uppercase font-black mb-3">Forma de Pagamento</div>
                        ${orderData.payment_method === 'Pix' ? `
                            <div class="space-y-3">
                                <div class="text-sm text-yellow-300"><strong>💳 Pague via Pix</strong></div>
                                <div class="bg-white/10 p-3 rounded-xl text-center">
                                    <div class="text-xs text-slate-500 mb-2">Chave Pix (Copia e Cola)</div>
                                    <div class="text-white font-mono text-sm break-all font-bold">35991264352</div>
                                    <button onclick="navigator.clipboard.writeText('35991264352'); this.innerText = '✅ COPIADO!'" class="mt-2 text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-500 w-full font-bold">
                                        📋 COPIAR CHAVE
                                    </button>
                                </div>
                                <p class="text-xs text-yellow-300 mt-2">⏱️ Seu pedido será confirmado assim que recebermos o comprovante.</p>
                            </div>
                        ` : `
                            <div class="space-y-2">
                                <div class="text-sm text-green-300"><strong>💵 ${orderData.payment_method}</strong></div>
                                <p class="text-xs text-slate-400 mt-2">Você pagará quando receber o pedido.</p>
                            </div>
                        `}
                    </div>

                    <div class="space-y-3">
                        <button onclick="this.closest('.fixed').remove()" class="w-full bg-blue-600 text-white py-4 rounded-2xl font-black hover:bg-blue-500 transition-all">
                            ✓ FECHAR COMPROVANTE
                        </button>
                        <button onclick="window.print()" class="w-full bg-slate-700 text-white py-2 rounded-2xl font-bold hover:bg-slate-600 transition-all text-sm">
                            🖨️ IMPRIMIR
                        </button>
                    </div>
                </div>
            </div>
        `;

        const container = document.createElement('div');
        container.innerHTML = receiptHTML;
        document.body.appendChild(container);

        if (window.lucide) lucide.createIcons();
    }
};  