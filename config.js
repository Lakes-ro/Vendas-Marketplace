/**
 * CONFIG.JS v4.2
 * Inicialização ROBUSTA do Supabase - COM TABLES
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

    window._supabase = null;

    function initSupabase() {
        console.clear();
        window.log('🚀 Iniciando Fadvendas...', 'info');
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