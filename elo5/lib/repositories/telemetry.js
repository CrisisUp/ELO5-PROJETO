// Elo5 — item 3 do checklist: SQL de telemetria isolado (espelho do server.js).
// Quando migrarmos para TimescaleDB, SÓ este arquivo muda (hypertable +
// retention policy no lugar do DELETE); rotas e services nem percebem.

'use strict';

function insertSample(db, { deviceId, timestamp, dist, pir, ldr, ldrAnomaly }) {
  db.prepare(
    `INSERT INTO telemetry (device_id, timestamp, dist, pir, ldr, ldr_anomaly)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(deviceId, timestamp, dist, pir, ldr, ldrAnomaly);
}

// Bound table growth: keep the newest ~5000 rows per device.
function prunePerDevice(db, deviceId, keep = 5000) {
  db.prepare(
    `DELETE FROM telemetry WHERE device_id = ? AND id NOT IN
     (SELECT id FROM telemetry WHERE device_id = ? ORDER BY id DESC LIMIT ?)`
  ).run(String(deviceId), String(deviceId), keep);
}

// P2: retention by age (TELEMETRY_RETENTION_DAYS, 0 = keep all — o chamador decide).
function pruneByAge(db, retentionDays) {
  db.prepare(
    `DELETE FROM telemetry WHERE timestamp < datetime('now', 'localtime', ?)`
  ).run(`-${retentionDays} days`);
}

function listHistory(db, { deviceId = '', since = '', limit = 120 } = {}) {
  const conds = [];
  const params = [];
  if (deviceId) { conds.push('device_id = ?'); params.push(deviceId); }
  if (since) { conds.push('timestamp >= ?'); params.push(since); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db.prepare(
    `SELECT device_id, timestamp, dist, pir, ldr, ldr_anomaly
     FROM telemetry ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`
  ).all(...params, limit);
}

function listForExport(db, { deviceId = '', since = '', until = '', limit = 1000 } = {}) {
  const conds = [];
  const params = [];
  if (deviceId) { conds.push('device_id = ?'); params.push(deviceId); }
  if (since) { conds.push('timestamp >= ?'); params.push(since); }
  if (until) { conds.push('timestamp <= ?'); params.push(until); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db.prepare(
    `SELECT device_id, timestamp, dist, pir, ldr, ldr_anomaly
     FROM telemetry ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`
  ).all(...params, limit);
}

module.exports = { insertSample, prunePerDevice, pruneByAge, listHistory, listForExport };
