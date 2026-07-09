/**
 * PRODUCTS.JS v4.0 - CORRIGIDO
 * ✅ Removido código do script-vitrine.js que estava colado no final por engano
 * ✅ saveProductDirect() para botão onclick sem form
 * ✅ fetchAll() com filtro status=active
 * ✅ render() com try/catch completo
 */

const PRODUCT_PLACEHOLDER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='160' viewBox='0 0 200 160'%3E%3Crect width='200' height='160' fill='%231e293b'/%3E%3Crect x='70' y='45' width='60' height='50' rx='6' fill='%23334155'/%3E%3Ccircle cx='100' cy='115' r='8' fill='%23334155'/%3E%3Ctext x='100' y='145' text-anchor='middle' font-size='11' fill='%2364748b' font-family='sans-serif'%3ESem imagem%3C/text%3E%3C/svg%3E`;

const Products = {
    editingId: null,
    products: [],

    async fetchAll() {
        try {
            log('📦 Carregando produtos...', 'info');

            const { data, error } = await _supabase
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
                    active,
                    created_at,
                    profiles!owner_id(id, full_name, email)
                `)
                .eq('active', true)
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.products = data || [];

            this.render();

            if (window.APP?.auth?.userId) {
                setTimeout(() => {
                    this.renderAdmin();
                    if (window.APP.auth.role === 'seller') {
                        this.renderSeller();
                    }
                }, 300);
            }

            log(`✅ ${this.products.length} produtos carregados`, 'success');
            return this.products;

        } catch (err) {
            log(`❌ Erro ao carregar produtos: ${err.message}`, 'error');
            return [];
        }
    },

    render() {
        try {
            const grid = document.getElementById('product-grid');
            if (!grid) {
                log('⚠️ #product-grid não encontrado', 'warning');
                return;
            }

            if (!this.products || this.products.length === 0) {
                grid.innerHTML = '<div class="col-span-full text-slate-600 text-center py-12">Nenhum produto disponível</div>';
                return;
            }

            grid.innerHTML = this.products.map(p => {
                const estoque = p.stock || 0;
                const disponivel = estoque > 0;
                const vendedor = p.profiles?.full_name || 'Vendedor';

                return `
                    <div class="bg-slate-900/40 p-6 rounded-[32px] border border-white/5 flex flex-col gap-4 hover:border-blue-500/30 transition-all">
                        ${p.image_url
                            ? `<img src="${p.image_url}" alt="${p.name}" class="w-full h-44 object-cover rounded-2xl" onerror="if(!this.dataset.err){this.dataset.err=1;this.src=PRODUCT_PLACEHOLDER}">`
                            : `<div class="w-full h-44 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-600">SEM IMAGEM</div>`
                        }

                        <h3 class="text-xl font-bold text-white">${p.name}</h3>
                        <p class="text-slate-500 text-xs line-clamp-2">${p.description || ''}</p>

                        <div class="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-lg border border-white/5">
                            <i data-lucide="store" class="w-3 h-3 text-yellow-500"></i>
                            <span class="text-xs text-yellow-300 font-semibold truncate">Vendido por: ${vendedor}</span>
                        </div>

                        <div class="flex justify-between items-center">
                            <div class="text-2xl font-black text-white">R$ ${Number(p.price).toFixed(2)}</div>
                            <div class="text-xs font-black ${disponivel ? 'text-green-500' : 'text-red-500'}">
                                ${disponivel ? `${estoque} em estoque` : 'Fora de estoque'}
                            </div>
                        </div>

                        <button
                            data-action="add-to-cart"
                            data-id="${p.id}"
                            data-name="${p.name.replace(/'/g, "\\'")}"
                            data-price="${p.price}"
                            class="bg-blue-600 py-4 rounded-2xl font-black text-xs uppercase text-white hover:bg-blue-500 transition-all ${!disponivel ? 'opacity-50 cursor-not-allowed' : ''}"
                            ${!disponivel ? 'disabled' : ''}>
                            Adicionar ao Carrinho
                        </button>
                    </div>
                `;
            }).join('');

            if (window.lucide) lucide.createIcons();
            log('✅ Marketplace renderizado', 'success');

        } catch (err) {
            log(`❌ Erro ao renderizar marketplace: ${err.message}`, 'error');
        }
    },

    renderAdmin() {
        try {
            const list = document.getElementById('admin-list');
            if (!list) return;

            let filtrado = this.products;

            if (window.APP?.auth?.role === 'seller') {
                filtrado = this.products.filter(p => p.owner_id === window.APP.auth.userId);
            }

            if (!filtrado || filtrado.length === 0) {
                list.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhum produto</div>';
                return;
            }

            list.innerHTML = filtrado.map(p => `
                <div class="flex justify-between items-center bg-slate-900/50 p-4 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-all">
                    <div class="flex-1">
                        <span class="font-bold text-white block">${p.name}</span>
                        <span class="text-xs text-yellow-400 font-semibold mt-1">👤 ${p.profiles?.full_name || 'Desconhecido'}</span>
                        <span class="text-xs text-slate-500 mt-1 block">R$ ${Number(p.price).toFixed(2)}</span>
                        <span class="text-xs ${p.stock > 10 ? 'text-green-500' : p.stock > 0 ? 'text-yellow-500' : 'text-red-500'} font-black mt-1 block">
                            Estoque: ${p.stock}
                        </span>
                    </div>
                    <div class="flex gap-2">
                        <button onclick='window.APP.products.edit(${JSON.stringify(p).replace(/'/g, "&apos;")})' class="text-blue-500 p-2 hover:bg-blue-500/10 rounded-lg transition-all">
                            <i data-lucide="edit-3" class="w-4 h-4"></i>
                        </button>
                        <button onclick="window.APP.products.delete('${p.id}')" class="text-red-500 p-2 hover:bg-red-500/10 rounded-lg transition-all">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            if (window.lucide) lucide.createIcons();
            log('✅ Admin list renderizado', 'success');

        } catch (err) {
            log(`❌ Erro ao renderizar admin: ${err.message}`, 'error');
        }
    },

    renderSeller() {
        try {
            const list = document.getElementById('seller-list');
            if (!list) return;

            if (!window.APP?.auth?.userId) {
                list.innerHTML = '<div class="text-slate-600 text-center py-8">Você precisa estar logado</div>';
                return;
            }

            const meus = this.products.filter(p => p.owner_id === window.APP.auth.userId);

            if (!meus || meus.length === 0) {
                list.innerHTML = '<div class="text-slate-600 text-center py-8">Você não tem produtos ainda</div>';
                return;
            }

            list.innerHTML = meus.map(p => `
                <div class="bg-slate-900/40 p-6 rounded-[32px] border border-white/5 flex flex-col gap-4 hover:border-blue-500/30 transition-all">
                    ${p.image_url
                        ? `<img src="${p.image_url}" alt="${p.name}" class="w-full h-44 object-cover rounded-2xl" onerror="if(!this.dataset.err){this.dataset.err=1;this.src=PRODUCT_PLACEHOLDER}">`
                        : `<div class="w-full h-44 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-600">SEM IMAGEM</div>`
                    }

                    <h3 class="text-xl font-bold text-white">${p.name}</h3>
                    <p class="text-slate-500 text-xs line-clamp-2">${p.description || ''}</p>

                    <div class="flex justify-between items-center">
                        <div class="text-2xl font-black text-white">R$ ${Number(p.price).toFixed(2)}</div>
                        <div class="text-xs font-bold text-slate-400">Estoque: ${p.stock}</div>
                    </div>

                    <div class="flex gap-2">
                        <button onclick='window.APP.products.edit(${JSON.stringify(p).replace(/'/g, "&apos;")})' class="flex-1 bg-blue-600 hover:bg-blue-500 py-2 rounded-2xl font-bold text-xs text-white transition-all">
                            ✏️ EDITAR
                        </button>
                        <button onclick="window.APP.products.delete('${p.id}')" class="flex-1 bg-red-600 hover:bg-red-500 py-2 rounded-2xl font-bold text-xs text-white transition-all">
                            🗑️ DELETAR
                        </button>
                    </div>
                </div>
            `).join('');

            if (window.lucide) lucide.createIcons();
            log('✅ Seller grid renderizado', 'success');

        } catch (err) {
            log(`❌ Erro ao renderizar seller: ${err.message}`, 'error');
        }
    },

    openModal() {
        try {
            if (!window.APP?.auth?.isLoggedIn()) {
                alert('❌ Você precisa fazer login');
                window.APP.auth.openAuthModal();
                return;
            }

            if (!window.APP.auth.userId) {
                alert('❌ Erro ao identificar usuário. Tente fazer login novamente.');
                log('❌ userId undefined ao abrir modal', 'error');
                return;
            }

            this.editingId = null;

            // Resetar campos manualmente (sem form.reset())
            ['p-name', 'p-price', 'p-cost', 'p-stock', 'p-desc'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });

            const title = document.querySelector('#admin-modal h3');
            if (title) title.innerText = 'NOVO PRODUTO';

            document.getElementById('admin-modal')?.classList.remove('hidden');
            log('✅ Modal de produto aberto', 'success');

        } catch (err) {
            log(`❌ Erro ao abrir modal: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    closeModal() {
        try {
            document.getElementById('admin-modal')?.classList.add('hidden');
            this.editingId = null;
        } catch (err) {
            log(`❌ Erro ao fechar modal: ${err.message}`, 'error');
        }
    },

    edit(product) {
        try {
            if (!window.APP.auth.canEditProduct(product.owner_id)) {
                alert('❌ Você não tem permissão para editar este produto');
                return;
            }

            this.editingId = product.id;

            document.getElementById('p-name').value = product.name || '';
            document.getElementById('p-price').value = product.price || 0;
            document.getElementById('p-cost').value = product.cost_price || 0;
            document.getElementById('p-stock').value = product.stock || 0;
            document.getElementById('p-desc').value = product.description || '';

            const title = document.querySelector('#admin-modal h3');
            if (title) title.innerText = `✏️ EDITAR: ${product.name}`;

            document.getElementById('admin-modal')?.classList.remove('hidden');
            log(`✏️ Editando: ${product.name}`, 'info');

        } catch (err) {
            log(`❌ Erro ao editar: ${err.message}`, 'error');
        }
    },

    // ✅ Versão Direct — chamada pelo botão onclick sem form
    async saveProductDirect() {
        const btn = document.getElementById('btn-save');
        const originalText = btn?.innerText;

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerText = '⏳ SALVANDO...';
            }

            if (!window.APP.auth.isLoggedIn()) {
                throw new Error('Você precisa estar logado');
            }

            if (!window.APP.auth.userId) {
                throw new Error('Erro ao identificar usuário');
            }

            const name = document.getElementById('p-name')?.value?.trim();
            const price = parseFloat(document.getElementById('p-price')?.value);

            if (!name) throw new Error('Nome é obrigatório');
            if (!price || price < 0) throw new Error('Preço deve ser válido');

            let imageUrl = null;
            const fileInput = document.getElementById('p-image');

            if (fileInput && fileInput.files.length > 0) {
                const file = fileInput.files[0];

                if (file.size > 5 * 1024 * 1024) {
                    throw new Error('Imagem maior que 5MB');
                }

                const fileName = `${Date.now()}-${file.name}`;

                const { error: uploadError } = await _supabase.storage
                    .from('product-images')
                    .upload(fileName, file);

                if (uploadError) throw uploadError;

                const { data: publicUrl } = _supabase.storage
                    .from('product-images')
                    .getPublicUrl(fileName);

                imageUrl = publicUrl.publicUrl;
                log(`📤 Imagem enviada: ${fileName}`, 'success');
            }

            const productData = {
                name,
                price,
                cost_price: parseFloat(document.getElementById('p-cost')?.value) || 0,
                stock: parseInt(document.getElementById('p-stock')?.value) || 0,
                description: document.getElementById('p-desc')?.value?.trim() || '',
                owner_id: window.APP.auth.userId,
                active: true
            };

            if (imageUrl) productData.image_url = imageUrl;

            let result;
            if (this.editingId) {
                const product = this.products.find(p => p.id === this.editingId);
                if (!window.APP.auth.canEditProduct(product?.owner_id)) {
                    throw new Error('Você não tem permissão para editar este produto');
                }

                result = await _supabase
                    .from('products')
                    .update(productData)
                    .eq('id', this.editingId);

                log('✅ Produto atualizado', 'success');
                alert('✅ Produto atualizado!');
            } else {
                result = await _supabase
                    .from('products')
                    .insert([productData]);

                log('✅ Produto criado', 'success');
                alert('✅ Produto criado!');
            }

            if (result.error) throw result.error;

            this.closeModal();
            await this.fetchAll();

        } catch (err) {
            log(`❌ Erro ao salvar: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = originalText;
            }
        }
    },

    // Mantido para compatibilidade retroativa (admin.js ainda usa saveProduct via form)
    async saveProduct(event) {
        if (event) event.preventDefault();
        await this.saveProductDirect();
    },

    async delete(productId) {
        try {
            const product = this.products.find(p => p.id === productId);

            if (!window.APP.auth.canEditProduct(product?.owner_id)) {
                alert('❌ Você não tem permissão para deletar este produto');
                return;
            }

            if (!confirm(`⚠️ Deletar "${product.name}"?`)) return;
            if (!confirm('❌ ATENÇÃO: IRREVERSÍVEL!')) return;

            log(`🗑️ Deletando ${productId}...`, 'info');

            const { error } = await _supabase
                .from('products')
                .delete()
                .eq('id', productId);

            if (error) throw error;

            log('✅ Produto deletado', 'success');
            alert('✅ Produto removido!');
            await this.fetchAll();

        } catch (err) {
            log(`❌ Erro ao deletar: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    }
};