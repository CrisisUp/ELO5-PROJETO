// Elo5 — telemetry routes: history and export (CSV/JSON).

'use strict';

function registerRoutes(router, deps) {
  const {
    sendJson,
    telemetryRepo,
    requireOperator,
    capExportLimitLib,
    TELEMETRY_EXPORT_MAX,
    TELEMETRY_RETENTION_DAYS,
    buildTelemetryCsvLib,
  } = deps;

  // GET /api/telemetry — telemetry history for charts
  router.get('/api/telemetry', async (req, res, url) => {
    const deviceId = (url.searchParams.get('device_id') || '').trim();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '120', 10) || 120, 1), 1000);
    const since = (url.searchParams.get('since') || '').trim();

    const rows = telemetryRepo.listHistory(deps.db, { deviceId, since, limit });
    sendJson(res, 200, rows.reverse());
  });

  // GET /api/telemetry/export — export telemetry as CSV or JSON (operator only)
  router.get('/api/telemetry/export', async (req, res, url) => {
    if (!requireOperator(req, res)) return;

    const format = (url.searchParams.get('format') || 'csv').trim().toLowerCase();
    const deviceId = (url.searchParams.get('device_id') || '').trim();
    const since = (url.searchParams.get('since') || '').trim();
    const until = (url.searchParams.get('until') || '').trim();
    const limit = capExportLimitLib(url.searchParams.get('limit'), TELEMETRY_EXPORT_MAX);

    const rows = telemetryRepo.listForExport(deps.db, { deviceId, since, until, limit });

    if (format === 'json') {
      return sendJson(res, 200, {
        retention_days: TELEMETRY_RETENTION_DAYS,
        count: rows.length,
        rows: rows.reverse(),
      });
    }
    if (format !== 'csv') {
      return sendJson(res, 400, { error: 'format inválido (csv, json)' });
    }

    const s = buildTelemetryCsvLib(rows.reverse());
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Length': Buffer.byteLength(s),
      'Content-Disposition': 'attachment; filename="elo5-telemetry.csv"',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(s);
  });
}

module.exports = { registerRoutes };