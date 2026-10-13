// Elo5 — audit trail route (operator only).

'use strict';

function registerRoutes(router, deps) {
  const {
    sendJson,
    requireOperator,
  } = deps;

  // GET /api/audit — operator audit trail
  router.get('/api/audit', async (req, res, url) => {
    if (!requireOperator(req, res)) return;

    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500);
    const rows = deps.db.prepare(
      `SELECT id, timestamp, actor, action, device_id, detail
       FROM audit_log ORDER BY id DESC LIMIT ?`
    ).all(limit);

    sendJson(res, 200, rows);
  });
}

module.exports = { registerRoutes };