// Elo5 — logs routes: list and create.

'use strict';

function registerRoutes(router, deps) {
  const {
    sendJson,
    logsRepo,
    toLogDTO,
    requireRateLimit,
    isBridgeAuthorized: isBridgeAuthorizedWith,
    isOperatorAuthorized: isOperatorAuthorizedWith,
    OPERATOR_TOKEN,
    ackTracker,
    fmtTs,
    writeAudit,
  } = deps;

  // GET /api/logs — list logs with filters
  router.get('/api/logs', async (req, res, url) => {
    const search = (url.searchParams.get('search') || '').trim();
    const location = (url.searchParams.get('location') || '').trim();
    const camera = (url.searchParams.get('camera') || '').trim();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);

    const rows = logsRepo.listLogs(deps.db, { search, location, camera, limit });
    sendJson(res, 200, rows.map(toLogDTO));
  });

  // POST /api/logs — create log (bridge OR operator, rate limited)
  router.post('/api/logs', async (req, res, url) => {
    // Bridge (x-bridge-key) or operator may write logs; others 401 when auth is on.
    if (OPERATOR_TOKEN && !isBridgeAuthorizedWith(req, deps.config.BRIDGE_KEY) && !isOperatorAuthorizedWith(req, OPERATOR_TOKEN)) {
      return sendJson(res, 401, { error: 'operador não autenticado (x-operator-token)' });
    }
    if (!requireRateLimit(req, res)) return;

    const body = await deps.readBody(req);

    const location = String(body.location || '').trim();
    if (!location) {
      const e = new Error('location é obrigatório');
      e.status = 400;
      throw e;
    }

    const cameraStatus = body.cameraStatus === 'Desativada' ? 'Desativada' : 'Ativa';
    const acesso = body.acesso === 'Negado' ? 'Negado' : 'Autorizado';

    let employeeId = body.employeeId ?? body.employee_id ?? null;
    if (employeeId === 'unknown' || employeeId === '') employeeId = null;
    if (employeeId != null) {
      if (!logsRepo.employeeExists(deps.db, String(employeeId))) {
        const e = new Error('employeeId desconhecido');
        e.status = 400;
        throw e;
      }
    }

    let confianca = body.confianca ?? body.confidence ?? null;
    if (confianca != null) {
      confianca = Number(confianca);
      if (!Number.isFinite(confianca)) {
        const e = new Error('confianca inválida');
        e.status = 400;
        throw e;
      }
    }

    const deviceId = String(body.deviceId || body.device_id || 'IOT-MANUAL-01');
    const face = cameraStatus === 'Ativa' ? 1 : 0;

    let id;
    do {
      id = 'LOG-' + Math.floor(100000 + Math.random() * 900000);
    } while (logsRepo.logIdExists(deps.db, id));

    const eventName = body.event != null ? String(body.event).slice(0, 64) : null;

    logsRepo.insertLogRow(deps.db, {
      id,
      timestamp: fmtTs(new Date()),
      deviceId,
      location,
      cameraStatus,
      employeeId: employeeId ? String(employeeId) : null,
      face,
      confianca,
      acesso,
      origin: body.origin || 'manual',
      eventName,
    });

    try {
      if (eventName && (body.origin || 'manual') === 'esp32') {
        ackTracker.ackCommandsForLogEvent(deps.db, fmtTs, deviceId, eventName);
      }
    } catch { /* ACK is best-effort */ }

    const log = logsRepo.getLogWithEmployee(deps.db, id);
    sendJson(res, 201, toLogDTO(log));
  });
}

module.exports = { registerRoutes };