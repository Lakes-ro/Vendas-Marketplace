/**
 * SW.JS v5.0 — Service Worker
 * Fica na RAIZ do site: um Service Worker só controla a pasta onde está.
 *  - Cache "rede primeiro": sempre tenta a versão nova; sem internet,
 *    usa a última cópia guardada.
 *  - Só guarda arquivos do próprio site (Supabase e CDNs vão direto).
 *  - Notificação push "🎉 Nova venda!" (ver js/notifications.js).
 */

const CACHE_NAME = 'marketplace-v5.4';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './html/privacidade.html',
    './css/style.css',
    './css/tailwind-built.css',
    './css/theme.css',
    './img/icon-192.png',
    './img/icon-512.png',
    './img/icon-maskable-192.png',
    './img/icon-maskable-512.png',
    './js/sw-register.js',
    './js/config.js',
    './js/storage.js',
    './js/image-zoom.js',
    './js/auth.js',
    './js/store-status.js',
    './js/cart.js',
    './js/products.js',
    './js/ads.js',
    './js/bi.js',
    './js/navigation.js',
    './js/tenants.js',
    './js/orders.js',
    './js/order-management.js',
    './js/admin-warnings.js',
    './js/vendor-settings.js',
    './js/notifications.js',
    './js/vendor-notices.js',
    './js/moderation.js',
    './js/image-optimizer.js',
    './js/restock-alerts.js',
    './js/onboarding.js',
    './js/pwa.js',
    './js/app.js',
    './js/theme-toggle.js',
    './js/home-extras.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(ASSETS_TO_CACHE.map((url) => cache.add(url)))
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => Promise.all(
            names
                .filter((n) => n !== CACHE_NAME && (n.startsWith('fadvendas-') || n.startsWith('marketplace-')))
                .map((n) => caches.delete(n))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (!url.protocol.startsWith('http')) return;
    if (url.origin !== self.location.origin) return; // Supabase, CDNs etc. vão direto pra rede

    event.respondWith(networkFirst(request));
});

function fetchWithTimeout(request, ms) {
    return new Promise((resolve, reject) => {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = setTimeout(() => {
            controller?.abort();
            reject(new Error('timeout'));
        }, ms);
        fetch(request, controller ? { signal: controller.signal } : undefined)
            .then((res) => { clearTimeout(timer); resolve(res); })
            .catch((err) => { clearTimeout(timer); reject(err); });
    });
}

async function networkFirst(request) {
    try {
        const response = await fetchWithTimeout(request, 5000);
        if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
    } catch {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;

        if (request.mode === 'navigate') {
            const page = await caches.match('./index.html');
            if (page) return page;
        }
        return new Response('⚠️ Você está offline e não há cache disponível.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

// ========================================
// NOTIFICAÇÃO PUSH — "🎉 Nova venda!" com o site fechado
// ========================================
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }

    const title = data.title || 'Ityrapuã Store';
    const options = {
        body: data.body || 'Você tem uma novidade na loja.',
        icon: 'img/icon-192.png',
        badge: 'img/icon-maskable-192.png',
        tag: data.tag || 'ityrapuan',
        renotify: true,
        requireInteraction: false,
        vibrate: [120, 60, 120],
        data: { url: data.url || './index.html#vendas' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || './index.html#vendas', self.registration.scope).href;

    event.waitUntil((async () => {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const w of wins) {
            if (w.url.startsWith(self.registration.scope)) {
                await w.focus();
                w.postMessage({ type: 'OPEN_SALES' });
                return;
            }
        }
        await self.clients.openWindow(target);
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
