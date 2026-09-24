/**
 * SCRIPT-VITRINE.JS v2.3
 * v2.3 (auditoria):
 *  - compra agora usa a função create_order do banco (antes gravava
 *    direto em orders/order_items com preço vindo do navegador — o banco
 *    bloqueia isso e a compra falhava sempre com "loja fechada")
 *  - nome/descrição/vendedor escapados (XSS)
 *  - não baixa mais o custo (cost_price) dos produtos
 *  - imagem reserva embutida (via.placeholder.com saiu do ar)
 */

let allProducts = [];

const VITRINE_PLACEHOLDER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%231e293b'/%3E%3Ctext x='100' y='105' text-anchor='middle' font-size='14' fill='%2364748b' font-family='sans-serif'%3ESem imagem%3C/text%3E%3C/svg%3E`;

async function getProducts() {
    try {
        if (!window._supabase) throw new Error('Supabase não inicializado');

        const { data, error } = await window._supabase
            .from('products')
            .select('id, name, price, stock, description, image_url, owner_id, created_at, profiles!owner_id(full_name, phone)')
            .eq('active', true)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) throw error;

        allProducts = data || [];
        await attachVendorOnlineStatus(allProducts);
        return allProducts;
    } catch (error) {
        console.error('❌ Erro ao carregar produtos:', error);
        showConnectionError();
        return null;
    }
}

async function attachVendorOnlineStatus(products) {
    try {
        const ownerIds = [...new Set(products.map(p => p.owner_id).filter(Boolean))];
        if (!ownerIds.length) return;
        const { data, error } = await window._supabase
            .from('vendor_status').select('owner_id, is_online').in('owner_id', ownerIds);
        if (error) throw error;
        const map = {};
        (data || []).forEach(v => { map[v.owner_id] = v.is_online; });
        products.forEach(p => { p.vendor_online = Object.prototype.hasOwnProperty.call(map, p.owner_id) ? map[p.owner_id] : true; });
    } catch (err) {
        products.forEach(p => { if (p.vendor_online === undefined) p.vendor_online = true; });
    }
}

