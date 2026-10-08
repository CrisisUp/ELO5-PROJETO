// Elo5 — item 3 do checklist: SQL de pending_commands isolado (espelho do server.js).
// P0 retry-until-ACK: os SELECTs de "due" e os UPDATEs de claim/ack ficam aqui.

'use strict';

function unackedForState(db, deviceId) {
  return db.prepare(
    `SELECT id, action FROM pending_commands
     WHERE device_id = ? AND sent_at IS NOT NULL AND acked_at IS NULL`
  ).all(deviceId);
}

function markAckedIfPending(db, now, id) {
  return db.prepare(
    'UPDATE pending_commands SET acked_at = ? WHERE id = ? AND acked_at IS NULL'
  ).run(now, id);
}

// Log-event ACK: o comando mais antigo da ação, ainda não confirmado.
function oldestUnackedByAction(db, deviceId, action) {
  return db.prepare(
    `SELECT id FROM pending_commands
     WHERE device_id = ? AND action = ? AND sent_at IS NOT NULL AND acked_at IS NULL
     ORDER BY id LIMIT 1`
  ).get(deviceId, action);
}

function queueCommand(db, deviceId, action, now) {
  return db.prepare(
    'INSERT INTO pending_commands (device_id, action, created_at) VALUES (?, ?, ?)'
  ).run(deviceId, action, now);
}

function markAcked(db, now, id) {
  db.prepare('UPDATE pending_commands SET acked_at = ? WHERE id = ?').run(now, id);
}

function getCommand(db, id) {
  return db.prepare('SELECT * FROM pending_commands WHERE id = ?').get(id);
}

// Bridge: comandos nunca enviados OU não confirmados e vencidos para retry.
function dueCommands(db, maxRetries, retryBeforeTs) {
  return db.prepare(
    `SELECT pc.id, pc.device_id, pc.action, pc.attempts, d.mqtt_node
     FROM pending_commands pc JOIN devices d ON d.id = pc.device_id
     WHERE pc.acked_at IS NULL
       AND (pc.sent_at IS NULL
            OR (pc.attempts < ? AND (pc.last_try_at IS NULL OR pc.last_try_at <= ?)))
     ORDER BY pc.id`
  ).all(maxRetries, retryBeforeTs);
}

function claimCommands(db, rows, now) {
  const mark = db.prepare(
    `UPDATE pending_commands
     SET sent_at = COALESCE(sent_at, ?), last_try_at = ?, attempts = attempts + 1
     WHERE id = ? AND acked_at IS NULL`
  );
  rows.forEach((r) => mark.run(now, now, r.id));
}

module.exports = {
  unackedForState,
  markAckedIfPending,
  oldestUnackedByAction,
  queueCommand,
  markAcked,
  getCommand,
  dueCommands,
  claimCommands,
};
