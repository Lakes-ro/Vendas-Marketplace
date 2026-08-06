/**
 * BI.JS v9.3
 * ✅ Gráfico "Top Produtos" com legenda HTML própria
 * ✅ Fallback de custo (unit_cost) via cost_price atual do produto
 * ✅ Filtro de período + detalhamento com itens/telefone/WhatsApp
 * ✅ BI escopado por role — vendedor só vê o próprio desempenho
 * ✅ Detalhamento com forma de pagamento, badge de status, comprovante
 *    e confirmação de pagamento
 * ✅ v9.2: Resumo Executivo, DRE, Ticket Médio, deltas ▲/▼, Curva ABC,
 *    Estoque Crítico, Giro de Estoque, Ranking de Vendedores e
 *    toggleInfo() implementados
 * ✅ v9.3 PERFORMANCE: a tabela de custo dos produtos (usada pra
 *    calcular lucro) era remontada do zero 3 VEZES a cada atualização
 *    de tela — uma vez em renderKPIs, outra em renderDRE, outra no
 *    gráfico de faturamento — cada uma percorrendo a lista inteira de
 *    produtos de novo. Agora é montada UMA ÚNICA VEZ por atualização
 *    (em _renderFiltered) e reaproveitada nas três.
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
    _viewRole: null,
    _lastKPIs: null,

    _formatBRL(value, decimals = 2) {
        if (window.formatBRL) return window.formatBRL(value, decimals);
        const num = Number(value) || 0;
        return num.toLocaleString('pt-BR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

    toggleInfo(id) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden');
    },

    async loadDashboard() {
        const token = ++this._loadToken;
        try {
            log('📊 Carregando BI Dashboard...', 'info');

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

        const prevRange = this._getPreviousRange(range);
        const prevFiltered = (this._allOrders || []).filter(o => {
            const d = new Date(o.created_at);
            return d >= prevRange.start && d <= prevRange.end;
        });

        // ✅ FIX v9.3 (performance): monta o mapa de custo UMA VEZ aqui,
        // e passa pronto pra quem precisar — em vez de cada função
        // (KPIs, DRE, gráfico) reconstruir a mesma tabela sozinha.
        const costFallback = this._buildCostFallbackMap();

        this._syncPeriodButtonsUI(range);
        this.renderKPIs(filtered, prevFiltered, costFallback);
        this.renderExecutiveSummary(filtered, prevFiltered, range);
        this.renderDRE(filtered, costFallback);
        this.renderOrderList(filtered);
        this.renderABC(filtered);
        this.renderCriticalStock();
        this.renderStockTurnover(filtered, range);
        this.renderVendorRanking(filtered);
        await this.prepareCharts(filtered, token, range, costFallback);
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

    _getPreviousRange(range) {
        const duration = range.end.getTime() - range.start.getTime();
        const prevEnd = new Date(range.start.getTime() - 1);
        const prevStart = new Date(prevEnd.getTime() - duration);
        return { start: prevStart, end: prevEnd };
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

    _calcTotals(orders, costFallback) {
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

        const margem = total > 0 ? (lucro / total) * 100 : 0;
        const ticketMedio = orders.length > 0 ? total / orders.length : 0;

        return { total, lucro, margem, itemsSold, ticketMedio, count: orders.length };
    },

    renderKPIs(orders, prevOrders = [], costFallback = null) {
        try {
            costFallback = costFallback || this._buildCostFallbackMap();

            const cur = this._calcTotals(orders, costFallback);
            const prev = this._calcTotals(prevOrders, costFallback);

            this._lastKPIs = cur;

            const set = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };

            set('bi-revenue', `R$ ${this._formatBRL(cur.total)}`);
            set('bi-profit', `R$ ${this._formatBRL(cur.lucro)}`);
            set('bi-margin', `${cur.margem.toFixed(1)}%`);
            set('bi-orders', cur.count);
            set('bi-items-sold', cur.itemsSold);
            set('bi-ticket-medio', `R$ ${this._formatBRL(cur.ticketMedio)}`);

            this._renderDelta('bi-revenue-delta', cur.total, prev.total);
            this._renderDelta('bi-profit-delta', cur.lucro, prev.lucro);
            this._renderDelta('bi-margin-delta', cur.margem, prev.margem, true);
            this._renderDelta('bi-ticket-medio-delta', cur.ticketMedio, prev.ticketMedio);
            this._renderDelta('bi-orders-delta', cur.count, prev.count);
            this._renderDelta('bi-items-sold-delta', cur.itemsSold, prev.itemsSold);

        } catch (err) {
            log(`❌ Erro KPIs: ${err.message}`, 'error');
        }
    },

    _renderDelta(elId, curVal, prevVal, isPercentPoint = false) {
        const el = document.getElementById(elId);
        if (!el) return;

        if (!curVal && !prevVal) {
            el.innerHTML = '';
            return;
        }

        if (!prevVal) {
            el.innerHTML = '<span class="text-slate-500">— sem período anterior pra comparar</span>';
            return;
        }

        const diff = curVal - prevVal;
        const pct = isPercentPoint ? diff : (diff / Math.abs(prevVal)) * 100;
        const isUp = diff >= 0;
        const arrow = isUp ? '▲' : '▼';
        const color = isUp ? 'text-green-500' : 'text-red-500';
        const suffix = isPercentPoint ? 'p.p.' : '%';

        el.innerHTML = `<span class="${color}">${arrow} ${Math.abs(pct).toFixed(1)}${suffix}</span> <span class="text-slate-600">vs período anterior</span>`;
    },

    renderExecutiveSummary(orders, prevOrders, range) {
        const el = document.getElementById('bi-executive-summary');
        if (!el) return;

        if (!orders.length) {
            el.textContent = `Nenhuma venda registrada em "${range.label}".`;
            return;
        }

        const k = this._lastKPIs || this._calcTotals(orders, this._buildCostFallbackMap());
        const prevTotal = prevOrders.reduce((s, o) => s + (o.total_amount || 0), 0);

        let trendText = '';
        if (prevTotal > 0) {
            const pct = ((k.total - prevTotal) / prevTotal) * 100;
            trendText = pct >= 0
                ? ` Isso é <strong class="text-green-400">${pct.toFixed(0)}% a mais</strong> que no período anterior.`
                : ` Isso é <strong class="text-red-400">${Math.abs(pct).toFixed(0)}% a menos</strong> que no período anterior.`;
        }

        el.innerHTML = `Em <strong>${range.label}</strong>, o faturamento foi de <strong>R$ ${this._formatBRL(k.total)}</strong>,
            com lucro de <strong>R$ ${this._formatBRL(k.lucro)}</strong> (margem de ${k.margem.toFixed(1)}%).${trendText}
            Foram <strong>${k.count}</strong> pedido(s), com ticket médio de <strong>R$ ${this._formatBRL(k.ticketMedio)}</strong>.`;
    },

    renderDRE(orders, costFallback = null) {
        const el = document.getElementById('bi-dre');
        if (!el) return;

        costFallback = costFallback || this._buildCostFallbackMap();

        const receita = orders.reduce((s, o) => s + (o.total_amount || 0), 0);
        const cpv = orders.reduce((sum, o) => sum + (o.order_items || []).reduce((s, i) => {
            const cost = i.unit_cost || costFallback[i.product_id] || 0;
            return s + (cost * (i.quantity || 1));
        }, 0), 0);
        const lucroBruto = receita - cpv;
        const margem = receita > 0 ? (lucroBruto / receita) * 100 : 0;

        const row = (label, value, isTotal = false) => `
            <div class="flex justify-between items-center py-2 ${isTotal ? 'border-t border-white/10 mt-2 pt-3' : ''}">
                <span class="${isTotal ? 'font-black text-white' : 'text-slate-400'} text-sm">${label}</span>
                <span class="${isTotal ? 'font-black text-lg' : 'font-bold'} ${value < 0 ? 'text-red-400' : 'text-slate-200'}">
                    R$ ${this._formatBRL(value)}
                </span>
            </div>
        `;

        el.innerHTML = `
            ${row('Receita Bruta (Faturamento)', receita)}
            ${row('(-) Custo dos Produtos Vendidos (CPV)', -cpv)}
            ${row(`(=) Lucro Bruto (margem de ${margem.toFixed(1)}%)`, lucroBruto, true)}
        `;
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

            const canDelete = this._viewRole === 'supreme';
            const canConfirmPayment = this._viewRole === 'supreme';

            list.innerHTML = orders.slice(0, 15).map(order => {
                const itemsText = (order.order_items || [])
                    .map(i => `${i.quantity || 1}x ${i.products?.name || 'Produto removido'}`)
                    .join(', ') || 'Sem itens registrados';

                const waLink = this._buildWhatsAppLink(order.customer_phone);
                const dataHora = new Date(order.created_at).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });

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

    renderABC(orders) {
        const container = document.getElementById('bi-abc-table');
        if (!container) return;

        if (!orders.length) {
            container.innerHTML = '<div class="text-slate-600 text-center py-6">Sem dados suficientes neste período</div>';
            return;
        }

        const revenueByProduct = {};
        const nameByProduct = {};

        orders.forEach(o => {
            (o.order_items || []).forEach(item => {
                const pid = item.product_id;
                if (!pid) return;
                const rev = (item.unit_price || 0) * (item.quantity || 1);
                revenueByProduct[pid] = (revenueByProduct[pid] || 0) + rev;
                if (item.products?.name) nameByProduct[pid] = item.products.name;
            });
        });

        const entries = Object.entries(revenueByProduct).sort((a, b) => b[1] - a[1]);
        const totalRevenue = entries.reduce((s, [, v]) => s + v, 0);

        if (!entries.length || !totalRevenue) {
            container.innerHTML = '<div class="text-slate-600 text-center py-6">Sem dados suficientes neste período</div>';
            return;
        }

        let cumulative = 0;
        container.innerHTML = entries.map(([pid, rev]) => {
            cumulative += rev;
            const cumPct = (cumulative / totalRevenue) * 100;
            const classe = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
            const classColor = classe === 'A'
                ? 'bg-green-500/20 text-green-400'
                : classe === 'B'
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-slate-500/20 text-slate-400';
            const pctOfTotal = (rev / totalRevenue) * 100;
            const name = nameByProduct[pid] || `Produto #${pid.slice(0, 6)}`;

            return `
                <div class="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        <span class="text-[10px] font-black px-2 py-1 rounded-full ${classColor} uppercase flex-shrink-0">Classe ${classe}</span>
                        <span class="text-sm text-white font-bold truncate">${window.escapeHtml(name)}</span>
                    </div>
                    <div class="text-right flex-shrink-0 ml-2">
                        <div class="text-sm font-bold text-green-400">R$ ${this._formatBRL(rev)}</div>
                        <div class="text-[10px] text-slate-500">${pctOfTotal.toFixed(1)}% do faturamento</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    renderCriticalStock() {
        const container = document.getElementById('bi-low-stock-list');
        if (!container) return;

        let products = window.APP?.products?.products || [];
        if (this._viewRole === 'seller') {
            products = products.filter(p => p.owner_id === window.APP.auth.userId);
        }

        if (!products.length) {
            container.innerHTML = '<div class="text-slate-600 text-center py-6">Nenhum produto cadastrado</div>';
            return;
        }

        const critical = products.filter(p => (p.stock || 0) <= (p.min_stock ?? 5));

        if (!critical.length) {
            container.innerHTML = '<div class="text-green-500/70 text-center py-6">✅ Nenhum produto com estoque crítico</div>';
            return;
        }

        container.innerHTML = critical
            .sort((a, b) => (a.stock || 0) - (b.stock || 0))
            .map(p => `
                <div class="flex justify-between items-center bg-red-500/5 p-3 rounded-xl border border-red-500/20">
                    <div class="flex-1 min-w-0">
                        <span class="text-sm text-white font-bold truncate block">${window.escapeHtml(p.name)}</span>
                        ${this._viewRole === 'supreme' ? `<span class="text-[10px] text-slate-500">👤 ${window.escapeHtml(p.profiles?.full_name || 'Vendedor')}</span>` : ''}
                    </div>
                    <div class="text-right flex-shrink-0 ml-2">
                        <div class="text-sm font-black text-red-400">${p.stock || 0} un.</div>
                        <div class="text-[10px] text-slate-500">mín: ${p.min_stock ?? 5}</div>
                    </div>
                </div>
            `).join('');
    },

    renderStockTurnover(orders, range) {
        const container = document.getElementById('bi-stock-turnover');
        if (!container) return;

        let products = window.APP?.products?.products || [];
        if (this._viewRole === 'seller') {
            products = products.filter(p => p.owner_id === window.APP.auth.userId);
        }

        if (!products.length) {
            container.innerHTML = '<div class="text-slate-600 text-center py-6">Nenhum produto cadastrado</div>';
            return;
        }

        const days = Math.max(1, Math.ceil((range.end - range.start) / 86400000));

        const soldByProduct = {};
        orders.forEach(o => {
            (o.order_items || []).forEach(item => {
                if (!item.product_id) return;
                soldByProduct[item.product_id] = (soldByProduct[item.product_id] || 0) + (item.quantity || 1);
            });
        });

        const rows = products.map(p => {
            const sold = soldByProduct[p.id] || 0;
            const dailyRate = sold / days;
            const stock = p.stock || 0;
            const coverageDays = dailyRate > 0 ? Math.round(stock / dailyRate) : null;
            return { p, sold, coverageDays, stock };
        });

        rows.sort((a, b) => {
            if (a.coverageDays === null && b.coverageDays === null) return 0;
            if (a.coverageDays === null) return 1;
            if (b.coverageDays === null) return -1;
            return a.coverageDays - b.coverageDays;
        });

        container.innerHTML = rows.map(r => {
            let badge, badgeColor;
            if (r.coverageDays === null) {
                badge = 'Estoque parado';
                badgeColor = 'bg-slate-500/20 text-slate-400';
            } else if (r.coverageDays <= 7) {
                badge = `${r.coverageDays} dias restantes`;
                badgeColor = 'bg-red-500/20 text-red-400';
            } else if (r.coverageDays <= 20) {
                badge = `${r.coverageDays} dias restantes`;
                badgeColor = 'bg-yellow-500/20 text-yellow-400';
            } else {
                badge = `${r.coverageDays} dias restantes`;
                badgeColor = 'bg-green-500/20 text-green-400';
            }

            return `
                <div class="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                    <div class="flex-1 min-w-0">
                        <span class="text-sm text-white font-bold truncate block">${window.escapeHtml(r.p.name)}</span>
                        <span class="text-[10px] text-slate-500">${r.stock} un. em estoque · ${r.sold} vendida(s) no período</span>
                    </div>
                    <span class="text-[10px] font-black px-2 py-1 rounded-full ${badgeColor} uppercase flex-shrink-0 ml-2">${badge}</span>
                </div>
            `;
        }).join('');
    },

    renderVendorRanking(orders) {
        const wrapper = document.getElementById('bi-vendor-ranking-wrapper');
        const container = document.getElementById('bi-vendor-ranking');
        if (!wrapper || !container) return;

        if (this._viewRole !== 'supreme') {
            wrapper.classList.add('hidden');
            return;
        }
        wrapper.classList.remove('hidden');

        const costFallback = this._buildCostFallbackMap();
        const productMap = {};
        (window.APP?.products?.products || []).forEach(p => { productMap[p.id] = p; });

        const byVendor = {};
        orders.forEach(o => {
            (o.order_items || []).forEach(item => {
                const product = productMap[item.product_id];
                const vendorId = product?.owner_id || 'desconhecido';
                const vendorName = product?.profiles?.full_name || 'Vendedor desconhecido';
                if (!byVendor[vendorId]) byVendor[vendorId] = { name: vendorName, revenue: 0, profit: 0, items: 0 };

                const rev = (item.unit_price || 0) * (item.quantity || 1);
                const cost = (item.unit_cost || costFallback[item.product_id] || 0) * (item.quantity || 1);

                byVendor[vendorId].revenue += rev;
                byVendor[vendorId].profit += (rev - cost);
                byVendor[vendorId].items += (item.quantity || 1);
            });
        });

        const ranked = Object.values(byVendor).sort((a, b) => b.revenue - a.revenue);

        if (!ranked.length) {
            container.innerHTML = '<div class="text-slate-600 text-center py-6">Sem dados suficientes neste período</div>';
            return;
        }

        container.innerHTML = ranked.map((v, i) => `
            <div class="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                <div class="flex items-center gap-3">
                    <span class="text-lg font-black ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-orange-400' : 'text-slate-600'}">#${i + 1}</span>
                    <span class="text-sm text-white font-bold">${window.escapeHtml(v.name)}</span>
                </div>
                <div class="text-right">
                    <div class="text-sm font-black text-green-400">R$ ${this._formatBRL(v.revenue)}</div>
                    <div class="text-[10px] text-slate-500">lucro: R$ ${this._formatBRL(v.profit)} · ${v.items}un</div>
                </div>
            </div>
        `).join('');
    },

    async prepareCharts(orders, token, range, costFallback = null) {
        try {
            this.renderRevenueChart(orders, range, costFallback);
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

    renderRevenueChart(orders, range, costFallback = null) {
        try {
            const ctx = document.getElementById('chart-revenue');
            if (!ctx) return;

            const titleEl = document.getElementById('bi-revenue-chart-title');
            if (titleEl) titleEl.textContent = `📈 Faturamento (${range.label})`;

            const buckets = this._buildBuckets(range.start, range.end);
            costFallback = costFallback || this._buildCostFallbackMap();

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
