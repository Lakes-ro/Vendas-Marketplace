/**
 * CONFIG.JS v4.6
 * Inicialização ROBUSTA do Supabase - COM TABLES
 * ✅ window.formatBRL() — formatação de moeda no padrão brasileiro
 * ✅ window.buildWhatsAppLink() — helper global pro link do WhatsApp
 * ✅ v4.5 SEGURANÇA CRÍTICA: window.escapeHtml() — neutraliza qualquer
 *    texto digitado por vendedor ou cliente antes de ele ser exibido na
 *    tela.
 * ✅ v4.6 NOVO — PERFORMANCE: window.compressImage() — comprime fotos
 *    no PRÓPRIO NAVEGADOR (usando <canvas>, sem depender de nenhuma
 *    biblioteca externa) antes de subir pro Supabase.
 * ✅ v4.7 NOVO — PRIMEIRA IMPRESSÃO: se o Supabase JS demorar/falhar
 *    pra carregar do CDN (rede lenta, bloqueador de anúncio agressivo,
 *    etc.), o sistema agora tenta de novo sozinho por conta própria
 *    (5 tentativas, meio segundo entre cada uma) ANTES de incomodar a
 *    pessoa — cobre o caso comum de "o CDN só demorou um pouquinho
 *    mais". Só depois de esgotar as tentativas é que aparece um aviso,
 *    e mesmo assim um aviso DISCRETO (uma faixa no topo, com botão de
 *    tentar de novo) — não mais um alert() nativo do navegador, que
 *    trava a tela inteira e passa a impressão de que o site quebrou.
 */

