/**
 * ================================================
 * SCRIPT-VITRINE.JS - SISTEMA DE VITRINE COMPLETO
 * ================================================
 * v2.2
 * ✅ Usa window._supabase (criado pelo config.js) — mesmo banco/
 *    mesmas credenciais do marketplace principal, sem projeto Supabase
 *    duplicado/desconhecido.
 * ✅ Usa as tabelas reais do sistema: products / profiles
 * ✅ Checkout agora grava de verdade em orders / order_items
 *    (antes só dava console.log e fingia sucesso)
 * ✅ v2.1: produtos de vendedor offline aparecem marcados, com o botão de
 *    compra desabilitado — o banco já bloqueia isso via RLS, isso aqui é
 *    só o aviso na tela antes do cliente chegar até o checkout.
 * ✅ v2.1 FIX: typo "ddocument" corrigido em openCheckoutModal().
 * ✅ v2.1 FIX: mensagem amigável quando o banco recusa o pedido (loja
 *    fechada por horário/Sabbath, ou vendedor offline), em vez de um
 *    erro técnico cru.
 * ✅ v2.2: texto "Vendedor Indisponível" trocado para "Vendedor Offline"
 * ✅ v2.2 NOVO: botão "Falar com o Vendedor" no card do produto — usa o
 *    telefone salvo no perfil do vendedor (profiles.phone) pra abrir o
 *    WhatsApp direto. Some automaticamente se o vendedor não tiver
 *    telefone cadastrado.
 */

let allProducts = [];

/**
 * ================================================
 * BUSCA DE PRODUTOS
 * ================================================
 */

