// Elo5 — health & mqtt-status routes.

'use strict';

function registerRoutes(router, deps) {
  const { sendJson, bridgeStatus, fmtTs, OPERATOR_TOKEN, STALE_AFTER_MS, BRIDGE_MAX_RETRIES, TELEMETRY_RETENTION_DAYS, TELEMETRY_EXPORT_MAX } = deps;

  router.get('/api/health', async (req, res, url) => {
    sendJson(res, 200, {
      ok: true,
      db: 'sqlite',
      time: fmtTs(new Date()),
      mqtt: bridgeStatus.connected
        ? { connected: true, at: bridgeStatus.updatedAt }
        : { connected: false },
      auth: { operatorRequired: !!OPERATOR_TOKEN },
      limits: {
        staleAfterMs: STALE_AFTER_MS,
        bridgeMaxRetries: BRIDGE_MAX_RETRIES,
        telemetryRetentionDays: TELEMETRY_RETENTION_DAYS,
        telemetryExportMax: TELEMETRY_EXPORT_MAX,
      },
    });
  });

  router.get('/api/mqtt-status', async (req, res, url) => {
    sendJson(res, 200, { ...bridgeStatus });
  });
}

module.exports = { registerRoutes };