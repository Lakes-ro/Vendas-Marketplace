/**
 * ADS.JS v6.4
 * v6.4 NOVO:
 *  - ✏️ EDITAR anúncio (imagem, texto, link) sem precisar apagar e criar
 *    de novo — dá até pra trocar de imagem para texto e vice-versa
 *  - ⏸ PAUSAR / ▶ REATIVAR: tira do banner sem apagar
 *  - lista do Admin mostra também os pausados (selo NO AR / PAUSADO)
 *  - imagem antiga é apagada do Storage ao ser trocada (se nenhum outro
 *    anúncio usa a mesma) e upload que falhou não deixa arquivo órfão
 * v6.3 (auditoria):
 *  - SEGURANÇA: título/texto/link de anúncios e solicitações escapados;
 *    links só http(s) (bloqueia "javascript:")
 *  - refreshForRole(): mostra as solicitações do Admin mesmo quando o
 *    login acontece depois de a página abrir
 *  - removidos listeners duplicados das abas (navigation.js já cuida)
 *  - showHelp() implementado (botões ❓ do HTML)
 *  - WhatsApp do "Anuncie aqui" com DDI 55 (antes o número era inválido)
 *  - índice do carrossel corrigido depois de excluir anúncio
 *  - imagem do anúncio comprimida e com nome de arquivo seguro
 */

