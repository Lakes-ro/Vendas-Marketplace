/**
 * CONFIG.JS v4.5
 * Inicialização ROBUSTA do Supabase - COM TABLES
 * ✅ window.formatBRL() — formatação de moeda no padrão brasileiro
 * ✅ window.buildWhatsAppLink() — helper global pro link do WhatsApp
 * ✅ v4.5 SEGURANÇA CRÍTICA: window.escapeHtml() — neutraliza qualquer
 *    texto digitado por vendedor ou cliente (nome, descrição de produto,
 *    texto de anúncio, etc.) antes de ele ser exibido na tela. Sem isso,
 *    qualquer pessoa — mesmo sem conta, só preenchendo o campo "Nome" no
 *    checkout — conseguia fazer um pedacinho de código rodar no
 *    navegador de quem visse aquele texto depois (inclusive o Admin
 *    Supremo no BI). Essa função é usada em TODO lugar do sistema que
 *    mostra texto vindo de fora (products.js, ads.js, bi.js, tenants.js,
 *    orders.js, order-management.js, admin-warnings.js).
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
     * ✅ NOVO (v4.5) SEGURANÇA: neutraliza caracteres HTML perigosos antes
     * de qualquer texto de terceiro (nome, descrição, título, etc.) ser
     * inserido na tela via innerHTML. Uso: `window.escapeHtml(valor)` no
     * lugar de usar o valor cru dentro de qualquer template string que
     * vá para innerHTML.
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.log('📄 DOM carregado, inicializando Supabase...', 'info');
            const success = initSupabase();
            
            if (!success) {
                alert('⚠️ Erro ao conectar com o banco. Recarregue a página.');
            }
        });
    } else {
        window.log('📄 DOM já estava pronto, inicializando Supabase agora...', 'info');
        const success = initSupabase();
        
        if (!success) {
            alert('⚠️ Erro ao conectar com o banco. Recarregue a página.');
        }
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
