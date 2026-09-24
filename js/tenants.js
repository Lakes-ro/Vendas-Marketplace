/**
 * TENANTS.JS v2.1
 * v2.1 (auditoria):
 *  - SEGURANÇA: nome/email/telefone/produtos escapados (XSS)
 *  - promover por email com busca exata (antes "_" e "%" viravam curinga)
 *  - classes de cor fixas (as montadas por template não existiam no
 *    Tailwind compilado)
 *  - rótulo "Banir / Reativar" condiz com o que o banco grava ('banned')
 */

const Tenants = {
    tenants: [],
    products: [],
    supremeAdmins: [],

    async loadDashboard() {
        try {
            if (!window.APP.auth.isSupreme()) return;

            const [sellersRes, productsRes] = await Promise.all([
                _supabase.from('profiles')
                    .select('id, email, full_name, phone, role, status, created_at')
                    .eq('role', 'seller')
                    .order('created_at', { ascending: false }),
                _supabase.from('products')
                    .select('id, owner_id, name, price, stock, active, created_at')
            ]);
            if (sellersRes.error) throw sellersRes.error;
            if (productsRes.error) throw productsRes.error;

            this.tenants = sellersRes.data || [];
            this.products = productsRes.data || [];

            this.renderTenantsList();
            this.renderTenantStats();
            await this.loadSupremeAdmins();
        } catch (err) {
            log(`❌ Dashboard vendedores: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    _productsOf(ownerId) {
        return this.products.filter(p => p.owner_id === ownerId);
    },

    renderTenantsList() {
        const list = document.getElementById('tenants-list');
        if (!list) return;

        if (!this.tenants.length) {
            list.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhum vendedor cadastrado</div>';
            return;
        }

        list.innerHTML = this.tenants.map(seller => {
            const mine = this._productsOf(seller.id);
            const active = mine.filter(p => p.active);
            const totalStock = active.reduce((s, p) => s + (Number(p.stock) || 0), 0);
            const totalValue = active.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.stock) || 0), 0);
            const isActive = seller.status !== 'banned';
            const id = escapeHtml(seller.id);

            return `
                <div class="bg-slate-900/50 p-6 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-all">
                    <div class="flex justify-between items-start mb-4 gap-3">
                        <div class="flex-1 min-w-0">
                            <h3 class="text-lg font-black text-white truncate">${escapeHtml(seller.full_name || 'Sem nome')}</h3>
                            <p class="text-xs text-slate-400 mt-1 truncate">${escapeHtml(seller.email)}</p>
                            <p class="text-xs text-slate-500 mt-1">📱 ${escapeHtml(seller.phone || 'Sem telefone')}</p>
                        </div>
                        <span class="inline-block px-3 py-1 rounded-full text-[10px] font-black flex-shrink-0 ${isActive
                            ? 'text-green-500 bg-green-500/10 border border-green-500/30'
                            : 'text-red-500 bg-red-500/10 border border-red-500/30'}">
                            ${isActive ? '✅ ATIVO' : '⛔ BANIDO'}
                        </span>
                    </div>

                    <div class="grid grid-cols-3 gap-3 my-4 bg-white/5 p-3 rounded-lg border border-white/5">
                        <div class="text-center">
                            <div class="text-lg font-black text-blue-400">${mine.length}</div>
                            <div class="text-[10px] text-slate-500">Produtos</div>
                        </div>
                        <div class="text-center">
                            <div class="text-lg font-black text-yellow-400">${totalStock}</div>
                            <div class="text-[10px] text-slate-500">Em Estoque</div>
                        </div>
                        <div class="text-center">
                            <div class="text-lg font-black text-green-400">R$ ${formatBRL(totalValue, 0)}</div>
                            <div class="text-[10px] text-slate-500">Valor Est.</div>
                        </div>
                    </div>

                    <div class="flex justify-between items-center text-xs text-slate-500 pt-3 border-t border-white/5">
                        <span>📅 Desde ${new Date(seller.created_at).toLocaleDateString('pt-BR')}</span>
                        <div class="flex gap-3">
                            <button onclick="window.APP.tenants.viewTenantDetails('${id}')" class="text-blue-500 hover:text-blue-400 font-bold">👁️ DETALHES</button>
                            <button onclick="window.APP.tenants.changeTenantStatus('${id}')" class="${isActive ? 'text-red-500 hover:text-red-400' : 'text-green-500 hover:text-green-400'} font-bold">
                                ${isActive ? '⛔ BANIR' : '🔓 REATIVAR'}
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('');
    },

    renderTenantStats() {
        const statsDiv = document.getElementById('tenants-stats');
        if (!statsDiv) return;

        const activeCount = this.tenants.filter(t => t.status !== 'banned').length;
        const activeProducts = this.products.filter(p => p.active);
        const totalStock = activeProducts.reduce((s, p) => s + (Number(p.stock) || 0), 0);
        const totalValue = activeProducts.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.stock) || 0), 0);
        const top = this.getTopseller();

        statsDiv.innerHTML = `
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-gradient-to-br from-purple-900/30 to-purple-800/10 border border-purple-500/30 p-4 rounded-2xl">
                    <div class="text-3xl font-black text-purple-400">${this.tenants.length}</div>
                    <div class="text-xs text-slate-500 mt-2">Total de Vendedores</div>
                    <div class="text-[10px] text-slate-600 mt-1">${activeCount} ativos • ${this.tenants.length - activeCount} banidos</div>
                </div>
                <div class="bg-gradient-to-br from-blue-900/30 to-blue-800/10 border border-blue-500/30 p-4 rounded-2xl">
                    <div class="text-3xl font-black text-blue-400">${activeProducts.length}</div>
                    <div class="text-xs text-slate-500 mt-2">Produtos no Catálogo</div>
                    <div class="text-[10px] text-slate-600 mt-1">${this.products.length - activeProducts.length} retidos/inativos</div>
                </div>
                <div class="bg-gradient-to-br from-yellow-900/30 to-yellow-800/10 border border-yellow-500/30 p-4 rounded-2xl">
                    <div class="text-3xl font-black text-yellow-400">${totalStock}</div>
                    <div class="text-xs text-slate-500 mt-2">Itens em Estoque</div>
                </div>
                <div class="bg-gradient-to-br from-green-900/30 to-green-800/10 border border-green-500/30 p-4 rounded-2xl">
                    <div class="text-3xl font-black text-green-400">R$ ${formatBRL(totalValue, 0)}</div>
                    <div class="text-xs text-slate-500 mt-2">Valor em Estoque</div>
                    <div class="text-[10px] text-slate-600 mt-1 truncate">${top ? `Top: ${escapeHtml(top.name)}` : 'Sem dados'}</div>
                </div>
            </div>`;
    },

    getTopseller() {
        const rows = this.tenants
            .map(t => ({ name: t.full_name || t.email, count: this._productsOf(t.id).length }))
            .filter(r => r.count > 0)
            .sort((a, b) => b.count - a.count);
        return rows[0] || null;
    },

    viewTenantDetails(tenantId) {
        const tenant = this.tenants.find(t => t.id === tenantId);
        if (!tenant) return;

        const modal = document.getElementById('tenant-details-modal');
        const title = document.getElementById('tenant-details-title');
        const content = document.getElementById('tenant-details-content');
        if (!modal || !title || !content) return;

        title.textContent = `📦 Produtos de ${tenant.full_name || tenant.email}`;
        const mine = this._productsOf(tenantId);

        content.innerHTML = !mine.length
            ? '<div class="text-slate-600 text-center py-8">Nenhum produto</div>'
            : mine.map(p => {
                const stock = Number(p.stock) || 0;
                const status = !p.active ? ['text-orange-400', '🚫 RETIDO'] : stock > 0 ? ['text-green-500', '✅ ATIVO'] : ['text-red-500', '❌ ZERO'];
                return `
                    <div class="flex justify-between items-center bg-slate-800/50 p-3 rounded-lg border border-white/5">
                        <div class="flex-1 min-w-0">
                            <span class="text-sm font-bold text-white block truncate">${escapeHtml(p.name)}</span>
                            <span class="text-xs text-slate-500 block mt-1">R$ ${formatBRL(p.price)} • Est: ${stock}</span>
                        </div>
                        <div class="text-xs ${status[0]} font-bold flex-shrink-0 ml-2">${status[1]}</div>
                    </div>`;
            }).join('');

        modal.classList.remove('hidden');
    },

    async changeTenantStatus(tenantId) {
        const tenant = this.tenants.find(t => t.id === tenantId);
        if (!tenant) return;
        const ban = tenant.status !== 'banned';
        const msg = ban
            ? `Banir "${tenant.full_name || tenant.email}"?\n\nOs produtos dele somem da vitrine e ele é desconectado no próximo acesso.`
            : `Reativar "${tenant.full_name || tenant.email}"?`;
        if (!confirm(msg)) return;

        try {
            const { data, error } = await _supabase.from('profiles')
                .update({ status: ban ? 'banned' : 'active' })
                .eq('id', tenantId)
                .select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('O banco recusou a alteração');
            await this.loadDashboard();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        }
    },

    closeTenantDetailsModal() {
        document.getElementById('tenant-details-modal')?.classList.add('hidden');
    },

    // ── Administradores Supremos ────────────────────────────────

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
            log(`❌ Admins supremos: ${err.message}`, 'error');
        }
    },

    renderSupremeAdmins() {
        const list = document.getElementById('supreme-admins-list');
        if (!list) return;
        if (!this.supremeAdmins.length) {
            list.innerHTML = '<div class="text-slate-600 text-center py-4">Nenhum admin supremo encontrado</div>';
            return;
        }

        const me = window.APP?.auth?.userId;
        list.innerHTML = this.supremeAdmins.map(admin => {
            const isFounder = !!admin.is_founder;
            return `
                <div class="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/5">
                    <div class="flex-1 min-w-0">
                        <span class="font-bold text-white block">
                            ${escapeHtml(admin.full_name || 'Sem nome')}
                            ${isFounder ? '<span class="ml-2 text-[10px] font-black px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 uppercase align-middle">🛡️ Fundador</span>' : ''}
                            ${admin.id === me ? '<span class="ml-2 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 uppercase align-middle">Você</span>' : ''}
                        </span>
                        <span class="text-xs text-slate-500 truncate block">${escapeHtml(admin.email)}</span>
                    </div>
                    ${isFounder
                        ? '<span class="text-[10px] text-slate-600 font-bold uppercase flex-shrink-0 ml-3">Protegido</span>'
                        : `<button onclick="window.APP.tenants.revokeSupreme('${escapeHtml(admin.id)}')" class="text-red-500 hover:text-red-400 text-xs font-bold flex-shrink-0 ml-3">🔒 Revogar Acesso</button>`}
                </div>`;
        }).join('');
    },

    promptPromoteSupreme() {
        const email = prompt('Digite o e-mail EXATO da pessoa (ela precisa já ter uma conta criada) que você quer promover a Admin Supremo:');
        if (!email || !email.trim()) return;
        this.promoteToSupreme(email.trim().toLowerCase());
    },

    async promoteToSupreme(email) {
        try {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido');

            // ilike sem curingas = comparação exata sem diferenciar maiúsculas
            const pattern = email.replace(/[\\%_]/g, (c) => `\\${c}`);
            const { data, error } = await _supabase
                .from('profiles')
                .select('id, email, full_name, role')
                .ilike('email', pattern)
                .limit(2);
            if (error) throw error;

            const target = (data || []).find(p => (p.email || '').toLowerCase() === email);
            if (!target) {
                alert('❌ Não encontrei nenhuma conta com esse e-mail.\n\nA pessoa precisa criar a conta primeiro (tela de Cadastro).');
                return;
            }
            if (target.role === 'supreme') { alert('ℹ️ Essa pessoa já é Admin Supremo.'); return; }

            if (!confirm(`Promover "${target.full_name || target.email}" a Admin Supremo?\n\nEla terá acesso TOTAL: produtos de todos os vendedores, todos os pedidos, BI completo, anúncios e gestão de vendedores.`)) return;

            const { data: upd, error: updErr } = await _supabase.from('profiles')
                .update({ role: 'supreme' }).eq('id', target.id).select('id');
            if (updErr) throw updErr;
            if (!upd?.length) throw new Error('O banco recusou a alteração');

            alert('✅ Promovido com sucesso!');
            await this.loadDashboard();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        }
    },

    async revokeSupreme(userId) {
        const target = this.supremeAdmins.find(a => a.id === userId);
        if (target?.is_founder) { alert('❌ Esta conta é a fundadora do sistema e não pode ser revogada.'); return; }

        const isSelf = userId === window.APP?.auth?.userId;
        if (!confirm(`${isSelf ? '⚠️ Você está removendo o SEU PRÓPRIO acesso de Admin.\n\n' : ''}Revogar o acesso de Admin Supremo de "${target?.full_name || target?.email || 'esta conta'}"?\n\nA conta volta a ser Vendedor.`)) return;

        try {
            const { data, error } = await _supabase.from('profiles')
                .update({ role: 'seller' }).eq('id', userId).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('O banco recusou a alteração');

            if (isSelf) {
                await window.APP.auth.init();
                await window.APP.onAuthChanged();
                window.APP.navigation.showTab('market');
                return;
            }
            await this.loadDashboard();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        }
    }
};