if (typeof window.CONFIG_LOADED !== 'undefined') {
    console.log('⚠️ Config.js já foi carregado. Ignorando duplicata.');
} else {
    window.CONFIG = {
        SUPABASE_URL: 'https://dkzbpevakiiwzuimzftz.supabase.co',
        SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRremJwZXZha2lpd3p1aW16ZnR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNTc4NDgsImV4cCI6MjA4NDczMzg0OH0.GgDQz3KR2x1vupLWPSd7gU9lLXNCjBAaFXEM6IADYWY',
        DEBUG: true,
        TABLES: {
            PRODUCTS: 'products',
            ORDERS: 'orders',
            ORDER_ITEMS: 'order_items',
            ADS: 'ads',
            PROFILES: 'profiles'
        },
        STORAGE_BUCKET: 'product-images',
        ADS_BUCKET: 'ad-images',
        MAX_IMAGE_SIZE: 5242880
    };

    window.log = function(message, type = 'info') {
        if (!window.CONFIG || !window.CONFIG.DEBUG) return;

        const styles = {
            'info': 'color: #3b82f6; font-weight: bold;',
            'success': 'color: #10b981; font-weight: bold;',
            'error': 'color: #ef4444; font-weight: bold;',
            'warning': 'color: #f59e0b; font-weight: bold;'
        };

        const prefix = {
            'info': 'ℹ️',
            'success': '✅',
            'error': '❌',
            'warning': '⚠️'
        }[type] || '•';

        console.log(`%c${prefix} ${message}`, styles[type] || 'color: inherit;');
    };

    /**
     * Formata número no padrão monetário brasileiro.
     * Ex: formatBRL(2528.49) -> "2.528,49"
     */
    window.formatBRL = function(value, decimals = 2) {
        const num = Number(value) || 0;
        return num.toLocaleString('pt-BR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    };

    /**
     * Transforma um telefone salvo no banco em link do WhatsApp.
     */
    window.buildWhatsAppLink = function(phone) {
        if (!phone) return null;
        const digits = String(phone).replace(/\D/g, '');
        if (!digits) return null;
        const withCountry = digits.length <= 11 ? `55${digits}` : digits;
        return `https://wa.me/${withCountry}`;
    };

    /**
     * ✅ SEGURANÇA: neutraliza caracteres HTML perigosos antes de
     * qualquer texto de terceiro ser inserido na tela via innerHTML.
     */
    window.escapeHtml = function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    /**
     * ✅ NOVO (v4.6) PERFORMANCE: comprime uma imagem no navegador antes
     * do upload — redimensiona pro máximo de `maxWidth`/`maxHeight`
     * (padrão 1600px) e recodifica como JPEG na qualidade informada
     * (padrão 0.75). Resolve produtos.js e ads.js.
     *
     * Regras de segurança/qualidade:
     *  - Não mexe em vídeos (não é imagem) — resolve com o arquivo
     *    original sem tocar.
     *  - Não mexe em GIF — comprimir como JPEG destruiria a animação.
     *  - Não mexe em arquivos já pequenos (< 300KB) — não vale a pena
     *    o custo de processar uma imagem que já é leve.
     *  - Se por algum motivo a versão "comprimida" sair MAIOR que a
     *    original (raro, acontece com imagens já bem otimizadas), usa
     *    a original mesmo.
     *  - Se der qualquer erro no meio do processo (imagem corrompida,
     *    navegador sem suporte a canvas, etc.), devolve o arquivo
     *    ORIGINAL — nunca trava o upload por causa da compressão.
     *
     * Uso: const arquivoParaSubir = await window.compressImage(file);
     */
    window.compressImage = function(file, options = {}) {
        const maxWidth  = options.maxWidth  || 1600;
        const maxHeight = options.maxHeight || 1600;
        const quality   = options.quality   || 0.75;
        const minSizeToCompress = options.minSizeToCompress || 300 * 1024;

        return new Promise((resolve) => {
            try {
                if (!file || !file.type || !file.type.startsWith('image/')) {
                    resolve(file);
                    return;
                }
                if (file.type === 'image/gif') {
                    resolve(file);
                    return;
                }
                if (file.size < minSizeToCompress) {
                    resolve(file);
                    return;
                }

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
                        if (!ctx) { resolve(file); return; }

                        ctx.drawImage(img, 0, 0, width, height);

                        canvas.toBlob((blob) => {
                            if (!blob || blob.size >= file.size) {
                                resolve(file);
                                return;
                            }

                            const compressedName = file.name.replace(/\.\w+$/, '') + '.jpg';
                            const compressedFile = new File([blob], compressedName, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });

                            window.log?.(
                                `📷 Imagem comprimida: ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(1)}MB`,
                                'success'
                            );

                            resolve(compressedFile);
                        }, 'image/jpeg', quality);
                    } catch (innerErr) {
                        resolve(file);
                    }
                };

                img.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    resolve(file);
                };

                img.src = objectUrl;
            } catch (err) {
                resolve(file);
            }
        });
    };

    window._supabase = null;

    function initSupabase() {
        console.clear();
        window.log('🚀 Iniciando Estação Ityrapuan...', 'info');
        window.log('1️⃣ Verificando se Supabase JS está disponível...', 'info');

        if (!window.supabase) {
            window.log('❌ ERRO: Supabase JS não foi carregado do CDN', 'error');
            return false;
        }

        window.log('✅ Supabase JS carregado do CDN', 'success');

        try {
            window.log('2️⃣ Criando cliente Supabase...', 'info');

            if (!window.CONFIG.SUPABASE_URL || !window.CONFIG.SUPABASE_KEY) {
                throw new Error('Credenciais Supabase inválidas ou ausentes');
            }

            window._supabase = window.supabase.createClient(
                window.CONFIG.SUPABASE_URL,
                window.CONFIG.SUPABASE_KEY
            );

            if (!window._supabase) {
                throw new Error('Falha ao criar cliente Supabase');
            }

            window.log('✅ Cliente Supabase criado com sucesso', 'success');
            window.log('✅ CONFIG.TABLES carregado', 'success');
            window.log('✅ Supabase disponível em window._supabase', 'success');

            return true;

        } catch (err) {
            window.log(`❌ Erro ao criar cliente Supabase: ${err.message}`, 'error');
            console.error('Stack:', err);
            return false;
        }
    }

    /**
     * ✅ NOVO (v4.7): faixa discreta no topo da tela — substitui o
     * antigo alert() nativo, que travava a página inteira e dava a
     * impressão de que o site tinha quebrado. Só aparece depois de
     * esgotar as tentativas automáticas de reconexão.
     */
    function showConnectionErrorBanner() {
        if (document.getElementById('supabase-error-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'supabase-error-banner';
        banner.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
            'background:#ef4444', 'color:#fff', 'padding:12px 16px',
            'text-align:center', 'font-weight:700', 'font-size:13px',
            'font-family:Inter,-apple-system,sans-serif',
            'box-shadow:0 4px 14px rgba(0,0,0,0.3)'
        ].join(';');
        banner.innerHTML = `
            ⚠️ Não conseguimos conectar ao servidor agora.
            <button id="supabase-error-retry-btn" style="margin-left:10px;text-decoration:underline;background:none;border:none;color:#fff;font-weight:900;cursor:pointer;font-size:13px;">
                Tentar novamente
            </button>
        `;
        document.body.appendChild(banner);

        document.getElementById('supabase-error-retry-btn')?.addEventListener('click', () => {
            location.reload();
        });
    }

    /**
     * ✅ NOVO (v4.7): tenta inicializar o Supabase várias vezes antes
     * de desistir — cobre o caso (bem comum) de o script do CDN só ter
     * demorado um pouco mais pra carregar, sem precisar incomodar
     * ninguém com aviso nenhum.
     */
    function tryInitWithRetry(attemptsLeft = 5, delayMs = 600) {
        const success = initSupabase();
        if (success) return;

        if (attemptsLeft > 0) {
            setTimeout(() => tryInitWithRetry(attemptsLeft - 1, delayMs), delayMs);
            return;
        }

        window.log('❌ Esgotadas as tentativas de conexão com o Supabase', 'error');
        showConnectionErrorBanner();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.log('📄 DOM carregado, inicializando Supabase...', 'info');
            tryInitWithRetry();
        });
    } else {
        window.log('📄 DOM já estava pronto, inicializando Supabase agora...', 'info');
        tryInitWithRetry();
    }

    setTimeout(() => {
        window.log('', 'info');
        window.log('📊 STATUS DO SUPABASE:', 'info');
        window.log(`   window._supabase: ${window._supabase ? '✅ PRONTO' : '❌ NÃO PRONTO'}`, 'info');
        window.log(`   CONFIG.TABLES: ${window.CONFIG && window.CONFIG.TABLES ? '✅ PRONTO' : '❌ NÃO PRONTO'}`, 'info');
        window.log('', 'info');
    }, 100);

    window.CONFIG_LOADED = true;
}
