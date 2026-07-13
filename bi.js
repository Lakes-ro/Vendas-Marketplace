/**
 * BI.JS v9.1
 * ✅ Gráfico "Top Produtos" com legenda HTML própria (v7.2)
 * ✅ Fallback de custo (unit_cost) via cost_price atual do produto (v7.1)
 * ✅ Filtro de período + detalhamento com itens/telefone/WhatsApp +
 *    valores desenhados nos gráficos (v8.0)
 * ✅ Formatação R$ no padrão brasileiro (v8.1)
 * ✅ BI escopado por role — vendedor só vê o próprio desempenho (v9.0)
 * ✅ v9.1 NOVO: detalhamento agora mostra a forma de pagamento, um badge
 *    "✔ Pago" ou "Aguardando pagamento", link "📎 Ver Comprovante" (quando
 *    o cliente anexou o comprovante Pix no checkout) e um botão "✔
 *    Confirmar Pagamento" — só pro Admin Supremo, já que o Pix cai numa
 *    conta centralizada, não na de cada vendedor individual. O banco
 *    (trigger + RLS) também impede qualquer outra pessoa de confirmar
 *    pagamento, mesmo chamando a API direto.
 */

// ── Plugin custom de "data labels" (valores desenhados no próprio gráfico) ──
if (typeof Chart !== 'undefined' && !window.__biValueLabelsPluginRegistered) {
    Chart.register({
        id: 'valueLabelsPlugin',
        afterDatasetsDraw(chart, args, options) {
            if (!options || options.formatter === false) return;
            const { ctx } = chart;

            chart.data.datasets.forEach((dataset, dsIndex) => {
                const meta = chart.getDatasetMeta(dsIndex);
                if (meta.hidden) return;

                meta.data.forEach((element, index) => {
                    const value = dataset.data[index];
                    if (!value) return;

                    const label = typeof options.formatter === 'function'
                        ? options.formatter(value, dataset, index)
                        : String(value);
                    if (!label) return;

                    let x, y;
                    if (chart.config.type === 'doughnut' || chart.config.type === 'pie') {
                        const angle = (element.startAngle + element.endAngle) / 2;
                        const radius = (element.innerRadius + element.outerRadius) / 2;
                        x = element.x + Math.cos(angle) * radius;
                        y = element.y + Math.sin(angle) * radius;
                    } else {
                        const pos = typeof element.tooltipPosition === 'function'
                            ? element.tooltipPosition()
                            : { x: element.x, y: element.y };
                        x = pos.x;
                        y = pos.y - 8;
                    }

                    ctx.save();
                    ctx.font = options.font || 'bold 10px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    if (options.stroke) {
                        ctx.lineWidth = options.strokeWidth || 3;
                        ctx.strokeStyle = options.strokeColor || 'rgba(0,0,0,0.6)';
                        ctx.strokeText(label, x, y);
                    }

                    ctx.fillStyle = options.color || '#e2e8f0';
                    ctx.fillText(label, x, y);
                    ctx.restore();
                });
            });
        }
    });
    window.__biValueLabelsPluginRegistered = true;
}

