/**
 * BI.JS v7.2
 * ✅ Gráfico "Top Produtos" mostra NOMES reais (não product_id nem "Produto 1")
 * ✅ Busca nomes dos produtos via JOIN no Supabase ou via Products já carregados
 * ✅ BIVendor duplicado removido (estava causando erros de Auth.getCurrentUser)
 * ✅ FIX: condição de corrida ao navegar rápido entre abas causava
 *    "Canvas is already in use" e crash em generateLabels (item.text undefined).
 *    Agora usa um token de geração pra cancelar renders desatualizados,
 *    e destrói qualquer chart preso ao canvas via Chart.getChart() (não só
 *    a referência local this.charts, que podia estar desatualizada).
 * ✅ v7.1: KPIs (Lucro/Margem) tinham fallback de custo via costMap.
 * ✅ v7.2 FIX: legenda do "Top Produtos" sumia/cortava (Chart.js comprime a
 *    legenda quando não há altura suficiente, e piora em mobile). Agora a
 *    legenda do Chart.js fica desligada nesse gráfico e uma lista HTML
 *    própria é renderizada embaixo — sempre mostra nome completo, quantidade
 *    vendida e %, e empilha bem em telas pequenas.
 */

const BI = {
    charts: {},
    _loadToken: 0,

    async loadDashboard() {
        const token = ++this._loadToken;
        try {
            log('📊 Carregando BI Dashboard...', 'info');

            if (!window.APP?.auth?.isSupreme()) {
                log('❌ Acesso negado ao BI', 'error');
                return;
            }

            const { data: orders, error } = await _supabase
                .from('orders')
                .select(`
                    id,
                    customer_name,
                    total_amount,
                    status,
                    created_at,
                    order_items (
                        id,
                        product_id,
                        quantity,
                        unit_price,
                        unit_cost
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Se uma navegação mais nova já começou enquanto esperávamos o Supabase, cancela
            if (token !== this._loadToken) return;

            const allOrders = orders || [];

            this.renderKPIs(allOrders);
            this.renderOrderList(allOrders);
            await this.prepareCharts(allOrders, token);

            if (token !== this._loadToken) return;

            log('✅ BI dashboard carregado', 'success');

        } catch (err) {
            log(`❌ Erro ao carregar BI: ${err.message}`, 'error');
            if (token === this._loadToken) this.renderMockCharts();
        }
    },

    /**
     * Mapa product_id -> cost_price atual, montado a partir dos produtos já
     * carregados em memória (window.APP.products.products). Usado como
     * fallback quando order_items.unit_cost vier 0/nulo.
     */
    _buildCostFallbackMap() {
        const map = {};
        const cached = window.APP?.products?.products || [];
        cached.forEach(p => {
            map[p.id] = p.cost_price || 0;
        });
        return map;
    },

    renderKPIs(orders) {
        try {
            const costFallback = this._buildCostFallbackMap();

            const total = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
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

            set('bi-revenue', `R$ ${total.toFixed(2)}`);
            set('bi-profit',  `R$ ${lucro.toFixed(2)}`);
            set('bi-margin',  `${margem}%`);
            set('bi-orders',  orders.length);

        } catch (err) {
            log(`❌ Erro KPIs: ${err.message}`, 'error');
        }
    },

    renderOrderList(orders) {
        try {
            const list = document.getElementById('bi-orders-detail');
            if (!list) return;

            if (!orders.length) {
                list.innerHTML = '<div class="text-slate-500 text-sm text-center py-8">Nenhum pedido</div>';
                return;
            }

            list.innerHTML = orders.slice(0, 10).map(order => `
                <div class="flex justify-between items-start bg-white/5 p-4 rounded-xl border border-white/5">
                    <div class="flex-1">
                        <div class="font-bold text-white">Pedido #${order.id.substring(0, 8).toUpperCase()}</div>
                        <div class="text-xs text-slate-400 mt-1">${order.customer_name || 'Cliente'}</div>
                        <div class="text-[10px] text-slate-600 mt-1">${new Date(order.created_at).toLocaleDateString('pt-BR')}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm font-bold text-green-400">R$ ${(order.total_amount || 0).toFixed(2)}</div>
                        <button onclick="window.APP.bi.deleteOrder('${order.id}')" class="text-red-500 text-xs mt-2 hover:text-red-400">
                            ✕ Deletar
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            log(`❌ Erro lista pedidos: ${err.message}`, 'error');
        }
    },

    async prepareCharts(orders, token) {
        try {
            this.renderRevenueChart(orders);
            await this.renderTopProductsChart(orders, token);
        } catch (err) {
            log(`❌ Erro ao preparar gráficos: ${err.message}`, 'error');
        }
    },

    renderMockCharts() {
        try {
            this.renderRevenueChart([]);
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

    renderRevenueChart(orders) {
        try {
            const ctx = document.getElementById('chart-revenue');
            if (!ctx) return;

            const last7Days = this._getLast7Days();
            const labels = last7Days.map(d =>
                d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
            );
            const data = last7Days.map(day => {
                return orders
                    .filter(o => {
                        const d = new Date(o.created_at).toLocaleDateString('pt-BR');
                        return d === day.toLocaleDateString('pt-BR');
                    })
                    .reduce((sum, o) => sum + (o.total_amount || 0), 0);
            });

            this._destroyCanvasChart(ctx, 'revenue');

            const costFallback = this._buildCostFallbackMap();

            const profitData = last7Days.map(day => {
                return orders
                    .filter(o => {
                        const d = new Date(o.created_at).toLocaleDateString('pt-BR');
                        return d === day.toLocaleDateString('pt-BR');
                    })
                    .reduce((sum, o) => {
                        const cost = (o.order_items || []).reduce((s, i) => {
                            const itemCost = i.unit_cost || costFallback[i.product_id] || 0;
                            return s + (itemCost * (i.quantity || 1));
                        }, 0);
                        return sum + ((o.total_amount || 0) - cost);
                    }, 0);
            });

            this.charts.revenue = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Faturamento (R$)',
                            data,
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
                            callbacks: {
                                label: ctx => ` R$ ${ctx.parsed.y.toFixed(2)}`
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: '#94a3b8',
                                callback: v => `R$ ${v.toFixed(2)}`
                            },
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

    /**
     * ✅ v7.2: legenda nativa do Chart.js desligada (legend.display:false) —
     * quem mostra os nomes agora é _renderTopProductsLegend(), uma lista HTML
     * própria embaixo do gráfico, que nunca corta texto e funciona bem no
     * mobile (a lista simplesmente empilha, sem depender de altura de canvas).
     */
    async renderTopProductsChart(orders, token) {
        try {
            const ctx = document.getElementById('chart-products');
            if (!ctx) return;

            const COLORS = ['#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'];

            // ── Sem dados ──────────────────────────────────────────────
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

            // ── Somar quantidade vendida por product_id ─────────────────
            const countById = {};
            orders.forEach(order => {
                (order.order_items || []).forEach(item => {
                    const pid = item.product_id;
                    if (!pid) return;
                    countById[pid] = (countById[pid] || 0) + (item.quantity || 1);
                });
            });

            // Fallback: se order_items veio vazio, buscar direto na tabela order_items
            if (Object.keys(countById).length === 0) {
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

            // ── Pegar top 5 ────────────────────────────────────────────
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

            // ── Resolver nomes dos produtos ────────────────────────────
            const ids = top5.map(([id]) => id);
            const nameMap = await this._resolveProductNames(ids);

            if (token !== this._loadToken) return;

            const labels = top5.map(([id]) => nameMap[id] || `#${id.slice(0, 6)}`);
            const data   = top5.map(([, count]) => count);
            const colors = labels.map((_, i) => COLORS[i % COLORS.length]);

            // ── Renderizar gráfico ──────────────────────────────────────
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
                        legend: { display: false }, // ✅ v7.2: legenda própria abaixo
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.85)',
                            titleColor: '#fff',
                            bodyColor: '#cbd5e1',
                            callbacks: {
                                label: ctx => ` ${ctx.label}: ${ctx.parsed} unidades`
                            }
                        }
                    }
                }
            });

            // ── Renderizar legenda HTML própria ─────────────────────────
            this._renderTopProductsLegend(labels, data, colors);

            log('✅ Gráfico top produtos renderizado com nomes reais', 'success');

        } catch (err) {
            log(`❌ Erro gráfico top produtos: ${err.message}`, 'error');
        }
    },

    /**
     * ✅ NOVO (v7.2): renderiza a legenda do Top Produtos como uma lista HTML,
     * dentro de #chart-products-legend (precisa existir no HTML, logo abaixo
     * do <canvas id="chart-products">). Mostra nome completo + quantidade +
     * percentual, e é 100% responsiva (empilha em coluna no mobile).
     */
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

    _getLast7Days() {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d);
        }
        return days;
    },

    async deleteOrder(orderId) {
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