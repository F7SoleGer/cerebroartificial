const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const ROOT = __dirname;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const urlPath = decodeURI(req.url.split('?')[0]);
  let filePath = path.join(ROOT, urlPath);

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    const ext = path.extname(filePath);
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        const fallback = path.join(ROOT, '404.html');
        fs.readFile(fallback, (err3, data404) => {
          if (err3) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data404);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
      res.end(data);
    });
  });
}).listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
