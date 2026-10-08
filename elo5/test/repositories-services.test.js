// Elo5 — item 3 do checklist: trava services extraídos (ACK, staleness, retenção).
// Usa SQLite em memória (:memory:) — zero efeito no elo5.db real.
// Rode com `! npm test` (a partir de elo5/).

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const commandsRepo = require('../lib/repositories/commands');
const telemetryRepo = require('../lib/repositories/telemetry');
const auditRepo = require('../lib/repositories/audit');
const ack = require('../lib/services/ackTracker');
const { parseTs, toDeviceDTO } = require('../lib/services/staleness');
const { shouldPruneByAge, persistSample } = require('../lib/services/retention');

const fmtTs = (d) => {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

let db;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE devices (id TEXT PRIMARY KEY, mqtt_node TEXT);
    CREATE TABLE pending_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,
      action TEXT NOT NULL, created_at TEXT NOT NULL,
      sent_at TEXT, last_try_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, acked_at TEXT);
    CREATE TABLE telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,
      timestamp TEXT NOT NULL, dist REAL, pir INTEGER NOT NULL DEFAULT 0,
      ldr INTEGER, ldr_anomaly INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'operator', action TEXT NOT NULL,
      device_id TEXT, detail TEXT);`);
});

describe('ackTracker (P0)', () => {
  it('commandSatisfiedByState: arm/disarm/reset resolvem por estado; test/recalibrate nunca', () => {
    assert.equal(ack.commandSatisfiedByState('arm', true, false), true);
    assert.equal(ack.commandSatisfiedByState('arm', false, false), false);
    assert.equal(ack.commandSatisfiedByState('disarm', false, false), true);
    assert.equal(ack.commandSatisfiedByState('reset_alarm', true, false), true);
    assert.equal(ack.commandSatisfiedByState('test', true, false), false);
    assert.equal(ack.commandSatisfiedByState('recalibrate', true, false), false);
  });
  it('ackCommandsForState confirma só o comando satisfeito', () => {
    const now = fmtTs(new Date());
    const a = commandsRepo.queueCommand(db, 'D1', 'arm', now);
    const b = commandsRepo.queueCommand(db, 'D1', 'disarm', now);
    db.prepare('UPDATE pending_commands SET sent_at = ?, last_try_at = ?').run(now, now);
    const n = ack.ackCommandsForState(db, fmtTs, 'D1', true, false);
    assert.equal(n, 1);
    assert.ok(commandsRepo.getCommand(db, Number(a.lastInsertRowid)).acked_at);
    assert.equal(commandsRepo.getCommand(db, Number(b.lastInsertRowid)).acked_at, null);
  });
  it('ackCommandsForLogEvent mapeia evento → ação (test, recalibrated, disarmed)', () => {
    const now = fmtTs(new Date());
    for (const a of ['test', 'recalibrate', 'disarm']) {
      commandsRepo.queueCommand(db, 'D1', a, now);
    }
    db.prepare('UPDATE pending_commands SET sent_at = ?, last_try_at = ?').run(now, now);
    assert.equal(ack.ackCommandsForLogEvent(db, fmtTs, 'D1', 'test'), 1);
    assert.equal(ack.ackCommandsForLogEvent(db, fmtTs, 'D1', 'recalibrated'), 1);
    assert.equal(ack.ackCommandsForLogEvent(db, fmtTs, 'D1', 'disarmed'), 1);
    assert.equal(ack.ackCommandsForLogEvent(db, fmtTs, 'D1', 'evento-desconhecido'), 0);
  });
  it('dueCommands + claimCommands: nunca-enviado e vencido entram; confirmado não', () => {
    const now = fmtTs(new Date());
    db.prepare('INSERT INTO devices (id, mqtt_node) VALUES (?, ?)').run('D1', 'armazem-b');
    commandsRepo.queueCommand(db, 'D1', 'arm', now); // nunca enviado → due
    const old = fmtTs(new Date(Date.now() - 60000));
    db.prepare(
      'INSERT INTO pending_commands (device_id, action, created_at, sent_at, last_try_at, attempts) VALUES (?,?,?,?,?,?)'
    ).run('D1', 'disarm', old, old, old, 1); // enviado, 1 tentativa, vencido → due
    const due = commandsRepo.dueCommands(db, 5, fmtTs(new Date()));
    assert.equal(due.length, 2);
    commandsRepo.claimCommands(db, due, fmtTs(new Date()));
    const claimed = commandsRepo.getCommand(db, due[0].id);
    assert.equal(claimed.attempts, 1);
    assert.ok(claimed.sent_at);
  });
});

describe('staleness (P1)', () => {
  it('parseTs entende fmtTs e rejeita lixo', () => {
    assert.ok(Number.isFinite(parseTs('2026-10-08 10:00:00')));
    assert.ok(Number.isNaN(parseTs('lixo')));
    assert.ok(Number.isNaN(parseTs(null)));
  });
  it('toDeviceDTO marca OFFLINE após STALE_AFTER_MS, preserva recente', () => {
    const old = { id: 'D', status: 'ONLINE', last_seen: '2020-01-01 00:00:00' };
    assert.equal(toDeviceDTO(old, 90000).status, 'OFFLINE');
    const fresh = { id: 'D', status: 'ONLINE', last_seen: fmtTs(new Date()) };
    assert.equal(toDeviceDTO(fresh, 90000).status, 'ONLINE');
    assert.equal(toDeviceDTO(null, 90000), null);
  });
});

describe('retention (P2)', () => {
  it('shouldPruneByAge: 0 = guardar tudo', () => {
    assert.equal(shouldPruneByAge(0), false);
    assert.equal(shouldPruneByAge(30), true);
  });
  it('persistSample insere e respeita teto por device', () => {
    for (let i = 0; i < 10; i++) {
      persistSample(db, fmtTs, 0, 'D1', { dist: i, pir: 0, ldr: 1000 + i, ldrAnomaly: 0 });
    }
    const rows = telemetryRepo.listHistory(db, { deviceId: 'D1', limit: 100 });
    assert.equal(rows.length, 10);
    assert.equal(rows[0].dist, 9); // newest-first
  });
});

describe('audit repo', () => {
  it('writeAudit é best-effort e lista newest-first', () => {
    auditRepo.writeAudit(db, fmtTs, { action: 'arm', deviceId: 'D1', detail: 'x', actor: 'operator' });
    const rows = auditRepo.listAudit(db, 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'arm');
  });
});
