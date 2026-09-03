/**
 * ORDERS.JS v5.0
 * ✅ sendOrderDirect() para botão onclick sem form
 * ✅ StoreStatus.canCheckout() validado antes de processar
 * ✅ v4.1: ícone de WhatsApp compacto ao lado de cada item no comprovante,
 *    pro cliente falar com o vendedor daquele produto
 * ✅ v4.1: mensagem amigável quando o banco recusa a compra (loja fechada
 *    por horário/Sabbath, ou vendedor offline)
 * ✅ v4.2: upload de comprovante Pix (imagem/PDF) OU envio via WhatsApp
 *    — quem confirma o pagamento é o Admin Supremo, no BI.
 * ✅ v5.0 NOVO — PIX POR VENDEDOR: antes, todo pagamento Pix ia pra UMA
 *    chave única da loja e só o Admin Supremo confirmava. Agora, cada
 *    vendedor tem sua PRÓPRIA chave Pix (cadastrada no perfil dele) e
 *    confirma o próprio pagamento. Se o carrinho tiver produtos de mais
 *    de um vendedor, o comprovante mostra UM BLOCO DE PAGAMENTO PIX
 *    SEPARADO por vendedor — cada um com a chave, o valor daquela
 *    parte, o upload de comprovante e o link de WhatsApp direto pro
 *    vendedor dono daquele produto.
 *    Importante: create_order() NÃO foi alterada (continua validando
 *    loja aberta/estoque/preço exatamente como antes). A separação por
 *    vendedor acontece em cima do pedido já criado, usando a função
 *    register_order_vendor_payments() (recalcula os valores direto de
 *    order_items/products no banco — nunca confia em número vindo do
 *    navegador) e attach_vendor_payment_proof()/confirm_vendor_payment()
 *    (nova migração — ver migracao_pix_por_vendedor.sql).
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

    /**
     * ✅ NOVO (v5.0): busca owner_id + nome/telefone/chave Pix do
     * vendedor de cada produto do carrinho, numa única consulta —
     * mesma consulta pública que a vitrine já usa (products.js), então
     * não depende de nenhuma mudança em create_order() nem exige o
     * comprador estar logado.
     */
    async _buildVendorMapForCart(productIds) {
        const map = {};
        if (!productIds.length) return map;

        try {
            const { data, error } = await _supabase
                .from('products')
                .select('id, owner_id, profiles!owner_id(full_name, phone, pix_key)')
                .in('id', productIds);

            if (error) throw error;

            (data || []).forEach(p => {
                map[p.id] = {
                    ownerId: p.owner_id,
                    vendorName: p.profiles?.full_name || 'Vendedor',
                    vendorPhone: p.profiles?.phone || null,
                    pixKey: p.profiles?.pix_key || null
                };
            });
        } catch (err) {
            log(`⚠️ Não foi possível identificar os vendedores do carrinho: ${err.message}`, 'warning');
        }

        return map;
    },

    /**
     * ✅ NOVO (v5.0): agrupa os itens do carrinho por vendedor (owner_id),
     * usando o mapa buscado em _buildVendorMapForCart(). Cada grupo vira
     * um bloco de pagamento Pix próprio no comprovante.
     * ⚠️ O subtotal aqui é calculado com o preço que estava no carrinho
     * no momento da compra — é só o valor MOSTRADO pro comprador/vendedor
     * se organizarem. O valor que realmente conta pra confirmação de
     * pagamento é recalculado no banco (register_order_vendor_payments),
     * direto de order_items, então nunca depende desse número do navegador.
     */
    _groupCartByVendor(cartItems, vendorMap) {
        const groups = {};

        cartItems.forEach(item => {
            const info = vendorMap[item.id] || {};
            const vendorId = info.ownerId || 'desconhecido';

            if (!groups[vendorId]) {
                groups[vendorId] = {
                    vendorId,
                    vendorName: info.vendorName || 'Vendedor',
                    vendorPhone: info.vendorPhone || null,
                    pixKey: info.pixKey || null,
                    subtotal: 0,
                    itemNames: []
                };
            }

            groups[vendorId].subtotal += Number(item.price) || 0;
            groups[vendorId].itemNames.push(item.name);
        });

        return Object.values(groups);
    },

    // ✅ v5.0 FIX CRÍTICO (mantido de versões anteriores): checkout
    // continua indo 100% pela função create_order() (RPC SECURITY
    // DEFINER: valida loja aberta, vendedor online, estoque, e calcula
    // o preço a partir do produto real — não confia no preço que vem do
    // carrinho). Essa função NÃO foi tocada nesta versão.
    async sendOrderDirect() {
        const customerName = document.getElementById('cust-name')?.value?.trim();
        const customerPhone = document.getElementById('cust-phone')?.value?.trim();
        const paymentMethod = document.getElementById('cust-payment')?.value;
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

            // ✅ NOVO (v5.0): identifica o(s) vendedor(es) do carrinho ANTES
            // de criar o pedido — assim já temos as chaves Pix prontas pra
            // montar o comprovante assim que a compra for confirmada.
            const productIds = [...new Set(items.map(i => i.id))];
            const vendorMap = await this._buildVendorMapForCart(productIds);
            const vendorGroups = this._groupCartByVendor(items, vendorMap);

            // Agrupa quantidades por produto (cada unidade adicionada ao
            // carrinho vira uma entrada própria em Cart.items).
            const qtyMap = {};
            items.forEach(item => { qtyMap[item.id] = (qtyMap[item.id] || 0) + 1; });

            const p_items = Object.entries(qtyMap).map(([product_id, quantity]) => ({
                product_id, quantity
            }));

            const { data: result, error: rpcError } = await _supabase.rpc('create_order', {
                p_customer_name: customerName,
                p_customer_phone: customerPhone,
                p_payment_method: paymentMethod,
                p_items: p_items
            });

            if (rpcError) throw rpcError;

            const orderId = result.order_id;
            const totalAmount = result.total_amount;
            log('✅ Pedido criado: ' + orderId, 'success');

            // ✅ NOVO (v5.0): cria a "fatia" de cada vendedor pra esse
            // pedido (idempotente — se já existir, não duplica). Isso
            // recalcula os valores direto de order_items/products no
            // banco, então é sempre confiável mesmo que o preço mostrado
            // no carrinho já não bata mais exatamente. Se a migração
            // ainda não tiver sido aplicada no banco, isso falha
            // silenciosamente (com aviso no console) — a compra em si
            // já foi concluída com sucesso de qualquer forma.
            try {
                await _supabase.rpc('register_order_vendor_payments', { p_order_id: orderId });
            } catch (splitErr) {
                log(`⚠️ Não foi possível separar o pagamento por vendedor: ${splitErr.message}`, 'warning');
            }

            // Recarregar produtos para refletir o novo estoque (a baixa já
            // foi feita dentro da própria função, com trava de linha —
            // sem risco de duas compras simultâneas venderem o mesmo
            // último item).
            if (window.APP?.products?.fetchAll) {
                setTimeout(() => window.APP.products.fetchAll(), 500);
            }

            window.APP.cart.clear();
            this.closeCustomerModal();

            // ✅ NOVO: missão de onboarding
            window.APP?.onboarding?.markMission?.('purchase');

            // A própria função já devolve nome/telefone do vendedor de
            // cada item — só falta montar o link do WhatsApp.
            const itemsWithVendor = (result.items || []).map(i => ({
                name: i.name,
                price: i.price,
                quantity: i.quantity,
                vendor_name: i.vendor_name,
                vendor_wa_link: window.buildWhatsAppLink ? window.buildWhatsAppLink(i.vendor_phone) : null
            }));

            await this.showReceipt({
                order_id: orderId,
                customer_name: customerName,
                customer_phone: customerPhone,
                payment_method: paymentMethod,
                total_amount: totalAmount,
                items: itemsWithVendor,
                vendor_groups: vendorGroups,
                timestamp: new Date()
            });

        } catch (err) {
            log(`❌ Erro no checkout: ${err.message}`, 'error');

            // ✅ create_order() sinaliza problemas de negócio com mensagens
            // específicas (RAISE EXCEPTION) — traduz pra algo amigável.
            const friendlyMessages = {
                store_closed: '🔒 A loja está fechada no momento (horário de funcionamento, Sabbath, ou fechamento manual). Tente novamente mais tarde.',
                empty_cart: '❌ Seu carrinho está vazio.',
                product_not_found: '❌ Um dos produtos do carrinho não está mais disponível. Atualize a página e tente de novo.',
                vendor_banned: '❌ Um dos vendedores deste pedido está indisponível no momento.',
                vendor_offline: '🔌 Um dos vendedores deste pedido está temporariamente offline. Tente novamente mais tarde.'
            };
            const msgKey = Object.keys(friendlyMessages).find(k => (err.message || '').includes(k));
            alert(msgKey ? friendlyMessages[msgKey] : `❌ Erro na compra:\n${err.message}\n\nTente novamente`);
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
     * ✅ v5.0: link de WhatsApp pra enviar o comprovante Pix direto pro
     * VENDEDOR daquele grupo (antes ia sempre pro número fixo da loja).
     * Se o vendedor não tiver telefone cadastrado, retorna null e o
     * botão correspondente simplesmente não aparece.
     */
    _buildVendorProofWhatsAppLink(orderData, group) {
        if (!group.vendorPhone) return null;
        const link = window.buildWhatsAppLink ? window.buildWhatsAppLink(group.vendorPhone) : null;
        if (!link) return null;
        const orderCode = orderData.order_id.slice(0, 8).toUpperCase();
        const message = `Olá! Segue o comprovante do pedido #${orderCode}, no valor de R$ ${window.formatBRL(group.subtotal)}.`;
        return `${link}?text=${encodeURIComponent(message)}`;
    },

    /**
     * ✅ NOVO (v5.0): upload do comprovante Pix da fatia de UM vendedor
     * específico dentro do pedido. Usa attach_vendor_payment_proof()
     * (RPC, confere o telefone do pedido antes de aceitar — igual a
     * attach_payment_proof() fazia antes, só que agora por vendedor).
     */
    async uploadVendorPaymentProof(orderId, vendorId, inputEl, customerPhone) {
        const file = inputEl?.files?.[0];
        if (!file) return;

        const zoneKey = `${orderId}-${vendorId}`;
        const statusEl = document.getElementById(`proof-status-${zoneKey}`);
        const zoneEl = document.getElementById(`proof-zone-${zoneKey}`);
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

            const fileName = `${orderId}-${vendorId}-${Date.now()}-${file.name}`;

            const { error: uploadError } = await _supabase.storage
                .from('payment-proofs')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data: publicUrl } = _supabase.storage
                .from('payment-proofs')
                .getPublicUrl(fileName);

            const { error: attachError } = await _supabase.rpc('attach_vendor_payment_proof', {
                p_order_id: orderId,
                p_vendor_id: vendorId,
                p_proof_path: publicUrl.publicUrl,
                p_customer_phone: customerPhone
            });

            if (attachError) throw attachError;

            setStatus('✅ Comprovante enviado! Aguarde a confirmação do vendedor.', 'text-green-400');
            if (zoneEl) zoneEl.classList.add('hidden');

            log('✅ Comprovante de pagamento enviado (por vendedor)', 'success');
        } catch (err) {
            log(`❌ Erro ao enviar comprovante: ${err.message}`, 'error');
            setStatus(`❌ Erro: ${err.message}`, 'text-red-400');
        }
    },

    /**
     * ✅ v5.0: monta UM bloco de pagamento Pix por vendedor (chave, valor
     * daquela fatia, upload de comprovante próprio e link de WhatsApp
     * direto pro vendedor). Se o vendedor ainda não tiver cadastrado a
     * própria chave Pix, mostra um aviso no lugar da chave, mas continua
     * permitindo falar com ele por WhatsApp.
     */
    _renderVendorPixBlock(orderData, group) {
        const esc = window.escapeHtml || ((s) => s);
        const zoneKey = `${orderData.order_id}-${group.vendorId}`;
        const safeVendorName = esc(group.vendorName);
        const waLink = this._buildVendorProofWhatsAppLink(orderData, group);

        const pixKeyBlock = group.pixKey ? `
            <div class="bg-white/10 p-3 rounded-xl text-center">
                <div class="text-xs text-slate-500 mb-2">Chave Pix de ${safeVendorName}</div>
                <div class="text-white font-mono text-sm break-all font-bold">${esc(group.pixKey)}</div>
                <button onclick="navigator.clipboard.writeText('${esc(group.pixKey).replace(/'/g, "\\'")}'); this.innerText = '✅ COPIADO!'" class="no-print mt-2 text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-500 w-full font-bold">
                    📋 COPIAR CHAVE
                </button>
            </div>
        ` : `
            <div class="bg-red-900/20 border border-red-500/30 p-3 rounded-xl text-center">
                <div class="text-xs text-red-300 leading-relaxed">
                    ⚠️ ${safeVendorName} ainda não cadastrou uma chave Pix.<br>Combine o pagamento direto pelo WhatsApp abaixo.
                </div>
            </div>
        `;

        return `
            <div class="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-sm font-black text-white">👤 ${safeVendorName}</span>
                    <span class="text-sm font-black text-green-400">R$ ${window.formatBRL(group.subtotal)}</span>
                </div>
                <div class="text-[11px] text-slate-500">${esc(group.itemNames.join(', '))}</div>

                ${pixKeyBlock}

                <div class="no-print">
                    <div id="proof-zone-${zoneKey}"
                         class="border-2 border-dashed border-slate-600 rounded-xl p-4 text-center hover:border-blue-500 transition-colors cursor-pointer"
                         onclick="document.getElementById('proof-input-${zoneKey}').click()">
                        <input type="file" id="proof-input-${zoneKey}"
                               accept="image/jpeg,image/png,image/webp,application/pdf"
                               class="hidden"
                               onchange="window.APP.orders.uploadVendorPaymentProof('${orderData.order_id}', '${group.vendorId}', this, '${esc(orderData.customer_phone).replace(/'/g, "\\'")}')">
                        <div class="text-2xl mb-1">📎</div>
                        <div class="text-xs font-bold text-slate-300">Toque para anexar o comprovante</div>
                        <div class="text-[10px] text-slate-500 mt-1">JPG, PNG ou PDF · máx. 5MB</div>
                    </div>
                    <div id="proof-status-${zoneKey}" class="text-xs text-center mt-2"></div>

                    ${waLink ? `
                        <div class="flex items-center gap-2 my-2">
                            <div class="flex-1 h-px bg-slate-700"></div>
                            <span class="text-[10px] text-slate-500 uppercase">ou</span>
                            <div class="flex-1 h-px bg-slate-700"></div>
                        </div>
                        <a href="${waLink}" target="_blank" rel="noopener"
                           class="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-500 text-white font-black py-3 rounded-xl transition-all text-sm">
                            <i data-lucide="message-circle" class="w-4 h-4"></i>
                            Enviar Comprovante via WhatsApp
                        </a>
                    ` : ''}
                </div>
            </div>
        `;
    },

    async showReceipt(orderData) {
        // ✅ FIX SEGURANÇA: o comprovante roda no navegador do PRÓPRIO
        // COMPRADOR — se o nome do produto (definido pelo vendedor) ou os
        // dados do cliente fossem inseridos sem escapeHtml(), um vendedor
        // mal-intencionado conseguiria rodar código no navegador de quem
        // compra dele. Escapando aqui.
        const esc = window.escapeHtml || ((s) => s);
        const safeCustomerName = esc(orderData.customer_name);
        const safeCustomerPhone = esc(orderData.customer_phone);

        // ✅ NOVO (v5.0): um bloco de pagamento Pix por vendedor, em vez
        // de uma chave única da loja inteira.
        const vendorGroups = orderData.vendor_groups || [];
        const pixBlocksHtml = vendorGroups.map(g => this._renderVendorPixBlock(orderData, g)).join('');

        const receiptHTML = `
            <div class="fixed inset-0 z-[5000] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md">
                <div id="receipt-print-area" class="print-area bg-[#161b2c] p-8 rounded-[40px] w-full max-w-md border border-slate-800 max-h-[90vh] overflow-y-auto">

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
                                <span class="text-white font-bold">${safeCustomerName}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-slate-400">Telefone:</span>
                                <span class="text-white font-bold">${safeCustomerPhone}</span>
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
                                    <span class="text-slate-300 truncate">${esc(item.name)}</span>
                                    <div class="flex items-center gap-2 flex-shrink-0">
                                        ${item.vendor_wa_link ? `
                                            <a href="${item.vendor_wa_link}" target="_blank" rel="noopener"
                                               title="Falar com ${esc(item.vendor_name || 'o vendedor')} no WhatsApp"
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
                                ${vendorGroups.length > 1 ? `
                                    <p class="text-xs text-slate-400">
                                        Esse pedido tem produtos de <strong class="text-white">${vendorGroups.length} vendedores diferentes</strong> —
                                        pague cada um na própria chave Pix abaixo.
                                    </p>
                                ` : ''}

                                <div class="space-y-3">
                                    ${pixBlocksHtml}
                                </div>

                                <p class="text-xs text-yellow-300 mt-2">⏱️ Seu pedido será confirmado assim que o(s) vendedor(es) receber(em) o comprovante.</p>
                            </div>
                        ` : `
                            <div class="space-y-2">
                                <div class="text-sm text-green-300"><strong>💵 ${orderData.payment_method}</strong></div>
                                <p class="text-xs text-slate-400 mt-2">Você pagará quando receber o pedido.</p>
                            </div>
                        `}
                    </div>

                    <div class="space-y-3 no-print">
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
