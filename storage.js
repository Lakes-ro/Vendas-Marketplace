/**
 * STORAGE.JS
 * Gerencia persistência de dados locais
 */

const Storage = {
    // Prefixo para evitar colisões
    PREFIX: 'fadvendas_',

    /**
     * Salva dados no localStorage
     */
    set: (key, value) => {
        try {
            localStorage.setItem(Storage.PREFIX + key, JSON.stringify(value));
            log(`Storage: ${key} salvo`, 'success');
        } catch (err) {
            log(`Storage error: ${err.message}`, 'error');
        }
    },

    /**
     * Recupera dados do localStorage
     */
    get: (key, defaultValue = null) => {
        try {
            const item = localStorage.getItem(Storage.PREFIX + key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (err) {
            log(`Storage error ao ler ${key}:`, 'error');
            return defaultValue;
        }
    },

    /**
     * Remove item do localStorage
     */
    remove: (key) => {
        try {
            localStorage.removeItem(Storage.PREFIX + key);
            log(`Storage: ${key} removido`, 'success');
        } catch (err) {
            log(`Storage error: ${err.message}`, 'error');
        }
    },

    /**
     * Limpa todo o storage
     */
    clear: () => {
        try {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(Storage.PREFIX)) {
                    localStorage.removeItem(key);
                }
            });
            log('Storage: Limpeza completa', 'success');
        } catch (err) {
            log(`Storage clear error: ${err.message}`, 'error');
        }
    },

    /**
     * Salva carrinho localmente
     */
    saveCart: (cart) => {
        Storage.set('cart', cart);
    },

    /**
     * Carrega carrinho salvo
     */
    loadCart: () => {
        return Storage.get('cart', []);
    }
};
