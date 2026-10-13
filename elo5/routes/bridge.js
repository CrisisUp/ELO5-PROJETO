// Elo5 — bridge internal routes: device state updates + heartbeat.

'use strict';

function registerRoutes(router, deps) {
  const {
    sendJson,
    devicesRepo,
    toDeviceDTO,
    fmtTs,
    ackTracker,
    isBridgeAuthorized: isBridgeAuthorizedWith,
    config,
    retention,
    telemetryRepo,
  } = deps;

  // PATCH /api/_bridge/devices/:id — bridge updates device live-state
  router.patch('/api/_bridge/devices/:id', async (req, res, url, params) => {
    if (!isBridgeAuthorizedWith(req, config.BRIDGE_KEY)) {
      return sendJson(res, 403, { error: 'bridge key inválida' });
    }

    const body = await deps.readBody(req);
    const deviceId = params.id;
    const dev = devicesRepo.getDevice(deps.db, deviceId);
    if (!dev) return sendJson(res, 404, { error: 'dispositivo não encontrado' });

    const sets = [];
    const paramsArr = [];
    if (body.status !== undefined) {
      const st = String(body.status).toUpperCase();
      if (st !== 'ONLINE' && st !== 'OFFLINE') return sendJson(res, 400, { error: 'status inválido' });
      sets.push('status = ?'); paramsArr.push(st);
    }
    if (body.armed !== undefined) {
      sets.push('armed = ?');
      paramsArr.push(body.armed == null ? null : (body.armed ? 1 : 0));
    }
    if (body.alarming !== undefined) {
      sets.push('alarming = ?'); paramsArr.push(body.alarming ? 1 : 0);
    }
    if (body.mqtt_user !== undefined) {
      sets.push('mqtt_user = ?');
      paramsArr.push(body.mqtt_user == null ? null : String(body.mqtt_user).slice(0, 64));
    }
    if (body.last_telemetry !== undefined) {
      sets.push('last_telemetry = ?');
      paramsArr.push(typeof body.last_telemetry === 'string' ? body.last_telemetry : JSON.stringify(body.last_telemetry));
    }
    sets.push('last_seen = ?'); paramsArr.push(fmtTs(new Date()));

    if (!sets.length) return sendJson(res, 400, { error: 'nada para atualizar' });
    paramsArr.push(deviceId);
    devicesRepo.updateDeviceSets(deps.db, deviceId, sets, paramsArr);

    try {
      if (body.last_telemetry !== undefined && body.last_telemetry !== null) {
        const t = typeof body.last_telemetry === 'string'
          ? JSON.parse(body.last_telemetry) : body.last_telemetry;
        retention.persistSample(deps.db, fmtTs, deps.TELEMETRY_RETENTION_DAYS, deviceId, t);
      }
    } catch { /* telemetry is best-effort */ }

    try {
      if (body.armed !== undefined || body.alarming !== undefined) {
        const cur = devicesRepo.getArmedState(deps.db, deviceId);
        ackTracker.ackCommandsForState(deps.db, fmtTs, deviceId, cur.armed === 1, cur.alarming === 1);
      }
    } catch { /* ACK is best-effort */ }

    sendJson(res, 200, toDeviceDTO(devicesRepo.getDevice(deps.db, deviceId)));
  });

  // POST /api/_bridge/heartbeat — bridge heartbeat
  router.post('/api/_bridge/heartbeat', async (req, res, url) => {
    if (!isBridgeAuthorizedWith(req, config.BRIDGE_KEY)) {
      return sendJson(res, 403, { error: 'bridge key inválida' });
    }
    deps.setBridgeStatus({ connected: true });
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { registerRoutes };