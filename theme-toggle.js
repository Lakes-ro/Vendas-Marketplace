/**
 * THEME-TOGGLE.JS v1.0
 * ✅ Controla o botão de alternar entre modo CLARO (padrão novo) e
 *    modo ESCURO (visual antigo do sistema), salvando a escolha da
 *    pessoa no localStorage — cada aparelho lembra a própria escolha.
 * ✅ O tema é aplicado via atributo data-theme no <html>, lido pelo
 *    theme.css.
 * ✅ Atualiza também a cor da barra do navegador (meta theme-color)
 *    e o ícone do botão (lua no claro, sol no escuro).
 */

(function () {
    const STORAGE_KEY = 'ityrapuan_theme';

    function getSavedTheme() {
        return localStorage.getItem(STORAGE_KEY) || 'light';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);

        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? '#0b0f1a' : '#ffffff');

        updateButtonIcons(theme);
    }

    /**
     * Em modo claro mostra o ícone de LUA (convite pra ir pro escuro).
     * Em modo escuro mostra o ícone de SOL (convite pra voltar ao claro).
     */
    function updateButtonIcons(theme) {
        const sunIcon = document.getElementById('theme-toggle-icon-sun');
        const moonIcon = document.getElementById('theme-toggle-icon-moon');
        if (!sunIcon || !moonIcon) return;

        sunIcon.classList.toggle('hidden', theme !== 'dark');
        moonIcon.classList.toggle('hidden', theme === 'dark');
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY, next);
        applyTheme(next);
    }

    function init() {
        applyTheme(getSavedTheme());

        const btn = document.getElementById('theme-toggle-btn');
        if (btn) btn.addEventListener('click', toggleTheme);

        if (window.lucide) lucide.createIcons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.ThemeToggle = { toggleTheme, applyTheme };
})();
