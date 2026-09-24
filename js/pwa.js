/**
 * PWA.JS v3.1
 * Botão flutuante "📲 Instalar App" — aparece só quando o próprio
 * navegador avisa que dá pra instalar (Chrome/Edge, Android e desktop).
 * iPhone/iPad (Safari) não avisa — lá é manual: Compartilhar →
 * "Adicionar à Tela de Início".
 *
 * v3.1 (auditoria): o aviso do navegador (beforeinstallprompt) costuma
 * chegar logo no carregamento da página — ANTES do app terminar de
 * iniciar. Como a escuta só era ligada no init() (que roda depois do
 * login/produtos), o aviso se perdia e o botão nunca aparecia. Agora a
 * escuta começa assim que este arquivo carrega.
 */

const PwaInstall = {
    _deferredPrompt: null,
    _ready: false,

    /** Liga as escutas na hora que o arquivo carrega. */
    _listen() {
        if (this._isStandalone()) return;

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this._deferredPrompt = e;
            if (this._ready) { this._ensureButton(); this._showButton(); }
        });

        window.addEventListener('appinstalled', () => {
            this._deferredPrompt = null;
            this._hideButton(true);
        });
    },

    /** Chamado pelo app.js quando a tela já está pronta. */
    init() {
        this._ready = true;
        if (this._isStandalone() || !this._deferredPrompt) return;
        this._ensureButton();
        this._showButton();
    },

    _isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    },

    _ensureButton() {
        if (document.getElementById('pwa-install-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'pwa-install-btn';
        btn.className = 'pwa-install-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Instalar aplicativo');
        btn.title = 'Instalar app na tela inicial';
        btn.textContent = '📲';
        document.body.appendChild(btn);
        btn.addEventListener('click', () => this._promptInstall());
    },

    async _promptInstall() {
        if (!this._deferredPrompt) return;
        const promptEvent = this._deferredPrompt;
        this._deferredPrompt = null;
        this._hideButton();
        try {
            promptEvent.prompt();
            await promptEvent.userChoice;
        } catch (err) {
            log?.(`⚠️ Erro ao pedir instalação: ${err.message}`, 'warning');
        }
    },

    _showButton() {
        document.getElementById('pwa-install-btn')?.classList.add('show');
    },

    _hideButton(remove = false) {
        const btn = document.getElementById('pwa-install-btn');
        if (!btn) return;
        if (remove) btn.remove();
        else btn.classList.remove('show');
    }
};

PwaInstall._listen();
window.PwaInstall = PwaInstall;