async function getProducts() {
    try {
        if (!window._supabase) {
            throw new Error('Supabase não inicializado — confirme se config.js foi carregado antes deste arquivo');
        }

        const { data, error } = await window._supabase
            .from('products')
            .select(`
                id,
                name,
                price,
                cost_price,
                stock,
                description,
                image_url,
                owner_id,
                created_at,
                profiles!owner_id(full_name, phone)
            `)
            .eq('active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        allProducts = data || [];
        await attachVendorOnlineStatus(allProducts); // ✅ marca vendedor offline
        console.log(`✅ ${allProducts.length} produtos carregados`);
        return allProducts;

    } catch (error) {
        console.error('❌ Erro crítico ao carregar produtos:', error);
        showConnectionError();
        return [];
    }
}

/**
 * Busca o status online/offline de cada vendedor e anexa
 * `product.vendor_online` em cada produto (mesma lógica do app principal).
 * Produto sem linha em vendor_status é tratado como disponível (mesmo
 * padrão do banco: is_online default = true).
 */
async function attachVendorOnlineStatus(products) {
    try {
        const ownerIds = [...new Set(products.map(p => p.owner_id).filter(Boolean))];
        if (!ownerIds.length) return;

        const { data, error } = await window._supabase
            .from('vendor_status')
            .select('owner_id, is_online')
            .in('owner_id', ownerIds);

        if (error) throw error;

        const onlineMap = {};
        (data || []).forEach(v => { onlineMap[v.owner_id] = v.is_online; });

        products.forEach(p => {
            p.vendor_online = onlineMap.hasOwnProperty(p.owner_id) ? onlineMap[p.owner_id] : true;
        });
    } catch (err) {
        console.warn('⚠️ Não foi possível verificar status dos vendedores:', err.message);
        products.forEach(p => { if (p.vendor_online === undefined) p.vendor_online = true; });
    }
}

/**
 * ================================================
 * RENDERIZAÇÃO DE PRODUTOS NA VITRINE
 * ================================================
 */

async function renderProducts() {
    const gridContainer = document.getElementById('product-grid');

    if (!gridContainer) {
        console.warn('❌ #product-grid não encontrado no DOM');
        return;
    }

    try {
        gridContainer.innerHTML = '';

        const products = await getProducts();

        if (!products || products.length === 0) {
            gridContainer.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <p style="color: #a0a0b0; font-size: 18px; margin-bottom: 20px;">
                        😔 Nenhum produto disponível no momento
                    </p>
                    <p style="color: #6b7c8f; font-size: 14px;">
                        Tente atualizar a página em breve.
                    </p>
                    <button onclick="location.reload()" class="btn btn--secondary" style="margin-top: 20px;">
                        🔄 Atualizar
                    </button>
                </div>
            `;
            return;
        }

        products.forEach(product => {
            const card = createProductCard(product);
            gridContainer.appendChild(card);
        });

        console.log(`✅ ${products.length} produtos renderizados`);

    } catch (error) {
        console.error('❌ Erro ao renderizar produtos:', error);
        gridContainer.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; color: #ff6464;">
                <p>❌ Ops! Problema de conexão com o banco. Tente atualizar a página.</p>
            </div>
        `;
    }
}

/**
 * ================================================
 * CRIAR CARD DE PRODUTO
 * ================================================
 */

function createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const vendorName = product.profiles?.full_name || 'Vendedor';
    const vendorOnline = product.vendor_online !== false;
    const disponivel = (product.stock || 0) > 0 && vendorOnline;

    // ✅ NOVO (v2.2): link do WhatsApp do vendedor, se ele tiver telefone salvo
    const waLink = window.buildWhatsAppLink ? window.buildWhatsAppLink(product.profiles?.phone) : null;

    card.innerHTML = `
        <div class="product-image">
            <img src="${product.image_url || 'https://via.placeholder.com/200'}" 
                 alt="${product.name}"
                 loading="lazy"
                 onerror="this.src='https://via.placeholder.com/200'">
            ${getStockBadge(product)}
        </div>
        
        <div class="product-info">
            <h3 class="product-title">${product.name}</h3>
            <p class="product-vendor">${vendorName}</p>
            
            <p class="product-description">${product.description || 'Sem descrição'}</p>
            
            <div class="product-price">
               <span class="price-value">R$ ${window.formatBRL(product.price || 0)}</span>
            </div>

            ${waLink ? `
                <a href="${waLink}" target="_blank" rel="noopener" class="btn btn--secondary btn--full" style="margin-bottom: 8px; display: block; text-align: center;">
                    💬 Falar com o Vendedor
                </a>
            ` : ''}

            <button class="btn btn--primary btn--full" onclick="openCheckoutModal('${product.id}')" ${!disponivel ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
                ${!vendorOnline ? '🔌 Vendedor Offline' : disponivel ? '🛒 Comprar' : '❌ Fora de Estoque'}
            </button>
        </div>
    `;
    return card;
}

/**
 * ================================================
 * BADGE DE ESTOQUE / DISPONIBILIDADE
 * ================================================
 */

function getStockBadge(product) {
    const vendorOnline = product.vendor_online !== false;

    if (!vendorOnline) {
        return `<div class="stock-badge stock-badge--out">🔌 Vendedor Offline</div>`;
    }

    const estoque = product.stock || 0;

    if (estoque === 0) {
        return `<div class="stock-badge stock-badge--out">❌ Fora de Estoque</div>`;
    }

    if (estoque <= 5) {
        return `<div class="stock-badge stock-badge--low">⚠️ ${estoque} restantes</div>`;
    }

    return '';
}

/**
 * ================================================
 * MODAL DE CHECKOUT (SEM LOGIN)
 * ================================================
 */

function openCheckoutModal(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    if (product.vendor_online === false) {
        alert('🔌 Este vendedor está temporariamente offline. Tente novamente mais tarde.');
        return;
    }

    if ((product.stock || 0) === 0) {
        alert('❌ Produto fora de estoque!');
        return;
    }

    const modal = document.getElementById('checkout-modal');
    if (!modal) return;

    document.getElementById('checkout-product-name').textContent = product.name;
    document.getElementById('checkout-product-price').textContent = `R$ ${window.formatBRL(product.price)}`;
    document.getElementById('checkout-product-id').value = productId;

    document.getElementById('checkout-form').reset();

    modal.classList.add('modal--active');
    modal.style.display = 'flex';
}

function closeCheckoutModal() {
    const modal = document.getElementById('checkout-modal');
    if (modal) {
        modal.classList.remove('modal--active');
        modal.style.display = 'none';
    }
}

/**
 * ================================================
 * SUBMISSÃO DO CHECKOUT
 * ✅ FIX: antes só fazia console.log e fingia sucesso.
 *    Agora grava de verdade em orders / order_items.
 * ================================================
 */

async function handleCheckout(event) {
    event.preventDefault();

    const productId = document.getElementById('checkout-product-id').value;
    const name = document.getElementById('checkout-name').value.trim();
    const curso = document.getElementById('checkout-curso').value.trim();
    const whatsapp = document.getElementById('checkout-whatsapp').value.trim();

    if (!name || !curso || !whatsapp) {
        alert('❌ Preencha todos os campos obrigatórios');
        return;
    }

    const product = allProducts.find(p => p.id === productId);
    if (!product) {
        alert('❌ Produto não encontrado');
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn?.innerText;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = '⏳ ENVIANDO...'; }

    try {
        if (!window._supabase) throw new Error('Supabase não disponível');

        // Cria o pedido (curso vai anexado ao nome do cliente, já que
        // a tabela orders não tem uma coluna própria pra isso)
        const { data: orderData, error: orderError } = await window._supabase
            .from('orders')
            .insert([{
                customer_name: `${name} (${curso})`,
                customer_phone: whatsapp,
                payment_method: 'A combinar',
                total_amount: product.price,
                status: 'pending'
            }])
            .select();

        if (orderError) throw orderError;
        if (!orderData || orderData.length === 0) throw new Error('Erro ao criar pedido');

        const orderId = orderData[0].id;

        // Cria o item do pedido, com o custo real do produto (pro BI calcular lucro certo)
        const { error: itemError } = await window._supabase
            .from('order_items')
            .insert([{
                order_id: orderId,
                product_id: product.id,
                quantity: 1,
                unit_price: product.price,
                unit_cost: product.cost_price || 0
            }]);

        if (itemError) throw itemError;

        // Decrementa estoque
        await window._supabase
            .from('products')
            .update({ stock: Math.max(0, (product.stock || 0) - 1) })
            .eq('id', product.id);

        console.log('✅ Pedido criado:', orderId);
        alert(`✅ Pedido enviado com sucesso!\n\nNos vemos em breve, ${name}! 🎉`);
        closeCheckoutModal();

        // Recarrega produtos pra refletir o novo estoque
        renderProducts();

    } catch (error) {
        console.error('Erro ao criar pedido:', error);

        // Mensagem amigável quando o banco bloqueia a compra
        // (loja fechada por Sabbath/horário noturno, ou vendedor offline)
        const isBlockedByHours = error.code === '42501' || /row-level security/i.test(error.message || '');
        if (isBlockedByHours) {
            alert('🔒 Não foi possível concluir a compra agora.\n\nA loja está fechada no momento (horário de funcionamento, Sabbath, ou o vendedor deste produto está temporariamente offline). Tente novamente mais tarde.');
        } else {
            alert('❌ Erro ao processar pedido. Tente novamente.');
        }
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = originalText; }
    }
}

