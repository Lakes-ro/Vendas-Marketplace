/**
 * ORDERS.JS v4.7
 * v4.7: comprovante salvo no aparelho — reabre sozinho se a pessoa sair
 *    pra pagar no banco e a página recarregar; "📄 Meus pedidos" no
 *    carrinho; impressão própria em 1 folha (antes saía em branco).
 * v4.6: comprovante redesenhado — celebração no topo, total em destaque,
 *    prazo do Pix, "próximos passos" numerados, um cartão por vendedor
 *    com UMA ação principal, detalhes recolhidos e "Continuar comprando".
 * v4.5 (auditoria):
 *  - Pix POR VENDEDOR no comprovante (vendor_pix_keys → profiles.pix_key),
 *    no lugar da chave fixa única da loja
 *  - registra o valor de cada vendedor (register_order_vendor_payments)
 *  - comprovante enviado por vendedor (attach_vendor_payment_proof), com
 *    o telefone do comprador — antes a chamada faltava p_customer_phone e
 *    sempre falhava
 *  - tudo que vem do comprador/vendedor é escapado (XSS)
 *  - mensagens de erro para estoque insuficiente e vendedor banido
 */

const Orders = {
    _lastOrder: null,

    checkout() {
        if (window.APP.cart.getCount() === 0) { alert('❌ Seu carrinho está vazio!'); return; }
        if (window.APP?.storeStatus?.canCheckout && !window.APP.storeStatus.canCheckout()) return;

        // Pré-preenche com os dados do perfil, se logado
        const profile = window.APP?.auth?.profile;
        const nameEl = document.getElementById('cust-name');
        const phoneEl = document.getElementById('cust-phone');
        if (profile && nameEl && !nameEl.value) nameEl.value = profile.full_name || '';
        if (profile && phoneEl && !phoneEl.value) phoneEl.value = profile.phone || '';

        document.getElementById('customer-modal')?.classList.remove('hidden');
    },

    closeCustomerModal() {
        const modal = document.getElementById('customer-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        ['cust-name', 'cust-phone', 'cust-payment'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    },

    _friendlyError(err) {
        const msg = (err?.message || '').toLowerCase();
        if (msg.includes('store_closed')) return '🔒 A loja está fechada no momento (horário de funcionamento ou Sabbath). Tente mais tarde.';
        if (msg.includes('vendor_offline')) return '🔌 O vendedor de um dos itens está offline agora. Remova o item ou tente mais tarde.';
        if (msg.includes('vendor_banned') || msg.includes('product_not_found')) return '❌ Um dos produtos do carrinho não está mais disponível. Remova-o e tente de novo.';
        if (msg.includes('insufficient_stock')) {
            const left = (err.message.split(':')[2] || '').trim();
            return `❌ Um dos produtos não tem estoque suficiente${left ? ` (restam ${left})` : ''}. Ajuste o carrinho e tente de novo.`;
        }
        if (msg.includes('empty_cart')) return '❌ Seu carrinho está vazio.';
        return `❌ Erro na compra:\n${err?.message || 'desconhecido'}\n\nTente novamente.`;
    },

    async sendOrderDirect() {
        const customerName = document.getElementById('cust-name')?.value?.trim();
        const customerPhone = document.getElementById('cust-phone')?.value?.trim();
        const paymentMethod = document.getElementById('cust-payment')?.value;
        const items = [...window.APP.cart.items];

        const btn = document.getElementById('btn-finish');
        const originalText = btn?.innerText;
        if (btn) { btn.disabled = true; btn.innerText = '⏳ PROCESSANDO...'; }

        try {
            if (!customerName || !customerPhone) throw new Error('Nome e telefone são obrigatórios');
            if (customerPhone.replace(/\D/g, '').length < 10) throw new Error('Informe o WhatsApp com DDD');
            if (!items.length) throw new Error('empty_cart');
            if (!paymentMethod) throw new Error('Escolha uma forma de pagamento');

            const qtdMap = {};
            items.forEach(i => { qtdMap[i.id] = (qtdMap[i.id] || 0) + 1; });
            const rpcItems = Object.entries(qtdMap).map(([product_id, quantity]) => ({ product_id, quantity }));

            const { data: result, error } = await _supabase.rpc('create_order', {
                p_customer_name: customerName.slice(0, 120),
                p_customer_phone: customerPhone.slice(0, 30),
                p_payment_method: paymentMethod,
                p_items: rpcItems
            });
            if (error) throw error;
            if (!result?.order_id) throw new Error('Erro ao criar pedido');

            // Separa o valor de cada vendedor (não bloqueia a compra se falhar)
            try { await _supabase.rpc('register_order_vendor_payments', { p_order_id: result.order_id }); }
            catch (e) { log(`⚠️ register_order_vendor_payments: ${e.message}`, 'warning'); }

            window.APP.cart.clear();
            this.closeCustomerModal();
            window.APP.cart.closeCart?.();
            setTimeout(() => window.APP?.products?.fetchStorefront?.(), 500);

            window.APP?.onboarding?.markMission?.('purchase');

            const vendors = await this._buildVendorGroups(result.items || []);

            const receipt = {
                order_id: result.order_id,
                customer_name: customerName,
                customer_phone: customerPhone,
                payment_method: paymentMethod,
                total_amount: result.total_amount,
                vendors,
                timestamp: new Date()
            };
            this._saveReceipt(receipt);
            await this.showReceipt(receipt);
        } catch (err) {
            log(`❌ Erro no checkout: ${err.message}`, 'error');
            alert(this._friendlyError(err));
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
        }
    },

    async sendOrder(event) {
        event?.preventDefault?.();
        await this.sendOrderDirect();
    },

    /**
     * Agrupa os itens do pedido por vendedor e busca as chaves Pix de cada um.
     */
    async _buildVendorGroups(items) {
        const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];
        const ownerByProduct = {};
        const profileByOwner = {};

        if (productIds.length) {
            try {
                const { data } = await _supabase
                    .from('products')
                    .select('id, owner_id, profiles!owner_id(full_name, phone, pix_key)')
                    .in('id', productIds);
                (data || []).forEach(p => {
                    ownerByProduct[p.id] = p.owner_id;
                    if (p.owner_id) profileByOwner[p.owner_id] = p.profiles || {};
                });
            } catch (e) { log(`⚠️ Dono dos produtos: ${e.message}`, 'warning'); }
        }

        const ownerIds = [...new Set(Object.values(ownerByProduct).filter(Boolean))];
        const keysByOwner = {};
        if (ownerIds.length) {
            try {
                const { data } = await _supabase
                    .from('vendor_pix_keys')
                    .select('owner_id, label, pix_key, created_at')
                    .in('owner_id', ownerIds)
                    .order('created_at', { ascending: true });
                (data || []).forEach(k => { (keysByOwner[k.owner_id] = keysByOwner[k.owner_id] || []).push(k); });
            } catch (e) { log(`⚠️ Chaves Pix: ${e.message}`, 'warning'); }
        }

        const groups = {};
        items.forEach(item => {
            const ownerId = ownerByProduct[item.product_id] || 'desconhecido';
            if (!groups[ownerId]) {
                const prof = profileByOwner[ownerId] || {};
                let keys = keysByOwner[ownerId] || [];
                if (!keys.length && prof.pix_key) keys = [{ label: 'Pix', pix_key: prof.pix_key }];
                groups[ownerId] = {
                    vendor_id: ownerId,
                    vendor_name: item.vendor_name || prof.full_name || 'Vendedor',
                    vendor_phone: item.vendor_phone || prof.phone || null,
                    pix_keys: keys,
                    items: [],
                    subtotal: 0
                };
            }
            const qty = Number(item.quantity) || 1;
            const line = (Number(item.price) || 0) * qty;
            groups[ownerId].items.push({ name: item.name, quantity: qty, total: line });
            groups[ownerId].subtotal += line;
        });

        return Object.values(groups);
    },

    copyPix(btn) {
        const key = btn?.dataset?.pix || '';
        const done = () => { btn.innerText = '✅ COPIADO!'; setTimeout(() => { btn.innerText = '📋 COPIAR CHAVE'; }, 2000); };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(key).then(done).catch(() => prompt('Copie a chave Pix:', key));
        } else {
            prompt('Copie a chave Pix:', key);
        }
    },

    async uploadPaymentProof(orderId, vendorId, inputEl) {
        const file = inputEl?.files?.[0];
        if (!file) return;

        const statusEl = document.getElementById(`proof-status-${vendorId}`);
        const zoneEl = document.getElementById(`proof-zone-${vendorId}`);
        const setStatus = (text, color) => {
            if (statusEl) { statusEl.textContent = text; statusEl.className = `text-xs text-center mt-2 ${color}`; }
        };

        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (!allowed.includes(file.type)) { setStatus('❌ Envie JPG, PNG, WEBP ou PDF', 'text-red-400'); return; }
        if (file.size > 5 * 1024 * 1024) { setStatus('❌ Arquivo maior que 5MB', 'text-red-400'); return; }

        const phone = this._lastOrder?.customer_phone;
        if (!phone) { setStatus('❌ Pedido não encontrado — envie pelo WhatsApp', 'text-red-400'); return; }

        try {
            setStatus('⏳ Enviando comprovante...', 'text-slate-400');
            const path = `${orderId}/${vendorId}/${Date.now()}-${sanitizeFileName(file.name)}`;

            const { error: upErr } = await _supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type });
            if (upErr) throw upErr;

            const { error: rpcErr } = vendorId === 'desconhecido'
                ? await _supabase.rpc('attach_payment_proof', { p_order_id: orderId, p_proof_path: path, p_customer_phone: phone })
                : await _supabase.rpc('attach_vendor_payment_proof', {
                    p_order_id: orderId, p_vendor_id: vendorId, p_proof_path: path, p_customer_phone: phone
                });
            if (rpcErr) throw rpcErr;

            setStatus('✅ Comprovante enviado! Aguarde a confirmação do vendedor.', 'text-green-400');
            zoneEl?.classList.add('hidden');
        } catch (err) {
            log(`❌ Erro ao enviar comprovante: ${err.message}`, 'error');
            setStatus('❌ Não foi possível enviar. Use o botão do WhatsApp abaixo.', 'text-red-400');
        }
    },

    _orderCode(orderId) {
        return String(orderId).slice(0, 8).toUpperCase();
    },

    _formatPhone(phone) {
        const d = String(phone || '').replace(/\D/g, '');
        if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
        if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
        return String(phone || '');
    },

    /**
     * Estilos do comprovante — próprios (prefixo rc-), sem depender de
     * classes do Tailwind compilado. Funciona no tema claro e no escuro.
     */
    _ensureReceiptStyles() {
        if (document.getElementById('rc-styles')) return;
        const style = document.createElement('style');
        style.id = 'rc-styles';
        style.textContent = `
            .rc-overlay{position:fixed;inset:0;z-index:5000;background:rgba(2,6,23,.82);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
                display:flex;align-items:flex-end;justify-content:center;padding:0;animation:rcFade .25s ease}
            @media(min-width:640px){.rc-overlay{align-items:center;padding:24px}}
            .rc-sheet{--bg:#111827;--card:#1a2236;--line:rgba(255,255,255,.08);--text:#f1f5f9;--muted:#94a3b8;--soft:rgba(255,255,255,.04);
                background:var(--bg);color:var(--text);width:100%;max-width:440px;max-height:92vh;overflow-y:auto;
                border-radius:28px 28px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.4);animation:rcUp .35s cubic-bezier(.2,.9,.3,1.2);
                font-family:Inter,-apple-system,'Segoe UI',sans-serif}
            @media(min-width:640px){.rc-sheet{border-radius:28px}}
            html[data-theme="light"] .rc-sheet{--bg:#ffffff;--card:#f8fafc;--line:rgba(15,23,42,.08);--text:#0f172a;--muted:#64748b;--soft:rgba(15,23,42,.03)}
            @keyframes rcFade{from{opacity:0}to{opacity:1}}
            @keyframes rcUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
            @keyframes rcPop{0%{transform:scale(.4)}70%{transform:scale(1.12)}100%{transform:scale(1)}}

            .rc-hero{padding:32px 24px 24px;text-align:center;background:linear-gradient(180deg,rgba(34,197,94,.14),transparent)}
            .rc-check{width:64px;height:64px;margin:0 auto 14px;border-radius:50%;background:#22c55e;color:#fff;display:flex;align-items:center;justify-content:center;
                box-shadow:0 0 0 8px rgba(34,197,94,.15);animation:rcPop .5s ease .1s both}
            .rc-title{font-size:22px;font-weight:900;letter-spacing:-.02em;margin:0 0 6px}
            .rc-sub{font-size:14px;color:var(--muted);margin:0;line-height:1.5}
            .rc-code{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:6px 12px;border-radius:999px;background:var(--soft);border:1px solid var(--line);
                font-size:12px;font-weight:700;color:var(--muted);cursor:pointer}
            .rc-code b{color:var(--text);letter-spacing:.06em}

            .rc-body{padding:0 20px 20px;display:flex;flex-direction:column;gap:16px}
            .rc-total{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-radius:20px;
                background:linear-gradient(135deg,rgba(59,130,246,.16),rgba(139,92,246,.12));border:1px solid rgba(99,102,241,.25)}
            .rc-total span{font-size:13px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
            .rc-total strong{font-size:30px;font-weight:900;color:#3b82f6;letter-spacing:-.02em}

            .rc-label{font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin:4px 0 -4px}
            .rc-steps{display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:20px;background:var(--card);border:1px solid var(--line)}
            .rc-step{display:flex;gap:12px;align-items:flex-start}
            .rc-step-n{flex-shrink:0;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;
                background:rgba(59,130,246,.15);color:#3b82f6}
            .rc-step.is-now .rc-step-n{background:#3b82f6;color:#fff;box-shadow:0 0 0 4px rgba(59,130,246,.2)}
            .rc-step p{margin:3px 0 0;font-size:14px;line-height:1.45;color:var(--muted)}
            .rc-step.is-now p{color:var(--text);font-weight:700}
            .rc-step.is-done .rc-step-n{background:#22c55e;color:#fff}
            .rc-step.is-done p{text-decoration:line-through;text-decoration-color:rgba(148,163,184,.5)}

            .rc-vendor{border-radius:20px;background:var(--card);border:1px solid var(--line);overflow:hidden}
            .rc-vendor-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line)}
            .rc-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;
                background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-weight:900;font-size:15px}
            .rc-vendor-name{font-weight:800;font-size:15px;line-height:1.2}
            .rc-vendor-tag{font-size:12px;color:var(--muted)}
            .rc-vendor-amount{margin-left:auto;font-weight:900;font-size:17px;color:#3b82f6;white-space:nowrap}
            .rc-items{padding:12px 18px;display:flex;flex-direction:column;gap:8px}
            .rc-item{display:flex;justify-content:space-between;gap:12px;font-size:14px}
            .rc-item span:first-child{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .rc-item span:last-child{font-weight:700;white-space:nowrap}
            .rc-actions{padding:4px 18px 18px;display:flex;flex-direction:column;gap:12px}

            .rc-pix{padding:16px;border-radius:16px;background:var(--soft);border:1px dashed rgba(59,130,246,.45);text-align:center}
            .rc-pix-label{font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
            .rc-pix-key{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:17px;font-weight:800;margin:8px 0 12px;word-break:break-all}
            .rc-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:50px;padding:12px 16px;border:none;border-radius:16px;
                font-weight:900;font-size:15px;line-height:1.2;text-decoration:none;cursor:pointer;transition:transform .15s ease,filter .15s ease;text-align:center}
            .rc-btn:hover{filter:brightness(1.07)} .rc-btn:active{transform:scale(.98)}
            .rc-btn-blue{background:#3b82f6;color:#fff;box-shadow:0 8px 20px rgba(59,130,246,.3)}
            .rc-btn-wa{background:#25D366;color:#fff;box-shadow:0 8px 20px rgba(37,211,102,.32);min-height:54px}
            .rc-btn-ghost{background:var(--soft);color:var(--text);border:1px solid var(--line)}
            .rc-upload{padding:14px;border-radius:16px;border:2px dashed var(--line);text-align:center;cursor:pointer;font-size:14px;font-weight:700;color:var(--text)}
            .rc-upload small{display:block;margin-top:4px;font-size:12px;font-weight:500;color:var(--muted)}
            .rc-or{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}
            .rc-or::before,.rc-or::after{content:'';flex:1;height:1px;background:var(--line)}
            .rc-hint{font-size:12px;color:var(--muted);text-align:center;margin:-4px 0 0;line-height:1.45}
            .rc-alert{padding:12px 14px;border-radius:14px;font-size:13px;line-height:1.5;font-weight:600}
            .rc-alert-warn{background:rgba(245,158,11,.12);color:#d97706;border:1px solid rgba(245,158,11,.25)}
            html:not([data-theme="light"]) .rc-alert-warn{color:#fbbf24}

            .rc-details{border-radius:16px;border:1px solid var(--line);overflow:hidden}
            .rc-details summary{list-style:none;cursor:pointer;padding:14px 18px;font-size:13px;font-weight:700;color:var(--muted);display:flex;justify-content:space-between}
            .rc-details summary::-webkit-details-marker{display:none}
            .rc-details[open] summary{border-bottom:1px solid var(--line)}
            .rc-details dl{margin:0;padding:12px 18px;display:grid;grid-template-columns:auto 1fr;gap:10px 16px;font-size:14px}
            .rc-details dt{color:var(--muted)} .rc-details dd{margin:0;text-align:right;font-weight:700;word-break:break-word}

            .rc-trust{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:var(--muted);text-align:center}
            .rc-footer{padding:4px 20px 24px;display:flex;flex-direction:column;gap:10px}
            .rc-link{background:none;border:none;color:var(--muted);font-size:13px;font-weight:700;cursor:pointer;padding:6px}
        `;
        document.head.appendChild(style);
    },

    _steps(isPix, multi) {
        const steps = isPix
            ? [
                multi ? 'Faça um Pix para cada vendedor, no valor indicado' : 'Pague via Pix com a chave abaixo',
                'Envie o comprovante (anexando aqui ou pelo WhatsApp)',
                'O vendedor confirma e combina a entrega com você'
            ]
            : [
                'Seu pedido já chegou para o vendedor',
                'Combine a entrega pelo WhatsApp',
                'Pague em dinheiro quando receber'
            ];
        const current = isPix ? 0 : 1; // no dinheiro, o passo 1 já aconteceu
        return `
            <div class="rc-steps">
                ${steps.map((t, i) => {
                    const state = i < current ? 'is-done' : i === current ? 'is-now' : '';
                    return `
                    <div class="rc-step ${state}">
                        <span class="rc-step-n">${i < current ? '✓' : i + 1}</span>
                        <p>${t}</p>
                    </div>`;
                }).join('')}
            </div>`;
    },

    _renderVendorBlock(orderData, v) {
        const isPix = orderData.payment_method === 'Pix';
        const code = this._orderCode(orderData.order_id);
        const vid = escapeHtml(v.vendor_id);
        const oid = escapeHtml(orderData.order_id);
        const initials = String(v.vendor_name || 'V').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

        const waText = isPix
            ? `Olá, ${v.vendor_name}! Fiz o pedido #${code} (R$ ${formatBRL(v.subtotal)}) na Ityrapuã Store e segue o comprovante do Pix.`
            : `Olá, ${v.vendor_name}! Fiz o pedido #${code} (R$ ${formatBRL(v.subtotal)}) na Ityrapuã Store. Como combinamos a entrega?`;
        const waLink = buildWhatsAppLink(v.vendor_phone, waText) || buildWhatsAppLink(CONFIG.STORE_WHATSAPP, waText);

        const itemsHtml = v.items.map(i => `
            <div class="rc-item">
                <span>${i.quantity > 1 ? `${i.quantity}× ` : ''}${escapeHtml(i.name)}</span>
                <span>R$ ${formatBRL(i.total)}</span>
            </div>`).join('');

        const pixHtml = !isPix ? '' : (v.pix_keys.length ? v.pix_keys.map(k => `
            <div class="rc-pix">
                <div class="rc-pix-label">🔑 Chave Pix ${k.label && k.label !== 'Pix' ? `· ${escapeHtml(k.label)}` : ''}</div>
                <div class="rc-pix-key">${escapeHtml(k.pix_key)}</div>
                <button type="button" class="rc-btn rc-btn-blue" data-pix="${escapeHtml(k.pix_key)}" onclick="window.APP.orders.copyPix(this)">📋 COPIAR CHAVE</button>
            </div>`).join('') : `
            <div class="rc-alert rc-alert-warn">Este vendedor ainda não cadastrou chave Pix. Chame no WhatsApp para receber os dados de pagamento.</div>`);

        const proofHtml = !isPix ? '' : `
            <div id="proof-zone-${vid}" class="rc-upload" onclick="document.getElementById('proof-input-${vid}').click()">
                <input type="file" id="proof-input-${vid}" accept="image/jpeg,image/png,image/webp,application/pdf" style="display:none"
                       onchange="window.APP.orders.uploadPaymentProof('${oid}', '${vid}', this)">
                📎 Já pagou? Anexe o comprovante
                <small>Foto ou PDF · até 5MB</small>
            </div>
            <div id="proof-status-${vid}" class="rc-hint"></div>`;

        const waHtml = waLink ? `
            ${isPix ? '<div class="rc-or">ou</div>' : ''}
            <a href="${escapeHtml(waLink)}" target="_blank" rel="noopener" class="rc-btn rc-btn-wa">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
                <span>${isPix ? 'Enviar comprovante no WhatsApp' : 'Combinar entrega no WhatsApp'}</span>
            </a>
            <p class="rc-hint">A mensagem com o número do pedido já vai escrita.</p>` : '';

        return `
            <div class="rc-vendor">
                <div class="rc-vendor-head">
                    <div class="rc-avatar">${escapeHtml(initials)}</div>
                    <div style="min-width:0">
                        <div class="rc-vendor-name">${escapeHtml(v.vendor_name)}</div>
                        <div class="rc-vendor-tag">Vendedor(a) da comunidade</div>
                    </div>
                    <div class="rc-vendor-amount">R$ ${formatBRL(v.subtotal)}</div>
                </div>
                <div class="rc-items">${itemsHtml}</div>
                <div class="rc-actions">
                    ${pixHtml}
                    ${proofHtml}
                    ${waHtml}
                </div>
            </div>`;
    },

    // ============================================================
    // COMPROVANTES GUARDADOS NO APARELHO ("Meus pedidos")
    // Quem sai do site pra pagar no app do banco pode voltar e a página
    // ter sido recarregada (o celular fecha abas em segundo plano). O
    // comprovante fica salvo aqui e reabre sozinho enquanto o Pix não
    // vence — e pode ser consultado depois em Carrinho → Meus pedidos.
    // ============================================================

    RECEIPTS_KEY: 'my_receipts',
    PIX_WINDOW_MS: 2 * 60 * 60 * 1000,
    KEEP_DAYS: 30,

    _loadReceipts() {
        const list = (typeof Storage !== 'undefined' && Storage.get) ? Storage.get(this.RECEIPTS_KEY, []) : [];
        const limit = Date.now() - this.KEEP_DAYS * 86400000;
        return (Array.isArray(list) ? list : [])
            .filter(r => r && r.order_id && new Date(r.timestamp).getTime() > limit);
    },

    _saveReceipts(list) {
        try { Storage.set(this.RECEIPTS_KEY, list.slice(0, 15)); } catch {}
    },

    _saveReceipt(receipt) {
        const list = this._loadReceipts().filter(r => r.order_id !== receipt.order_id);
        list.unshift({ ...receipt, timestamp: new Date(receipt.timestamp).toISOString(), dismissed: false });
        this._saveReceipts(list);
        this._ensureMyOrdersEntry();
    },

    _markReceiptDismissed(orderId) {
        const list = this._loadReceipts();
        const r = list.find(x => x.order_id === orderId);
        if (r) { r.dismissed = true; this._saveReceipts(list); }
    },

    _hydrate(r) {
        return { ...r, timestamp: new Date(r.timestamp), vendors: r.vendors || [] };
    },

    _isPixPending(r) {
        return r.payment_method === 'Pix' && (Date.now() - new Date(r.timestamp).getTime()) < this.PIX_WINDOW_MS;
    },

    /** Chamado no carregamento do app: reabre o Pix pendente que a pessoa não fechou. */
    restorePendingReceipt() {
        this._ensureMyOrdersEntry();
        if (document.querySelector('.rc-overlay')) return;
        const pending = this._loadReceipts().find(r => !r.dismissed && this._isPixPending(r));
        if (pending) this.showReceipt(this._hydrate(pending));
    },

    openReceipt(orderId) {
        const r = this._loadReceipts().find(x => x.order_id === orderId);
        if (!r) return;
        document.getElementById('my-orders-modal')?.remove();
        this.showReceipt(this._hydrate(r));
    },

    openMyOrders() {
        this._ensureReceiptStyles();
        document.getElementById('my-orders-modal')?.remove();
        const list = this._loadReceipts();

        const rows = list.length ? list.map(r => {
            const when = new Date(r.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const vendors = (r.vendors || []).map(v => v.vendor_name).join(', ');
            let badge;
            if (r.payment_method !== 'Pix') badge = '<span style="color:#22c55e">💵 Pagar na entrega</span>';
            else if (this._isPixPending(r)) badge = '<span style="color:#f59e0b">⏱️ Aguardando Pix</span>';
            else badge = '<span style="color:#94a3b8">Pix — prazo encerrado</span>';
            return `
                <button type="button" class="rc-vendor" data-open-receipt="${escapeHtml(r.order_id)}"
                    style="width:100%;text-align:left;cursor:pointer;padding:14px 16px;display:flex;justify-content:space-between;gap:12px;align-items:center;color:inherit">
                    <div style="min-width:0">
                        <div style="font-weight:800">#${escapeHtml(this._orderCode(r.order_id))} · ${when}</div>
                        <div style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(vendors)}</div>
                        <div style="font-size:12px;font-weight:700;margin-top:4px">${badge}</div>
                    </div>
                    <div style="font-weight:900;color:#3b82f6;white-space:nowrap">R$ ${formatBRL(r.total_amount)}</div>
                </button>`;
        }).join('') : '<p class="rc-sub" style="text-align:center;padding:24px 0">Nenhum pedido feito neste aparelho ainda.</p>';

        const overlay = document.createElement('div');
        overlay.id = 'my-orders-modal';
        overlay.className = 'rc-overlay';
        overlay.innerHTML = `
            <div class="rc-sheet" role="dialog" aria-modal="true" aria-label="Meus pedidos">
                <div class="rc-hero" style="padding-bottom:16px">
                    <h2 class="rc-title">📄 Meus pedidos</h2>
                    <p class="rc-sub">Pedidos feitos neste aparelho nos últimos ${this.KEEP_DAYS} dias. Toque para ver o comprovante.</p>
                </div>
                <div class="rc-body">${rows}</div>
                <div class="rc-footer">
                    <button type="button" class="rc-btn rc-btn-ghost" data-close>Fechar</button>
                </div>
            </div>`;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-close]')) { overlay.remove(); return; }
            const btn = e.target.closest('[data-open-receipt]');
            if (btn) this.openReceipt(btn.dataset.openReceipt);
        });
        document.body.appendChild(overlay);
    },

    /** Botão "📄 Meus pedidos" dentro do carrinho (só aparece se houver pedido salvo). */
    _ensureMyOrdersEntry() {
        const drawer = document.getElementById('cart-drawer');
        if (!drawer) return;
        const list = this._loadReceipts();
        let btn = document.getElementById('my-orders-btn');

        if (!list.length) { btn?.remove(); return; }

        const pending = list.some(r => this._isPixPending(r));
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'my-orders-btn';
            btn.type = 'button';
            btn.style.cssText = 'margin:0 24px 12px;padding:12px 16px;border-radius:14px;border:1px solid rgba(148,163,184,.25);background:rgba(148,163,184,.08);color:inherit;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;flex-shrink:0';
            btn.addEventListener('click', () => {
                window.APP?.cart?.closeCart?.();
                this.openMyOrders();
            });
            const header = drawer.firstElementChild;
            header?.insertAdjacentElement('afterend', btn);
        }
        btn.innerHTML = `<span>📄 Meus pedidos (${list.length})</span>${pending ? '<span style="color:#f59e0b;font-size:12px">⏱️ Pix pendente</span>' : '<span>›</span>'}`;
    },

    _toast(text) {
        let container = document.getElementById('cart-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cart-toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'cart-toast';
        toast.textContent = text;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('cart-toast-show'));
        setTimeout(() => {
            toast.classList.remove('cart-toast-show');
            toast.classList.add('cart-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    },

    // ============================================================
    // IMPRESSÃO — página própria, 1 folha, independente do CSS do site
    // ============================================================
    printReceipt(orderData) {
        const d = orderData;
        const isPix = d.payment_method === 'Pix';
        const code = this._orderCode(d.order_id);
        const when = new Date(d.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const payLabel = d.payment_method === 'Dinheiro' ? 'Dinheiro na entrega' : d.payment_method;
        const e = escapeHtml;

        const vendorsHtml = (d.vendors || []).map(v => `
            <div class="vendor">
                <div class="vendor-head"><span>Vendedor: <b>${e(v.vendor_name)}</b>${v.vendor_phone ? ` · ${e(this._formatPhone(v.vendor_phone))}` : ''}</span><b>R$ ${formatBRL(v.subtotal)}</b></div>
                <table>
                    ${(v.items || []).map(i => `<tr><td>${i.quantity}× ${e(i.name)}</td><td class="r">R$ ${formatBRL(i.total)}</td></tr>`).join('')}
                </table>
                ${isPix && v.pix_keys?.length ? `<div class="pix">Chave Pix${v.pix_keys.length > 1 ? 's' : ''}: ${v.pix_keys.map(k => `<b>${e(k.pix_key)}</b>${k.label && k.label !== 'Pix' ? ` (${e(k.label)})` : ''}`).join(' · ')}</div>` : ''}
            </div>`).join('');

        const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Pedido #${code}</title>
            <style>
                @page{size:A4;margin:14mm}
                *{box-sizing:border-box}
                body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:12.5px}
                .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
                .brand{font-size:20px;font-weight:900;letter-spacing:-.02em}
                .brand small{display:block;font-size:11px;font-weight:400;color:#555;letter-spacing:0}
                .code{text-align:right;font-size:12px}.code b{font-size:16px}
                .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:16px}
                .grid div span{color:#555}
                .vendor{border:1px solid #ccc;border-radius:8px;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid}
                .vendor-head{display:flex;justify-content:space-between;margin-bottom:6px}
                table{width:100%;border-collapse:collapse}td{padding:3px 0;border-top:1px dotted #ddd}.r{text-align:right;white-space:nowrap}
                .pix{margin-top:8px;padding:6px 8px;background:#f3f4f6;border-radius:6px}
                .total{display:flex;justify-content:space-between;align-items:center;border-top:2px solid #111;margin-top:14px;padding-top:10px;font-size:18px;font-weight:900}
                .note{margin-top:14px;font-size:11px;color:#555;line-height:1.5}
            </style></head><body>
            <div class="head">
                <div class="brand">Ityrapuã Store<small>Marketplace comunitário</small></div>
                <div class="code">Comprovante de pedido<br><b>#${code}</b></div>
            </div>
            <div class="grid">
                <div><span>Cliente:</span> <b>${e(d.customer_name)}</b></div>
                <div><span>Data:</span> <b>${when}</b></div>
                <div><span>WhatsApp:</span> <b>${e(this._formatPhone(d.customer_phone))}</b></div>
                <div><span>Pagamento:</span> <b>${e(payLabel)}</b></div>
            </div>
            ${vendorsHtml}
            <div class="total"><span>TOTAL</span><span>R$ ${formatBRL(d.total_amount)}</span></div>
            <div class="note">${isPix
                ? 'Pagamento via Pix direto para cada vendedor. O pedido é confirmado quando o vendedor recebe o pagamento; pedidos sem pagamento expiram em 2 horas.'
                : 'Pagamento em dinheiro na entrega, combinada diretamente com o vendedor.'}
                <br>Este documento é um comprovante de pedido, não é nota fiscal.</div>
            </body></html>`;

        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
        document.body.appendChild(frame);
        const doc = frame.contentDocument;
        doc.open(); doc.write(html); doc.close();
        const doPrint = () => {
            try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch {}
            setTimeout(() => frame.remove(), 1500);
        };
        if (doc.readyState === 'complete') setTimeout(doPrint, 50);
        else frame.onload = doPrint;
    },

    async showReceipt(orderData) {
        this._lastOrder = orderData;
        this._ensureReceiptStyles();

        const isPix = orderData.payment_method === 'Pix';
        const multi = orderData.vendors.length > 1;
        const code = this._orderCode(orderData.order_id);
        const firstName = String(orderData.customer_name || '').trim().split(' ')[0];
        const payLabel = orderData.payment_method === 'Dinheiro' ? 'Dinheiro na entrega' : orderData.payment_method;
        const expires = new Date(orderData.timestamp.getTime() + 2 * 3600 * 1000)
            .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const overlay = document.createElement('div');
        overlay.className = 'rc-overlay receipt-overlay';
        overlay.innerHTML = `
            <div class="rc-sheet" role="dialog" aria-modal="true" aria-label="Comprovante do pedido">
                <div class="rc-hero">
                    <div class="rc-check">
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <h2 class="rc-title">${firstName ? `Pedido feito, ${escapeHtml(firstName)}! 🎉` : 'Pedido feito! 🎉'}</h2>
                    <p class="rc-sub">${isPix
                        ? 'Falta só o pagamento para o vendedor separar seu pedido.'
                        : 'O vendedor já recebeu seu pedido e vai falar com você.'}</p>
                </div>

                <div class="rc-body">
                    <div class="rc-total">
                        <span>${isPix ? 'Total a pagar' : 'Total na entrega'}</span>
                        <strong>R$ ${formatBRL(orderData.total_amount)}</strong>
                    </div>

                    ${isPix ? `<div class="rc-alert rc-alert-warn">⏱️ Pague até <b>${expires}</b> — depois disso o pedido expira e os itens voltam para a loja.</div>` : ''}

                    <div class="rc-label">Próximos passos</div>
                    ${this._steps(isPix, multi)}

                    <div class="rc-label">${multi ? `Seu pedido tem ${orderData.vendors.length} vendedores` : 'Seu vendedor'}</div>
                    ${orderData.vendors.map(v => this._renderVendorBlock(orderData, v)).join('')}

                    <details class="rc-details">
                        <summary><span>Detalhes do pedido</span><span>▾</span></summary>
                        <dl>
                            <dt>Cliente</dt><dd>${escapeHtml(orderData.customer_name)}</dd>
                            <dt>WhatsApp</dt><dd>${escapeHtml(this._formatPhone(orderData.customer_phone))}</dd>
                            <dt>Data</dt><dd>${orderData.timestamp.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
                            <dt>Pagamento</dt><dd>${escapeHtml(payLabel)}</dd>
                            <dt>Nº do pedido</dt><dd>#${code}</dd>
                        </dl>
                        <p class="rc-hint" style="padding:0 18px 14px;text-align:left">O nº do pedido identifica sua compra — o vendedor vê o mesmo número. Ele já vai junto na mensagem do WhatsApp.</p>
                    </details>

                    <div class="rc-trust">🤝 Você paga direto para quem vende — sem intermediários.</div>
                </div>

                <div class="rc-footer">
                    <button type="button" class="rc-btn rc-btn-ghost" data-close-receipt>🛍️ Continuar comprando</button>
                    <button type="button" class="rc-link" data-print-receipt>🖨️ Imprimir comprovante</button>
                </div>
            </div>`;

        const close = () => {
            this._markReceiptDismissed(orderData.order_id);
            overlay.remove();
            this._ensureMyOrdersEntry();
            if (isPix) this._toast('Comprovante guardado. Para ver de novo: 🛒 Carrinho → 📄 Meus pedidos');
        };
        overlay.querySelector('[data-close-receipt]').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        overlay.querySelector('[data-print-receipt]').addEventListener('click', () => this.printReceipt(orderData));

        document.body.appendChild(overlay);
    }
};
