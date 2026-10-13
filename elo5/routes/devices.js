// Elo5 — devices routes: list, mqtt-users, command queue.

'use strict';

function registerRoutes(router, deps) {
  const {
    sendJson,
    devicesRepo,
    toDeviceDTO,
    requireOperator,
    requireRateLimit,
    currentActor: currentActorWith,
    OPERATOR_TOKEN,
    CMD_ACTIONS,
    commandsRepo,
    validateMqttUserLib,
    writeAudit,
  } = deps;

  // GET /api/devices — list all devices with staleness-based status
  router.get('/api/devices', async (req, res, url) => {
    sendJson(res, 200, devicesRepo.listDevices(deps.db).map(toDeviceDTO));
  });

  // GET /api/employees — list all employees (kept here for now)
  router.get('/api/employees', async (req, res, url) => {
    sendJson(res, 200, deps.db.prepare('SELECT * FROM employees ORDER BY rowid').all());
  });

  // GET /api/mqtt-users — list MQTT users per device (operator only)
  router.get('/api/mqtt-users', async (req, res, url) => {
    if (!requireOperator(req, res)) return;
    sendJson(res, 200, devicesRepo.listDevicesForMqtt(deps.db));
  });

  // PATCH /api/mqtt-users/:id — rotate MQTT user (operator + rate limit)
  router.patch('/api/mqtt-users/:id', async (req, res, url, params) => {
    if (!requireOperator(req, res)) return;
    if (!requireRateLimit(req, res)) return;

    const body = await deps.readBody(req);
    const deviceId = params.id;
    const dev = devicesRepo.getDevice(deps.db, deviceId);
    if (!dev) return sendJson(res, 404, { error: 'dispositivo não encontrado' });

    const check = validateMqttUserLib(body.mqtt_user);
    if (check.error) return sendJson(res, 400, { error: check.error });
    const mqttUser = check.value;

    devicesRepo.updateMqttUser(deps.db, deviceId, mqttUser);
    const actor = currentActorWith(req, OPERATOR_TOKEN);
    writeAudit('mqtt-rotation', deviceId, `mqtt_user ${dev.mqtt_user || '(vazio)'} → ${mqttUser || '(vazio)'} — trocar a senha no broker (mosquitto_passwd) e no ESP (MQTT_PASSWORD)`, actor);
    sendJson(res, 200, toDeviceDTO(devicesRepo.getDevice(deps.db, deviceId)));
  });

  // POST /api/devices/:id/command — queue a command (operator + rate limit)
  router.post('/api/devices/:id/command', async (req, res, url, params) => {
    if (!requireOperator(req, res)) return;
    if (!requireRateLimit(req, res)) return;

    const body = await deps.readBody(req);
    const deviceId = params.id;
    const dev = devicesRepo.getDevice(deps.db, deviceId);
    if (!dev) return sendJson(res, 404, { error: 'dispositivo não encontrado' });
    if (!dev.mqtt_node) return sendJson(res, 400, { error: 'dispositivo sem nó MQTT (não é controlável)' });

    const action = String(body.action || '').trim();
    if (!CMD_ACTIONS.has(action)) {
      return sendJson(res, 400, { error: 'action inválida (arm, disarm, reset_alarm, test, recalibrate)' });
    }

    const now = deps.fmtTs(new Date());
    const r = commandsRepo.queueCommand(deps.db, deviceId, action, now);
    const id = Number(r.lastInsertRowid);
    let status = 'pending';

    try {
      if (dev.armed !== null && dev.armed !== undefined &&
          deps.ackTracker.commandSatisfiedByState(action, dev.armed === 1, dev.alarming === 1)) {
        commandsRepo.markAcked(deps.db, now, id);
        status = 'acked';
      }
    } catch { /* ACK is best-effort */ }

    writeAudit('command:' + action, deviceId, 'cmd#' + id + ' ' + status, currentActorWith(req, OPERATOR_TOKEN));
    sendJson(res, 201, { id, device_id: deviceId, action, queued: true, status });
  });
}

module.exports = { registerRoutes };