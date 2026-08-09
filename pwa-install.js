/**
 * PWA-INSTALL.JS v1.0
 * Banner de instalação do app na tela inicial.
 * ✅ Android / Windows / Mac no Chrome ou Edge: botão real que dispara a
 *    instalação nativa via evento beforeinstallprompt.
 * ✅ iPhone/iPad e Mac no Safari: a Apple NÃO permite nenhum site
 *    disparar instalação por código — nesses casos o banner mostra um
 *    passo a passo manual (Compartilhar → Adicionar à Tela de Início no
 *    iOS; Arquivo → Adicionar ao Dock no Mac).
 * ✅ Não aparece se o app já estiver instalado, e some por 7 dias se a
 *    pessoa fechar o banner (não fica insistindo toda visita).
 */

const PwaInstall = {
    deferredPrompt: null,
    DISMISS_KEY: 'ityrapuan_pwa_install_dismissed_at',
    DISMISS_DAYS: 7,

    init() {
        try {
            if (this._isStandalone()) return;
            if (this._wasDismissedRecently()) return;

            // ✅ Chrome/Edge (Android, Windows, Mac) — captura o prompt nativo
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                this.deferredPrompt = e;
                this._showBanner('native');
            });

            window.addEventListener('appinstalled', () => {
                this._hideBanner();
                this.deferredPrompt = null;
                localStorage.setItem(this.DISMISS_KEY, new Date().toISOString());
                console.log('✅ PWA instalado');
            });

            // ✅ Safari (iOS ou Mac) — sem API de instalação, mostra instruções
            if (this._isIOS() || this._isMacSafari()) {
                setTimeout(() => this._showBanner('manual'), 1500);
            }
        } catch (err) {
            console.warn('PwaInstall init falhou:', err.message);
        }
    },

    _isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    },

    _isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    },

    _isMacSafari() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        return isMac && isSafari && !this._isIOS();
    },

    _wasDismissedRecently() {
        const raw = localStorage.getItem(this.DISMISS_KEY);
        if (!raw) return false;
        const dismissedAt = new Date(raw).getTime();
        const days = (Date.now() - dismissedAt) / 86400000;
        return days < this.DISMISS_DAYS;
    },

    _showBanner(mode) {
        if (document.getElementById('pwa-install-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'pwa-install-banner';
        banner.innerHTML = `
            <div class="pwa-install-icon">📲</div>
            <div class="pwa-install-text">
                <strong>Instale o app da Estação Ityrapuan</strong>
                <span>Acesso rápido direto da tela inicial, sem precisar abrir o navegador.</span>
            </div>
            <div class="pwa-install-actions">
                <button id="pwa-install-action-btn" class="pwa-install-btn">
                    ${mode === 'native' ? 'Instalar' : 'Como instalar'}
                </button>
                <button id="pwa-install-dismiss-btn" class="pwa-install-dismiss" aria-label="Fechar">✕</button>
            </div>
        `;
        document.body.appendChild(banner);

        requestAnimationFrame(() => banner.classList.add('pwa-install-show'));

        document.getElementById('pwa-install-action-btn').addEventListener('click', () => {
            if (mode === 'native') this._triggerNativeInstall();
            else this._showInstructionsModal();
        });

        document.getElementById('pwa-install-dismiss-btn').addEventListener('click', () => {
            this._dismiss();
        });
    },

    _hideBanner() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.remove();
    },

    _dismiss() {
        localStorage.setItem(this.DISMISS_KEY, new Date().toISOString());
        this._hideBanner();
    },

    async _triggerNativeInstall() {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log('PWA install outcome:', outcome);
        this.deferredPrompt = null;
        this._hideBanner();
        if (outcome === 'accepted') {
            localStorage.setItem(this.DISMISS_KEY, new Date().toISOString());
        }
    },

    _showInstructionsModal() {
        if (document.getElementById('pwa-instructions-modal')) return;

        const steps = this._isIOS() ? `
            <ol class="pwa-steps">
                <li>Toque no ícone de <strong>Compartilhar</strong> (o quadrado com a seta ↑) na barra do Safari</li>
                <li>Role a lista e toque em <strong>"Adicionar à Tela de Início"</strong></li>
                <li>Toque em <strong>"Adicionar"</strong> no canto superior direito</li>
            </ol>
        ` : `
            <ol class="pwa-steps">
                <li>No menu <strong>Arquivo</strong> do Safari (barra superior do Mac), clique em <strong>"Adicionar ao Dock..."</strong></li>
                <li>Confirme clicando em <strong>"Adicionar"</strong></li>
            </ol>
        `;

        const modal = document.createElement('div');
        modal.id = 'pwa-instructions-modal';
        modal.className = 'pwa-instructions-overlay';
        modal.innerHTML = `
            <div class="pwa-instructions-content">
                <button class="pwa-instructions-close" aria-label="Fechar">✕</button>
                <div class="pwa-instructions-icon">📲</div>
                <h3>Instalar o app da Estação Ityrapuan</h3>
                <p class="pwa-instructions-note">O Safari não deixa instalar automaticamente — mas é rapidinho fazer manual:</p>
                ${steps}
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        modal.querySelector('.pwa-instructions-close').addEventListener('click', () => modal.remove());

        this._dismiss();
    }
};

window.PwaInstall = PwaInstall;