/**
 * ================================================
 * MENSAGEM DE ERRO DE CONEXÃO
 * ================================================
 */

function showConnectionError() {
    const gridContainer = document.getElementById('product-grid');
    if (gridContainer) {
        gridContainer.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; color: #ff6464;">
                <p style="font-size: 18px; margin-bottom: 10px;">🔴 Ops! Problema de conexão com o banco.</p>
                <p style="color: #a0a0b0; margin-bottom: 20px;">Tente atualizar a página.</p>
                <button onclick="location.reload()" class="btn btn--secondary">🔄 Atualizar Agora</button>
            </div>
        `;
    }
}

/**
 * ================================================
 * INICIALIZAÇÃO AO CARREGAR PÁGINA
 * ================================================
 */

function initVitrine() {
    console.log('🚀 Inicializando vitrine...');

    if (!window._supabase) {
        console.error('❌ Supabase não disponível — verifique se config.js foi carregado antes deste arquivo');
        showConnectionError();
        return;
    }

    renderProducts();

    const modal = document.getElementById('checkout-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeCheckoutModal();
            }
        });
    }

    console.log('✅ Vitrine inicializada');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVitrine);
} else {
    initVitrine();
}

window.renderProducts = renderProducts;
window.openCheckoutModal = openCheckoutModal;
window.closeCheckoutModal = closeCheckoutModal;
window.handleCheckout = handleCheckout;

console.log('✅ script-vitrine.js carregado');
