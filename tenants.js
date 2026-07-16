/**
 * TENANTS.JS v2.0
 * 🏪 Dashboard de Gerenciamento de Vendedores ("Inquilinos")
 * Apenas para SUPREMO - Ver, analisar e controlar todos os vendedores
 * ✅ v2.0 NOVO: gestão de Administradores Supremos — o Admin Supremo pode
 *    promover qualquer conta já cadastrada a Admin Supremo (ex: diretor da
 *    instituição, pra fiscalizar tudo) e revogar acesso de quem promoveu.
 *    A conta FUNDADORA do sistema (marcada como is_founder no banco) nunca
 *    pode ter o cargo alterado por ninguém — nem por outro Admin Supremo —
 *    isso é garantido tanto aqui no app quanto por um gatilho no próprio
 *    banco de dados (segunda camada de defesa).
 */

const Tenants = {
    tenants: [],
    products: [],
    supremeAdmins: [],

    async loadDashboard() {
        try {
            log('🏪 Carregando Dashboard de Vendedores...', 'info');

            if (!window.APP.auth.isSupreme()) {
                alert('❌ Acesso negado');
                return;
            }

            // 1. Carregar todos os perfis que são sellers
            const { data: sellers, error: sellersError } = await _supabase
                .from('profiles')
                .select('id, email, full_name, phone, role, status, created_at')
                .eq('role', 'seller')
                .order('created_at', { ascending: false });

            if (sellersError) throw sellersError;

            this.tenants = sellers || [];

            // 2. Carregar todos os produtos
            const { data: products, error: productsError } = await _supabase
                .from('products')
                .select('id, owner_id, name, price, stock, active, created_at')
                .eq('active', true);

            if (productsError) throw productsError;

            this.products = products || [];

            // 3. Renderizar
            this.renderTenantsList();
            this.renderTenantStats();

            // 4. ✅ NOVO: carregar e renderizar Admins Supremos
            await this.loadSupremeAdmins();

            log(`✅ ${this.tenants.length} vendedores carregados`, 'success');

        } catch (err) {
            log(`❌ Erro ao carregar dashboard tenants: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    /**
     * Lista de vendedores com stats
     */
    renderTenantsList() {
        try {
            const list = document.getElementById('tenants-list');
            if (!list) {
                log('⚠️ #tenants-list não encontrado', 'warning');
                return;
            }

            if (!this.tenants || this.tenants.length === 0) {
                list.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhum vendedor cadastrado</div>';
                return;
            }

            list.innerHTML = this.tenants.map(seller => {
                // Contar produtos do vendedor
                const productCount = this.products.filter(p => p.owner_id === seller.id).length;
                
                // Calcular total em estoque
                const totalStock = this.products
                    .filter(p => p.owner_id === seller.id)
                    .reduce((sum, p) => sum + (p.stock || 0), 0);

                // Calcular valor total em estoque
                const totalValue = this.products
                    .filter(p => p.owner_id === seller.id)
                    .reduce((sum, p) => sum + ((p.price || 0) * (p.stock || 0)), 0);

                // Status com cor
                const statusColor = seller.status === 'active' 
                    ? 'text-green-500' 
                    : 'text-red-500';

                // Data formatada
                const createdDate = new Date(seller.created_at).toLocaleDateString('pt-BR');

                return `
                    <div class="bg-slate-900/50 p-6 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-all">
                        
                        <!-- HEADER: Nome e Email -->
                        <div class="flex justify-between items-start mb-4">
                            <div class="flex-1">
                                <h3 class="text-lg font-black text-white">${seller.full_name}</h3>
                                <p class="text-xs text-slate-400 mt-1">${seller.email}</p>
                                <p class="text-xs text-slate-500 mt-1">📱 ${seller.phone || 'Sem telefone'}</p>
                            </div>
                            <div class="text-right">
                                <span class="inline-block px-3 py-1 rounded-full text-[10px] font-black ${statusColor} bg-${statusColor === 'text-green-500' ? 'green' : 'red'}-500/10 border border-${statusColor === 'text-green-500' ? 'green' : 'red'}-500/30">
                                    ${seller.status === 'active' ? '✅ ATIVO' : '⛔ INATIVO'}
                                </span>
                            </div>
                        </div>

                        <!-- STATS: Produtos, Estoque, Valor -->
                        <div class="grid grid-cols-3 gap-3 my-4 bg-white/5 p-3 rounded-lg border border-white/5">
                            <div class="text-center">
                                <div class="text-lg font-black text-blue-400">${productCount}</div>
                                <div class="text-[10px] text-slate-500">Produtos</div>
                            </div>
                            <div class="text-center">
                                <div class="text-lg font-black text-yellow-400">${totalStock}</div>
                                <div class="text-[10px] text-slate-500">Em Estoque</div>
                            </div>
                            <div class="text-center">
                                <div class="text-lg font-black text-green-400">R$ ${window.formatBRL(totalValue / 1000, 0)}k</div>
                                <div class="text-[10px] text-slate-500">Valor Est.</div>
                            </div>
                        </div>

                        <!-- DATA E AÇÕES -->
                        <div class="flex justify-between items-center text-xs text-slate-500 pt-3 border-t border-white/5">
                            <span>📅 Desde ${createdDate}</span>
                            <div class="flex gap-2">
                                <button onclick="window.APP.tenants.viewTenantDetails('${seller.id}')" class="text-blue-500 hover:text-blue-400 font-bold">
                                    👁️ VER DETALHES
                                </button>
                                <button onclick="window.APP.tenants.changeTenantStatus('${seller.id}', '${seller.status}')" class="text-yellow-500 hover:text-yellow-400 font-bold">
                                    ${seller.status === 'active' ? '🔒 DESATIVAR' : '🔓 ATIVAR'}
                                </button>
                            </div>
                        </div>

                    </div>
                `;
            }).join('');

            if (window.lucide) lucide.createIcons();
            log('✅ Lista de vendedores renderizada', 'success');

        } catch (err) {
            log(`❌ Erro ao renderizar lista: ${err.message}`, 'error');
        }
    },

    /**
     * Stats gerais de todos os vendedores
     */
    renderTenantStats() {
        try {
            const statsDiv = document.getElementById('tenants-stats');
            if (!statsDiv) return;

            // Contar vendedores ativos
            const activeCount = this.tenants.filter(t => t.status === 'active').length;
            const inactiveCount = this.tenants.length - activeCount;

            // Total de produtos
            const totalProducts = this.products.length;

            // Total de estoque
            const totalStockItems = this.products.reduce((sum, p) => sum + (p.stock || 0), 0);

            // Valor total em estoque
            const totalStockValue = this.products.reduce((sum, p) => 
                sum + ((p.price || 0) * (p.stock || 0)), 0
            );

            // Vendedor com mais produtos
            const topSeller = this.getTopseller();

            statsDiv.innerHTML = `
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    
                    <!-- STAT: Total Vendedores -->
                    <div class="bg-gradient-to-br from-purple-900/30 to-purple-800/10 border border-purple-500/30 p-4 rounded-2xl">
                        <div class="text-3xl font-black text-purple-400">${this.tenants.length}</div>
                        <div class="text-xs text-slate-500 mt-2">Total de Vendedores</div>
                        <div class="text-[10px] text-slate-600 mt-1">
                            ${activeCount} ativos • ${inactiveCount} inativos
                        </div>
                    </div>

                    <!-- STAT: Produtos Total -->
                    <div class="bg-gradient-to-br from-blue-900/30 to-blue-800/10 border border-blue-500/30 p-4 rounded-2xl">
                        <div class="text-3xl font-black text-blue-400">${totalProducts}</div>
                        <div class="text-xs text-slate-500 mt-2">Produtos no Catálogo</div>
                        <div class="text-[10px] text-slate-600 mt-1">
                            Distribuídos entre vendedores
                        </div>
                    </div>

                    <!-- STAT: Estoque Total -->
                    <div class="bg-gradient-to-br from-yellow-900/30 to-yellow-800/10 border border-yellow-500/30 p-4 rounded-2xl">
                        <div class="text-3xl font-black text-yellow-400">${totalStockItems}</div>
                        <div class="text-xs text-slate-500 mt-2">Itens em Estoque</div>
                        <div class="text-[10px] text-slate-600 mt-1">
                            Quantidade total
                        </div>
                    </div>

                    <!-- STAT: Valor Estoque -->
                    <div class="bg-gradient-to-br from-green-900/30 to-green-800/10 border border-green-500/30 p-4 rounded-2xl">
                        <div class="text-3xl font-black text-green-400">R$ ${(totalStockValue / 1000).toFixed(1)}k</div>
                        <div class="text-xs text-slate-500 mt-2">Valor em Estoque</div>
                        <div class="text-[10px] text-slate-600 mt-1">
                            ${topSeller ? `Top: ${topSeller.name}` : 'Sem dados'}
                        </div>
                    </div>

                </div>
            `;

        } catch (err) {
            log(`❌ Erro ao renderizar stats: ${err.message}`, 'error');
        }
    },

    /**
     * Obter vendedor com mais produtos
     */
    getTopseller() {
        try {
            if (!this.tenants || !this.products) return null;

            const productsByOwner = {};
            
            this.tenants.forEach(tenant => {
                const count = this.products.filter(p => p.owner_id === tenant.id).length;
                if (count > 0) {
                    productsByOwner[tenant.id] = { name: tenant.full_name, count };
                }
            });

            const sorted = Object.values(productsByOwner).sort((a, b) => b.count - a.count);
            return sorted[0] || null;

        } catch (err) {
            log(`❌ Erro ao calcular topseller: ${err.message}`, 'error');
            return null;
        }
    },

    /**
     * Ver produtos de um vendedor
     */
    viewTenantDetails(tenantId) {
        try {
            const tenant = this.tenants.find(t => t.id === tenantId);
            if (!tenant) {
                alert('❌ Vendedor não encontrado');
                return;
            }

            const tenantProducts = this.products.filter(p => p.owner_id === tenantId);

            const modal = document.getElementById('tenant-details-modal');
            const title = document.getElementById('tenant-details-title');
            const content = document.getElementById('tenant-details-content');

            if (!modal || !title || !content) {
                alert('⚠️ Modal não encontrado no HTML');
                return;
            }

            // Preencher modal
            title.innerText = `📦 Produtos de ${tenant.full_name}`;

            if (tenantProducts.length === 0) {
                content.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhum produto</div>';
            } else {
                content.innerHTML = tenantProducts.map(p => `
                    <div class="flex justify-between items-center bg-slate-800/50 p-3 rounded-lg border border-white/5">
                        <div class="flex-1">
                            <span class="text-sm font-bold text-white">${p.name}</span>
                            <span class="text-xs text-slate-500 block mt-1">R$ ${window.formatBRL(p.price)} • Est: ${p.stock}</span>
                        </div>
                        <div class="text-xs ${p.stock > 0 ? 'text-green-500' : 'text-red-500'} font-bold">
                            ${p.stock > 0 ? '✅ ATIVO' : '❌ ZERO'}
                        </div>
                    </div>
                `).join('');
            }

            // Mostrar modal
            modal.classList.remove('hidden');
            log(`👁️ Visualizando produtos de ${tenant.full_name}`, 'info');

        } catch (err) {
            log(`❌ Erro ao abrir detalhes: ${err.message}`, 'error');
        }
    },

    /**
     * Ativar/Desativar vendedor
     */
    async changeTenantStatus(tenantId, currentStatus) {
        try {
            const newStatus = currentStatus === 'active' ? 'banned' : 'active';
            const action = newStatus === 'active' ? 'ATIVAR' : 'DESATIVAR';

            if (!confirm(`Tem certeza que deseja ${action} este vendedor?`)) return;

            const { error } = await _supabase
                .from('profiles')
                .update({ status: newStatus })
                .eq('id', tenantId);

            if (error) throw error;

            log(`✅ Vendedor ${action}ado`, 'success');
            alert(`✅ Vendedor ${action}ado!`);
            
            // Recarregar
            await this.loadDashboard();

        } catch (err) {
            log(`❌ Erro ao mudar status: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    /**
     * Fechar modal de detalhes
     */
    closeTenantDetailsModal() {
        const modal = document.getElementById('tenant-details-modal');
        if (modal) modal.classList.add('hidden');
    },

    // ============================================================
    // ✅ NOVO (v2.0): GESTÃO DE ADMINISTRADORES SUPREMOS
    // ============================================================

    /**
     * Carrega todas as contas com role='supreme' e renderiza a lista.
     */
    async loadSupremeAdmins() {
        try {
            const { data, error } = await _supabase
                .from('profiles')
                .select('id, email, full_name, is_founder, created_at')
                .eq('role', 'supreme')
                .order('is_founder', { ascending: false })
                .order('created_at', { ascending: true });

            if (error) throw error;

            this.supremeAdmins = data || [];
            this.renderSupremeAdmins();
        } catch (err) {
            log(`❌ Erro ao carregar admins supremos: ${err.message}`, 'error');
        }
    },

    /**
     * Renderiza a lista de Admins Supremos. A conta fundadora (is_founder)
     * aparece com um selo "Fundador" e SEM botão de revogar — ela é
     * protegida também no banco, então mesmo alguém tentando forçar essa
     * chamada pelo console não consegue mudar o cargo dela.
     */
    renderSupremeAdmins() {
        const list = document.getElementById('supreme-admins-list');
        if (!list) return;

        if (!this.supremeAdmins || this.supremeAdmins.length === 0) {
            list.innerHTML = '<div class="text-slate-600 text-center py-4">Nenhum admin supremo encontrado</div>';
            return;
        }

        const currentUserId = window.APP?.auth?.userId;

        list.innerHTML = this.supremeAdmins.map(admin => {
            const isFounder = !!admin.is_founder;
            const isSelf = admin.id === currentUserId;

            return `
                <div class="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/5">
                    <div class="flex-1 min-w-0">
                        <span class="font-bold text-white block">
                            ${admin.full_name || 'Sem nome'}
                            ${isFounder ? '<span class="ml-2 text-[10px] font-black px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 uppercase align-middle">🛡️ Fundador</span>' : ''}
                            ${isSelf ? '<span class="ml-2 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 uppercase align-middle">Você</span>' : ''}
                        </span>
                        <span class="text-xs text-slate-500 truncate block">${admin.email}</span>
                    </div>
                    ${!isFounder ? `
                        <button onclick="window.APP.tenants.revokeSupreme('${admin.id}')" class="text-red-500 hover:text-red-400 text-xs font-bold flex-shrink-0 ml-3">
                            🔒 Revogar Acesso
                        </button>
                    ` : `
                        <span class="text-[10px] text-slate-600 font-bold uppercase flex-shrink-0 ml-3">Protegido</span>
                    `}
                </div>
            `;
        }).join('');
    },

    /**
     * Abre um prompt simples pedindo o e-mail da pessoa a promover.
     * A pessoa precisa já ter uma conta criada no sistema (Cadastro).
     */
    promptPromoteSupreme() {
        const email = prompt('Digite o e-mail EXATO da pessoa (ela precisa já ter uma conta criada no sistema) que você quer promover a Admin Supremo:');
        if (!email || !email.trim()) return;
        this.promoteToSupreme(email.trim().toLowerCase());
    },

    /**
     * Promove uma conta já existente a Admin Supremo. Acesso total ao
     * marketplace: vê todos os pedidos, produtos de todos os vendedores,
     * BI completo, anúncios e gestão de vendedores — pensado, por exemplo,
     * pro diretor da instituição fiscalizar o que está sendo vendido.
     */
    async promoteToSupreme(email) {
        try {
            const { data: target, error: findError } = await _supabase
                .from('profiles')
                .select('id, email, full_name, role')
                .ilike('email', email)
                .maybeSingle();

            if (findError) throw findError;

            if (!target) {
                alert('❌ Não encontrei nenhuma conta com esse e-mail.\n\nA pessoa precisa criar a conta dela primeiro (tela de Cadastro) — depois disso você consegue promover.');
                return;
            }

            if (target.role === 'supreme') {
                alert('ℹ️ Essa pessoa já é Admin Supremo.');
                return;
            }

            if (!confirm(`Confirma promover "${target.full_name || target.email}" a Admin Supremo?\n\nEla passará a ter acesso TOTAL: ver e gerenciar produtos de todos os vendedores, todos os pedidos, o BI completo do marketplace, anúncios e a gestão de vendedores.`)) {
                return;
            }

            const { error: updateError } = await _supabase
                .from('profiles')
                .update({ role: 'supreme' })
                .eq('id', target.id);

            if (updateError) throw updateError;

            log(`✅ ${target.email} promovido a Admin Supremo`, 'success');
            alert('✅ Promovido com sucesso!');

            await this.loadSupremeAdmins();
            await this.loadDashboard();
        } catch (err) {
            log(`❌ Erro ao promover: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    /**
     * Revoga o acesso de Admin Supremo de alguém que você promoveu
     * (a conta volta a ser Vendedor). A conta FUNDADORA nunca aparece com
     * esse botão na tela, e mesmo que alguém tente chamar essa função
     * manualmente pelo console apontando pro ID da fundadora, o banco
     * bloqueia a alteração (gatilho de proteção do fundador).
     */
    async revokeSupreme(userId) {
        try {
            const target = this.supremeAdmins.find(a => a.id === userId);

            if (target?.is_founder) {
                alert('❌ Esta conta é a fundadora do sistema e não pode ser revogada.');
                return;
            }

            if (!confirm(`Revogar o acesso de Admin Supremo de "${target?.full_name || target?.email || 'esta conta'}"?\n\nA conta volta a ser Vendedor comum.`)) {
                return;
            }

            const { error } = await _supabase
                .from('profiles')
                .update({ role: 'seller' })
                .eq('id', userId);

            if (error) throw error;

            log('✅ Acesso de Admin Supremo revogado', 'success');
            alert('✅ Acesso revogado — a conta agora é Vendedor.');

            await this.loadSupremeAdmins();
            await this.loadDashboard();
        } catch (err) {
            log(`❌ Erro ao revogar: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    }
};
