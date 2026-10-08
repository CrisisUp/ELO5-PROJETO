// Elo5 — item 3 do checklist: SQL de audit_log isolado (espelho do server.js).
// Auditoria é best-effort: nunca quebra a rota se o insert falhar.

'use strict';

function writeAudit(db, fmtTs, { action, deviceId = null, detail = null, actor = 'operator' }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (timestamp, actor, action, device_id, detail)
       VALUES (?, ?, ?, ?, ?)`
    ).run(fmtTs(new Date()), String(actor || 'operator').slice(0, 64),
      String(action).slice(0, 64), deviceId ? String(deviceId).slice(0, 64) : null,
      detail != null ? String(detail).slice(0, 500) : null);
  } catch { /* audit is best-effort */ }
}

function listAudit(db, limit = 100) {
  return db.prepare(
    `SELECT id, timestamp, actor, action, device_id, detail
     FROM audit_log ORDER BY id DESC LIMIT ?`
  ).all(limit);
}

module.exports = { writeAudit, listAudit };
