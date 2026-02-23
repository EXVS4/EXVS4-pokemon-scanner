/**
 * Card Price Scanner - ローカルHTTPサーバー
 * Node.js組み込みモジュールのみ使用（npm install不要）
 * 起動: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(ROOT, urlPath);

    // ディレクトリトラバーサル防止
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`404 Not Found: ${urlPath}`);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': mime,
            // 開発中はキャッシュを無効化（コード変更が即反映されるように）
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            // カメラAPIはHTTPS or localhostで動作するためヘッダーを付与
            'Permissions-Policy': 'camera=*',
        });
        res.end(data);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  ✅ Card Price Scanner が起動しました！');
    console.log(`  🌐 http://localhost:${PORT}`);
    console.log('');
    console.log('  終了するには Ctrl+C を押してください');
    console.log('');
});
