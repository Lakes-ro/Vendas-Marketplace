/**
 * BI.JS v9.3
 * v9.3 (auditoria):
 *  - SEGURANÇA: nome/telefone do comprador e nomes de produto escapados
 *    (antes um nome malicioso no checkout executava código no BI do Admin)
 *  - implementados: toggleSection, toggleInfo, ticket médio, variação vs.
 *    período anterior, barra custo × lucro, Curva ABC, ranking de
 *    vendedores, estoque crítico e giro de estoque
 *  - pagamento POR VENDEDOR (order_vendor_payments): vendedor vê e
 *    confirma o próprio Pix; Admin vê todos
 *  - busca paginada (passa do limite de 1000 linhas do Supabase)
 *  - excluir pedido checa erro de verdade e oferece devolver o estoque
 */

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
                        ? options.formatter(value, dataset, index) : String(value);
                    if (!label) return;

                    let x, y;
                    if (chart.config.type === 'doughnut' || chart.config.type === 'pie') {
                        const angle = (element.startAngle + element.endAngle) / 2;
                        const radius = (element.innerRadius + element.outerRadius) / 2;
                        x = element.x + Math.cos(angle) * radius;
                        y = element.y + Math.sin(angle) * radius;
                    } else {
                        const pos = element.tooltipPosition ? element.tooltipPosition() : { x: element.x, y: element.y };
                        x = pos.x; y = pos.y - 8;
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
    _viewRole: null,

    // ── Utilidades ─────────────────────────────────────────────

    _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; },

    toggleSection(name) {
        const content = document.getElementById(`sec-${name}-content`);
        const chevron = document.getElementById(`sec-${name}-chevron`);
        if (!content) return;
        const willOpen = content.classList.contains('hidden');
        content.classList.toggle('hidden', !willOpen);
        chevron?.classList.toggle('rotate-180', willOpen);
    },

    toggleInfo(id) {
        document.getElementById(id)?.classList.toggle('hidden');
    },

    /** Busca todas as linhas, 1000 por vez (limite padrão do Supabase). */
    async _fetchAllPages(buildQuery, pageSize = 1000, maxPages = 20) {
        let all = [];
        for (let page = 0; page < maxPages; page++) {
            const from = page * pageSize;
            const { data, error } = await buildQuery().range(from, from + pageSize - 1);
            if (error) throw error;
            all = all.concat(data || []);
            if (!data || data.length < pageSize) break;
        }
        return all;
    },

    _costFallbackMap() {
        const map = {};
        (window.APP?.products?.manageProducts || []).forEach(p => { map[p.id] = Number(p.cost_price) || 0; });
        return map;
    },

    _itemCost(item, fallback) {
        const cost = item.unit_cost != null && Number(item.unit_cost) > 0 ? Number(item.unit_cost) : (fallback[item.product_id] || 0);
        return cost * (Number(item.quantity) || 1);
    },

    // ── Carregamento ───────────────────────────────────────────

    async loadDashboard() {
        const token = ++this._loadToken;
        try {
            if (!window.APP?.auth?.hasSellerTools?.()) return;

            this._viewRole = window.APP.auth.role;
            this._set('bi-main-title', this._viewRole === 'supreme' ? 'DASHBOARD BI' : 'MEU DESEMPENHO');
            document.getElementById('bi-vendor-ranking-wrapper')?.classList.toggle('hidden', this._viewRole !== 'supreme');

            const orders = this._viewRole === 'supreme'
                ? await this._fetchAdminOrders()
                : await this._fetchSellerOrders();
            if (token !== this._loadToken) return;

            await this._attachVendorPayments(orders);
            if (token !== this._loadToken) return;

            this._allOrders = orders || [];
            if (!this.currentPeriod) this.currentPeriod = 'tudo';
            await this._renderFiltered(token);
        } catch (err) {
            log(`❌ Erro ao carregar BI: ${err.message}`, 'error');
            if (token === this._loadToken) {
                this._allOrders = [];
                this.currentPeriod = this.currentPeriod || 'tudo';
                this._renderFiltered(token);
            }
        }
    },

    async _fetchAdminOrders() {
        return this._fetchAllPages(() => _supabase
            .from('orders')
            .select(`
                id, customer_name, customer_phone, total_amount, status, created_at,
                payment_method, payment_proof_url, payment_confirmed,
                order_items (
                    id, product_id, quantity, unit_price, unit_cost,
                    products!product_id ( name, owner_id, profiles!owner_id ( full_name ) )
                )`)
            .order('created_at', { ascending: false }));
    },

    async _fetchSellerOrders() {
        const sellerId = window.APP.auth.userId;
        if (!sellerId) return [];

        const items = await this._fetchAllPages(() => _supabase
            .from('order_items')
            .select(`
                id, order_id, product_id, quantity, unit_price, unit_cost,
                products!product_id!inner ( name, owner_id ),
                orders!order_id ( id, customer_name, customer_phone, created_at, status, payment_method )`)
            .eq('products.owner_id', sellerId));

        const grouped = {};
        items.forEach(item => {
            const oid = item.order_id;
            if (!grouped[oid]) {
                grouped[oid] = {
                    id: oid,
                    customer_name: item.orders?.customer_name || 'Cliente',
                    customer_phone: item.orders?.customer_phone || null,
                    created_at: item.orders?.created_at || new Date().toISOString(),
                    status: item.orders?.status || null,
                    payment_method: item.orders?.payment_method || null,
                    total_amount: 0,
                    order_items: []
                };
            }
            grouped[oid].total_amount += (Number(item.unit_price) || 0) * (Number(item.quantity) || 1);
            grouped[oid].order_items.push(item);
        });

        return Object.values(grouped).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },

    /** Pagamentos por vendedor (RLS: vendedor só vê os dele; Admin vê todos). */
    async _attachVendorPayments(orders) {
        if (!orders || !orders.length) return;
        try {
            const rows = await this._fetchAllPages(() => _supabase
                .from('order_vendor_payments')
                .select('order_id, vendor_id, amount, payment_proof_url, payment_confirmed, payment_confirmed_at')
                .order('created_at', { ascending: false }));

            const byOrder = {};
            rows.forEach(r => { (byOrder[r.order_id] = byOrder[r.order_id] || []).push(r); });

            const vendorNames = {};
            orders.forEach(o => (o.order_items || []).forEach(i => {
                if (i.products?.owner_id) vendorNames[i.products.owner_id] = i.products?.profiles?.full_name || null;
            }));

            orders.forEach(o => {
                o.vendor_payments = (byOrder[o.id] || []).map(r => ({ ...r, vendor_name: vendorNames[r.vendor_id] || 'Vendedor' }));
            });
        } catch (err) {
            log(`⚠️ Pagamentos por vendedor: ${err.message}`, 'warning');
            orders.forEach(o => { o.vendor_payments = []; });
        }
    },

    _isPaid(order) {
        if (this._viewRole !== 'supreme') {
            const mine = (order.vendor_payments || []).find(v => v.vendor_id === window.APP.auth.userId);
            return !!mine?.payment_confirmed;
        }
        const vp = order.vendor_payments || [];
        if (vp.length) return vp.every(v => v.payment_confirmed);
        return !!order.payment_confirmed;
    },

    // ── Período ────────────────────────────────────────────────

    setPeriod(period) {
        if (this.currentPeriod === period) return;
        this.currentPeriod = period;
        this._renderFiltered(++this._loadToken);
    },

    _getPeriodRange(period) {
        const now = new Date();
        const today = new Date(now); today.setHours(0, 0, 0, 0);

        switch (period) {
            case 'hoje': return { start: today, end: now, label: 'Hoje' };
            case 'ontem': {
                const s = new Date(today); s.setDate(s.getDate() - 1);
                const e = new Date(s); e.setHours(23, 59, 59, 999);
                return { start: s, end: e, label: 'Ontem' };
            }
            case '7dias': {
                const s = new Date(today); s.setDate(s.getDate() - 6);
                return { start: s, end: now, label: 'Últimos 7 dias' };
            }
            case 'mes':
                return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now, label: 'Este mês' };
            case 'mes_passado':
                return {
                    start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
                    end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
                    label: 'Mês passado'
                };
            case 'tudo':
            default: {
                const earliest = this._allOrders.length
                    ? new Date(Math.min(...this._allOrders.map(o => new Date(o.created_at).getTime())))
                    : today;
                return { start: earliest, end: now, label: 'Todo o período', noCompare: true };
            }
        }
    },

    _previousRange(range) {
        if (range.noCompare) return null;
        if (this.currentPeriod === 'mes' || this.currentPeriod === 'mes_passado') {
            const s = new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1);
            const e = this.currentPeriod === 'mes'
                ? new Date(s.getFullYear(), s.getMonth(), range.end.getDate(), range.end.getHours(), range.end.getMinutes())
                : new Date(range.start.getFullYear(), range.start.getMonth(), 0, 23, 59, 59, 999);
            return { start: s, end: e };
        }
        const len = range.end - range.start;
        return { start: new Date(range.start - len - 1), end: new Date(range.start - 1) };
    },

    _inRange(orders, range) {
        return orders.filter(o => {
            const d = new Date(o.created_at);
            return d >= range.start && d <= range.end;
        });
    },

    async _renderFiltered(token = this._loadToken) {
        const range = this._getPeriodRange(this.currentPeriod || 'tudo');
        const filtered = this._inRange(this._allOrders, range);
        const prevRange = this._previousRange(range);
        const previous = prevRange ? this._inRange(this._allOrders, prevRange) : null;

        document.querySelectorAll('.bi-period-btn').forEach(btn => {
            btn.classList.toggle('bi-period-btn-active', btn.getAttribute('data-period') === this.currentPeriod);
        });
        this._set('bi-period-label', range.label);

        this.renderKPIs(filtered, previous);
        this.renderMarginBar(filtered);
        this.renderABC(filtered);
        this.renderVendorRanking(filtered);
        this.renderLowStock();
        this.renderStockTurnover(filtered, range);
        this.renderOrderList(filtered);
        await this.prepareCharts(filtered, token, range);
    },

    // ── KPIs ───────────────────────────────────────────────────

    _metrics(orders) {
        const fb = this._costFallbackMap();
        let revenue = 0, cost = 0, items = 0;
        orders.forEach(o => {
            revenue += Number(o.total_amount) || 0;
            (o.order_items || []).forEach(i => {
                cost += this._itemCost(i, fb);
                items += Number(i.quantity) || 1;
            });
        });
        const profit = revenue - cost;
        return {
            revenue, cost, profit, items,
            orders: orders.length,
            margin: revenue > 0 ? (profit / revenue) * 100 : 0,
            ticket: orders.length ? revenue / orders.length : 0
        };
    },

    _delta(id, current, previous, isPercentPoints = false) {
        const el = document.getElementById(id);
        if (!el) return;
        if (previous === null || previous === undefined) { el.textContent = ''; return; }

        let diff, text;
        if (isPercentPoints) {
            diff = current - previous;
            text = `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)} p.p.`;
        } else if (previous === 0) {
            if (current === 0) { el.textContent = '— igual ao período anterior'; el.className = 'text-xs font-bold mt-1 text-slate-500'; return; }
            diff = 1; text = '▲ novo';
        } else {
            diff = (current - previous) / Math.abs(previous);
            text = `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff * 100).toFixed(0)}% vs. anterior`;
        }
        el.textContent = text;
        el.className = `text-xs font-bold mt-1 ${diff >= 0 ? 'text-green-500' : 'text-red-500'}`;
    },

    renderKPIs(orders, previous) {
        const m = this._metrics(orders);
        const p = previous ? this._metrics(previous) : null;

        this._set('bi-revenue', `R$ ${formatBRL(m.revenue)}`);
        this._set('bi-profit', `R$ ${formatBRL(m.profit)}`);
        this._set('bi-margin', `${m.margin.toFixed(1)}%`);
        this._set('bi-ticket-medio', `R$ ${formatBRL(m.ticket)}`);
        this._set('bi-orders', m.orders);
        this._set('bi-items-sold', m.items);

        this._delta('bi-revenue-delta', m.revenue, p?.revenue);
        this._delta('bi-profit-delta', m.profit, p?.profit);
        this._delta('bi-margin-delta', m.margin, p ? p.margin : null, true);
        this._delta('bi-ticket-medio-delta', m.ticket, p?.ticket);
        this._delta('bi-orders-delta', m.orders, p?.orders);
        this._delta('bi-items-sold-delta', m.items, p?.items);
    },

    renderMarginBar(orders) {
        const el = document.getElementById('bi-margin-bar');
        if (!el) return;
        const m = this._metrics(orders);
        if (m.revenue <= 0) {
            el.innerHTML = '<div class="text-slate-500 text-sm text-center py-4">Sem vendas neste período</div>';
            return;
        }
        const costPct = Math.min(100, Math.max(0, (m.cost / m.revenue) * 100));
        const profitPct = 100 - costPct;
        el.innerHTML = `
            <div class="flex h-6 rounded-full overflow-hidden bg-slate-800">
                <div style="width:${costPct}%;background:#ef4444"></div>
                <div style="width:${profitPct}%;background:#22c55e"></div>
            </div>
            <div class="flex justify-between text-xs mt-2 font-bold">
                <span class="text-red-400">Custo: R$ ${formatBRL(m.cost)} (${costPct.toFixed(0)}%)</span>
                <span class="text-green-400">Lucro: R$ ${formatBRL(m.profit)} (${profitPct.toFixed(0)}%)</span>
            </div>`;
    },

    // ── Curva ABC ──────────────────────────────────────────────

    _productRevenue(orders) {
        const map = {};
        orders.forEach(o => (o.order_items || []).forEach(i => {
            const key = i.product_id || `removido-${i.products?.name || ''}`;
            if (!map[key]) map[key] = { name: i.products?.name || 'Produto removido', revenue: 0, units: 0 };
            map[key].revenue += (Number(i.unit_price) || 0) * (Number(i.quantity) || 1);
            map[key].units += Number(i.quantity) || 1;
        }));
        return Object.entries(map).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.revenue - a.revenue);
    },

    renderABC(orders) {
        const el = document.getElementById('bi-abc-table');
        if (!el) return;
        const rows = this._productRevenue(orders);
        const total = rows.reduce((s, r) => s + r.revenue, 0);
        if (!rows.length || total <= 0) {
            el.innerHTML = '<div class="text-slate-600 text-center py-6">Sem dados suficientes neste período</div>';
            return;
        }

        let acc = 0;
        const colors = { A: 'text-green-400 bg-green-500/15', B: 'text-yellow-400 bg-yellow-500/15', C: 'text-slate-400 bg-white/10' };
        el.innerHTML = rows.map(r => {
            const before = acc;
            acc += r.revenue;
            const cls = (before / total) < 0.8 ? 'A' : (before / total) < 0.95 ? 'B' : 'C';
            return `
                <div class="flex items-center justify-between gap-3 bg-white/5 p-3 rounded-xl">
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="text-xs font-black px-2 py-1 rounded-lg ${colors[cls]}">${cls}</span>
                        <span class="text-sm text-white font-bold truncate">${escapeHtml(r.name)}</span>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <div class="text-sm font-bold text-green-400">R$ ${formatBRL(r.revenue)}</div>
                        <div class="text-[10px] text-slate-500">${((r.revenue / total) * 100).toFixed(1)}% · ${r.units} un.</div>
                    </div>
                </div>`;
        }).join('');
    },

    // ── Ranking de vendedores (Admin) ──────────────────────────

    renderVendorRanking(orders) {
        const el = document.getElementById('bi-vendor-ranking');
        if (!el || this._viewRole !== 'supreme') return;

        const fb = this._costFallbackMap();
        const map = {};
        orders.forEach(o => (o.order_items || []).forEach(i => {
            const owner = i.products?.owner_id || 'desconhecido';
            if (!map[owner]) map[owner] = { name: i.products?.profiles?.full_name || 'Desconhecido', revenue: 0, profit: 0, orders: new Set() };
            const rev = (Number(i.unit_price) || 0) * (Number(i.quantity) || 1);
            map[owner].revenue += rev;
            map[owner].profit += rev - this._itemCost(i, fb);
            map[owner].orders.add(o.id);
        }));

        const rows = Object.values(map).sort((a, b) => b.revenue - a.revenue);
        if (!rows.length) {
            el.innerHTML = '<div class="text-slate-600 text-center py-6">Nenhuma venda neste período</div>';
            return;
        }
        const medals = ['🥇', '🥈', '🥉'];
        el.innerHTML = rows.map((r, i) => `
            <div class="flex items-center justify-between gap-3 bg-white/5 p-3 rounded-xl">
                <div class="flex items-center gap-3 min-w-0">
                    <span class="text-lg w-7 text-center">${medals[i] || `${i + 1}º`}</span>
                    <div class="min-w-0">
                        <div class="text-sm text-white font-bold truncate">${escapeHtml(r.name)}</div>
                        <div class="text-[10px] text-slate-500">${r.orders.size} pedido(s)</div>
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    <div class="text-sm font-bold text-green-400">R$ ${formatBRL(r.revenue)}</div>
                    <div class="text-[10px] text-blue-400">Lucro R$ ${formatBRL(r.profit)}</div>
                </div>
            </div>`).join('');
    },

    // ── Estoque ────────────────────────────────────────────────

    _stockProducts() {
        return (window.APP?.products?.manageProducts || []).filter(p => p.active !== false || p.flagged);
    },

    renderLowStock() {
        const el = document.getElementById('bi-low-stock-list');
        if (!el) return;
        const low = this._stockProducts()
            .filter(p => (Number(p.stock) || 0) <= (p.min_stock ?? 5))
            .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0));

        if (!low.length) {
            el.innerHTML = '<div class="text-green-500 text-sm text-center py-4">✅ Nenhum produto abaixo do estoque mínimo</div>';
            return;
        }
        el.innerHTML = low.map(p => {
            const stock = Number(p.stock) || 0;
            return `
                <div class="flex items-center justify-between gap-3 bg-white/5 p-3 rounded-xl">
                    <div class="min-w-0">
                        <div class="text-sm text-white font-bold truncate">${escapeHtml(p.name)}</div>
                        ${this._viewRole === 'supreme' ? `<div class="text-[10px] text-slate-500">👤 ${escapeHtml(p.profiles?.full_name || '')}</div>` : ''}
                    </div>
                    <div class="text-xs font-black flex-shrink-0 ${stock === 0 ? 'text-red-500' : 'text-yellow-500'}">
                        ${stock === 0 ? 'ESGOTADO' : `${stock} un.`} <span class="text-slate-600 font-normal">(mín ${p.min_stock ?? 5})</span>
                    </div>
                </div>`;
        }).join('');
    },

    renderStockTurnover(orders, range) {
        const el = document.getElementById('bi-stock-turnover');
        if (!el) return;
        const products = this._stockProducts();
        if (!products.length) {
            el.innerHTML = '<div class="text-slate-600 text-center py-6">Nenhum produto cadastrado</div>';
            return;
        }

        const days = Math.max(1, Math.ceil((range.end - range.start) / 86400000));
        const units = {};
        orders.forEach(o => (o.order_items || []).forEach(i => {
            if (i.product_id) units[i.product_id] = (units[i.product_id] || 0) + (Number(i.quantity) || 1);
        }));

        const rows = products.map(p => {
            const sold = units[p.id] || 0;
            const perDay = sold / days;
            const stock = Number(p.stock) || 0;
            return { p, sold, stock, cover: perDay > 0 ? stock / perDay : Infinity };
        }).sort((a, b) => a.cover - b.cover);

        el.innerHTML = rows.map(r => {
            let label, cls;
            if (r.stock === 0) { label = 'Esgotado'; cls = 'text-red-500'; }
            else if (r.cover === Infinity) { label = 'Estoque parado'; cls = 'text-slate-500'; }
            else {
                const d = Math.round(r.cover);
                label = `${d} dia${d === 1 ? '' : 's'}`;
                cls = d <= 7 ? 'text-red-400' : d <= 30 ? 'text-yellow-400' : 'text-green-400';
            }
            return `
                <div class="flex items-center justify-between gap-3 bg-white/5 p-3 rounded-xl">
                    <div class="min-w-0">
                        <div class="text-sm text-white font-bold truncate">${escapeHtml(r.p.name)}</div>
                        <div class="text-[10px] text-slate-500">${r.sold} vendido(s) no período · ${r.stock} em estoque</div>
                    </div>
                    <div class="text-xs font-black flex-shrink-0 ${cls}">${label}</div>
                </div>`;
        }).join('');
    },

    // ── Lista de pedidos ───────────────────────────────────────

    _paymentRowsHtml(order) {
        const isSupreme = this._viewRole === 'supreme';
        const myId = window.APP.auth.userId;
        const oid = escapeHtml(order.id);
        const vp = (order.vendor_payments || []).filter(v => isSupreme || v.vendor_id === myId);

        if (vp.length) {
            return vp.map(v => {
                const vid = escapeHtml(v.vendor_id);
                const canConfirm = !v.payment_confirmed && (isSupreme || v.vendor_id === myId);
                return `
                    <div class="flex flex-wrap items-center gap-1.5 mt-1">
                        ${isSupreme ? `<span class="text-[10px] text-slate-400">👤 ${escapeHtml(v.vendor_name)} · R$ ${formatBRL(v.amount)}</span>` : ''}
                        ${v.payment_confirmed
                            ? '<span class="text-[10px] font-black px-2 py-1 rounded-full bg-green-600/20 text-green-400 uppercase">✔ Pago</span>'
                            : '<span class="text-[10px] font-black px-2 py-1 rounded-full bg-yellow-600/20 text-yellow-400 uppercase">Aguardando pagamento</span>'}
                        ${v.payment_proof_url ? `<button onclick="window.APP.bi.viewPaymentProof('${oid}', '${vid}')" class="text-[10px] font-black px-2 py-1 rounded-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 uppercase">📎 Comprovante</button>` : ''}
                        ${canConfirm ? `<button onclick="window.APP.bi.confirmVendorPayment('${oid}', '${vid}')" class="text-[10px] font-black px-2 py-1 rounded-full bg-green-600/20 hover:bg-green-600/30 text-green-400 uppercase">✔ Confirmar Pix</button>` : ''}
                    </div>`;
            }).join('');
        }

        // Pedido antigo (sem divisão por vendedor)
        if (!isSupreme) return '';
        return `
            <div class="flex flex-wrap items-center gap-1.5 mt-1">
                ${order.payment_confirmed
                    ? '<span class="text-[10px] font-black px-2 py-1 rounded-full bg-green-600/20 text-green-400 uppercase">✔ Pago</span>'
                    : '<span class="text-[10px] font-black px-2 py-1 rounded-full bg-yellow-600/20 text-yellow-400 uppercase">Aguardando pagamento</span>'}
                ${order.payment_proof_url ? `<button onclick="window.APP.bi.viewPaymentProof('${oid}')" class="text-[10px] font-black px-2 py-1 rounded-full bg-blue-600/20 text-blue-400 uppercase">📎 Comprovante</button>` : ''}
                ${!order.payment_confirmed ? `<button onclick="window.APP.bi.confirmPayment('${oid}')" class="text-[10px] font-black px-2 py-1 rounded-full bg-green-600/20 text-green-400 uppercase">✔ Confirmar</button>` : ''}
            </div>`;
    },

    renderOrderList(orders) {
        const list = document.getElementById('bi-orders-detail');
        if (!list) return;

        if (!orders.length) {
            list.innerHTML = '<div class="text-slate-500 text-sm text-center py-8">Nenhum pedido neste período</div>';
            return;
        }

        const canDelete = this._viewRole === 'supreme';
        const LIMIT = 50;

        list.innerHTML = orders.slice(0, LIMIT).map(order => {
            const itemsText = (order.order_items || [])
                .map(i => `${Number(i.quantity) || 1}x ${i.products?.name || 'Produto removido'}`)
                .join(', ') || 'Sem itens registrados';
            const waLink = buildWhatsAppLink(order.customer_phone);
            const dataHora = new Date(order.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const expired = order.status === 'expired' || order.status === 'cancelled';

            return `
                <div class="flex justify-between items-start bg-white/5 p-4 rounded-xl border border-white/5 ${expired ? 'opacity-50' : ''}">
                    <div class="flex-1 min-w-0 pr-3">
                        <div class="font-bold text-white">Pedido #${escapeHtml(String(order.id).slice(0, 8).toUpperCase())} ${expired ? '<span class="text-[10px] text-red-400">(expirado)</span>' : ''}</div>
                        <div class="text-xs text-slate-400 mt-1">${escapeHtml(order.customer_name || 'Cliente')}</div>
                        ${order.customer_phone ? `
                            <div class="text-xs text-slate-500 mt-1">📱 ${escapeHtml(order.customer_phone)}
                                ${waLink ? `<a href="${escapeHtml(waLink)}" target="_blank" rel="noopener" class="text-green-500 hover:text-green-400 font-bold ml-2">WhatsApp</a>` : ''}
                            </div>` : ''}
                        <div class="text-[11px] text-blue-300/80 mt-2 leading-relaxed break-words">${escapeHtml(itemsText)}</div>
                        <div class="flex flex-wrap items-center gap-1.5 mt-2">
                            ${order.payment_method ? `<span class="text-[10px] font-black px-2 py-1 rounded-full bg-white/10 text-slate-300 uppercase">${escapeHtml(order.payment_method)}</span>` : ''}
                        </div>
                        ${this._paymentRowsHtml(order)}
                        <div class="text-[10px] text-slate-600 mt-1">${dataHora}</div>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <div class="text-sm font-bold text-green-400">R$ ${formatBRL(order.total_amount)}</div>
                        ${canDelete ? `<button onclick="window.APP.bi.deleteOrder('${escapeHtml(order.id)}')" class="text-red-500 text-xs mt-2 hover:text-red-400">✕ Deletar</button>` : ''}
                    </div>
                </div>`;
        }).join('') + (orders.length > LIMIT ? `<div class="text-center text-xs text-slate-500 py-2">Mostrando ${LIMIT} de ${orders.length} pedidos — escolha um período menor para ver os demais.</div>` : '');
    },

    async viewPaymentProof(orderId, vendorId) {
        const order = this._allOrders.find(o => o.id === orderId);
        const path = vendorId
            ? (order?.vendor_payments || []).find(v => v.vendor_id === vendorId)?.payment_proof_url
            : order?.payment_proof_url;
        if (!path) { alert('❌ Este pedido não tem comprovante anexado.'); return; }

        try {
            const { data, error } = await _supabase.storage.from('payment-proofs').createSignedUrl(path, 300);
            if (error) throw error;
            if (!data?.signedUrl) throw new Error('Não foi possível gerar o link');
            window.open(data.signedUrl, '_blank', 'noopener');
        } catch (err) {
            alert(`❌ Erro ao abrir comprovante: ${err.message}`);
        }
    },

    async confirmVendorPayment(orderId, vendorId) {
        if (!confirm('Confirmar que o Pix deste pedido caiu na conta?')) return;
        try {
            const { error } = await _supabase.rpc('confirm_vendor_payment', { p_order_id: orderId, p_vendor_id: vendorId });
            if (error) throw error;
            await this.loadDashboard();
        } catch (err) {
            alert(`❌ Erro ao confirmar pagamento: ${err.message}`);
        }
    },

    async confirmPayment(orderId) {
        if (this._viewRole !== 'supreme') return;
        if (!confirm('Confirmar que o pagamento deste pedido foi recebido?')) return;
        try {
            const { data, error } = await _supabase
                .from('orders')
                .update({ payment_confirmed: true, payment_confirmed_at: new Date().toISOString() })
                .eq('id', orderId)
                .select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('O banco recusou a alteração');
            await this.loadDashboard();
        } catch (err) {
            alert(`❌ Erro ao confirmar pagamento: ${err.message}`);
        }
    },

    async deleteOrder(orderId) {
        if (this._viewRole !== 'supreme') return;
        const order = this._allOrders.find(o => o.id === orderId);
        if (!confirm('Deletar este pedido? Isso não pode ser desfeito.')) return;
        const restock = confirm('Devolver os itens deste pedido ao estoque?\n\nOK = devolver · Cancelar = não devolver');

        try {
            if (restock && order) {
                for (const item of (order.order_items || [])) {
                    if (!item.product_id) continue;
                    const { data: prod } = await _supabase.from('products').select('stock').eq('id', item.product_id).maybeSingle();
                    if (!prod) continue;
                    const { error } = await _supabase.from('products')
                        .update({ stock: (Number(prod.stock) || 0) + (Number(item.quantity) || 1) })
                        .eq('id', item.product_id);
                    if (error) throw error;
                }
            }

            const { data, error } = await _supabase.from('orders').delete().eq('id', orderId).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('O banco recusou a exclusão');

            await this.loadDashboard();
            if (restock) window.APP?.products?.fetchAll?.();
        } catch (err) {
            alert(`❌ Erro ao deletar pedido: ${err.message}`);
        }
    },

    // ── Gráficos ───────────────────────────────────────────────

    async prepareCharts(orders, token, range) {
        if (typeof Chart === 'undefined') return;
        try {
            this.renderRevenueChart(orders, range);
            await this.renderTopProductsChart(orders, token);
        } catch (err) {
            log(`❌ Erro ao preparar gráficos: ${err.message}`, 'error');
        }
    },

    _destroyCanvasChart(ctx, key) {
        if (this.charts[key]) { try { this.charts[key].destroy(); } catch {} this.charts[key] = null; }
        const stray = Chart.getChart(ctx);
        if (stray) { try { stray.destroy(); } catch {} }
    },

    _localDateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    _buildBuckets(start, end) {
        const diffDays = Math.ceil((end - start) / 86400000) + 1;
        if (diffDays <= 31) {
            const days = [];
            const cursor = new Date(start); cursor.setHours(0, 0, 0, 0);
            const limit = new Date(end); limit.setHours(0, 0, 0, 0);
            while (cursor <= limit) { days.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
            return {
                labels: days.map(d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
                keys: days.map(d => this._localDateKey(d)),
                keyFor: (v) => this._localDateKey(new Date(v))
            };
        }
        const months = [];
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        const limit = new Date(end.getFullYear(), end.getMonth(), 1);
        while (cursor <= limit) { months.push(new Date(cursor)); cursor.setMonth(cursor.getMonth() + 1); }
        const mk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return {
            labels: months.map(d => d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })),
            keys: months.map(mk),
            keyFor: (v) => mk(new Date(v))
        };
    },

    renderRevenueChart(orders, range) {
        const ctx = document.getElementById('chart-revenue');
        if (!ctx) return;
        this._set('bi-revenue-chart-title', `📈 Faturamento (${range.label})`);

        const buckets = this._buildBuckets(range.start, range.end);
        const fb = this._costFallbackMap();
        const rev = {}, prof = {};
        buckets.keys.forEach(k => { rev[k] = 0; prof[k] = 0; });

        orders.forEach(o => {
            const key = buckets.keyFor(o.created_at);
            if (!(key in rev)) return;
            const total = Number(o.total_amount) || 0;
            const cost = (o.order_items || []).reduce((s, i) => s + this._itemCost(i, fb), 0);
            rev[key] += total;
            prof[key] += total - cost;
        });

        this._destroyCanvasChart(ctx, 'revenue');
        const showLabels = buckets.labels.length <= 14;

        this.charts.revenue = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: buckets.labels,
                datasets: [
                    { label: 'Faturamento (R$)', data: buckets.keys.map(k => rev[k]), backgroundColor: '#10b981', borderColor: '#059669', borderWidth: 2, borderRadius: 6 },
                    { label: 'Lucro (R$)', data: buckets.keys.map(k => prof[k]), backgroundColor: 'rgba(139,92,246,0.7)', borderColor: '#7c3aed', borderWidth: 2, borderRadius: 6 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#cbd5e1', font: { size: 12 } } },
                    tooltip: { callbacks: { label: c => ` R$ ${formatBRL(c.parsed.y)}` } },
                    valueLabelsPlugin: showLabels
                        ? { color: '#f1f5f9', font: 'bold 10px Inter, sans-serif', formatter: v => v > 0 ? `R$ ${formatBRL(v, 0)}` : '' }
                        : { formatter: false }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { color: '#94a3b8', callback: v => `R$ ${formatBRL(v, 0)}` }, grid: { color: '#334155' } },
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
                }
            }
        });
    },

    async renderTopProductsChart(orders, token) {
        const ctx = document.getElementById('chart-products');
        if (!ctx) return;
        const COLORS = ['#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'];

        const top5 = this._productRevenue(orders).sort((a, b) => b.units - a.units).slice(0, 5);
        if (token !== this._loadToken) return;

        this._destroyCanvasChart(ctx, 'products');

        if (!top5.length) {
            this.charts.products = new Chart(ctx, {
                type: 'doughnut',
                data: { labels: ['Aguardando vendas'], datasets: [{ data: [1], backgroundColor: ['rgba(107,114,128,0.4)'], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false }, valueLabelsPlugin: { formatter: false } } }
            });
            this._renderTopProductsLegend([], [], []);
            return;
        }

        const labels = top5.map(r => r.name);
        const data = top5.map(r => r.units);
        const colors = labels.map((_, i) => COLORS[i % COLORS.length]);

        this.charts.products = new Chart(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#0b0f1a', borderWidth: 3, hoverOffset: 8 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '58%',
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed} unidades` } },
                    valueLabelsPlugin: { color: '#fff', stroke: true, font: 'bold 12px Inter, sans-serif', formatter: v => v > 0 ? `${v}` : '' }
                }
            }
        });
        this._renderTopProductsLegend(labels, data, colors);
    },

    _renderTopProductsLegend(labels, data, colors) {
        const el = document.getElementById('chart-products-legend');
        if (!el) return;
        if (!labels.length) { el.innerHTML = ''; return; }
        const total = data.reduce((s, v) => s + v, 0);
        el.innerHTML = labels.map((name, i) => `
            <div class="legend-item">
                <span class="legend-dot" style="background:${colors[i]}"></span>
                <span class="legend-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                <span class="legend-value">${data[i]}un · ${total ? ((data[i] / total) * 100).toFixed(0) : 0}%</span>
            </div>`).join('');
    }
};
