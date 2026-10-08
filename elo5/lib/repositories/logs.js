// Elo5 — item 3 do checklist: SQL de logs isolado (espelho do server.js).
// Inclui as regras de insertLog (validação + ACK por evento); o server.js ainda
// usa as funções originais — a fiação acontece depois.

'use strict';

function listLogs(db, { search = '', location = '', camera = '', limit = 50 } = {}) {
  const conds = [];
  const params = [];
  if (search) {
    conds.push('(e.nome LIKE ? OR l.employee_id LIKE ? OR l.local LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (location) { conds.push('l.local LIKE ?'); params.push(`%${location}%`); }
  if (camera) { conds.push('l.camera_status = ?'); params.push(camera); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db.prepare(
    `SELECT l.*, e.nome, e.cargo, e.depto, e.foto_url
     FROM logs l LEFT JOIN employees e ON e.id = l.employee_id
     ${where} ORDER BY l.timestamp DESC, l.rowid DESC LIMIT ?`
  ).all(...params, limit);
}

function employeeExists(db, employeeId) {
  return !!db.prepare('SELECT 1 FROM employees WHERE id = ?').get(String(employeeId));
}

function logIdExists(db, id) {
  return !!db.prepare('SELECT 1 FROM logs WHERE id = ?').get(id);
}

function insertLogRow(db, { id, timestamp, deviceId, location, cameraStatus, employeeId, face, confianca, acesso, origin, eventName }) {
  db.prepare(
    `INSERT INTO logs (id, timestamp, device_id, local, camera_status,
      employee_id, face_detectada, confianca, acesso, origin, event)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, timestamp, deviceId, location, cameraStatus,
    employeeId, face, confianca, acesso, origin, eventName);
}

function getLogWithEmployee(db, id) {
  return db.prepare(
    `SELECT l.*, e.nome, e.cargo, e.depto, e.foto_url
     FROM logs l LEFT JOIN employees e ON e.id = l.employee_id WHERE l.id = ?`
  ).get(id);
}

function countLogs(db, sql) {
  return db.prepare(sql).get().c;
}

module.exports = {
  listLogs,
  employeeExists,
  logIdExists,
  insertLogRow,
  getLogWithEmployee,
  countLogs,
};
