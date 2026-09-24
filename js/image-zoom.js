/**
 * IMAGE-ZOOM.JS v1.1
 * ✅ v1.0: utilitário compartilhado de zoom em imagens — usado tanto
 *    nos anúncios (ads.js, dentro do modal fullscreen que já existia)
 *    quanto nos produtos (products.js, a partir da foto dentro do
 *    card de pré-visualização, em um modal próprio criado aqui).
 *    • Zoom por PINÇA (dois dedos) no celular/tablet
 *    • Zoom com a rodinha do mouse, no desktop
 *    • Duplo toque / duplo clique alterna entre normal e ampliado
 *    • Arrastar (pan) a imagem quando já está ampliada
 *    Implementado com Pointer Events (cobre mouse e toque com o
 *    mesmo código), sem depender de nenhuma biblioteca externa.
 * ✅ v1.1 NOVO: o modal próprio (produtos) agora aceita setas ◀ ▶ pra
 *    trocar de foto sem fechar o zoom — usado quando o produto tem
 *    mais de uma foto/vídeo cadastrado (ver products.js openImageZoom
 *    / _zoomStep). Também aceita seta ← → do teclado, e mostra um
 *    contador "2/3" no canto, igual ao card de pré-visualização.
 */

const ImageZoom = {
    MIN_SCALE: 1,
    MAX_SCALE: 4,
    DOUBLE_TAP_ZOOM: 2.5,

    /**
     * Liga o zoom por gesto numa <img>. Idempotente — chamar de novo
     * no mesmo elemento não duplica os listeners. `img._zoomReset()`
     * fica disponível depois, pra devolver a imagem ao tamanho normal
     * (usado sempre que um modal que contém essa imagem é reaberto).
     */
    attach(img) {
        if (!img || img._zoomAttached) return;
        img._zoomAttached = true;

        const state = { scale: 1, x: 0, y: 0 };
        const pointers = new Map();
        let pinchStartDist = 0;
        let pinchStartScale = 1;
        let panStart = null;
        let lastTapTime = 0;

        const apply = () => {
            img.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        };

        const reset = () => {
            state.scale = 1;
            state.x = 0;
            state.y = 0;
            apply();
        };
        img._zoomReset = reset;

        const clamp = () => {
            state.scale = Math.min(this.MAX_SCALE, Math.max(this.MIN_SCALE, state.scale));
            if (state.scale <= 1) {
                state.x = 0;
                state.y = 0;
                return;
            }
            const rect = img.getBoundingClientRect();
            const maxX = Math.max(0, (rect.width * state.scale - rect.width) / 2);
            const maxY = Math.max(0, (rect.height * state.scale - rect.height) / 2);
            state.x = Math.min(maxX, Math.max(-maxX, state.x));
            state.y = Math.min(maxY, Math.max(-maxY, state.y));
        };

        const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

        img.addEventListener('pointerdown', (e) => {
            try { img.setPointerCapture(e.pointerId); } catch (_) {}
            pointers.set(e.pointerId, e);

            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinchStartDist = dist(a, b);
                pinchStartScale = state.scale;
                panStart = null;
            } else if (pointers.size === 1) {
                if (state.scale > 1) {
                    panStart = { x: e.clientX - state.x, y: e.clientY - state.y };
                }

                // Duplo toque/clique: alterna entre normal e ampliado.
                const now = Date.now();
                if (now - lastTapTime < 300) {
                    state.scale = state.scale > 1 ? 1 : this.DOUBLE_TAP_ZOOM;
                    state.x = 0;
                    state.y = 0;
                    clamp();
                    apply();
                    panStart = null;
                }
                lastTapTime = now;
            }
        });

        img.addEventListener('pointermove', (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, e);

            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                const newDist = dist(a, b);
                if (pinchStartDist > 0) {
                    state.scale = pinchStartScale * (newDist / pinchStartDist);
                    clamp();
                    apply();
                }
            } else if (pointers.size === 1 && panStart) {
                state.x = e.clientX - panStart.x;
                state.y = e.clientY - panStart.y;
                clamp();
                apply();
            }
        });

        const endPointer = (e) => {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinchStartDist = 0;
            if (pointers.size === 0) panStart = null;
        };
        img.addEventListener('pointerup', endPointer);
        img.addEventListener('pointercancel', endPointer);
        img.addEventListener('pointerleave', endPointer);

        // Desktop: rodinha do mouse também amplia/reduz.
        img.addEventListener('wheel', (e) => {
            e.preventDefault();
            state.scale += e.deltaY < 0 ? 0.3 : -0.3;
            clamp();
            apply();
        }, { passive: false });

        img.addEventListener('dragstart', (e) => e.preventDefault());
    },

    // ============================================================
    // MODAL PRÓPRIO — usado pela foto dentro do card de produto
    // ============================================================
    _navOpts: null,

    _ensureModal() {
        if (this._modal) return;

        const modal = document.createElement('div');
        modal.id = 'product-image-zoom-modal';
        modal.className = 'hidden';
        modal.innerHTML = `
            <img id="product-image-zoom-img" src="" alt="Imagem ampliada">
            <button type="button" id="product-image-zoom-prev" class="zoom-nav-btn zoom-nav-prev hidden" aria-label="Foto anterior">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button type="button" id="product-image-zoom-next" class="zoom-nav-btn zoom-nav-next hidden" aria-label="Próxima foto">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <span id="product-image-zoom-counter" class="zoom-media-counter hidden"></span>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.close();
        });

        document.addEventListener('keydown', (e) => {
            if (modal.classList.contains('hidden')) return;
            if (e.key === 'Escape') this.close();
            if (e.key === 'ArrowLeft') this._navOpts?.onPrev?.();
            if (e.key === 'ArrowRight') this._navOpts?.onNext?.();
        });

        const prevBtn = modal.querySelector('#product-image-zoom-prev');
        const nextBtn = modal.querySelector('#product-image-zoom-next');
        prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navOpts?.onPrev?.(); });
        nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navOpts?.onNext?.(); });

        this._modal = modal;
        this._img = modal.querySelector('#product-image-zoom-img');
        this._prevBtn = prevBtn;
        this._nextBtn = nextBtn;
        this._counterEl = modal.querySelector('#product-image-zoom-counter');
        this.attach(this._img);
    },

    /**
     * @param {string} src - URL da foto a mostrar.
     * @param {object} [opts]
     * @param {function} [opts.onPrev] - chamado ao clicar ◀ ou apertar ←.
     * @param {function} [opts.onNext] - chamado ao clicar ▶ ou apertar →.
     * @param {string} [opts.counter] - texto tipo "2/3" mostrado no canto.
     *   As setas só aparecem quando onPrev E onNext são passados.
     */
    open(src, opts = {}) {
        if (!src) return;
        this._ensureModal();
        this._navOpts = opts;
        this._img.src = src;
        if (this._img._zoomReset) this._img._zoomReset();

        const hasNav = typeof opts.onPrev === 'function' && typeof opts.onNext === 'function';
        this._prevBtn.classList.toggle('hidden', !hasNav);
        this._nextBtn.classList.toggle('hidden', !hasNav);
        this._counterEl.classList.toggle('hidden', !opts.counter);
        if (opts.counter) this._counterEl.textContent = opts.counter;

        this._modal.classList.remove('hidden');
    },

    /**
     * ✅ NOVO (v1.1): troca a foto exibida sem fechar/reabrir o modal —
     * usado ao navegar pelas setas (o zoom da foto anterior é
     * desfeito, e a contagem "2/3" é atualizada se informada).
     */
    setImage(src, counter) {
        if (!this._img || !src) return;
        this._img.src = src;
        if (this._img._zoomReset) this._img._zoomReset();
        if (counter && this._counterEl) {
            this._counterEl.textContent = counter;
            this._counterEl.classList.remove('hidden');
        }
    },

    close() {
        if (!this._modal) return;
        this._modal.classList.add('hidden');
        this._navOpts = null;
    }
};

window.ImageZoom = ImageZoom;
