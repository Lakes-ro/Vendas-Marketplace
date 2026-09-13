/**
 * PWA.JS v2.0
 * ✅ Banner de instalação REMOVIDO a pedido — não aparece mais em
 *    nenhum aparelho (Android, Windows, iPhone, iPad ou Mac).
 * ✅ Mantido como objeto vazio (com os mesmos métodos) só pra não
 *    quebrar a chamada existente em app.js (PwaInstall.init()) — não
 *    faz mais nada na prática.
 * ✅ O app continua 100% instalável manualmente pelo usuário através
 *    do menu do próprio navegador (⋮ → "Instalar app" no Chrome/Edge,
 *    ou Compartilhar → "Adicionar à Tela de Início" no Safari/iPhone),
 *    só não exibimos mais nenhum aviso/banner sozinho sugerindo isso.
 */

const PwaInstall = {
    init() {
        // Intencionalmente vazio — banner de instalação desativado.
    }
};

window.PwaInstall = PwaInstall;
