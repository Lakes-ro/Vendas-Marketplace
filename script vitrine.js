/**
 * ================================================
 * SCRIPT-VITRINE.JS - SISTEMA DE VITRINE COMPLETO
 * ================================================
 * v2.0
 * ✅ Usa window._supabase (criado pelo config.js) — mesmo banco/
 *    mesmas credenciais do marketplace principal, sem projeto Supabase
 *    duplicado/desconhecido.
 * ✅ Usa as tabelas reais do sistema: products / profiles
 * ✅ Checkout agora grava de verdade em orders / order_items
 *    (antes só dava console.log e fingia sucesso)
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
                profiles!owner_id(full_name)
            `)
            .eq('active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        allProducts = data || [];
        console.log(`✅ ${allProducts.length} produtos carregados`);
        return allProducts;

    } catch (error) {
        console.error('❌ Erro crítico ao carregar produtos:', error);
        showConnectionError();
        return [];
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
                <span class="price-value">R$ ${Number(product.price || 0).toFixed(2)}</span>
            </div>

            <button class="btn btn--primary btn--full" onclick="openCheckoutModal('${product.id}')">
                🛒 Comprar
            </button>
        </div>
    `;
    return card;
}

/**
 * ================================================
 * BADGE DE ESTOQUE
 * ================================================
 */

function getStockBadge(product) {
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

    if ((product.stock || 0) === 0) {
        alert('❌ Produto fora de estoque!');
        return;
    }

    const modal = document.getElementById('checkout-modal');
    if (!modal) return;

    document.getElementById('checkout-product-name').textContent = product.name;
    document.getElementById('checkout-product-price').textContent = `R$ ${Number(product.price).toFixed(2)}`;
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
        alert('❌ Erro ao processar pedido. Tente novamente.');
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
