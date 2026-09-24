/**
 * HOME-EXTRAS.JS
 * Pequenos comportamentos da página principal que antes ficavam
 * escritos direto dentro do index.html:
 *  - prévia ao vivo do anúncio de texto (aba Anúncios)
 *  - botão flutuante "voltar ao topo"
 *  - pop-up de boas-vindas da Loja (uma vez por aparelho)
 */
(function () {
    'use strict';

    const HERO_DISMISS_KEY = 'ityrapuan_home_hero_popup_dismissed';
    const HERO_DELAY_MS = 4000;

    /** Prévia do anúncio de texto enquanto o Admin digita. */
    function bindAdTextPreview() {
        document.addEventListener('input', (e) => {
            if (e.target.id === 'ad-text-title') {
                const el = document.getElementById('preview-title');
                if (el) el.innerText = e.target.value || 'TÍTULO DO ANÚNCIO';
            }
            if (e.target.id === 'ad-text-content') {
                const el = document.getElementById('preview-text');
                if (el) el.innerText = e.target.value || 'Conteúdo do seu anúncio aparecerá aqui';
            }
        });
    }

    /** Botão "voltar ao topo": aparece depois que a pessoa rola a página. */
    function bindBackToTop() {
        const btn = document.getElementById('back-to-top');
        if (!btn) return;
        window.addEventListener('scroll', () => {
            btn.classList.toggle('show', window.scrollY > 480);
        }, { passive: true });
        btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    function heroWasDismissed() {
        try { return !!localStorage.getItem(HERO_DISMISS_KEY); } catch { return true; }
    }

    /** Pop-up de boas-vindas: só na Loja, só uma vez, nunca por cima do tutorial. */
    function scheduleHeroPopup() {
        if (heroWasDismissed()) return;

        setTimeout(() => {
            if (document.getElementById('home-hero-popup')) return;
            if (window.APP?.navigation?.getActiveTab?.() !== 'market') return;
            const tutorial = document.getElementById('onboarding-modal');
            if (tutorial && !tutorial.classList.contains('hidden')) return;
            if (document.querySelector('.rc-overlay')) return; // comprovante aberto

            const popup = document.createElement('div');
            popup.id = 'home-hero-popup';
            popup.className = 'home-hero-popup';
            popup.innerHTML = `
                <button type="button" class="home-hero-popup-close" aria-label="Fechar">✕</button>
                <h3 class="home-hero-popup-title">Compre direto de quem mora aqui</h3>
                <p class="home-hero-popup-text">Produtos locais de Ityrapuã — sem intermediários, com Pix direto para o vendedor</p>
                <div class="home-hero-popup-actions">
                    <button type="button" data-hero="products" class="home-hero-popup-btn home-hero-popup-btn-primary">Ver produtos</button>
                    <button type="button" data-hero="sell" class="home-hero-popup-btn home-hero-popup-btn-secondary">🚀 Quero vender</button>
                </div>`;
            document.body.appendChild(popup);
            requestAnimationFrame(() => popup.classList.add('show'));

            const dismiss = () => {
                popup.classList.remove('show');
                setTimeout(() => popup.remove(), 300);
                try { localStorage.setItem(HERO_DISMISS_KEY, '1'); } catch { /* modo privado */ }
            };

            popup.addEventListener('click', (e) => {
                if (e.target.closest('.home-hero-popup-close')) { dismiss(); return; }
                const action = e.target.closest('[data-hero]')?.dataset.hero;
                if (!action) return;
                dismiss();
                if (action === 'products') {
                    document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else if (window.APP?.auth?.isLoggedIn?.()) {
                    window.APP.auth.becomeSeller();
                } else {
                    window.APP?.auth?.openAuthModal?.('signup');
                }
            });
        }, HERO_DELAY_MS);
    }

    function init() {
        bindAdTextPreview();
        bindBackToTop();
        scheduleHeroPopup();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
