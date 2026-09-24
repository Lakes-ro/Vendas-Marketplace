/**
 * CONFIG.JS v4.8
 * v4.8 (auditoria):
 *  - dispara 'supabase-ready' quando o cliente fica pronto (app.js espera)
 *  - removido console.clear()
 *  - novos helpers: safeUrl(), sanitizeFileName(), onSupabaseReady()
 *  - número central da loja num lugar só (CONFIG.STORE_WHATSAPP)
 */

if (typeof window.CONFIG_LOADED !== 'undefined') {
    console.log('⚠️ Config.js já foi carregado. Ignorando duplicata.');
} else {
    window.CONFIG = {
        SUPABASE_URL: 'https://dkzbpevakiiwzuimzftz.supabase.co',
        SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRremJwZXZha2lpd3p1aW16ZnR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNTc4NDgsImV4cCI6MjA4NDczMzg0OH0.GgDQz3KR2x1vupLWPSd7gU9lLXNCjBAaFXEM6IADYWY',
        DEBUG: false,
        TABLES: {
            PRODUCTS: 'products',
            ORDERS: 'orders',
            ORDER_ITEMS: 'order_items',
            ADS: 'ads',
            PROFILES: 'profiles'
        },
        STORAGE_BUCKET: 'product-images',
        ADS_BUCKET: 'ad-images',
        MAX_IMAGE_SIZE: 5242880,
        STORE_WHATSAPP: '5535991264352',
        // Ferramentas de vendedor para o Admin Supremo (BI, Configurações da
        // loja, estoque, "Novo produto", avisos de venda, missões).
        // false = desligadas, sem apagar nada. Mude para true se precisar de volta.
        ADMIN_SELLER_TOOLS: false,
        // Notificação push (avisos de venda com o site fechado)
        VAPID_PUBLIC_KEY: 'BHh--3pMyxKxd6P49gRpsotKuBYuSsF32JZTqY4gMDw2olImuD75WI1y4_tlwXc4XjU5J6qM2QY-TIAV34u9Pi0',
        PUSH_FUNCTION_URL: 'https://dkzbpevakiiwzuimzftz.supabase.co/functions/v1/send-push'
    };

    window.log = function (message, type = 'info') {
        if (!window.CONFIG || !window.CONFIG.DEBUG) return;
        const styles = {
            info: 'color:#3b82f6;font-weight:bold;',
            success: 'color:#10b981;font-weight:bold;',
            error: 'color:#ef4444;font-weight:bold;',
            warning: 'color:#f59e0b;font-weight:bold;'
        };
        const prefix = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' }[type] || '•';
        console.log(`%c${prefix} ${message}`, styles[type] || '');
    };

    window.formatBRL = function (value, decimals = 2) {
        const num = Number(value) || 0;
        return num.toLocaleString('pt-BR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    };

    window.buildWhatsAppLink = function (phone, text) {
        if (!phone) return null;
        const digits = String(phone).replace(/\D/g, '');
        if (!digits) return null;
        const withCountry = digits.length <= 11 ? `55${digits}` : digits;
        return `https://wa.me/${withCountry}` + (text ? `?text=${encodeURIComponent(text)}` : '');
    };

    window.escapeHtml = function (str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    /** Só deixa passar URL http(s) — bloqueia "javascript:" e afins. */
    window.safeUrl = function (url) {
        if (!url) return '';
        try {
            const u = new URL(String(url).trim(), window.location.href);
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
        } catch {
            return '';
        }
    };

    /** Nome de arquivo seguro pro Storage (sem acento, espaço ou símbolo). */
    window.sanitizeFileName = function (name) {
        const clean = String(name || 'arquivo')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return (clean || 'arquivo').slice(-80);
    };

    window.compressImage = function (file, options = {}) {
        const maxWidth = options.maxWidth || 1600;
        const maxHeight = options.maxHeight || 1600;
        const quality = options.quality || 0.75;
        const minSize = options.minSizeToCompress || 300 * 1024;

        return new Promise((resolve) => {
            try {
                if (!file || !file.type || !file.type.startsWith('image/')) return resolve(file);
                if (file.type === 'image/gif' || file.size < minSize) return resolve(file);

                const objectUrl = URL.createObjectURL(file);
                const img = new Image();

                img.onload = () => {
                    URL.revokeObjectURL(objectUrl);
                    try {
                        let { width, height } = img;
                        if (width > maxWidth || height > maxHeight) {
                            const ratio = Math.min(maxWidth / width, maxHeight / height);
                            width = Math.round(width * ratio);
                            height = Math.round(height * ratio);
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) return resolve(file);
                        ctx.drawImage(img, 0, 0, width, height);
                        canvas.toBlob((blob) => {
                            if (!blob || blob.size >= file.size) return resolve(file);
                            const name = file.name.replace(/\.\w+$/, '') + '.jpg';
                            resolve(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
                        }, 'image/jpeg', quality);
                    } catch {
                        resolve(file);
                    }
                };
                img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
                img.src = objectUrl;
            } catch {
                resolve(file);
            }
        });
    };

    // ── Som de notificação ─────────────────────────────────────
    let _audioCtx = null;
    function _ensureAudioContext() {
        if (!_audioCtx) {
            try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch { return null; }
        }
        if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
        return _audioCtx;
    }
    ['click', 'touchstart', 'keydown'].forEach((evt) => {
        document.addEventListener(evt, () => _ensureAudioContext(), { once: true, passive: true });
    });

    window.playNotificationSound = function (type = 'default') {
        try {
            const ctx = _ensureAudioContext();
            if (!ctx || ctx.state !== 'running') return;
            const now = ctx.currentTime;
            const presets = {
                sale: [{ freq: 880, start: 0, dur: 0.12 }, { freq: 1174.66, start: 0.12, dur: 0.18 }],
                moderation: [{ freq: 660, start: 0, dur: 0.16 }],
                restock: [{ freq: 523.25, start: 0, dur: 0.12 }, { freq: 783.99, start: 0.12, dur: 0.16 }],
                default: [{ freq: 740, start: 0, dur: 0.15 }]
            };
            (presets[type] || presets.default).forEach((n) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = n.freq;
                const t0 = now + n.start;
                const t1 = t0 + n.dur;
                gain.gain.setValueAtTime(0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, t1);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(t0);
                osc.stop(t1 + 0.02);
            });
        } catch { /* som é opcional */ }
    };

    // ── Supabase ───────────────────────────────────────────────
    window._supabase = null;
    window.SUPABASE_READY = false;

    function initSupabase() {
        if (!window.supabase || !window.supabase.createClient) return false;
        try {
            window._supabase = window.supabase.createClient(
                window.CONFIG.SUPABASE_URL,
                window.CONFIG.SUPABASE_KEY
            );
            return !!window._supabase;
        } catch (err) {
            console.error('Erro ao criar cliente Supabase:', err);
            return false;
        }
    }

    function showConnectionErrorBanner() {
        if (document.getElementById('supabase-error-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'supabase-error-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#ef4444;color:#fff;padding:12px 16px;text-align:center;font-weight:700;font-size:13px;font-family:Inter,-apple-system,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,0.3)';
        banner.innerHTML = `⚠️ Não conseguimos conectar ao servidor agora.
            <button id="supabase-error-retry-btn" style="margin-left:10px;text-decoration:underline;background:none;border:none;color:#fff;font-weight:900;cursor:pointer;font-size:13px;">Tentar novamente</button>`;
        document.body.appendChild(banner);
        document.getElementById('supabase-error-retry-btn')?.addEventListener('click', () => location.reload());
    }

    function tryInitWithRetry(attemptsLeft = 15, delayMs = 600) {
        if (initSupabase()) {
            window.SUPABASE_READY = true;
            document.dispatchEvent(new Event('supabase-ready'));
            return;
        }
        if (attemptsLeft > 0) {
            setTimeout(() => tryInitWithRetry(attemptsLeft - 1, delayMs), delayMs);
            return;
        }
        showConnectionErrorBanner();
    }

    /** Roda `fn` assim que o Supabase estiver pronto (na hora, se já estiver). */
    window.onSupabaseReady = function (fn) {
        if (window.SUPABASE_READY) fn();
        else document.addEventListener('supabase-ready', fn, { once: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => tryInitWithRetry());
    } else {
        tryInitWithRetry();
    }

    window.CONFIG_LOADED = true;
}
