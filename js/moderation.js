/**
 * MODERATION.JS v1.1
 * v1.1 (auditoria): imagem da fila escapada (XSS na tela do Admin),
 *    escuta reiniciada ao trocar de conta, aviso de bloqueio sem
 *    repetir, e palavras proibidas com curinga (% _) recusadas.
 * ✅ Notifica o Admin Supremo em tempo real toda vez que um produto novo
 *    é publicado (nome do vendedor, produto, descrição, imagem).
 * ✅ Produtos com palavra proibida (lista em moderation_keywords) entram
 *    automaticamente OCULTOS da vitrine — o próprio banco já faz isso
 *    (gatilho check_product_moderation) — e aparecem aqui destacados,
 *    esperando o Admin Aprovar ou Bloquear.
 * ✅ Produtos sem nenhuma palavra suspeita publicam na hora, mas também
 *    aparecem nesta fila (últimos publicados) só pra conferência visual.
 * ✅ Gerenciador de palavras proibidas — adicionar/remover, sem precisar
 *    mexer no banco na mão.
 */

const Moderation = {
    channel: null,
    ownChannel: null,
    unseenCount: 0,
    queue: [],
    keywords: [],
    filter: 'flagged', // 'flagged' | 'recent'

    _notifiedBlocked: new Set(),

    init() {
        try {
            if (!window._supabase) return;

            // ✅ FIX (auditoria): sempre recomeça do zero — antes, ao sair
            // da conta ou trocar de cargo, a escuta antiga continuava
            // ligada (visitante deslogado recebia aviso de produto novo).
            this.teardown();

            // Fila de moderação (produto novo pra revisar) — só Admin Supremo
            if (window.APP?.auth?.isSupreme?.()) {
                this._subscribeRealtime();
            }

            // ✅ NOVO: aviso em tempo real pro PRÓPRIO vendedor quando UM
            // PRODUTO DELE é bloqueado pela moderação (palavra proibida)
            // — antes o produto simplesmente sumia da tela dele, sem
            // nunca saber que tinha sido bloqueado nem por quê.
            if (window.APP?.auth?.isSeller?.()) {
                this._subscribeOwnProductsRealtime();
            }

            log('🛡️ Moderação de produtos ativada', 'info');
        } catch (err) {
            log(`⚠️ Erro ao iniciar moderação: ${err.message}`, 'warning');
        }
    },

    _subscribeRealtime() {
        if (this.channel) return;

        this.channel = _supabase
            .channel('produtos-novos-moderacao')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'products' },
                (payload) => this._handleNewProduct(payload.new)
            )
            .subscribe();
    },

    /**
     * ✅ NOVO: escuta INSERT e UPDATE nos PRÓPRIOS produtos do vendedor
     * logado (filtro direto no Realtime, por owner_id) — cobre tanto o
     * bloqueio automático na hora de publicar quanto o caso de um
     * produto ser bloqueado DEPOIS (ex: o Admin adicionou uma palavra
     * proibida nova e o vendedor editou o produto por outro motivo).
     */
    _subscribeOwnProductsRealtime() {
        if (this.ownChannel) return;
        const userId = window.APP?.auth?.userId;
        if (!userId) return;

        this.ownChannel = _supabase
            .channel('meus-produtos-moderacao')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'products', filter: `owner_id=eq.${userId}` },
                (payload) => this._handleOwnProductChange(payload)
            )
            .subscribe();
    },

    _handleOwnProductChange(payload) {
        try {
            const product = payload.new;
            const before = payload.old;
            if (!product) return;

            // Só avisa no momento em que VIRA bloqueado (não repete o
            // aviso toda vez que o produto já bloqueado for salvo de novo).
            // ✅ FIX: o Realtime nem sempre manda o "antes" completo, então
            // também guarda quais produtos já foram avisados nesta sessão
            // (senão o aviso repetia a cada vez que o vendedor salvava).
            if (!product.flagged) { this._notifiedBlocked.delete(product.id); return; }
            const jaEstavaBloqueado = before?.flagged === true || this._notifiedBlocked.has(product.id)
                || (window.APP?.products?.manageProducts || []).some(p => p.id === product.id && p.flagged);
            this._notifiedBlocked.add(product.id);
            if (!jaEstavaBloqueado) {
                this._showOwnProductBlockedToast(product);
            }
        } catch (err) {
            log(`⚠️ Erro ao processar mudança em produto próprio: ${err.message}`, 'warning');
        }
    },

    _showOwnProductBlockedToast(product) {
        let container = document.getElementById('cart-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cart-toast-container';
            document.body.appendChild(container);
        }

        const esc = window.escapeHtml || ((s) => s);
        const toast = document.createElement('div');
        toast.className = 'cart-toast mod-toast mod-toast-flagged';
        toast.style.cursor = 'pointer';
        toast.innerHTML = `
            <i data-lucide="shield-alert" class="cart-toast-icon" style="color:#ef4444"></i>
            <span>🚫 Seu produto "${esc(product.name || 'produto')}" foi bloqueado — motivo: "${esc(product.flag_reason || 'não especificado')}"</span>
        `;
        toast.addEventListener('click', () => {
            window.APP?.navigation?.showTab('seller');
        });
        container.appendChild(toast);

        window.playNotificationSound?.('moderation');

        if (window.lucide) lucide.createIcons();

        requestAnimationFrame(() => toast.classList.add('cart-toast-show'));

        setTimeout(() => {
            toast.classList.remove('cart-toast-show');
            toast.classList.add('cart-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 8000);
    },

    teardown() {
        if (this.channel) {
            _supabase.removeChannel(this.channel);
            this.channel = null;
        }
        if (this.ownChannel) {
            _supabase.removeChannel(this.ownChannel);
            this.ownChannel = null;
        }
        this.unseenCount = 0;
    },

    async _handleNewProduct(product) {
        try {
            // Busca o nome do vendedor pra mostrar no toast (o payload do
            // Realtime só traz as colunas da própria tabela products).
            let vendorName = 'Vendedor';
            try {
                const { data } = await _supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('id', product.owner_id)
                    .maybeSingle();
                if (data?.full_name) vendorName = data.full_name;
            } catch (e) { /* segue com o nome genérico */ }

            this._showProductToast(product, vendorName);
            this._bumpBadge();

            // Se a aba de Moderação já estiver aberta, atualiza a fila na hora
            if (window.APP?.navigation?.getActiveTab?.() === 'moderation') {
                this.loadQueue();
            }
        } catch (err) {
            log(`⚠️ Erro ao processar novo produto: ${err.message}`, 'warning');
        }
    },

    _showProductToast(product, vendorName) {
        let container = document.getElementById('cart-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cart-toast-container';
            document.body.appendChild(container);
        }

        const esc = window.escapeHtml || ((s) => s);
        const isFlagged = !!product.flagged;

        const toast = document.createElement('div');
        toast.className = 'cart-toast mod-toast' + (isFlagged ? ' mod-toast-flagged' : '');
        toast.style.cursor = 'pointer';
        toast.innerHTML = `
            <i data-lucide="${isFlagged ? 'shield-alert' : 'package-plus'}" class="cart-toast-icon" style="color:${isFlagged ? '#ef4444' : '#3b82f6'}"></i>
            <span>${isFlagged ? '🚫 Produto retido p/ revisão' : '🆕 Novo produto'}: ${esc(product.name || 'Sem nome')} — por ${esc(vendorName)}</span>
        `;
        toast.addEventListener('click', () => {
            window.APP?.navigation?.showTab('moderation');
        });
        container.appendChild(toast);

        // ✅ NOVO: som de notificação
        window.playNotificationSound?.('moderation');

        if (window.lucide) lucide.createIcons();

        requestAnimationFrame(() => toast.classList.add('cart-toast-show'));

        setTimeout(() => {
            toast.classList.remove('cart-toast-show');
            toast.classList.add('cart-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 6000);
    },

    _bumpBadge() {
        this.unseenCount++;
        this._renderBadge();
    },

    _renderBadge() {
        ['moderation-nav-btn', 'bnav-moderation'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;

            let badge = btn.querySelector('.sale-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'sale-badge';
                btn.appendChild(badge);
            }

            badge.textContent = this.unseenCount > 9 ? '9+' : String(this.unseenCount);
            badge.style.display = this.unseenCount > 0 ? 'flex' : 'none';
        });
    },

    clearUnseen() {
        this.unseenCount = 0;
        this._renderBadge();
    },

    setFilter(filter) {
        this.filter = filter;
        this._updateFilterTabsUI();
        this.loadQueue();
    },

    _updateFilterTabsUI() {
        document.querySelectorAll('[data-mod-filter]').forEach(btn => {
            const isActive = btn.getAttribute('data-mod-filter') === this.filter;
            btn.classList.toggle('bg-orange-600', isActive);
            btn.classList.toggle('text-white', isActive);
            btn.classList.toggle('border-orange-600', isActive);
            btn.classList.toggle('bg-white/5', !isActive);
            btn.classList.toggle('text-slate-400', !isActive);
            btn.classList.toggle('border-white/10', !isActive);
        });
    },

    // ===== FILA DE PRODUTOS =====
    async loadQueue() {
        try {
            if (!window.APP?.auth?.isSupreme?.()) return;

            let query = _supabase
                .from('products')
                .select(`
                    id, name, description, price, image_url, active, flagged,
                    flag_reason, created_at, moderated_at, owner_id,
                    profiles!owner_id(full_name, email)
                `)
                .order('created_at', { ascending: false })
                .limit(60);

            if (this.filter === 'flagged') {
                query = query.eq('flagged', true);
            }

            const { data, error } = await query;
            if (error) throw error;

            this.queue = data || [];
            this._renderQueue();
            await this.loadKeywords();

            log('✅ Fila de moderação carregada', 'success');
        } catch (err) {
            log(`❌ Erro ao carregar fila de moderação: ${err.message}`, 'error');
        }
    },

    _renderQueue() {
        const container = document.getElementById('moderation-queue-list');
        if (!container) return;

        if (!this.queue.length) {
            const msg = this.filter === 'flagged'
                ? 'Nenhum produto retido no momento 🎉'
                : 'Nenhum produto recente';
            container.innerHTML = `<div class="text-slate-600 text-center py-8">${msg}</div>`;
            return;
        }

        const esc = window.escapeHtml || ((s) => s);

        container.innerHTML = this.queue.map(p => {
            const vendorName = esc(p.profiles?.full_name || 'Vendedor');
            const vendorEmail = esc(p.profiles?.email || '');
            const isFlagged = !!p.flagged;
            const statusLabel = isFlagged
                ? `<span class="text-[10px] font-black px-2 py-1 rounded-full bg-red-600/20 text-red-400 uppercase">🚫 Retido — motivo: "${esc(p.flag_reason || '—')}"</span>`
                : (p.active
                    ? `<span class="text-[10px] font-black px-2 py-1 rounded-full bg-green-600/20 text-green-400 uppercase">✅ Publicado</span>`
                    : `<span class="text-[10px] font-black px-2 py-1 rounded-full bg-slate-600/30 text-slate-400 uppercase">⏸️ Inativo</span>`);

            // ✅ FIX SEGURANÇA: a URL da imagem vem de um cadastro do
            // vendedor — antes entrava crua no src (dava pra injetar código
            // que rodava na tela do Admin). Agora só aceita http(s) e escapa.
            const imgUrl = window.safeUrl ? window.safeUrl(p.image_url) : '';
            const pid = esc(p.id);
            const imageHtml = imgUrl
                ? `<img src="${esc(imgUrl)}" alt="${esc(p.name)}" class="w-24 h-24 object-cover rounded-xl flex-shrink-0" onerror="this.style.display='none'">`
                : `<div class="w-24 h-24 bg-slate-800 rounded-xl flex items-center justify-center text-slate-600 text-[10px] flex-shrink-0 text-center">SEM IMAGEM</div>`;

            const actionButtons = isFlagged ? `
                <div class="flex gap-2 mt-3">
                    <button onclick="window.APP.moderation.approve('${pid}')" class="flex-1 py-2 text-xs font-bold bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-all">
                        ✅ Aprovar e Publicar
                    </button>
                    <button onclick="window.APP.moderation.block('${pid}')" class="flex-1 py-2 text-xs font-bold bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-all">
                        🚫 Manter Bloqueado
                    </button>
                </div>
            ` : `
                <div class="flex gap-2 mt-3">
                    <button onclick="window.APP.moderation.block('${pid}')" class="w-full py-2 text-xs font-bold bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-all">
                        🚫 Bloquear este produto
                    </button>
                </div>
            `;

            return `
                <div class="bg-slate-900/50 p-4 rounded-2xl border ${isFlagged ? 'border-red-500/30' : 'border-white/5'}">
                    <div class="flex gap-4">
                        ${imageHtml}
                        <div class="flex-1 min-w-0">
                            <div class="flex justify-between items-start gap-2 flex-wrap">
                                <h4 class="text-sm font-bold text-white">${esc(p.name || 'Sem nome')}</h4>
                                <span class="text-xs text-green-400 font-bold flex-shrink-0">R$ ${window.formatBRL(p.price)}</span>
                            </div>
                            <div class="text-[11px] text-yellow-400 font-semibold mt-1">👤 ${vendorName} <span class="text-slate-600">· ${vendorEmail}</span></div>
                            <p class="text-xs text-slate-400 mt-2 line-clamp-2">${esc(p.description || '—')}</p>
                            <div class="flex items-center gap-2 mt-2 flex-wrap">
                                ${statusLabel}
                                <span class="text-[10px] text-slate-600">📅 ${new Date(p.created_at).toLocaleString('pt-BR')}</span>
                            </div>
                        </div>
                    </div>
                    ${actionButtons}
                </div>
            `;
        }).join('');
    },

    async approve(productId) {
        if (!confirm('Aprovar este produto e publicá-lo na vitrine?')) return;
        await this._callModerate(productId, 'approve', '✅ Produto aprovado e publicado');
    },

    async block(productId) {
        if (!confirm('Bloquear este produto? Ele sai da vitrine imediatamente (pode reverter depois).')) return;
        await this._callModerate(productId, 'block', '🚫 Produto bloqueado');
    },

    async _callModerate(productId, action, successMsg) {
        try {
            const { error } = await _supabase.rpc('moderate_product', {
                p_product_id: productId,
                p_action: action
            });
            if (error) throw error;

            log(successMsg, 'success');
            await this.loadQueue();

            // Reflete a mudança nas telas de produtos/estoque também
            if (window.APP?.products?.fetchAll) window.APP.products.fetchAll();
        } catch (err) {
            log(`❌ Erro ao moderar produto: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    // ===== PALAVRAS PROIBIDAS =====
    async loadKeywords() {
        try {
            const { data, error } = await _supabase
                .from('moderation_keywords')
                .select('id, word, created_at')
                .order('word', { ascending: true });

            if (error) throw error;

            this.keywords = data || [];
            this._renderKeywords();
        } catch (err) {
            log(`❌ Erro ao carregar palavras proibidas: ${err.message}`, 'error');
        }
    },

    _renderKeywords() {
        const container = document.getElementById('moderation-keywords-list');
        if (!container) return;

        if (!this.keywords.length) {
            container.innerHTML = '<div class="text-slate-600 text-xs text-center py-4">Nenhuma palavra cadastrada</div>';
            return;
        }

        const esc = window.escapeHtml || ((s) => s);

        container.innerHTML = this.keywords.map(k => `
            <span class="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-full">
                ${esc(k.word)}
                <button onclick="window.APP.moderation.removeKeyword('${esc(k.id)}')" class="text-red-500 hover:text-red-400 font-black" aria-label="Remover">✕</button>
            </span>
        `).join('');
    },

    async addKeyword(event) {
        event.preventDefault();
        const input = document.getElementById('moderation-keyword-input');
        const word = input?.value?.trim()?.toLowerCase();
        if (!word) return;
        // ✅ FIX: "%" e "_" são curingas no banco — uma palavra só com
        // eles bloquearia TODOS os produtos da loja de uma vez.
        if (/[%_\\]/.test(word)) { alert('❌ Não use %, _ ou \\ na palavra proibida.'); return; }
        if (word.length < 3) { alert('❌ Use pelo menos 3 letras (palavras muito curtas bloqueiam produtos por engano).'); return; }

        try {
            const { error } = await _supabase
                .from('moderation_keywords')
                .insert([{ word, created_by: window.APP?.auth?.userId }]);

            if (error) throw error;

            input.value = '';
            await this.loadKeywords();
            log(`✅ Palavra "${word}" adicionada`, 'success');
        } catch (err) {
            if ((err.message || '').includes('duplicate')) {
                alert('ℹ️ Essa palavra já está na lista.');
            } else {
                log(`❌ Erro ao adicionar palavra: ${err.message}`, 'error');
                alert(`❌ Erro: ${err.message}`);
            }
        }
    },

    async removeKeyword(id) {
        if (!confirm('Remover esta palavra da lista de bloqueio?')) return;

        try {
            const { error } = await _supabase.from('moderation_keywords').delete().eq('id', id);
            if (error) throw error;

            await this.loadKeywords();
            log('✅ Palavra removida', 'success');
        } catch (err) {
            log(`❌ Erro ao remover palavra: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    }
};

window.Moderation = Moderation;
