/**
 * SERVER.JS
 * Servidor HTTP local com MIME types corretos para desenvolvimento
 * 
 * Como usar:
 * 1. Certifique-se que Node.js está instalado
 * 2. Na pasta do projeto, execute: node server.js
 * 3. Acesse: http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const HOST = 'localhost';

// Mapeamento de tipos MIME
const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const server = http.createServer((req, res) => {
    // Parse da URL
    const parsedUrl = url.parse(req.url, true);
    let pathname = parsedUrl.pathname;

    // Remove barra inicial se houver
    if (pathname === '/') {
        pathname = '/index.html';
    }

    // Determinar caminho do arquivo
    const filePath = path.join(__dirname, pathname);

    // Segurança: Previne path traversal
    const realPath = path.resolve(filePath);
    const baseDir = path.resolve(__dirname);

    if (!realPath.startsWith(baseDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Acesso Negado');
        return;
    }

    // Tentar carregar o arquivo
    fs.readFile(realPath, (err, data) => {
        if (err) {
            // Se arquivo não existe e não é um arquivo estático, retorna index.html
            if (err.code === 'ENOENT' && !path.extname(pathname)) {
                fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Erro interno do servidor');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
                    res.end(data);
                });
                return;
            }

            // Arquivo não encontrado
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 - Arquivo não encontrado: ' + pathname);
            return;
        }

        // Determinar tipo MIME
        const ext = path.extname(realPath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        // Headers de segurança e cache
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*'
        });

        res.end(data);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`
╔════════════════════════════════════════╗
║   FadVendas - Servidor Local            ║
╚════════════════════════════════════════╝

✓ Servidor rodando em: http://${HOST}:${PORT}
✓ Pressione Ctrl+C para parar

Estrutura esperada:
  / 
  ├── index.html
  ├── manifest.json
  ├── sw.js
  └── assets/
      ├── css/style.css
      └── js/
          ├── config.js
          ├── app.js
          └── modules/
              ├── storage.js
              ├── navigation.js
              ├── products.js
              ├── cart.js
              ├── orders.js
              ├── bi.js
              └── ads.js
    `);
});

// Tratamento de erros
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Porta ${PORT} já está em uso!`);
        console.log('Tente encerrar outros servidores ou mude a porta');
    } else {
        console.error('Erro do servidor:', err);
    }
});
