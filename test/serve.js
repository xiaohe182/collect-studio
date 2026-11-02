'use strict';
// 本地测试静态服务器：node test/serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = parseInt(process.argv[2], 10) || 8931;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/sample1.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('test server on http://127.0.0.1:' + port));
