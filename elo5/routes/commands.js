// Elo5 — commands routes: status polling + bridge commands.

'use strict';

function registerRoutes(router, deps) {
  const {
    sendJson,
    commandsRepo,
    deps: _, // placeholder, not used
    fmtTs,
    BRIDGE_MAX_RETRIES,
    BRIDGE_RETRY_MS,
    ackTracker,
    isBridgeAuthorized: isBridgeAuthorizedWith,
    config,
  } = deps;

  // GET /api/commands/:id — command status (enviando → confirmado/falhou)
  router.get('/api/commands/:id', async (req, res, url, params) => {
    const commandId = Number(params.id);
    const r = deps.db.prepare('SELECT * FROM pending_commands WHERE id = ?').get(commandId);
    if (!r) return sendJson(res, 404, { error: 'comando não encontrado' });

    // commandPublicStatus logic (from ackTracker)
    const status = r.acked_at
      ? 'acked'
      : r.attempts >= BRIDGE_MAX_RETRIES
        ? 'failed'
        : 'sending';

    sendJson(res, 200, {
      id: r.id,
      device_id: r.device_id,
      action: r.action,
      status,
      attempts: r.attempts || 0,
      max_attempts: BRIDGE_MAX_RETRIES,
      created_at: r.created_at,
      sent_at: r.sent_at,
      acked_at: r.acked_at,
    });
  });

  // GET /api/_bridge/commands — bridge fetches due commands (bridge auth only)
  router.get('/api/_bridge/commands', async (req, res, url) => {
    if (!isBridgeAuthorizedWith(req, config.BRIDGE_KEY)) {
      return sendJson(res, 403, { error: 'bridge key inválida' });
    }

    const now = fmtTs(new Date());
    const retryBefore = fmtTs(new Date(Date.now() - BRIDGE_RETRY_MS));
    const rows = commandsRepo.dueCommands(deps.db, BRIDGE_MAX_RETRIES, retryBefore);

    if (rows.length) {
      commandsRepo.claimCommands(deps.db, rows, now);
    }

    sendJson(res, 200, rows.map((r) => ({
      id: r.id,
      device_id: r.device_id,
      action: r.action,
      mqtt_node: r.mqtt_node,
      attempt: (r.attempts || 0) + 1,
    })));
  });
}

module.exports = { registerRoutes };