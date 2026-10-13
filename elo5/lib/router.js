// Elo5 — modular router: composes all route modules, handles 404, error handling.
// Zero external deps; used by server.js.

'use strict';

const { errorHandler } = require('./errors');

// Simple router interface — no external deps
class Router {
  constructor() {
    this.routes = []; // { method, pathRegex, paramNames, handler }
  }

  get(path, handler) { this._add('GET', path, handler); }
  post(path, handler) { this._add('POST', path, handler); }
  patch(path, handler) { this._add('PATCH', path, handler); }
  put(path, handler) { this._add('PUT', path, handler); }
  delete(path, handler) { this._add('DELETE', path, handler); }

  _add(method, path, handler) {
    // Convert path like '/api/mqtt-users/:id' to regex
    const paramNames = [];
    const regexStr = path
      .replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');
    const pathRegex = new RegExp(`^${regexStr}$`);
    this.routes.push({ method, pathRegex, paramNames, handler });
  }

  // Find matching route and extract params
  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pathRegex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

// Factory: creates the composed router with all route modules
function createRouter(deps) {
  const router = new Router();
  const { sendJson } = deps;

  // Mount all route modules (order matters: specific before generic)
  require('../routes/health').registerRoutes(router, deps);
  require('../routes/devices').registerRoutes(router, deps);
  require('../routes/logs').registerRoutes(router, deps);
  require('../routes/telemetry').registerRoutes(router, deps);
  require('../routes/commands').registerRoutes(router, deps);
  require('../routes/audit').registerRoutes(router, deps);
  require('../routes/bridge').registerRoutes(router, deps);
  require('../routes/static').registerRoutes(router, deps);

  // Return the main request handler for http.createServer
  return async function handleRequest(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const { pathname } = url;

      const match = router.match(req.method, pathname);
      if (!match) {
        // 404 — not found
        sendJson(res, 404, { error: 'rota não encontrada', code: 'NOT_FOUND' });
        return;
      }

      // Call handler with (req, res, url, params)
      await match.handler(req, res, url, match.params);
    } catch (err) {
      errorHandler(err, req, res, sendJson);
    }
  };
}

module.exports = { createRouter, Router };