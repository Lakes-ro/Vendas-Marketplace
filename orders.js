/**
 * ORDERS.JS v4.2
 * ✅ sendOrderDirect() para botão onclick sem form
 * ✅ StoreStatus.canCheckout() validado antes de processar
 * ✅ v4.1: ícone de WhatsApp compacto ao lado de cada item no comprovante,
 *    pro cliente falar com o vendedor daquele produto
 * ✅ v4.1: mensagem amigável quando o banco recusa a compra (loja fechada
 *    por horário/Sabbath, ou vendedor offline)
 * ✅ v4.2 NOVO: dentro do bloco Pix do comprovante, o cliente agora pode
 *    anexar o comprovante de pagamento (imagem/PDF, até 5MB) OU mandar
 *    via WhatsApp pro número da loja. O upload salva a URL em
 *    orders.payment_proof_url — quem confirma que o pagamento realmente
 *    caiu é sempre o Admin Supremo (na tela de BI), nunca automático.
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
            // ✅ v4.1: também busca owner_id + telefone do vendedor (profiles.phone),
            // pra poder oferecer contato direto no comprovante.
            const productIds = [...new Set(items.map(i => i.id))];
            const { data: productCosts } = await _supabase
                .from('products')
                .select('id, cost_price, stock, owner_id, profiles!owner_id(full_name, phone)')
                .in('id', productIds);

            const costMap = {};
            const vendorMap = {}; // ✅ NOVO: productId -> { name, phone }
            (productCosts || []).forEach(p => {
                costMap[p.id] = p.cost_price || 0;
                vendorMap[p.id] = {
                    name: p.profiles?.full_name || null,
                    phone: p.profiles?.phone || null
                };
            });

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

            // ✅ NOVO (v4.1): enriquece cada item com o link do WhatsApp do
            // vendedor daquele produto específico, pro comprovante mostrar
            // o ícone de contato ao lado do item (sem inflar a tela).
            const itemsWithVendor = items.map(item => {
                const vendor = vendorMap[item.id] || {};
                const waLink = window.buildWhatsAppLink ? window.buildWhatsAppLink(vendor.phone) : null;
                return { ...item, vendor_name: vendor.name, vendor_wa_link: waLink };
            });

            await this.showReceipt({
                order_id: orderId,
                customer_name: customerName,
                customer_phone: customerPhone,
                payment_method: paymentMethod,
                total_amount: totalAmount,
                items: itemsWithVendor,
                timestamp: new Date()
            });

        } catch (err) {
            log(`❌ Erro no checkout: ${err.message}`, 'error');

            // ✅ v4.1: mensagem amigável quando o banco bloqueia a compra
            // (loja fechada por Sabbath/horário noturno, ou vendedor offline)
            const isBlockedByHours = err.code === '42501' || /row-level security/i.test(err.message || '');
            if (isBlockedByHours) {
                alert('🔒 Não foi possível concluir a compra agora.\n\nA loja está fechada no momento (horário de funcionamento, Sabbath, ou o vendedor de um dos itens está temporariamente offline). Tente novamente mais tarde.');
            } else {
                alert(`❌ Erro na compra:\n${err.message}\n\nTente novamente`);
            }
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

    /**
     * ✅ NOVO (v4.2): monta o link do WhatsApp pra enviar o comprovante Pix
     * pro número central da loja (mesmo usado no fallback de "Anuncie Aqui"
     * em ads.js), já com uma mensagem pronta citando o número do pedido.
     */
    _buildProofWhatsAppLink(orderData) {
        const storeWhatsApp = '5535991264352';
        const orderCode = orderData.order_id.slice(0, 8).toUpperCase();
        const message = `Olá! Segue o comprovante do pedido #${orderCode}, no valor de R$ ${window.formatBRL(orderData.total_amount)}.`;
        return `https://wa.me/${storeWhatsApp}?text=${encodeURIComponent(message)}`;
    },

    /**
     * ✅ NOVO (v4.2): faz upload do comprovante Pix (imagem ou PDF, até 5MB)
     * pro bucket 'payment-proofs' e salva a URL pública no pedido. Isso NÃO
     * confirma o pagamento sozinho — só o Admin Supremo pode confirmar,
     * depois de conferir o comprovante (o banco garante isso via trigger).
     */
    async uploadPaymentProof(orderId, inputEl) {
        const file = inputEl?.files?.[0];
        if (!file) return;

        const statusEl = document.getElementById(`proof-status-${orderId}`);
        const zoneEl = document.getElementById(`proof-zone-${orderId}`);
        const setStatus = (text, color) => {
            if (statusEl) {
                statusEl.textContent = text;
                statusEl.className = `text-xs text-center mt-2 ${color}`;
            }
        };

        if (file.size > 5 * 1024 * 1024) {
            setStatus('❌ Arquivo maior que 5MB', 'text-red-400');
            return;
        }

        try {
            setStatus('⏳ Enviando comprovante...', 'text-slate-400');

            const fileName = `${orderId}-${Date.now()}-${file.name}`;

            const { error: uploadError } = await _supabase.storage
                .from('payment-proofs')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data: publicUrl } = _supabase.storage
                .from('payment-proofs')
                .getPublicUrl(fileName);

            const { error: updateError } = await _supabase
                .from('orders')
                .update({ payment_proof_url: publicUrl.publicUrl })
                .eq('id', orderId);

            if (updateError) throw updateError;

            setStatus('✅ Comprovante enviado! Aguarde a confirmação.', 'text-green-400');
            if (zoneEl) zoneEl.classList.add('hidden');

            log('✅ Comprovante de pagamento enviado', 'success');
        } catch (err) {
            log(`❌ Erro ao enviar comprovante: ${err.message}`, 'error');
            setStatus(`❌ Erro: ${err.message}`, 'text-red-400');
        }
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
                                <div class="text-xs bg-white/5 p-2 rounded-lg flex justify-between items-center gap-2">
                                    <span class="text-slate-300 truncate">${item.name}</span>
                                    <div class="flex items-center gap-2 flex-shrink-0">
                                        ${item.vendor_wa_link ? `
                                            <a href="${item.vendor_wa_link}" target="_blank" rel="noopener"
                                               title="Falar com ${item.vendor_name || 'o vendedor'} no WhatsApp"
                                               class="text-green-500 hover:text-green-400">
                                                <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
                                            </a>
                                        ` : ''}
                                        <span class="text-green-500 font-bold">R$ ${window.formatBRL(item.price)}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="bg-gradient-to-r from-blue-900/50 to-slate-900/50 p-4 rounded-2xl mb-6 border border-blue-500/20">
                        <div class="flex justify-between items-center">
                            <span class="text-slate-300 font-bold">TOTAL</span>
                            <span class="text-3xl font-black text-blue-500">R$ ${window.formatBRL(orderData.total_amount)}</span>
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

                                <!-- ✅ NOVO: anexar comprovante do Pix -->
                                <div>
                                    <div class="text-xs text-slate-500 uppercase font-black mb-2">Comprovante Pix</div>
                                    <div id="proof-zone-${orderData.order_id}"
                                         class="border-2 border-dashed border-slate-600 rounded-xl p-4 text-center hover:border-blue-500 transition-colors cursor-pointer"
                                         onclick="document.getElementById('proof-input-${orderData.order_id}').click()">
                                        <input type="file" id="proof-input-${orderData.order_id}"
                                               accept="image/jpeg,image/png,image/webp,application/pdf"
                                               class="hidden"
                                               onchange="window.APP.orders.uploadPaymentProof('${orderData.order_id}', this)">
                                        <div class="text-2xl mb-1">📎</div>
                                        <div class="text-xs font-bold text-slate-300">Toque para anexar o comprovante</div>
                                        <div class="text-[10px] text-slate-500 mt-1">JPG, PNG ou PDF · máx. 5MB</div>
                                    </div>
                                    <div id="proof-status-${orderData.order_id}" class="text-xs text-center mt-2"></div>

                                    <div class="flex items-center gap-2 my-2">
                                        <div class="flex-1 h-px bg-slate-700"></div>
                                        <span class="text-[10px] text-slate-500 uppercase">ou</span>
                                        <div class="flex-1 h-px bg-slate-700"></div>
                                    </div>

                                    <a href="${this._buildProofWhatsAppLink(orderData)}" target="_blank" rel="noopener"
                                       class="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-500 text-white font-black py-3 rounded-xl transition-all text-sm">
                                        <i data-lucide="message-circle" class="w-4 h-4"></i>
                                        Enviar Comprovante via WhatsApp
                                    </a>
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
