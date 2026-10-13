// Elo5 — static file serving (dashboard shell).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function registerRoutes(router, deps) {
  const { ROOT, sendJson } = deps;

  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
  };

  function serveStatic(pathname, res) {
    let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const abs = path.normalize(path.join(ROOT, rel));
    if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    // No-cache for dashboard shell so operator-token/chart fixes land on refresh.
    const headers = { 'Content-Type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream' };
    if (/\.(html|js|css)$/i.test(abs)) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    fs.createReadStream(abs).pipe(res);
  }

  // GET / and all non-API paths — serve static files
  router.get('/*', async (req, res, url) => {
    const { pathname } = url;
    if (pathname.startsWith('/api')) {
      // Not found — let the 404 handler in router.js handle it
      return;
    }
    serveStatic(pathname, res);
  });
}

module.exports = { registerRoutes };