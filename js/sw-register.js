/**
 * SW-REGISTER.JS
 * Registra o Service Worker (cache offline + notificações push).
 *
 * Na primeira visita de cada aparelho, apaga Service Workers e caches
 * antigos (de versões anteriores do sistema) antes de registrar o novo.
 * Isso roda uma única vez por aparelho (marcado no localStorage).
 *
 * O sw.js fica na RAIZ do site de propósito: um Service Worker só
 * controla as páginas da pasta onde ele está (e subpastas).
 */
(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) return;

    const CLEANUP_FLAG = 'ityrapuan_sw_cleanup_v1_done';

    function register() {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.warn('Falha ao registrar o Service Worker:', err);
        });
    }

    let alreadyCleaned = false;
    try { alreadyCleaned = localStorage.getItem(CLEANUP_FLAG) === '1'; } catch { /* modo privado */ }

    if (alreadyCleaned) {
        register();
        return;
    }

    navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .then(() => ('caches' in window
            ? caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
            : null))
        .catch(() => null)
        .then(() => {
            try { localStorage.setItem(CLEANUP_FLAG, '1'); } catch { /* modo privado */ }
            register();
        });
})();
