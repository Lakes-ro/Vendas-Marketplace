/**
 * ADS.JS v6.0 - CORRIGIDO
 * ✅ Admin: Gerencia anúncios (criar, editar, deletar)
 * ✅ Vendedores: Solicita anúncios (status: pending/approved/rejected)
 * ✅ Banner clicável e expansível
 * ✅ Sem duplicação de código
 */

const Ads = {
    ads: [],
    currentAdIndex: 0,
    carouselInterval: null,
    isInstalled: false,
    adType: 'image',
    duplicateData: null,
    currentRole: null,

    async init() {
        try {
            log('📢 Inicializando Ads v6.0...', 'info');
            this.currentRole = window.APP?.auth?.role || 'client';
            this.detectPWA();
            this._ensureModal();
            await this.loadAds();
            this._setupVendorUI();
            log('✅ Ads v6.0 inicializado', 'success');
        } catch (err) {
            log(`❌ Erro ao inicializar ads: ${err.message}`, 'error');
        }
    },

    detectPWA() {
        this.isInstalled = window.matchMedia('(display-mode: standalone)').matches;
    },

    // ===== SETUP PARA VENDEDORES =====
    _setupVendorUI() {
        if (this.currentRole !== 'seller') return;

        const adsReqBtn = document.getElementById('ads-requests-nav-btn');
        if (adsReqBtn) {
            adsReqBtn.classList.remove('hidden');
            adsReqBtn.addEventListener('click', () => {
                goToTab('ads-requests');
                this._loadVendorRequests();
            });
        }

        const bnav = document.getElementById('bnav-ads-requests');
        if (bnav) {
            bnav.classList.remove('hidden');
            bnav.addEventListener('click', () => {
                goToTab('ads-requests');
                this._loadVendorRequests();
            });
        }

        this._renderVendorRequestForm();
    },

    // ===== FORMULÁRIO DE SOLICITAÇÃO PARA VENDEDORES =====
    _renderVendorRequestForm() {
        const section = document.getElementById('ads-requests-section');
        if (!section) return;

        const formContainer = document.getElementById('ads-requests-form-container');
        if (!formContainer) return;

        formContainer.innerHTML = `
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
                        <input type="text" id="req-title" placeholder="Ex: Promoção de Verão" class="w-full p-3 bg-slate-800 border border-white/10 rounded-lg text-white" required>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-400 mb-2">Detalhes</label>
                        <textarea id="req-description" placeholder="Descreva seu anúncio..." rows="4" class="w-full p-3 bg-slate-800 border border-white/10 rounded-lg text-white"></textarea>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-400 mb-2">Link (Opcional)</label>
                        <input type="url" id="req-link" placeholder="https://..." class="w-full p-3 bg-slate-800 border border-white/10 rounded-lg text-white">
                    </div>

                    <button type="submit" class="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all">
                        📤 Enviar Solicitação
                    </button>
                </form>
            </div>
        `;

        const form = document.getElementById('ads-request-form');
        if (form) {
            form.addEventListener('submit', (e) => this._saveVendorRequest(e));
        }
    },

    // ===== SALVAR SOLICITAÇÃO DO VENDEDOR =====
    async _saveVendorRequest(event) {
        event.preventDefault();

        try {
            const vendorId = window.APP?.auth?.userId;
            if (!vendorId) {
                alert('❌ Vendedor não autenticado');
                return;
            }

            const type = document.getElementById('req-ad-type')?.value;
            const title = document.getElementById('req-title')?.value?.trim();
            const description = document.getElementById('req-description')?.value?.trim();
            const link = document.getElementById('req-link')?.value?.trim();

            if (!title) {
                alert('❌ Preencha o título');
                return;
            }

            log('💾 Salvando solicitação de anúncio...', 'info');

            const { error } = await _supabase.from('ads_requests').insert([{
                vendor_id: vendorId,
                type: type,
                title: title,
                description: description,
                link: link,
                status: 'pending'
            }]);

            if (error) throw error;

            alert('✅ Solicitação enviada com sucesso!');
            document.getElementById('ads-request-form').reset();
            await this._loadVendorRequests();

        } catch (err) {
            log(`❌ Erro ao salvar solicitação: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    // ===== CARREGAR SOLICITAÇÕES DO VENDEDOR =====
    async _loadVendorRequests() {
        try {
            const vendorId = window.APP?.auth?.userId;
            if (!vendorId) return;

            const { data, error } = await _supabase
                .from('ads_requests')
                .select('*')
                .eq('vendor_id', vendorId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            this._renderVendorRequests(data || []);

        } catch (err) {
            log(`❌ Erro ao carregar solicitações: ${err.message}`, 'error');
        }
    },

    // ===== RENDERIZAR LISTA DE SOLICITAÇÕES DO VENDEDOR =====
    _renderVendorRequests(requests) {
        const container = document.getElementById('ads-requests-container');
        if (!container) return;

        if (requests.length === 0) {
            container.innerHTML = '<div class="text-slate-600 text-center py-8">Nenhuma solicitação enviada</div>';
            return;
        }

        container.innerHTML = requests.map(req => {
            const statusColor = {
                pending: 'text-yellow-500',
                approved: 'text-green-500',
                rejected: 'text-red-500'
            }[req.status] || 'text-slate-400';

            const statusLabel = {
                pending: '⏳ Pendente',
                approved: '✅ Aprovado',
                rejected: '❌ Rejeitado'
            }[req.status] || 'Desconhecido';

            return `
                <div class="bg-slate-900/50 p-4 rounded-xl border border-white/5">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h4 class="text-sm font-bold text-slate-300">${req.title || 'Sem título'}</h4>
                            <span class="${statusColor} text-xs font-bold">${statusLabel}</span>
                        </div>
                        <span class="text-xs text-slate-500">${new Date(req.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>

                    <p class="text-xs text-slate-400 mb-3">${req.description || '—'}</p>

                    ${req.status === 'rejected' && req.rejection_reason ? `
                        <div class="bg-red-900/20 border border-red-500/30 p-3 rounded-lg mb-3">
                            <p class="text-xs text-red-400"><strong>Motivo da rejeição:</strong></p>
                            <p class="text-xs text-red-300 mt-1">${req.rejection_reason}</p>
                        </div>
                    ` : ''}

                    ${req.status === 'pending' ? `
                        <button onclick="window.APP.ads._deleteVendorRequest('${req.id}')" class="w-full py-2 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-all">
                            🗑️ Deletar
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');
    },

    // ===== DELETAR SOLICITAÇÃO DO VENDEDOR =====
    async _deleteVendorRequest(requestId) {
        if (!confirm('Deletar esta solicitação?')) return;

        try {
            const { error } = await _supabase
                .from('ads_requests')
                .delete()
                .eq('id', requestId);

            if (error) throw error;

            log('✅ Solicitação deletada', 'success');
            const vendorId = window.APP?.auth?.userId;
            const { data } = await _supabase
                .from('ads_requests')
                .select('*')
                .eq('vendor_id', vendorId)
                .order('created_at', { ascending: false });
            this._renderVendorRequests(data || []);

        } catch (err) {
            log(`❌ Erro ao deletar: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    // ===== MODAL FULLSCREEN PARA ANÚNCIOS =====
    _ensureModal() {
        if (document.getElementById('ad-fullscreen-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'ad-fullscreen-modal';
        modal.className = 'hidden';
        modal.innerHTML = `
            <div id="ad-fullscreen-content">
                <button id="ad-fullscreen-close" onclick="window.APP.ads.closeFullscreen()" aria-label="Fechar">✕</button>
                <img id="ad-fullscreen-img" src="" alt="Anúncio" style="display:none">
                <div id="ad-fullscreen-text-body" style="display:none">
                    <h2 id="ad-fullscreen-title" class="text-3xl font-black text-yellow-400 mb-3"></h2>
                    <p id="ad-fullscreen-desc" class="text-slate-300 text-base leading-relaxed"></p>
                </div>
                <div id="ad-fullscreen-link-wrap" style="text-align:center; display:none; margin-top:1.5rem">
                    <button id="ad-fullscreen-link-btn" onclick="window.APP.ads._openAdLink()">
                        🔗 Saiba Mais
                    </button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeFullscreen();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeFullscreen();
        });

        document.body.appendChild(modal);
    },

    // ===== CARREGAR ANÚNCIOS PÚBLICOS =====
    async loadAds() {
        try {
            if (!window._supabase) throw new Error('Supabase não disponível');

            log('📥 Carregando anúncios...', 'info');

            const { data, error } = await _supabase
                .from('ads')
                .select('*')
                .eq('active', true)
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.ads = data || [];
            log(`✅ ${this.ads.length} anúncio(s) carregado(s)`, 'success');

            if (this.ads.length > 0) {
                this.updateBanner();
                this.startCarousel();
            } else {
                this.showFallback();
            }

            if (this.currentRole === 'supreme') {
                this.renderAdminList();
            }

        } catch (err) {
            log(`❌ Erro ao carregar anúncios: ${err.message}`, 'error');
            this.showFallback();
        }
    },

    updateBanner() {
        try {
            const heroSection = document.getElementById('ads-hero');
            if (!heroSection) {
                log('⚠️ #ads-hero não encontrado', 'warning');
                return;
            }

            if (this.ads.length === 0) {
                this.showFallback();
                return;
            }

            const currentAd = this.ads[this.currentAdIndex];
            if (!currentAd) return;

            if (currentAd.image_url) {
                heroSection.innerHTML = `
                    <div onclick="window.APP.ads.openFullscreen()" class="cursor-zoom-in w-full h-full">
                        <img src="${currentAd.image_url}"
                             alt="Anúncio"
                             class="w-full h-full object-cover rounded-[32px]"
                             onerror="this.style.display='none'">
                    </div>
                `;
                log('✅ Banner de imagem renderizado', 'success');
                return;
            }

            if (currentAd.ad_title || currentAd.ad_text) {
                heroSection.innerHTML = `
                    <div onclick="window.APP.ads.openFullscreen()"
                         class="cursor-zoom-in w-full h-full flex flex-col items-center justify-center
                                bg-gradient-to-r from-yellow-900/20 to-yellow-800/20
                                rounded-[32px] border border-yellow-500/30 p-8">
                        <h2 class="text-4xl font-black text-yellow-400 mb-4 text-center">
                            ${currentAd.ad_title || 'Aviso'}
                        </h2>
                        <p class="text-lg text-slate-300 text-center max-w-md">${currentAd.ad_text || ''}</p>
                        <p class="text-sm text-yellow-500 mt-4">👆 Toque para ampliar</p>
                    </div>
                `;
                log('✅ Banner de texto renderizado', 'success');
                return;
            }

            this.showFallback();

        } catch (err) {
            log(`❌ Erro ao atualizar banner: ${err.message}`, 'error');
            this.showFallback();
        }
    },

    showFallback() {
        try {
            const heroSection = document.getElementById('ads-hero');
            if (!heroSection) return;

            heroSection.innerHTML = `
                <div class="w-full h-full flex flex-col items-center justify-center
                            bg-gradient-to-r from-blue-900/20 to-blue-800/20
                            rounded-[32px] border border-blue-500/30 p-8 cursor-pointer"
                     onclick="window.open('https://wa.me/35991264352?text=Olá! Gostaria de anunciar', '_blank')">
                    <div class="text-6xl mb-4">📢</div>
                    <h2 class="text-3xl font-black text-white mb-2">Anuncie Aqui</h2>
                    <p class="text-slate-400 text-center">Clique para entrar em contato</p>
                </div>
            `;
            log('✅ Fallback renderizado', 'info');
        } catch (err) {
            log(`❌ Erro ao renderizar fallback: ${err.message}`, 'error');
        }
    },

    startCarousel() {
        try {
            clearInterval(this.carouselInterval);
            if (this.ads.length <= 1) return;

            this.carouselInterval = setInterval(() => {
                this.currentAdIndex = (this.currentAdIndex + 1) % this.ads.length;
                this.updateBanner();
            }, 8000);

            log('✅ Carrossel iniciado (8s)', 'success');
        } catch (err) {
            log(`❌ Erro ao iniciar carrossel: ${err.message}`, 'error');
        }
    },

    openFullscreen() {
        try {
            this._ensureModal();
            const currentAd = this.ads[this.currentAdIndex];
            if (!currentAd) return;

            clearInterval(this.carouselInterval);

            const modal = document.getElementById('ad-fullscreen-modal');
            const img = document.getElementById('ad-fullscreen-img');
            const textBody = document.getElementById('ad-fullscreen-text-body');
            const titleEl = document.getElementById('ad-fullscreen-title');
            const descEl = document.getElementById('ad-fullscreen-desc');
            const linkWrap = document.getElementById('ad-fullscreen-link-wrap');

            img.style.display = 'none';
            textBody.style.display = 'none';
            linkWrap.style.display = 'none';

            if (currentAd.image_url) {
                img.src = currentAd.image_url;
                img.style.display = 'block';
            } else if (currentAd.ad_title || currentAd.ad_text) {
                if (titleEl) titleEl.textContent = currentAd.ad_title || '';
                if (descEl) descEl.textContent = currentAd.ad_text || '';
                textBody.style.display = 'block';
            }

            if (currentAd.link_contact) {
                linkWrap.style.display = 'block';
                this.currentAdLink = currentAd.link_contact;
            }

            modal.classList.remove('hidden');
            log('✅ Modal fullscreen aberto', 'success');

        } catch (err) {
            log(`❌ Erro ao abrir fullscreen: ${err.message}`, 'error');
        }
    },

    closeFullscreen() {
        try {
            const modal = document.getElementById('ad-fullscreen-modal');
            if (modal) modal.classList.add('hidden');
            this.startCarousel();
            log('✅ Modal fullscreen fechado', 'success');
        } catch (err) {
            log(`❌ Erro ao fechar fullscreen: ${err.message}`, 'error');
        }
    },

    _openAdLink() {
        if (this.currentAdLink) {
            window.open(this.currentAdLink, '_blank');
        }
    },

    renderAdminList() {
        try {
            const listDiv = document.getElementById('ads-list');
            if (!listDiv) return;

            if (this.ads.length === 0) {
                listDiv.innerHTML = '<div class="text-slate-600 text-sm text-center py-8">Nenhum anúncio ativo</div>';
                return;
            }

            listDiv.innerHTML = this.ads.map((ad) => {
                const isImage = !!ad.image_url;
                const isText = !!ad.ad_title || !!ad.ad_text;
                const typeLabel = isImage ? '🖼️ Imagem' : isText ? '📝 Texto' : '❓ Desconhecido';

                return `
                    <div class="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-yellow-500/20 transition-all">
                        <div class="flex gap-4 flex-1">
                            ${isImage
                                ? `<img src="${ad.image_url}" alt="Anúncio" class="w-16 h-16 object-cover rounded-lg flex-shrink-0 cursor-zoom-in"
                                       onclick="window.APP.ads.previewAd('${ad.id}')">`
                                : `<div class="w-16 h-16 bg-slate-700 rounded-lg flex items-center justify-center text-2xl flex-shrink-0">📝</div>`
                            }
                            <div class="flex-1 min-w-0">
                                <div class="text-xs text-yellow-400 font-bold mb-1">${typeLabel}</div>
                                ${isText
                                    ? `<div class="text-sm text-white font-bold truncate">${ad.ad_title || '(sem título)'}</div>
                                       <div class="text-xs text-slate-400 truncate">${ad.ad_text ? ad.ad_text.substring(0, 60) + '...' : ''}</div>`
                                    : `<div class="text-xs text-slate-300 truncate font-bold">Link: ${ad.link_contact || '(sem link)'}</div>`
                                }
                                <div class="text-[10px] text-slate-600 mt-1">📅 ${new Date(ad.created_at).toLocaleDateString('pt-BR')}</div>
                            </div>
                        </div>
                        <div class="flex gap-2 flex-shrink-0 ml-2">
                            <button onclick="window.APP.ads.previewAd('${ad.id}')" class="text-green-500 hover:bg-green-500/10 p-2 rounded-lg transition-all" title="Visualizar">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>
                            <button onclick="window.APP.ads.duplicateAd(${JSON.stringify(ad).replace(/"/g, '&quot;')})" class="text-blue-500 hover:bg-blue-500/10 p-2 rounded-lg transition-all" title="Duplicar">
                                <i data-lucide="copy" class="w-4 h-4"></i>
                            </button>
                            <button onclick="window.APP.ads.deleteAd('${ad.id}')" class="text-red-500 hover:bg-red-500/10 p-2 rounded-lg transition-all" title="Deletar">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            if (window.lucide) lucide.createIcons();

        } catch (err) {
            log(`❌ Erro ao renderizar lista: ${err.message}`, 'error');
        }
    },

    previewAd(adId) {
        const idx = this.ads.findIndex(a => a.id === adId);
        if (idx >= 0) {
            this.currentAdIndex = idx;
            this.openFullscreen();
        }
    },

    async deleteAd(adId) {
        try {
            if (!confirm('❌ Deseja deletar este anúncio?')) return;
            if (!window._supabase) { alert('Supabase não disponível'); return; }

            const { error } = await _supabase
                .from('ads')
                .delete()
                .eq('id', adId);

            if (error) throw error;

            alert('✅ Anúncio deletado com sucesso!');
            await this.loadAds();

        } catch (err) {
            log(`❌ Erro ao deletar anúncio: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    },

    duplicateAd(ad) {
        try {
            if (ad.image_url) {
                // ── Duplicar anúncio de IMAGEM ──────────────────────
                const imgInput = document.getElementById('ad-image-input');
                const linkInput = document.getElementById('ad-link-input');

                if (imgInput) imgInput.value = '';
                this.duplicateData = ad;
                if (linkInput) linkInput.value = ad.link_contact || '';

                // Garante que o formulário de imagem está visível
                if (this.toggleAdType) this.toggleAdType('image');

            } else if (ad.ad_title || ad.ad_text) {
                // ✅ FIX: duplicar anúncio de TEXTO — antes não fazia nada
                const titleInput = document.getElementById('ad-text-title');
                const contentInput = document.getElementById('ad-text-content');
                const linkInput = document.getElementById('ad-text-link');

                if (titleInput) titleInput.value = ad.ad_title || '';
                if (contentInput) contentInput.value = ad.ad_text || '';
                if (linkInput) linkInput.value = ad.link_contact || '';

                // Atualiza o preview em tempo real, se existir
                document.getElementById('preview-title') &&
                    (document.getElementById('preview-title').innerText = ad.ad_title || 'TÍTULO DO ANÚNCIO');
                document.getElementById('preview-text') &&
                    (document.getElementById('preview-text').innerText = ad.ad_text || 'Conteúdo do seu anúncio aparecerá aqui');

                this.duplicateData = null;

                // Garante que o formulário de texto está visível
                if (this.toggleAdType) this.toggleAdType('text');
            }

            document.getElementById('ads-section')?.scrollIntoView({ behavior: 'smooth' });
            alert('✅ Anúncio carregado! Faça alterações e publique como novo.');
        } catch (err) {
            log(`❌ Erro ao duplicar: ${err.message}`, 'error');
        }
    },

    /**
     * Alterna entre o formulário de imagem e o de texto (usado por duplicateAd
     * e pelo botão data-action="toggle-ad-type" via navigation.js)
     */
    toggleAdType(type) {
        this.adType = type;

        const btnImage = document.getElementById('btn-ad-type-image');
        const btnText = document.getElementById('btn-ad-type-text');
        const formImage = document.getElementById('ad-form-image');
        const formText = document.getElementById('ad-form-text');

        const isImage = type === 'image';

        if (formImage) formImage.classList.toggle('hidden', !isImage);
        if (formText) formText.classList.toggle('hidden', isImage);

        if (btnImage) {
            btnImage.classList.toggle('bg-blue-600', isImage);
            btnImage.classList.toggle('text-white', isImage);
            btnImage.classList.toggle('text-slate-400', !isImage);
        }
        if (btnText) {
            btnText.classList.toggle('bg-blue-600', !isImage);
            btnText.classList.toggle('text-white', !isImage);
            btnText.classList.toggle('text-slate-400', isImage);
        }
    },

    async saveAd(event, type) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }

        if (!window._supabase) {
            alert('❌ Supabase não disponível');
            return;
        }

        try {
            log('💾 Salvando anúncio...', 'info');

            let adData = { active: true };

            if (type === 'image') {
                let imageUrl;

                if (this.duplicateData?.image_url) {
                    imageUrl = this.duplicateData.image_url;
                } else {
                    const fileInput = document.getElementById('ad-image-input');
                    if (!fileInput || !fileInput.files.length) {
                        alert('❌ Selecione uma imagem');
                        return;
                    }

                    const file = fileInput.files[0];
                    if (file.size > 5 * 1024 * 1024) {
                        alert('❌ Imagem maior que 5MB');
                        return;
                    }

                    const fileName = `${Date.now()}-${file.name}`;

                    const { error: uploadError } = await _supabase.storage
                        .from('ad-images')
                        .upload(fileName, file);

                    if (uploadError) throw uploadError;

                    const { data: publicUrl } = _supabase.storage
                        .from('ad-images')
                        .getPublicUrl(fileName);

                    imageUrl = publicUrl.publicUrl;
                }

                adData = {
                    ...adData,
                    image_url: imageUrl,
                    link_contact: document.getElementById('ad-link-input')?.value || '',
                    ad_title: null,
                    ad_text: null
                };

            } else if (type === 'text') {
                const title = document.getElementById('ad-text-title')?.value?.trim() || '';
                const content = document.getElementById('ad-text-content')?.value?.trim() || '';

                if (!title && !content) {
                    alert('❌ Preencha pelo menos o título ou o conteúdo');
                    return;
                }

                adData = {
                    ...adData,
                    ad_title: title,
                    ad_text: content,
                    link_contact: document.getElementById('ad-text-link')?.value?.trim() || '',
                    image_url: null
                };
            }

            const { error: insertError } = await _supabase
                .from('ads')
                .insert([adData]);

            if (insertError) throw insertError;

            alert('✅ Anúncio publicado com sucesso!');

            ['ad-link-input', 'ad-text-title', 'ad-text-content', 'ad-text-link'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });

            const imageNameEl = document.getElementById('ad-image-name');
            if (imageNameEl) imageNameEl.innerText = 'Clique ou arraste uma imagem';

            this.duplicateData = null;
            await this.loadAds();

        } catch (err) {
            log(`❌ Erro ao salvar anúncio: ${err.message}`, 'error');
            alert(`❌ Erro: ${err.message}`);
        }
    }
};

console.log('✅ ads.js carregado');