const Ads = {
    ads: [],          // só os que estão no ar (banner)
    allAds: [],       // todos, inclusive pausados (lista do Admin)
    editingAdId: null,
    currentAdIndex: 0,
    carouselInterval: null,
    adType: 'image',
    duplicateData: null,
    currentAdLink: null,

    _getRole() { return window.APP?.auth?.role || 'client'; },

    async init() {
        this._ensureModal();
        this._bindDropZone();
        await this.loadAds();
        this.refreshForRole();
    },

    /** Chamado no boot e sempre que o login muda. */
    refreshForRole() {
        const isSupreme = this._getRole() === 'supreme';
        document.getElementById('ads-admin-requests-wrapper')?.classList.toggle('hidden', !isSupreme);
        if (isSupreme) {
            this.renderAdminList();
            this._loadAdminRequests();
        }
        if (this._getRole() === 'seller') this._renderVendorRequestForm();
    },

    // ===== AJUDA =====
    showHelp(who) {
        const text = who === 'admin'
            ? 'Solicitações de anúncio\n\n• Vendedores pedem um anúncio pela aba "Solicitações".\n• Você aprova ou rejeita aqui (na rejeição, o vendedor vê o motivo).\n• Aprovar NÃO publica sozinho: use o formulário acima para publicar o anúncio com as informações da solicitação.'
            : 'Como funciona\n\n1. Preencha o formulário e envie a solicitação.\n2. O Admin analisa e aprova ou rejeita (se rejeitar, você vê o motivo aqui).\n3. Depois de aprovado, o Admin publica o anúncio no banner da Loja.\n\nEnquanto estiver "Pendente", você pode deletar a solicitação.';
        alert(text);
    },

    // ===== VENDEDOR: FORMULÁRIO =====
    _renderVendorRequestForm() {
        const container = document.getElementById('ads-requests-form-container');
        if (!container || this._getRole() !== 'seller') return;
        if (container.dataset.rendered) return;
        container.dataset.rendered = '1';

        container.innerHTML = `
            <div class="bg-slate-900/50 p-6 rounded-2xl border border-white/5 mb-6">
                <h3 class="text-lg font-bold text-slate-300 mb-4">Solicitar Anúncio</h3>
                <form id="ads-request-form" class="space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-400 mb-2">Tipo de Anúncio</label>
                        <select id="req-ad-type" class="w-full p-3 bg-slate-800 border border-white/10 rounded-lg text-white" required>
                            <option value="image">🖼️ Com Imagem</option>
                            <option value="text">📝 Com Texto</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-400 mb-2">Título/Descrição</label>
                        <input type="text" id="req-title" maxlength="100" placeholder="Ex: Promoção de Verão" class="w-full p-3 bg-slate-800 border border-white/10 rounded-lg text-white" required>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-400 mb-2">Detalhes</label>
                        <textarea id="req-description" maxlength="500" placeholder="Descreva seu anúncio..." rows="4" class="w-full p-3 bg-slate-800 border border-white/10 rounded-lg text-white"></textarea>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-400 mb-2">Link (Opcional)</label>
                        <input type="url" id="req-link" placeholder="https://..." class="w-full p-3 bg-slate-800 border border-white/10 rounded-lg text-white">
                    </div>
                    <button type="submit" class="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all">📤 Enviar Solicitação</button>
                </form>
            </div>`;

        document.getElementById('ads-request-form')?.addEventListener('submit', (e) => this._saveVendorRequest(e));
    },

    async _saveVendorRequest(event) {
        event.preventDefault();
        const btn = event.target.querySelector('button[type="submit"]');
        try {
            const vendorId = window.APP?.auth?.userId;
            if (!vendorId) { alert('❌ Faça login como vendedor'); return; }

            const type = document.getElementById('req-ad-type')?.value;
            const title = document.getElementById('req-title')?.value?.trim();
            const description = document.getElementById('req-description')?.value?.trim();
            const rawLink = document.getElementById('req-link')?.value?.trim();
            const link = rawLink ? safeUrl(rawLink) : '';

            if (!title) { alert('❌ Preencha o título'); return; }
            if (rawLink && !link) { alert('❌ Link inválido — use um endereço começando com https://'); return; }

            if (btn) btn.disabled = true;
            const { error } = await _supabase.from('ads_requests').insert([{
                vendor_id: vendorId, type, title, description, link, status: 'pending'
            }]);
            if (error) throw error;

            alert('✅ Solicitação enviada com sucesso!');
            document.getElementById('ads-request-form')?.reset();
            await this._loadVendorRequests();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async _loadVendorRequests() {
        const vendorId = window.APP?.auth?.userId;
        if (!vendorId || this._getRole() !== 'seller') return;
        try {
            const { data, error } = await _supabase
                .from('ads_requests')
                .select('*')
                .eq('vendor_id', vendorId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            this._renderVendorRequests(data || []);
        } catch (err) {
            log(`❌ Solicitações: ${err.message}`, 'error');
        }
    },

    _renderVendorRequests(requests) {
        const container = document.getElementById('ads-requests-container');
        if (!container) return;
        if (!requests.length) {
            container.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhuma solicitação enviada</div>';
            return;
        }

        const colors = { pending: 'text-yellow-500', approved: 'text-green-500', rejected: 'text-red-500' };
        const labels = { pending: '⏳ Pendente', approved: '✅ Aprovado', rejected: '❌ Rejeitado' };

        container.innerHTML = requests.map(req => `
            <div class="bg-slate-900/50 p-4 rounded-xl border border-white/5 mb-3">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h4 class="text-sm font-bold text-slate-300">${escapeHtml(req.title || 'Sem título')}</h4>
                        <span class="${colors[req.status] || 'text-slate-400'} text-xs font-bold">${labels[req.status] || 'Desconhecido'}</span>
                    </div>
                    <span class="text-xs text-slate-500">${new Date(req.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
                <p class="text-xs text-slate-400 mb-3 whitespace-pre-wrap">${escapeHtml(req.description || '—')}</p>
                ${req.status === 'rejected' && req.rejection_reason ? `
                    <div class="bg-red-900/20 border border-red-500/30 p-3 rounded-lg mb-3">
                        <p class="text-xs text-red-400"><strong>Motivo da rejeição:</strong></p>
                        <p class="text-xs text-red-300 mt-1">${escapeHtml(req.rejection_reason)}</p>
                    </div>` : ''}
                ${req.status === 'pending' ? `
                    <button onclick="window.APP.ads._deleteVendorRequest('${escapeHtml(req.id)}')" class="w-full py-2 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-all">🗑️ Deletar</button>` : ''}
            </div>`).join('');
    },

    async _deleteVendorRequest(requestId) {
        if (!confirm('Deletar esta solicitação?')) return;
        try {
            const { error } = await _supabase.from('ads_requests').delete().eq('id', requestId);
            if (error) throw error;
            await this._loadVendorRequests();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        }
    },

    // ===== ADMIN: SOLICITAÇÕES =====
    async _loadAdminRequests() {
        if (this._getRole() !== 'supreme') return;
        try {
            const { data, error } = await _supabase
                .from('ads_requests')
                .select('*, profiles!vendor_id(full_name)')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });
            if (error) throw error;
            this._renderAdminRequests(data || []);
        } catch (err) {
            log(`❌ Solicitações pendentes: ${err.message}`, 'error');
        }
    },

    _renderAdminRequests(requests) {
        const container = document.getElementById('ads-admin-requests-list');
        if (!container) return;
        if (!requests.length) {
            container.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhuma solicitação pendente 🎉</div>';
            return;
        }
        const typeLabel = { image: '🖼️ Com Imagem', text: '📝 Com Texto' };

        container.innerHTML = requests.map(req => {
            const link = safeUrl(req.link);
            const id = escapeHtml(req.id);
            return `
                <div class="bg-slate-900/50 p-4 rounded-xl border border-orange-500/20">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <h4 class="text-sm font-bold text-white">${escapeHtml(req.title || 'Sem título')}</h4>
                            <span class="text-xs text-yellow-400 font-semibold">👤 ${escapeHtml(req.profiles?.full_name || 'Vendedor')}</span>
                        </div>
                        <span class="text-[10px] text-slate-500">${escapeHtml(typeLabel[req.type] || req.type || '')}</span>
                    </div>
                    <p class="text-xs text-slate-400 mb-2 whitespace-pre-wrap">${escapeHtml(req.description || '—')}</p>
                    ${link ? `<p class="text-xs text-blue-400 mb-3 break-all">🔗 ${escapeHtml(link)}</p>` : ''}
                    <div class="text-[10px] text-slate-600 mb-3">📅 ${new Date(req.created_at).toLocaleString('pt-BR')}</div>
                    <div class="flex gap-2">
                        <button onclick="window.APP.ads._approveRequest('${id}')" class="flex-1 py-2 text-xs font-bold bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-all">✅ Aprovar</button>
                        <button onclick="window.APP.ads._rejectRequest('${id}')" class="flex-1 py-2 text-xs font-bold bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-all">❌ Rejeitar</button>
                    </div>
                </div>`;
        }).join('');
    },

    async _approveRequest(requestId) {
        if (!confirm('Aprovar esta solicitação de anúncio?')) return;
        try {
            const { error } = await _supabase.from('ads_requests')
                .update({ status: 'approved', updated_at: new Date().toISOString() })
                .eq('id', requestId);
            if (error) throw error;
            alert('✅ Solicitação aprovada! Agora publique o anúncio no formulário acima.');
            await this._loadAdminRequests();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        }
    },

    async _rejectRequest(requestId) {
        const reason = prompt('Motivo da rejeição (o vendedor verá esse texto):');
        if (reason === null) return;
        try {
            const { error } = await _supabase.from('ads_requests')
                .update({ status: 'rejected', rejection_reason: reason.trim() || 'Não especificado', updated_at: new Date().toISOString() })
                .eq('id', requestId);
            if (error) throw error;
            await this._loadAdminRequests();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        }
    },

    // ===== MODAL FULLSCREEN =====
    _ensureModal() {
        if (document.getElementById('ad-fullscreen-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'ad-fullscreen-modal';
        modal.className = 'hidden';
        modal.innerHTML = `
            <div id="ad-fullscreen-content">
                <button id="ad-fullscreen-close" aria-label="Fechar">✕</button>
                <img id="ad-fullscreen-img" src="" alt="Anúncio" style="display:none">
                <div id="ad-fullscreen-text-body" style="display:none">
                    <h2 id="ad-fullscreen-title" class="text-3xl font-black text-yellow-400 mb-3"></h2>
                    <p id="ad-fullscreen-desc" class="text-slate-300 text-base leading-relaxed" style="white-space:pre-wrap"></p>
                </div>
                <div id="ad-fullscreen-link-wrap" style="text-align:center; display:none; margin-top:1.5rem">
                    <button id="ad-fullscreen-link-btn">🔗 Saiba Mais</button>
                </div>
            </div>`;
        modal.addEventListener('click', (e) => { if (e.target === modal) this.closeFullscreen(); });
        modal.querySelector('#ad-fullscreen-close').addEventListener('click', () => this.closeFullscreen());
        modal.querySelector('#ad-fullscreen-link-btn').addEventListener('click', () => this._openAdLink());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) this.closeFullscreen();
        });
        document.body.appendChild(modal);
    },

    _bindDropZone() {
        const zone = document.getElementById('ad-image-drop-zone');
        const input = document.getElementById('ad-image-input');
        if (!zone || !input || zone.dataset.bound) return;
        zone.dataset.bound = '1';

        zone.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('border-blue-500'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('border-blue-500'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('border-blue-500');
            if (e.dataTransfer?.files?.length) {
                input.files = e.dataTransfer.files;
                input.dispatchEvent(new Event('change'));
            }
        });
    },

    // ===== ANÚNCIOS PÚBLICOS =====
    async loadAds() {
        try {
            const isSupreme = this._getRole() === 'supreme';
            let query = _supabase.from('ads').select('*').order('created_at', { ascending: false });
            if (!isSupreme) query = query.eq('active', true);

            const { data, error } = await query;
            if (error) throw error;

            this.allAds = data || [];
            this.ads = this.allAds.filter(a => a.active !== false);
            if (this.currentAdIndex >= this.ads.length) this.currentAdIndex = 0;

            if (this.ads.length) { this.updateBanner(); this.startCarousel(); }
            else { clearInterval(this.carouselInterval); this.showFallback(); }

            if (isSupreme) this.renderAdminList();
        } catch (err) {
            log(`❌ Anúncios: ${err.message}`, 'error');
            this.showFallback();
        }
    },

    updateBanner() {
        const hero = document.getElementById('ads-hero');
        if (!hero) return;
        const ad = this.ads[this.currentAdIndex];
        if (!ad) { this.showFallback(); return; }

        const img = safeUrl(ad.image_url);
        if (img) {
            hero.innerHTML = `
                <div data-ad-open class="cursor-zoom-in w-full h-full">
                    <img src="${escapeHtml(img)}" alt="Anúncio" class="w-full h-full object-cover rounded-[32px]" onerror="this.style.display='none'">
                </div>`;
        } else if (ad.ad_title || ad.ad_text) {
            hero.innerHTML = `
                <div data-ad-open class="cursor-zoom-in w-full h-full flex flex-col items-center justify-center bg-gradient-to-r from-yellow-900/20 to-yellow-800/20 rounded-[32px] border border-yellow-500/30 p-8">
                    <h2 class="text-4xl font-black text-yellow-400 mb-4 text-center">${escapeHtml(ad.ad_title || 'Aviso')}</h2>
                    <p class="text-lg text-slate-300 text-center max-w-md line-clamp-2">${escapeHtml(ad.ad_text || '')}</p>
                    <p class="text-sm text-yellow-500 mt-4">👆 Toque para ampliar</p>
                </div>`;
        } else {
            this.showFallback();
            return;
        }
        hero.querySelector('[data-ad-open]')?.addEventListener('click', () => this.openFullscreen());
    },

    showFallback() {
        const hero = document.getElementById('ads-hero');
        if (!hero) return;
        hero.innerHTML = `
            <div data-ad-fallback class="w-full h-full flex flex-col items-center justify-center bg-gradient-to-r from-blue-900/20 to-blue-800/20 rounded-[32px] border border-blue-500/30 p-8 cursor-pointer">
                <div class="text-6xl mb-4">📢</div>
                <h2 class="text-3xl font-black text-white mb-2">Anuncie Aqui</h2>
                <p class="text-slate-400 text-center">Clique para entrar em contato</p>
            </div>`;
        hero.querySelector('[data-ad-fallback]')?.addEventListener('click', () => {
            window.open(buildWhatsAppLink(CONFIG.STORE_WHATSAPP, 'Olá! Gostaria de anunciar na Ityrapuã Store'), '_blank', 'noopener');
        });
    },

    startCarousel() {
        clearInterval(this.carouselInterval);
        if (this.ads.length <= 1) return;
        this.carouselInterval = setInterval(() => {
            if (document.hidden) return;
            this.currentAdIndex = (this.currentAdIndex + 1) % this.ads.length;
            this.updateBanner();
        }, 8000);
    },

    /** Abre em tela cheia o anúncio atual do banner (ou o anúncio passado). */
    openFullscreen(adOverride) {
        this._ensureModal();
        const ad = adOverride || this.ads[this.currentAdIndex];
        if (!ad) return;
        clearInterval(this.carouselInterval);

        const modal = document.getElementById('ad-fullscreen-modal');
        const img = document.getElementById('ad-fullscreen-img');
        const textBody = document.getElementById('ad-fullscreen-text-body');
        const linkWrap = document.getElementById('ad-fullscreen-link-wrap');

        img.style.display = 'none';
        textBody.style.display = 'none';
        linkWrap.style.display = 'none';

        const imgUrl = safeUrl(ad.image_url);
        if (imgUrl) {
            img.src = imgUrl;
            img.style.display = 'block';
        } else {
            document.getElementById('ad-fullscreen-title').textContent = ad.ad_title || '';
            document.getElementById('ad-fullscreen-desc').textContent = ad.ad_text || '';
            textBody.style.display = 'block';
        }

        this.currentAdLink = safeUrl(ad.link_contact) || null;
        if (this.currentAdLink) linkWrap.style.display = 'block';

        modal.classList.remove('hidden');
    },

    closeFullscreen() {
        document.getElementById('ad-fullscreen-modal')?.classList.add('hidden');
        this.startCarousel();
    },

    _openAdLink() {
        if (this.currentAdLink) window.open(this.currentAdLink, '_blank', 'noopener');
    },

    // ===== ADMIN: LISTA =====
    _findAd(adId) {
        return (this.allAds || []).find(a => a.id === adId) || this.ads.find(a => a.id === adId);
    },

    renderAdminList() {
        const listDiv = document.getElementById('ads-list');
        if (!listDiv) return;
        const all = this.allAds || [];

        if (!all.length) {
            listDiv.innerHTML = '<div class="text-slate-600 text-sm text-center py-8">Nenhum anúncio publicado ainda</div>';
            return;
        }

        const activeCount = all.filter(a => a.active !== false).length;
        const summary = `<div class="text-[11px] text-slate-500 mb-1">${activeCount} no ar · ${all.length - activeCount} pausado(s)</div>`;

        listDiv.innerHTML = summary + all.map(ad => {
            const img = safeUrl(ad.image_url);
            const isText = !img && (ad.ad_title || ad.ad_text);
            const isActive = ad.active !== false;
            const isEditing = this.editingAdId === ad.id;
            const id = escapeHtml(ad.id);
            const typeLabel = img ? '🖼️ Imagem' : isText ? '📝 Texto' : '❓ Desconhecido';
            const preview = ad.ad_text ? (ad.ad_text.length > 60 ? ad.ad_text.slice(0, 60) + '…' : ad.ad_text) : '';

            return `
                <div class="flex justify-between items-center bg-white/5 p-4 rounded-2xl border transition-all
                            ${isEditing ? 'border-blue-500/60' : 'border-white/5 hover:border-yellow-500/20'} ${isActive ? '' : 'opacity-60'}">
                    <div class="flex gap-4 flex-1 min-w-0">
                        ${img
                            ? `<img src="${escapeHtml(img)}" alt="Anúncio" class="w-16 h-16 object-cover rounded-lg flex-shrink-0 cursor-zoom-in" onclick="window.APP.ads.previewAd('${id}')">`
                            : `<div class="w-16 h-16 bg-slate-700 rounded-lg flex items-center justify-center text-2xl flex-shrink-0">📝</div>`}
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1 flex-wrap">
                                <span class="text-xs text-yellow-400 font-bold">${typeLabel}</span>
                                ${isActive
                                    ? '<span class="text-[10px] font-black px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">NO AR</span>'
                                    : '<span class="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400">PAUSADO</span>'}
                                ${isEditing ? '<span class="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">EDITANDO</span>' : ''}
                            </div>
                            ${isText
                                ? `<div class="text-sm text-white font-bold truncate">${escapeHtml(ad.ad_title || '(sem título)')}</div>
                                   <div class="text-xs text-slate-400 truncate">${escapeHtml(preview)}</div>`
                                : `<div class="text-xs text-slate-300 truncate font-bold">Link: ${escapeHtml(ad.link_contact || '(sem link)')}</div>`}
                            <div class="text-[10px] text-slate-600 mt-1">📅 ${new Date(ad.created_at).toLocaleDateString('pt-BR')}</div>
                        </div>
                    </div>
                    <div class="flex gap-1 flex-shrink-0 ml-2">
                        <button onclick="window.APP.ads.previewAd('${id}')" class="text-green-500 hover:bg-green-500/10 p-2 rounded-lg" title="Visualizar" aria-label="Visualizar"><i data-lucide="eye" class="w-4 h-4"></i></button>
                        <button onclick="window.APP.ads.editAd('${id}')" class="text-yellow-400 hover:bg-yellow-500/10 p-2 rounded-lg" title="Editar" aria-label="Editar"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                        <button onclick="window.APP.ads.toggleActive('${id}')" class="${isActive ? 'text-slate-300' : 'text-green-400'} hover:bg-white/10 p-2 rounded-lg"
                                title="${isActive ? 'Pausar (tira do banner sem apagar)' : 'Colocar no ar de novo'}" aria-label="${isActive ? 'Pausar' : 'Reativar'}">
                            <i data-lucide="${isActive ? 'pause' : 'play'}" class="w-4 h-4"></i>
                        </button>
                        <button onclick="window.APP.ads.duplicateAd('${id}')" class="text-blue-500 hover:bg-blue-500/10 p-2 rounded-lg" title="Duplicar" aria-label="Duplicar"><i data-lucide="copy" class="w-4 h-4"></i></button>
                        <button onclick="window.APP.ads.deleteAd('${id}')" class="text-red-500 hover:bg-red-500/10 p-2 rounded-lg" title="Deletar" aria-label="Deletar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>
                </div>`;
        }).join('');

        if (window.lucide) lucide.createIcons();
    },

    previewAd(adId) {
        const ad = this._findAd(adId);
        if (!ad) return;
        const idx = this.ads.findIndex(a => a.id === adId);
        if (idx >= 0) this.currentAdIndex = idx;
        this.openFullscreen(ad);
    },

    async toggleActive(adId) {
        const ad = this._findAd(adId);
        if (!ad) return;
        const newActive = ad.active === false;
        try {
            const { data, error } = await _supabase.from('ads').update({ active: newActive }).eq('id', adId).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('O banco recusou a alteração');
            this.currentAdIndex = 0;
            await this.loadAds();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        }
    },

    _adImagePath(url) {
        const path = String(url || '').split('/ad-images/')[1];
        return path ? decodeURIComponent(path.split('?')[0]) : null;
    },

    async deleteAd(adId) {
        if (!confirm('❌ Deseja deletar este anúncio?\n\nDica: se for só tirar do ar por um tempo, use o botão ⏸ Pausar.')) return;
        try {
            const ad = this._findAd(adId);
            const { data, error } = await _supabase.from('ads').delete().eq('id', adId).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('O banco recusou a exclusão');

            // Só apaga o arquivo se nenhum outro anúncio (ex: duplicado) usa a mesma imagem
            const path = this._adImagePath(ad?.image_url);
            const sharedByOther = (this.allAds || []).some(a => a.id !== adId && a.image_url === ad?.image_url);
            if (path && !sharedByOther) await _supabase.storage.from('ad-images').remove([path]).catch(() => {});

            if (this.editingAdId === adId) this.cancelEdit();
            this.currentAdIndex = 0;
            await this.loadAds();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        }
    },

    // ===== FORMULÁRIO (criar / editar / duplicar) =====
    _setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; },
    _setText(id, v) { const el = document.getElementById(id); if (el) el.innerText = v; },

    _fillForm(ad) {
        this._setVal('ad-image-input', '');
        if (ad.image_url) {
            this._setVal('ad-link-input', ad.link_contact || '');
            this._setText('ad-image-name', '🖼️ Mantendo a imagem atual — clique aqui só se quiser trocar');
            this.toggleAdType('image');
        } else {
            this._setVal('ad-text-title', ad.ad_title || '');
            this._setVal('ad-text-content', ad.ad_text || '');
            this._setVal('ad-text-link', ad.link_contact || '');
            this._setText('preview-title', ad.ad_title || 'TÍTULO DO ANÚNCIO');
            this._setText('preview-text', ad.ad_text || 'Conteúdo do seu anúncio aparecerá aqui');
            this.toggleAdType('text');
        }
    },

    _resetForm() {
        ['ad-link-input', 'ad-text-title', 'ad-text-content', 'ad-text-link', 'ad-image-input'].forEach(id => this._setVal(id, ''));
        this._setText('ad-image-name', 'Clique ou arraste uma imagem');
        this._setText('preview-title', 'TÍTULO DO ANÚNCIO');
        this._setText('preview-text', 'Conteúdo do seu anúncio aparecerá aqui');
        this.duplicateData = null;
    },

    /** Liga/desliga o "modo edição" nos dois formulários (textos dos botões + faixa de aviso). */
    _renderEditMode() {
        const editing = !!this.editingAdId;
        const ad = editing ? this._findAd(this.editingAdId) : null;

        ['ad-form-image', 'ad-form-text'].forEach(formId => {
            const btn = document.querySelector(`#${formId} button[type="submit"]`);
            if (!btn) return;
            if (!btn.dataset.originalText) btn.dataset.originalText = btn.innerText;
            btn.innerText = editing ? '💾 SALVAR ALTERAÇÕES' : btn.dataset.originalText;
        });

        let banner = document.getElementById('ad-edit-banner');
        if (!editing) { banner?.remove(); return; }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'ad-edit-banner';
            banner.className = 'mb-4 p-4 rounded-2xl border border-blue-500/40 bg-blue-500/10 flex items-center justify-between gap-3 flex-wrap';
            const anchor = document.getElementById('ad-form-image');
            anchor?.parentNode?.insertBefore(banner, anchor);
        }
        const name = ad?.ad_title || (ad?.image_url ? 'anúncio com imagem' : 'anúncio');
        banner.innerHTML = `
            <span class="text-sm text-blue-200 font-bold">✏️ Editando: <span class="text-white">${escapeHtml(name)}</span>
                <span class="block text-[11px] text-slate-400 font-normal mt-1">Altere o que quiser e clique em "Salvar alterações". Você também pode trocar entre imagem e texto.</span>
            </span>
            <button type="button" data-ad-cancel-edit class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-bold">Cancelar edição</button>`;
        banner.querySelector('[data-ad-cancel-edit]').addEventListener('click', () => this.cancelEdit());
    },

    editAd(adId) {
        const ad = this._findAd(adId);
        if (!ad) return;
        this._resetForm();
        this.editingAdId = adId;
        this._fillForm(ad);
        this._renderEditMode();
        this.renderAdminList();
        document.getElementById('ad-edit-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    cancelEdit() {
        this.editingAdId = null;
        this._resetForm();
        this._renderEditMode();
        this.renderAdminList();
    },

    duplicateAd(adId) {
        const ad = this._findAd(adId);
        if (!ad) return;
        if (this.editingAdId) { this.editingAdId = null; this._renderEditMode(); }
        this._resetForm();
        this._fillForm(ad);
        this.duplicateData = ad.image_url ? ad : null;
        if (ad.image_url) this._setText('ad-image-name', '🖼️ Usando a imagem do anúncio duplicado — clique para trocar');
        this.renderAdminList();
        document.getElementById('ads-section')?.scrollIntoView({ behavior: 'smooth' });
    },

    toggleAdType(type) {
        this.adType = type === 'text' ? 'text' : 'image';
        const isImage = this.adType === 'image';

        document.getElementById('ad-form-image')?.classList.toggle('hidden', !isImage);
        document.getElementById('ad-form-text')?.classList.toggle('hidden', isImage);

        const btnImage = document.getElementById('btn-ad-type-image');
        const btnText = document.getElementById('btn-ad-type-text');
        [[btnImage, isImage], [btnText, !isImage]].forEach(([b, on]) => {
            if (!b) return;
            b.classList.toggle('bg-blue-600', on);
            b.classList.toggle('text-white', on);
            b.classList.toggle('text-slate-400', !on);
        });
    },

    async _uploadAdImage(original) {
        if (!original.type.startsWith('image/')) throw new Error('O arquivo precisa ser uma imagem');
        const file = await compressImage(original);
        if (file.size > 5 * 1024 * 1024) throw new Error('Imagem maior que 5MB');
        const path = `${Date.now()}-${sanitizeFileName(file.name)}`;
        const { error } = await _supabase.storage.from('ad-images').upload(path, file, { contentType: file.type });
        if (error) throw error;
        return { url: _supabase.storage.from('ad-images').getPublicUrl(path).data.publicUrl, path };
    },

    async saveAd(event, type) {
        event?.preventDefault?.();
        if (this._getRole() !== 'supreme') { alert('❌ Apenas o Admin pode publicar anúncios'); return; }

        const form = document.getElementById(type === 'text' ? 'ad-form-text' : 'ad-form-image');
        const btn = form?.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        const editing = this.editingAdId ? this._findAd(this.editingAdId) : null;
        let uploaded = null;

        try {
            let adData;

            if (type === 'image') {
                const newFile = document.getElementById('ad-image-input')?.files?.[0];
                let imageUrl;
                if (newFile) {
                    uploaded = await this._uploadAdImage(newFile);
                    imageUrl = uploaded.url;
                } else if (editing?.image_url) {
                    imageUrl = editing.image_url;            // editando: mantém a imagem atual
                } else if (this.duplicateData?.image_url) {
                    imageUrl = this.duplicateData.image_url; // duplicando: reaproveita
                } else {
                    alert('❌ Selecione uma imagem');
                    return;
                }

                const rawLink = document.getElementById('ad-link-input')?.value?.trim() || '';
                const link = rawLink ? safeUrl(rawLink) : '';
                if (rawLink && !link) { alert('❌ Link inválido — use https://...'); return; }

                adData = { image_url: imageUrl, link_contact: link, ad_title: null, ad_text: null };
            } else {
                const title = document.getElementById('ad-text-title')?.value?.trim() || '';
                const content = document.getElementById('ad-text-content')?.value?.trim() || '';
                if (!title && !content) { alert('❌ Preencha pelo menos o título ou o conteúdo'); return; }

                const rawLink = document.getElementById('ad-text-link')?.value?.trim() || '';
                const link = rawLink ? safeUrl(rawLink) : '';
                if (rawLink && !link) { alert('❌ Link inválido — use https://...'); return; }

                adData = { ad_title: title, ad_text: content, link_contact: link, image_url: null };
            }

            if (editing) {
                const { data, error } = await _supabase.from('ads').update(adData).eq('id', editing.id).select('id');
                if (error) throw error;
                if (!data?.length) throw new Error('O banco recusou a alteração');

                // Imagem antiga trocada/removida: apaga do Storage (se nenhum outro anúncio usa)
                if (editing.image_url && editing.image_url !== adData.image_url) {
                    const oldPath = this._adImagePath(editing.image_url);
                    const sharedByOther = (this.allAds || []).some(a => a.id !== editing.id && a.image_url === editing.image_url);
                    if (oldPath && !sharedByOther) await _supabase.storage.from('ad-images').remove([oldPath]).catch(() => {});
                }
                alert('✅ Anúncio atualizado!');
            } else {
                const { error } = await _supabase.from('ads').insert([{ ...adData, active: true }]);
                if (error) throw error;
                alert('✅ Anúncio publicado com sucesso!');
            }

            uploaded = null; // deu certo: não apagar o arquivo novo
            this.editingAdId = null;
            this._resetForm();
            this._renderEditMode();
            await this.loadAds();
        } catch (err) {
            alert(`❌ Erro: ${err.message}`);
        } finally {
            // Falhou depois de subir a imagem nova: não deixa arquivo órfão
            if (uploaded?.path) await _supabase.storage.from('ad-images').remove([uploaded.path]).catch(() => {});
            if (btn) btn.disabled = false;
        }
    }
};
