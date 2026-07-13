/**
 * SW.JS v4.0 - SERVICE WORKER CORRIGIDO
 * ✅ Todos os arquivos do projeto incluídos no cache
 * ✅ Versão bumpeada para forçar atualização do cache antigo
 * ✅ Estratégia Network First
 */

const CACHE_VERSION = 'marketplace-v4.0';
const CACHE_NAME = CACHE_VERSION;

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './store status.css',
    './manifest.json',
    // Módulos JS — ordem não importa para cache
    './config.js',
    './storage.js',
    './wrapper.js',
    './auth.js',
    './store-status.js',
    './cart.js',
    './admin.js',
    './products.js',
    './ads.js',
    './bi.js',
    './navigation.js',
    './tenants.js',
    './orders.js',
    './admin-warnings.js',
    './order-management.js',
    './app.js'
];

// ========================================
// INSTALAR - CACHEAR ASSETS
// ========================================
self.addEventListener('install', (event) => {
    console.log(`[SW] Instalando ${CACHE_VERSION}`);

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
                console.warn('[SW] Alguns assets não puderam ser cacheados:', err.message);
                return Promise.resolve();
            });
        }).then(() => {
            console.log(`[SW] ${CACHE_VERSION} instalado`);
        })
    );

    self.skipWaiting();
});

// ========================================
// ATIVAR - LIMPAR CACHES ANTIGOS
// ========================================
self.addEventListener('activate', (event) => {
    console.log(`[SW] Ativando ${CACHE_VERSION}`);

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME && (name.startsWith('fadvendas-') || name.startsWith('marketplace-')))
                    .map((name) => {
                        console.log(`[SW] Deletando cache antigo: ${name}`);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('[SW] Limpeza de caches concluída');
        })
    );

    self.clients.claim();
});

// ========================================
// FETCH - NETWORK FIRST STRATEGY
// ========================================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (!url.protocol.startsWith('http')) return;
    if (request.method !== 'GET') return;

    // Não cachear chamadas ao Supabase API
    if (url.hostname.includes('supabase.co')) return;

    event.respondWith(networkFirstStrategy(request));
});

function networkFirstStrategy(request) {
    return fetch(request, {
        signal: AbortSignal.timeout(5000)
    })
        .then((response) => {
            if (response.ok) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseClone);
                });
            }
            return response;
        })
        .catch((err) => {
            console.log(`[SW] Rede falhou para ${request.url}: ${err.message}`);

            return caches.match(request).then((cachedResponse) => {
                if (cachedResponse) {
                    console.log(`[SW] Usando cache para ${request.url}`);
                    return cachedResponse;
                }

                return new Response(
                    '⚠️ Você está offline e não há cache disponível.',
                    {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: new Headers({ 'Content-Type': 'text/plain' })
                    }
                );
            });
        });
}

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

console.log(`[SW] Service Worker ${CACHE_VERSION} carregado`);