async function renderProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;

    const products = await getProducts();
    if (products === null) return; // erro já exibido

    if (!products.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;padding:40px 20px;text-align:center;">
                <p style="color:#a0a0b0;font-size:18px;margin-bottom:20px;">😔 Nenhum produto disponível no momento</p>
                <button onclick="location.reload()" class="btn btn--secondary">🔄 Atualizar</button>
            </div>`;
        return;
    }

    grid.innerHTML = '';
    products.forEach(p => grid.appendChild(createProductCard(p)));
}

function createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';

    const vendorOnline = product.vendor_online !== false;
    const stock = Number(product.stock) || 0;
    const disponivel = stock > 0 && vendorOnline;
    const img = window.safeUrl(product.image_url) || VITRINE_PLACEHOLDER;
    const waLink = window.buildWhatsAppLink(product.profiles?.phone, `Olá! Tenho interesse em "${product.name}".`);

    card.innerHTML = `
        <div class="product-image">
            <img src="${escapeHtml(img)}" alt="${escapeHtml(product.name)}" loading="lazy"
                 onerror="if(!this.dataset.err){this.dataset.err=1;this.src=VITRINE_PLACEHOLDER}">
            ${getStockBadge(product)}
        </div>
        <div class="product-info">
            <h3 class="product-title">${escapeHtml(product.name)}</h3>
            <p class="product-vendor">${escapeHtml(product.profiles?.full_name || 'Vendedor')}</p>
            <p class="product-description">${escapeHtml(product.description || 'Sem descrição')}</p>
            <div class="product-price"><span class="price-value">R$ ${formatBRL(product.price)}</span></div>
            ${waLink ? `
                <a href="${escapeHtml(waLink)}" target="_blank" rel="noopener" class="btn btn--secondary btn--full" style="margin-bottom:8px;display:block;text-align:center;">
                    💬 Falar com o Vendedor
                </a>` : ''}
            <button class="btn btn--primary btn--full" data-buy="${escapeHtml(product.id)}" ${!disponivel ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
                ${!vendorOnline ? '🔌 Vendedor Offline' : disponivel ? '🛒 Comprar' : '❌ Fora de Estoque'}
            </button>
        </div>`;

    card.querySelector('[data-buy]')?.addEventListener('click', () => openCheckoutModal(product.id));
    return card;
}

function getStockBadge(product) {
    if (product.vendor_online === false) return `<div class="stock-badge stock-badge--out">🔌 Vendedor Offline</div>`;
    const stock = Number(product.stock) || 0;
    if (stock === 0) return `<div class="stock-badge stock-badge--out">❌ Fora de Estoque</div>`;
    if (stock <= 5) return `<div class="stock-badge stock-badge--low">⚠️ ${stock} restantes</div>`;
    return '';
}

function openCheckoutModal(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    if (product.vendor_online === false) { alert('🔌 Este vendedor está temporariamente offline.'); return; }
    if ((Number(product.stock) || 0) === 0) { alert('❌ Produto fora de estoque!'); return; }

    const modal = document.getElementById('checkout-modal');
    if (!modal) return;

    document.getElementById('checkout-form').reset();
    document.getElementById('checkout-product-name').textContent = product.name;
    document.getElementById('checkout-product-price').textContent = `R$ ${formatBRL(product.price)}`;
    document.getElementById('checkout-product-id').value = productId;

    modal.classList.add('modal--active');
    modal.style.display = 'flex';
}

function closeCheckoutModal() {
    const modal = document.getElementById('checkout-modal');
    if (modal) { modal.classList.remove('modal--active'); modal.style.display = 'none'; }
}

function friendlyOrderError(error) {
    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('store_closed')) return '🔒 A loja está fechada agora (horário de funcionamento ou Sabbath). Tente mais tarde.';
    if (msg.includes('vendor_offline')) return '🔌 O vendedor deste produto está offline agora. Tente mais tarde.';
    if (msg.includes('insufficient_stock')) return '❌ Este produto acabou de esgotar.';
    if (msg.includes('product_not_found') || msg.includes('vendor_banned')) return '❌ Este produto não está mais disponível.';
    return '❌ Erro ao processar pedido. Tente novamente.';
}

async function handleCheckout(event) {
    event.preventDefault();

    const productId = document.getElementById('checkout-product-id').value;
    const name = document.getElementById('checkout-name').value.trim();
    const curso = document.getElementById('checkout-curso').value.trim();
    const whatsapp = document.getElementById('checkout-whatsapp').value.trim();

    if (!name || !curso || !whatsapp) { alert('❌ Preencha todos os campos obrigatórios'); return; }
    if (whatsapp.replace(/\D/g, '').length < 10) { alert('❌ Informe o WhatsApp com DDD'); return; }

    const product = allProducts.find(p => p.id === productId);
    if (!product) { alert('❌ Produto não encontrado'); return; }

    const btn = event.target.querySelector('button[type="submit"]');
    const originalText = btn?.innerText;
    if (btn) { btn.disabled = true; btn.innerText = '⏳ ENVIANDO...'; }

    try {
        const { data, error } = await window._supabase.rpc('create_order', {
            p_customer_name: `${name} (${curso})`.slice(0, 120),
            p_customer_phone: whatsapp.slice(0, 30),
            p_payment_method: 'A combinar',
            p_items: [{ product_id: product.id, quantity: 1 }]
        });
        if (error) throw error;
        if (!data?.order_id) throw new Error('Erro ao criar pedido');

        try { await window._supabase.rpc('register_order_vendor_payments', { p_order_id: data.order_id }); } catch {}

        closeCheckoutModal();
        const code = String(data.order_id).slice(0, 8).toUpperCase();
        const wa = window.buildWhatsAppLink(product.profiles?.phone, `Olá! Fiz o pedido #${code} de "${product.name}" pela vitrine.`);
        if (wa && confirm(`✅ Pedido #${code} enviado!\n\nQuer chamar o vendedor no WhatsApp para combinar o pagamento e a entrega?`)) {
            window.open(wa, '_blank', 'noopener');
        } else if (!wa) {
            alert(`✅ Pedido #${code} enviado com sucesso, ${name}! O vendedor vai entrar em contato.`);
        }
        renderProducts();
    } catch (error) {
        console.error('Erro ao criar pedido:', error);
        alert(friendlyOrderError(error));
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
    }
}

function showConnectionError() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;padding:40px 20px;text-align:center;color:#ff6464;">
            <p style="font-size:18px;margin-bottom:10px;">🔴 Ops! Problema de conexão com o banco.</p>
            <p style="color:#a0a0b0;margin-bottom:20px;">Tente atualizar a página.</p>
            <button onclick="location.reload()" class="btn btn--secondary">🔄 Atualizar Agora</button>
        </div>`;
}

function initVitrine() {
    renderProducts();
    const modal = document.getElementById('checkout-modal');
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeCheckoutModal(); });
}

window.onSupabaseReady(initVitrine);

window.renderProducts = renderProducts;
window.openCheckoutModal = openCheckoutModal;
window.closeCheckoutModal = closeCheckoutModal;
window.handleCheckout = handleCheckout;