const BI = {
    charts: {},
    _loadToken: 0,
    _allOrders: [],
    currentPeriod: null,
    _viewRole: null, // ✅ NOVO: 'supreme' ou 'seller' — define escopo dos dados

    _formatBRL(value, decimals = 2) {
        if (window.formatBRL) return window.formatBRL(value, decimals);
        const num = Number(value) || 0;
        return num.toLocaleString('pt-BR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

    async loadDashboard() {
        const token = ++this._loadToken;
        try {
            log('📊 Carregando BI Dashboard...', 'info');

            // ✅ FIX v9.0: antes só supremo entrava. Agora vendedor também
            // pode (isSeller() retorna true pra seller E supreme).
            if (!window.APP?.auth?.isSeller()) {
                log('❌ Acesso negado ao BI', 'error');
                return;
            }

            this._viewRole = window.APP.auth.role;
            this._updateHeaderForRole();

            const orders = this._viewRole === 'supreme'
                ? await this._fetchAdminOrders()
                : await this._fetchSellerOrders();

            if (token !== this._loadToken) return;

            this._allOrders = orders || [];

            if (!this.currentPeriod) this.currentPeriod = 'tudo';

            await this._renderFiltered(token);

            if (token !== this._loadToken) return;

            log('✅ BI dashboard carregado', 'success');

        } catch (err) {
            log(`❌ Erro ao carregar BI: ${err.message}`, 'error');
            if (token === this._loadToken) this.renderMockCharts();
        }
    },

    /**
     * ✅ Consulta original — Admin Supremo vê TODOS os pedidos do
     * marketplace, com todos os itens de todos os vendedores.
     */
    async _fetchAdminOrders() {
        const { data, error } = await _supabase
            .from('orders')
            .select(`
                id,
                customer_name,
                customer_phone,
                total_amount,
                status,
                created_at,
                payment_method,
                payment_proof_url,
                payment_confirmed,
                order_items (
                    id,
                    product_id,
                    quantity,
                    unit_price,
                    unit_cost,
                    products!product_id (name)
                )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data;
    },

    /**
     * ✅ NOVO (v9.0): Vendedor vê só os ITENS de pedidos que contêm produtos
     * dele. Um mesmo pedido no banco pode ter itens de vários vendedores —
     * aqui reconstruímos "pedidos" só com os itens do vendedor logado, e o
     * total mostrado é só a fatia dele (nunca o pedido inteiro de terceiros).
     */
    async _fetchSellerOrders() {
        const sellerId = window.APP.auth.userId;
        if (!sellerId) return [];

        const { data: items, error } = await _supabase
            .from('order_items')
            .select(`
                id,
                order_id,
                product_id,
                quantity,
                unit_price,
                unit_cost,
                products!product_id!inner (name, owner_id),
                orders!order_id (id, customer_name, customer_phone, created_at, payment_method, payment_proof_url, payment_confirmed)
            `)
            .eq('products.owner_id', sellerId);

        if (error) throw error;

        const grouped = {};
        (items || []).forEach(item => {
            const oid = item.order_id;
            if (!grouped[oid]) {
                grouped[oid] = {
                    id: oid,
                    customer_name: item.orders?.customer_name || 'Cliente',
                    customer_phone: item.orders?.customer_phone || null,
                    created_at: item.orders?.created_at || new Date().toISOString(),
                    payment_method: item.orders?.payment_method || null,
                    payment_proof_url: item.orders?.payment_proof_url || null,
                    payment_confirmed: !!item.orders?.payment_confirmed,
                    total_amount: 0,
                    order_items: []
                };
            }

            grouped[oid].total_amount += (item.unit_price || 0) * (item.quantity || 1);
            grouped[oid].order_items.push({
                id: item.id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                unit_cost: item.unit_cost,
                products: { name: item.products?.name }
            });
        });

        return Object.values(grouped).sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
    },

    /**
     * ✅ NOVO (v9.0): troca o título da seção conforme o role, pra deixar
     * claro que o vendedor está vendo só o desempenho dele, não da loja toda.
     */
    _updateHeaderForRole() {
        const titleEl = document.getElementById('bi-main-title');
        if (!titleEl) return;
        titleEl.textContent = this._viewRole === 'supreme' ? 'DASHBOARD BI' : 'MEU DESEMPENHO';
    },

    setPeriod(period) {
        if (this.currentPeriod === period) return;
        this.currentPeriod = period;
        const token = ++this._loadToken;
        this._renderFiltered(token);
    },

    async _renderFiltered(token = this._loadToken) {
        const range = this._getPeriodRange(this.currentPeriod);

        const filtered = (this._allOrders || []).filter(o => {
            const d = new Date(o.created_at);
            return d >= range.start && d <= range.end;
        });

        this._syncPeriodButtonsUI(range);
        this.renderKPIs(filtered);
        this.renderOrderList(filtered);
        await this.prepareCharts(filtered, token, range);
    },

    _getPeriodRange(period) {
        const now = new Date();
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);

        switch (period) {
            case 'hoje':
                return { start: startOfToday, end: now, label: 'Hoje' };

            case 'ontem': {
                const y = new Date(startOfToday);
                y.setDate(y.getDate() - 1);
                const yEnd = new Date(y);
                yEnd.setHours(23, 59, 59, 999);
                return { start: y, end: yEnd, label: 'Ontem' };
            }

            case '7dias': {
                const s = new Date(startOfToday);
                s.setDate(s.getDate() - 6);
                return { start: s, end: now, label: 'Últimos 7 dias' };
            }

            case 'mes': {
                const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                return { start: s, end: now, label: 'Este mês' };
            }

            case 'mes_passado': {
                const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
                const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                return { start: s, end: e, label: 'Mês passado' };
            }

            case 'tudo':
            default: {
                const earliest = (this._allOrders && this._allOrders.length)
                    ? new Date(Math.min(...this._allOrders.map(o => new Date(o.created_at).getTime())))
                    : new Date(startOfToday);
                return { start: earliest, end: now, label: 'Todo o período' };
            }
        }
    },

    _syncPeriodButtonsUI(range) {
        document.querySelectorAll('.bi-period-btn').forEach(btn => {
            const p = btn.getAttribute('data-period');
            btn.classList.toggle('bi-period-btn-active', p === this.currentPeriod);
        });
        const labelEl = document.getElementById('bi-period-label');
        if (labelEl) labelEl.textContent = range.label;
    },

    _buildCostFallbackMap() {
        const map = {};
        const cached = window.APP?.products?.products || [];
        cached.forEach(p => { map[p.id] = p.cost_price || 0; });
        return map;
    },

    renderKPIs(orders) {
        try {
            const costFallback = this._buildCostFallbackMap();

            const total = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);

            const itemsSold = orders.reduce((sum, o) =>
                sum + (o.order_items || []).reduce((s, i) => s + (i.quantity || 1), 0), 0);

            const lucro = orders.reduce((sum, o) => {
                const itemsCost = (o.order_items || []).reduce((s, i) => {
                    const cost = i.unit_cost || costFallback[i.product_id] || 0;
                    return s + (cost * (i.quantity || 1));
                }, 0);
                return sum + ((o.total_amount || 0) - itemsCost);
            }, 0);

            const margem = total > 0 ? ((lucro / total) * 100).toFixed(1) : 0;

            const set = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };

            set('bi-revenue', `R$ ${this._formatBRL(total)}`);
            set('bi-profit',  `R$ ${this._formatBRL(lucro)}`);
            set('bi-margin',  `${margem}%`);
            set('bi-orders',  orders.length);
            set('bi-items-sold', itemsSold);

        } catch (err) {
            log(`❌ Erro KPIs: ${err.message}`, 'error');
        }
    },

    _buildWhatsAppLink(phone) {
        if (!phone) return null;
        const digits = String(phone).replace(/\D/g, '');
        if (!digits) return null;
        const withCountry = digits.length <= 11 ? `55${digits}` : digits;
        return `https://wa.me/${withCountry}`;
    },

    renderOrderList(orders) {
        try {
            const list = document.getElementById('bi-orders-detail');
            if (!list) return;

            if (!orders.length) {
                list.innerHTML = '<div class="text-slate-500 text-sm text-center py-8">Nenhum pedido neste período</div>';
                return;
            }

            // ✅ NOVO (v9.0): vendedor não tem permissão de deletar pedido
            // (nem faria sentido — o pedido pode ter itens de outros vendedores)
            const canDelete = this._viewRole === 'supreme';
            // ✅ NOVO (v9.1): só o Admin Supremo confirma pagamento (o Pix
            // cai numa conta centralizada, não na do vendedor individual)
            const canConfirmPayment = this._viewRole === 'supreme';

            list.innerHTML = orders.slice(0, 15).map(order => {
                const itemsText = (order.order_items || [])
                    .map(i => `${i.quantity || 1}x ${i.products?.name || 'Produto removido'}`)
                    .join(', ') || 'Sem itens registrados';

                const waLink = this._buildWhatsAppLink(order.customer_phone);
                const dataHora = new Date(order.created_at).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });

                // ✅ NOVO (v9.1): badges de forma de pagamento e status de confirmação
                const isPaid = !!order.payment_confirmed;
                const paymentBadge = order.payment_method ? `
                    <span class="text-[10px] font-black px-2 py-1 rounded-full bg-white/10 text-slate-300 uppercase">${order.payment_method}</span>
                ` : '';
                const statusBadge = isPaid ? `
                    <span class="text-[10px] font-black px-2 py-1 rounded-full bg-green-600/20 text-green-400 uppercase">✔ Pago</span>
                ` : `
                    <span class="text-[10px] font-black px-2 py-1 rounded-full bg-yellow-600/20 text-yellow-400 uppercase">Aguardando pagamento</span>
                `;
                const proofLink = order.payment_proof_url ? `
                    <a href="${order.payment_proof_url}" target="_blank" rel="noopener" class="text-[10px] font-black px-2 py-1 rounded-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 uppercase transition-all">
                        📎 Ver Comprovante
                    </a>
                ` : '';
                const confirmBtn = (canConfirmPayment && !isPaid) ? `
                    <button onclick="window.APP.bi.confirmPayment('${order.id}')" class="text-[10px] font-black px-2 py-1 rounded-full bg-green-600/20 hover:bg-green-600/30 text-green-400 uppercase transition-all">
                        ✔ Confirmar Pagamento
                    </button>
                ` : '';

                return `
                    <div class="flex justify-between items-start bg-white/5 p-4 rounded-xl border border-white/5">
                        <div class="flex-1 min-w-0 pr-3">
                            <div class="font-bold text-white">Pedido #${order.id.substring(0, 8).toUpperCase()}</div>
                            <div class="text-xs text-slate-400 mt-1">${order.customer_name || 'Cliente'}</div>
                            ${order.customer_phone ? `
                                <div class="text-xs text-slate-500 mt-1">
                                    📱 ${order.customer_phone}
                                    ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" class="text-green-500 hover:text-green-400 font-bold ml-2">WhatsApp</a>` : ''}
                                </div>
                            ` : ''}
                            <div class="text-[11px] text-blue-300/80 mt-2 leading-relaxed break-words">${itemsText}</div>
                            <div class="flex flex-wrap items-center gap-1.5 mt-2">
                                ${paymentBadge}${statusBadge}${proofLink}${confirmBtn}
                            </div>
                            <div class="text-[10px] text-slate-600 mt-1">${dataHora}</div>
                        </div>
                        <div class="text-right flex-shrink-0">
                            <div class="text-sm font-bold text-green-400">R$ ${this._formatBRL(order.total_amount)}</div>
                            ${canDelete ? `
                                <button onclick="window.APP.bi.deleteOrder('${order.id}')" class="text-red-500 text-xs mt-2 hover:text-red-400">
                                    ✕ Deletar
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            log(`❌ Erro lista pedidos: ${err.message}`, 'error');
        }
    },

    async prepareCharts(orders, token, range) {
        try {
            this.renderRevenueChart(orders, range);
            await this.renderTopProductsChart(orders, token);
        } catch (err) {
            log(`❌ Erro ao preparar gráficos: ${err.message}`, 'error');
        }
    },

    renderMockCharts() {
        try {
            const range = this._getPeriodRange(this.currentPeriod || 'tudo');
            this.renderRevenueChart([], range);
            this.renderTopProductsChart([], this._loadToken);
        } catch (err) {
            log(`❌ Erro gráficos mock: ${err.message}`, 'error');
        }
    },

    _destroyCanvasChart(ctx, chartsKey) {
        if (this.charts[chartsKey]) {
            try { this.charts[chartsKey].destroy(); } catch (e) {}
            this.charts[chartsKey] = null;
        }
        const stray = Chart.getChart(ctx);
        if (stray) {
            try { stray.destroy(); } catch (e) {}
        }
    },

    _buildBuckets(start, end) {
        const diffDays = Math.ceil((end - start) / 86400000) + 1;

        if (diffDays <= 31) {
            const days = [];
            const cursor = new Date(start);
            cursor.setHours(0, 0, 0, 0);
            const limit = new Date(end);
            limit.setHours(0, 0, 0, 0);
            while (cursor <= limit) {
                days.push(new Date(cursor));
                cursor.setDate(cursor.getDate() + 1);
            }
            return {
                labels: days.map(d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
                keys: days.map(d => this._localDateKey(d)),
                keyFor: (value) => this._localDateKey(new Date(value))
            };
        }

        const months = [];
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        const limit = new Date(end.getFullYear(), end.getMonth(), 1);
        while (cursor <= limit) {
            months.push(new Date(cursor));
            cursor.setMonth(cursor.getMonth() + 1);
        }
        return {
            labels: months.map(d => d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })),
            keys: months.map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`),
            keyFor: (value) => {
                const d = new Date(value);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            }
        };
    },

    _localDateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    renderRevenueChart(orders, range) {
        try {
            const ctx = document.getElementById('chart-revenue');
            if (!ctx) return;

            const titleEl = document.getElementById('bi-revenue-chart-title');
            if (titleEl) titleEl.textContent = `📈 Faturamento (${range.label})`;

            const buckets = this._buildBuckets(range.start, range.end);
            const costFallback = this._buildCostFallbackMap();

            const revenueMap = {};
            const profitMap = {};
            buckets.keys.forEach(k => { revenueMap[k] = 0; profitMap[k] = 0; });

            orders.forEach(o => {
                const key = buckets.keyFor(o.created_at);
                if (!(key in revenueMap)) return;

                revenueMap[key] += (o.total_amount || 0);

                const itemsCost = (o.order_items || []).reduce((s, i) => {
                    const cost = i.unit_cost || costFallback[i.product_id] || 0;
                    return s + (cost * (i.quantity || 1));
                }, 0);
                profitMap[key] += (o.total_amount || 0) - itemsCost;
            });

            const revenueData = buckets.keys.map(k => revenueMap[k]);
            const profitData = buckets.keys.map(k => profitMap[k]);

            this._destroyCanvasChart(ctx, 'revenue');

            const showBarLabels = buckets.labels.length <= 14;
            const self = this;

            this.charts.revenue = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: buckets.labels,
                    datasets: [
                        {
                            label: 'Faturamento (R$)',
                            data: revenueData,
                            backgroundColor: orders.length ? '#10b981' : 'rgba(16,185,129,0.3)',
                            borderColor: '#059669',
                            borderWidth: 2,
                            borderRadius: 6
                        },
                        {
                            label: 'Lucro (R$)',
                            data: profitData,
                            backgroundColor: orders.length ? 'rgba(139,92,246,0.7)' : 'rgba(139,92,246,0.2)',
                            borderColor: '#7c3aed',
                            borderWidth: 2,
                            borderRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: '#cbd5e1', font: { size: 12 } } },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.85)',
                            titleColor: '#fff',
                            bodyColor: '#cbd5e1',
                            callbacks: { label: ctx => ` R$ ${self._formatBRL(ctx.parsed.y)}` }
                        },
                        valueLabelsPlugin: showBarLabels ? {
                            color: '#f1f5f9',
                            font: 'bold 10px Inter, sans-serif',
                            formatter: (v) => v > 0 ? `R$ ${self._formatBRL(v, 0)}` : ''
                        } : { formatter: false }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { color: '#94a3b8', callback: v => `R$ ${self._formatBRL(v, 0)}` },
                            grid: { color: '#334155' }
                        },
                        x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
                    }
                }
            });

            log('✅ Gráfico faturamento renderizado', 'success');
        } catch (err) {
            log(`❌ Erro gráfico faturamento: ${err.message}`, 'error');
        }
    },

    async renderTopProductsChart(orders, token) {
        try {
            const ctx = document.getElementById('chart-products');
            if (!ctx) return;

            const COLORS = ['#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'];

            if (!orders.length) {
                if (token !== this._loadToken) return;
                this._destroyCanvasChart(ctx, 'products');
                this.charts.products = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Aguardando vendas'],
                        datasets: [{ data: [1], backgroundColor: ['rgba(107,114,128,0.4)'], borderWidth: 0 }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false }, tooltip: { enabled: false } }
                    }
                });
                this._renderTopProductsLegend([], [], []);
                return;
            }

            const countById = {};
            orders.forEach(order => {
                (order.order_items || []).forEach(item => {
                    const pid = item.product_id;
                    if (!pid) return;
                    countById[pid] = (countById[pid] || 0) + (item.quantity || 1);
                });
            });

            // ✅ FIX v9.0: esse fallback busca TODOS os order_items do banco —
            // só faz sentido pro Admin (visão geral). Pro vendedor, os itens já
            // vêm certos da consulta escopada em _fetchSellerOrders(), então
            // esse fallback fica restrito ao modo supremo pra não vazar dados
            // de outros vendedores no gráfico do vendedor.
            if (Object.keys(countById).length === 0 && this._viewRole === 'supreme') {
                try {
                    const { data: allItems } = await _supabase
                        .from('order_items')
                        .select('product_id, quantity');

                    if (token !== this._loadToken) return;

                    (allItems || []).forEach(item => {
                        if (!item.product_id) return;
                        countById[item.product_id] = (countById[item.product_id] || 0) + (item.quantity || 1);
                    });
                } catch(e) {
                    log('⚠️ Fallback order_items falhou: ' + e.message, 'warning');
                }
            }

            const top5 = Object.entries(countById)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            if (!top5.length) {
                if (token !== this._loadToken) return;
                this._destroyCanvasChart(ctx, 'products');
                this.charts.products = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Sem itens registrados'],
                        datasets: [{ data: [1], backgroundColor: ['rgba(107,114,128,0.4)'], borderWidth: 0 }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false }, tooltip: { enabled: false } }
                    }
                });
                this._renderTopProductsLegend([], [], []);
                return;
            }

            const ids = top5.map(([id]) => id);
            const nameMap = await this._resolveProductNames(ids);

            if (token !== this._loadToken) return;

            const labels = top5.map(([id]) => nameMap[id] || `#${id.slice(0, 6)}`);
            const data   = top5.map(([, count]) => count);
            const colors = labels.map((_, i) => COLORS[i % COLORS.length]);

            this._destroyCanvasChart(ctx, 'products');
            this.charts.products = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: colors,
                        borderColor: '#0b0f1a',
                        borderWidth: 3,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '58%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.85)',
                            titleColor: '#fff',
                            bodyColor: '#cbd5e1',
                            callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} unidades` }
                        },
                        valueLabelsPlugin: {
                            color: '#fff',
                            stroke: true,
                            font: 'bold 12px Inter, sans-serif',
                            formatter: (v) => v > 0 ? `${v}` : ''
                        }
                    }
                }
            });

            this._renderTopProductsLegend(labels, data, colors);

            log('✅ Gráfico top produtos renderizado com nomes reais', 'success');

        } catch (err) {
            log(`❌ Erro gráfico top produtos: ${err.message}`, 'error');
        }
    },

    _renderTopProductsLegend(labels, data, colors) {
        const el = document.getElementById('chart-products-legend');
        if (!el) return;

        if (!labels.length) {
            el.innerHTML = '';
            return;
        }

        const totalUnidades = data.reduce((s, v) => s + v, 0);

        el.innerHTML = labels.map((name, i) => {
            const value = data[i];
            const pct = totalUnidades > 0 ? ((value / totalUnidades) * 100).toFixed(0) : 0;
            return `
                <div class="legend-item">
                    <span class="legend-dot" style="background:${colors[i]}"></span>
                    <span class="legend-name" title="${name.replace(/"/g, '&quot;')}">${name}</span>
                    <span class="legend-value">${value}un · ${pct}%</span>
                </div>
            `;
        }).join('');
    },

    async _resolveProductNames(ids) {
        const nameMap = {};

        const cached = window.APP?.products?.products || [];
        cached.forEach(p => {
            if (ids.includes(p.id)) nameMap[p.id] = p.name;
        });

        const missing = ids.filter(id => !nameMap[id]);
        if (missing.length > 0) {
            try {
                const { data } = await _supabase
                    .from('products')
                    .select('id, name')
                    .in('id', missing);

                (data || []).forEach(p => { nameMap[p.id] = p.name; });
            } catch (e) {
                log(`⚠️ Não foi possível buscar nomes dos produtos: ${e.message}`, 'warning');
            }
        }

        return nameMap;
    },

    /**
     * ✅ NOVO (v9.1): confirma que o pagamento Pix de um pedido foi
     * recebido. Só o Admin Supremo pode fazer isso (o banco também
     * protege isso via trigger, então essa checagem aqui é a segunda
     * camada de defesa, igual ao deleteOrder).
     */
    async confirmPayment(orderId) {
        if (this._viewRole !== 'supreme') {
            alert('❌ Você não tem permissão para confirmar pagamentos.');
            return;
        }

        if (!confirm('Confirmar que o pagamento deste pedido foi recebido?')) return;

        try {
            const { error } = await _supabase
                .from('orders')
                .update({ payment_confirmed: true, payment_confirmed_at: new Date() })
                .eq('id', orderId);

            if (error) throw error;

            log('✅ Pagamento confirmado', 'success');
            await this.loadDashboard();
        } catch (err) {
            log(`❌ Erro ao confirmar pagamento: ${err.message}`, 'error');
            alert(`Erro ao confirmar pagamento: ${err.message}`);
        }
    },

    /**
     * ✅ Apenas Admin Supremo pode deletar (canDelete gate já esconde o
     * botão no HTML pra vendedor, mas mantemos a checagem aqui também
     * como segunda camada de defesa).
     */
    async deleteOrder(orderId) {
        if (this._viewRole !== 'supreme') {
            alert('❌ Você não tem permissão para deletar pedidos.');
            return;
        }

        if (!confirm('Deletar pedido?')) return;
        try {
            await _supabase.from('order_items').delete().eq('order_id', orderId);
            await _supabase.from('orders').delete().eq('id', orderId);
            log('✅ Pedido deletado', 'success');
            await this.loadDashboard();
        } catch (err) {
            log(`❌ Erro ao deletar: ${err.message}`, 'error');
            alert(`Erro ao deletar pedido: ${err.message}`);
        }
    }
};
