/**
 * SW.JS v5.0 - LISTA DE CACHE CORRIGIDA (auditoria)
 * ✅ Estratégia Network First (mantida)
 * ✅ v5.0 FIX: a lista de arquivos pré-cacheados estava desatualizada —
 *    apontava para "./admin.js" (arquivo que não existe mais no
 *    projeto) e não incluía vários arquivos que hoje fazem parte do
 *    sistema (tenants.js, vendor-settings.js, notifications.js, pwa.js,
 *    theme.css, theme-toggle.js, tailwind.built.css, manifest.json).
 *    Na prática, isso significava que quase nada ficava salvo em cache
 *    de verdade — toda visita repetida baixava tudo de novo da rede,
 *    mesmo com o Service Worker "funcionando". Agora a lista reflete
 *    os arquivos reais servidos pelo index.html.
 * ✅ CACHE_VERSION subiu para forçar a troca do cache antigo/quebrado
 *    em todos os aparelhos que já tinham o Service Worker instalado.
 */

const CACHE_VERSION = 'marketplace-v5.9';
const CACHE_NAME = CACHE_VERSION;

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',

    // Estilos
    './style.css',
    './theme.css',
    './tailwind.built.css',

    // Módulos JS — mesma ordem do index.html (não é obrigatório pro
    // cache, mas facilita conferir se algum arquivo real ficou de fora)
    './config.js',
    './storage.js',
    './wrapper.js',
    './auth.js',
    './store-status.js',
    './cart.js',
    './products.js',
    './ads.js',
    './image-optimizer.js',
    './bi.js',
    './navigation.js',
    './tenants.js',
    './orders.js',
    './order-management.js',
    './admin-warnings.js',
    './vendor-settings.js',
    './notifications.js',
    './pwa.js',
    './app.js',
    './theme-toggle.js'
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
