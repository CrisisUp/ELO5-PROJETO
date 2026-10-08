// Elo5 System — Phase 1: real API + SQLite (zero external dependencies)
// Requires Node 22.5+ (uses the built-in node:sqlite module).
// Usage:  node server.js   →  http://localhost:3000
// NOTE: open the dashboard through http://localhost:3000, NOT as a
// file (fetch() does not work over file://).

const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// Minimal .env loader (no external deps): KEY=VALUE lines, # comments, optional quotes.
function loadDotEnv() {
  try {
    const p = path.join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* .env is optional */ }
}
loadDotEnv();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const db = new DatabaseSync(path.join(ROOT, 'elo5.db'));

// ---- Schema ----
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    cargo TEXT NOT NULL,
    depto TEXT NOT NULL,
    foto_url TEXT
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    local TEXT NOT NULL,
    tipo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ONLINE',
    last_seen TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    device_id TEXT,
    local TEXT NOT NULL,
    camera_status TEXT NOT NULL,
    employee_id TEXT REFERENCES employees(id),
    face_detectada INTEGER NOT NULL DEFAULT 0,
    confianca REAL,
    acesso TEXT NOT NULL DEFAULT 'Autorizado',
    origin TEXT NOT NULL DEFAULT 'manual'
  );
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
  CREATE TABLE IF NOT EXISTS pending_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    last_try_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    acked_at TEXT
  );
`);

// ---- Phase 2 migration: ESP32 link + live state on devices ----
for (const col of [
  "mqtt_node TEXT",
  "armed INTEGER",
  "alarming INTEGER NOT NULL DEFAULT 0",
  "last_telemetry TEXT",
]) {
  try { db.exec(`ALTER TABLE devices ADD COLUMN ${col}`); }
  catch (e) { /* column already exists — ignore */ }
}
// ---- P0 migration: command ACK tracking (retry until ESP confirms via .../state) ----
for (const col of [
  "last_try_at TEXT",
  "attempts INTEGER NOT NULL DEFAULT 0",
  "acked_at TEXT",
]) {
  try { db.exec(`ALTER TABLE pending_commands ADD COLUMN ${col}`); }
  catch (e) { /* column already exists — ignore */ }
}
// ---- P0 migration: keep the ESP log event name so .../log can ACK commands ----
try { db.exec(`ALTER TABLE logs ADD COLUMN event TEXT`); }
catch (e) { /* column already exists — ignore */ }
// ---- P2 migration: per-device MQTT user (ACL rotation visibility) ----
try { db.exec(`ALTER TABLE devices ADD COLUMN mqtt_user TEXT`); }
catch (e) { /* column already exists — ignore */ }
try {
  db.prepare(
    `UPDATE devices SET mqtt_user = 'elo5-esp'
     WHERE id = 'IOT-CAM-ARMAZEMB' AND (mqtt_user IS NULL OR mqtt_user = '')`
  ).run();
} catch { /* best-effort */ }
// ---- P1 migration: real telemetry history + operator audit trail ----
db.exec(`
  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    dist REAL,
    pir INTEGER NOT NULL DEFAULT 0,
    ldr INTEGER,
    ldr_anomaly INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts ON telemetry(device_id, timestamp);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'operator',
    action TEXT NOT NULL,
    device_id TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);
`);
// Map the existing "Armazém B" row to the ESP32 MQTT node (idempotent).
db.prepare(
  `UPDATE devices SET mqtt_node = 'armazem-b',
     tipo = 'ESP32 PIR + HC-SR04 + LDR (alarme patrimonial)'
   WHERE id = 'IOT-CAM-ARMAZEMB'`
).run();

function fmtTs(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- Seed (only when empty) ----
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM employees').get().c;
  if (count > 0) return;
  const now = fmtTs(new Date());
  const insEmp = db.prepare(
    'INSERT INTO employees (id, nome, cargo, depto, foto_url) VALUES (?, ?, ?, ?, ?)');
  [
    ['ELO5-7890', 'Mariana Costa', 'Gerente de Logística', 'Operações',
     'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80'],
    ['ELO5-7891', 'Carlos Eduardo', 'Operador de Máquinas', 'Produção',
     'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80'],
    ['ELO5-7892', 'Beatriz Lima', 'Analista de Segurança', 'TI & Cibersegurança',
     'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80'],
    ['ELO5-7893', 'Rafael Souza', 'Supervisor de Estoque', 'Armazém B',
     'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80'],
    ['ELO5-7896', 'Fernanda Oliveira', 'Diretora de Operações', 'Diretoria',
     'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80'],
    ['ELO5-7897', 'Lucas Mendes', 'Técnico de Manutenção', 'Infraestrutura',
     'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80'],
  ].forEach((r) => insEmp.run(...r));

  const insDev = db.prepare(
    'INSERT INTO devices (id, local, tipo, status, last_seen) VALUES (?, ?, ?, ?, ?)');
  [
    ['IOT-CAM-GATE01', 'Gate 01 - Portaria', 'Catraca Facial AI'],
    ['IOT-CAM-ARMAZEMB', 'Armazém B', 'Sensor Presença + Câmera'],
    ['IOT-CAM-LABPD', 'Lab de P&D', 'Leitor RFID + Térmico'],
    ['IOT-CAM-DIRETORIA', 'Diretoria Executiva', 'Biometria + Câmera HD'],
  ].forEach((r) => insDev.run(...r, 'ONLINE', now));

  console.log('Seed: 6 employees + 4 devices inseridos.');
}
seed();

// ---- Row → frontend DTO (same shape the dashboard already renders) ----
function toLogDTO(r) {
  return {
    id: r.id,
    timestamp: r.timestamp,
    location: r.local,
    cameraStatus: r.camera_status,
    faceDetected: r.face_detectada === 1,
    confidence: r.confianca == null ? null : Number(r.confianca).toFixed(1),
    accessStatus: r.acesso,
    deviceId: r.device_id,
    origin: r.origin || 'manual',
    event: r.event || null,
    employee: r.employee_id
      ? { id: r.employee_id, name: r.nome, role: r.cargo, dept: r.depto, photo: r.foto_url }
      : null,
  };
}

function sendJson(res, status, data) {
  const s = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    // P1 hardening: minimal security headers on every API response.
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(s);
}

// ---- P1: hardening + operator auth + staleness helpers ----
function getClientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'local';
}

// Simple fixed-window rate limit for mutating routes (in-memory, per IP).
// Returns true when allowed, false when the caller should answer 429.
function checkRateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + 60000 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  if (rateBuckets.size > 1000) {
    // Evict expired buckets opportunistically to bound memory.
    for (const [k, v] of rateBuckets) if (now > v.resetAt) rateBuckets.delete(k);
  }
  return b.count <= RATE_LIMIT_MAX;
}

function getOperatorToken(req) {
  const h = String(req.headers['x-operator-token'] || '').trim();
  if (h) return h;
  const auth = String(req.headers['authorization'] || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

// When OPERATOR_TOKEN is empty the API stays in open local mode (P0 behavior).
function isOperatorAuthorized(req) {
  if (!OPERATOR_TOKEN) return true;
  const tok = getOperatorToken(req);
  return tok.length > 0 && tok === OPERATOR_TOKEN;
}

function requireOperator(req, res) {
  if (isOperatorAuthorized(req)) return true;
  sendJson(res, 401, { error: 'operador não autenticado (x-operator-token)' });
  return false;
}

function requireRateLimit(req, res) {
  if (checkRateLimit(req)) return true;
  sendJson(res, 429, { error: 'muitas requisições — tente de novo em instantes' });
  return false;
}

function writeAudit(action, deviceId, detail, actor) {
  try {
    db.prepare(
      `INSERT INTO audit_log (timestamp, actor, action, device_id, detail)
       VALUES (?, ?, ?, ?, ?)`
    ).run(fmtTs(new Date()), String(actor || 'operator').slice(0, 64),
      String(action).slice(0, 64), deviceId ? String(deviceId).slice(0, 64) : null,
      detail != null ? String(detail).slice(0, 500) : null);
  } catch { /* audit is best-effort */ }
}

// P1 staleness: a device whose last_seen is older than STALE_AFTER_MS is
// reported OFFLINE even if the DB row still says ONLINE (survives restarts).
function parseTs(s) {
  // fmtTs produces "YYYY-MM-DD HH:MM:SS" in local time.
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function toDeviceDTO(r) {
  if (!r) return r;
  const out = { ...r };
  try {
    const age = Date.now() - parseTs(r.last_seen);
    if (Number.isFinite(age) && age > STALE_AFTER_MS) out.status = 'OFFLINE';
  } catch { /* keep stored status */ }
  return out;
}

// P2: prune telemetry older than TELEMETRY_RETENTION_DAYS (best-effort, runs on sample insert).
function pruneTelemetry() {
  if (!TELEMETRY_RETENTION_DAYS) return;
  try {
    db.prepare(
      `DELETE FROM telemetry WHERE timestamp < datetime('now', 'localtime', ?)`
    ).run(`-${TELEMETRY_RETENTION_DAYS} days`);
  } catch { /* prune is best-effort */ }
}

// P1: persist one telemetry sample (best-effort; keeps last_telemetry working as before).
function insertTelemetrySample(deviceId, data) {
  if (!data || typeof data !== 'object') return;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dist = data.dist !== undefined ? num(data.dist) : (data.distance_cm !== undefined ? num(data.distance_cm) : null);
  const pir = data.pir ? 1 : 0;
  const ldr = data.ldr !== undefined ? num(data.ldr) : null;
  const anom = data.ldr_anomaly ? 1 : 0;
  if (dist == null && ldr == null && !pir && !anom) return;
  db.prepare(
    `INSERT INTO telemetry (device_id, timestamp, dist, pir, ldr, ldr_anomaly)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(String(deviceId), fmtTs(new Date()), dist, pir, ldr, anom);
  // Bound table growth: keep the newest ~5000 rows per device.
  try {
    db.prepare(
      `DELETE FROM telemetry WHERE device_id = ? AND id NOT IN
       (SELECT id FROM telemetry WHERE device_id = ? ORDER BY id DESC LIMIT 5000)`
    ).run(String(deviceId), String(deviceId));
  } catch { /* prune is best-effort */ }
  // P2: retention by age (TELEMETRY_RETENTION_DAYS, 0 = keep all).
  pruneTelemetry();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error('payload too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---- API handlers ----
function handleListLogs(url, res) {
  const search = (url.searchParams.get('search') || '').trim();
  const location = (url.searchParams.get('location') || '').trim();
  const camera = (url.searchParams.get('camera') || '').trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);

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

  const rows = db.prepare(
    `SELECT l.*, e.nome, e.cargo, e.depto, e.foto_url
     FROM logs l LEFT JOIN employees e ON e.id = l.employee_id
     ${where} ORDER BY l.timestamp DESC, l.rowid DESC LIMIT ?`
  ).all(...params, limit);
  sendJson(res, 200, rows.map(toLogDTO));
}

function insertLog(data) {
  const location = String(data.location || '').trim();
  if (!location) { const e = new Error('location é obrigatório'); e.status = 400; throw e; }

  const cameraStatus = data.cameraStatus === 'Desativada' ? 'Desativada' : 'Ativa';
  const acesso = data.acesso === 'Negado' ? 'Negado' : 'Autorizado';

  let employeeId = data.employeeId ?? data.employee_id ?? null;
  if (employeeId === 'unknown' || employeeId === '') employeeId = null;
  if (employeeId != null) {
    const ok = db.prepare('SELECT 1 FROM employees WHERE id = ?').get(String(employeeId));
    if (!ok) { const e = new Error('employeeId desconhecido'); e.status = 400; throw e; }
  }

  let confianca = data.confianca ?? data.confidence ?? null;
  if (confianca != null) {
    confianca = Number(confianca);
    if (!Number.isFinite(confianca)) { const e = new Error('confianca inválida'); e.status = 400; throw e; }
  }

  const deviceId = String(data.deviceId || data.device_id || 'IOT-MANUAL-01');
  const face = cameraStatus === 'Ativa' ? 1 : 0;

  let id;
  const exists = db.prepare('SELECT 1 FROM logs WHERE id = ?');
  do { id = 'LOG-' + Math.floor(100000 + Math.random() * 900000); } while (exists.get(id));

  // P0: keep the ESP event name (armed, disarmed, test, ...) so .../log can ACK commands.
  const eventName = data.event != null ? String(data.event).slice(0, 64) : null;

  db.prepare(
    `INSERT INTO logs (id, timestamp, device_id, local, camera_status,
      employee_id, face_detectada, confianca, acesso, origin, event)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, fmtTs(new Date()), deviceId, location, cameraStatus,
    employeeId ? String(employeeId) : null, face, confianca, acesso, data.origin || 'manual', eventName);

  // P0: log-event based ACK — e.g. .../log {"event":"disarmed"} confirms a disarm.
  try {
    if (eventName && (data.origin || 'manual') === 'esp32') {
      ackCommandsForLogEvent(String(deviceId), eventName);
    }
  } catch { /* ACK is best-effort */ }

  return db.prepare(
    `SELECT l.*, e.nome, e.cargo, e.depto, e.foto_url
     FROM logs l LEFT JOIN employees e ON e.id = l.employee_id WHERE l.id = ?`
  ).get(id);
}

function handleCreateLog(body, res) {
  try {
    sendJson(res, 201, toLogDTO(insertLog(body)));
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message || 'erro interno' });
  }
}

// ---- Phase 2: device live-state + command queue (used by mqtt-bridge.js) ----
const CMD_ACTIONS = new Set(['arm', 'disarm', 'reset_alarm', 'test', 'recalibrate']);
// P0: retry/ACK config — bridge re-sends un-ACKed commands until the ESP
// confirms via .../state (or matching .../log). Env-overridable, .env supported.
const BRIDGE_MAX_RETRIES = Math.max(1, parseInt(process.env.BRIDGE_MAX_RETRIES || '5', 10) || 5);
const BRIDGE_RETRY_MS = Math.max(1000, parseInt(process.env.BRIDGE_RETRY_MS || '5000', 10) || 5000);
let bridgeStatus = { connected: false, updatedAt: null };
// ---- P1: operator auth + hardening + staleness ----
// OPERATOR_TOKEN: when set, mutating API routes require
// `x-operator-token: <token>` or `Authorization: Bearer <token>`.
// Empty (default) = open local mode, same as P0 (avoids breaking existing setup).
const OPERATOR_TOKEN = String(process.env.OPERATOR_TOKEN || '').trim();
// STALE_AFTER_MS: device with no bridge touch for longer than this is
// reported OFFLINE (staleness-based, survives bridge restarts).
const STALE_AFTER_MS = Math.max(15000, parseInt(process.env.STALE_AFTER_MS || '90000', 10) || 90000);
// RATE_LIMIT_MAX: max mutating requests per IP per minute (simple in-memory).
const RATE_LIMIT_MAX = Math.max(10, parseInt(process.env.RATE_LIMIT_MAX || '120', 10) || 120);
const rateBuckets = new Map(); // ip -> { count, resetAt }
// ---- P2: telemetry retention + export ----
// TELEMETRY_RETENTION_DAYS: samples older than this are pruned (0 = keep all).
const _RET_RAW = String(process.env.TELEMETRY_RETENTION_DAYS ?? '').trim();
const TELEMETRY_RETENTION_DAYS = _RET_RAW === ''
  ? 30 : Math.max(0, parseInt(_RET_RAW, 10) || 0);
// TELEMETRY_EXPORT_MAX: cap rows per /api/telemetry/export (CSV/JSON).
const TELEMETRY_EXPORT_MAX = Math.min(20000, Math.max(100, parseInt(process.env.TELEMETRY_EXPORT_MAX || '5000', 10) || 5000));

// P0: does an observed device state satisfy a queued command?
function commandSatisfiedByState(action, armed, alarming) {
  if (action === 'arm') return armed === true;
  if (action === 'disarm') return armed === false;
  if (action === 'reset_alarm') return alarming === false;
  // test / recalibrate don't change armed state: they are ACKed only via
  // their .../log events (test, recalibrating/recalibrated), never by state.
  return false;
}

// P0: mark un-ACKed sent commands as ACKed when the ESP state confirms them.
// Returns number of commands ACKed.
function ackCommandsForState(deviceId, armed, alarming) {
  const now = fmtTs(new Date());
  const rows = db.prepare(
    `SELECT id, action FROM pending_commands
     WHERE device_id = ? AND sent_at IS NOT NULL AND acked_at IS NULL`
  ).all(deviceId);
  let n = 0;
  const mark = db.prepare('UPDATE pending_commands SET acked_at = ? WHERE id = ? AND acked_at IS NULL');
  for (const r of rows) {
    if (commandSatisfiedByState(r.action, armed, alarming)) {
      mark.run(now, r.id);
      n++;
    }
  }
  return n;
}

// P0: log-event based ACK (precise for test/recalibrate/arm/disarm/reset).
function ackCommandsForLogEvent(deviceId, event) {
  const map = {
    armed: ['arm'], disarmed: ['disarm'], armed_button: ['arm'], disarmed_button: ['disarm'],
    alarm_reset: ['reset_alarm'], alarm_timeout: ['reset_alarm'],
    test: ['test'], recalibrating: ['recalibrate'], recalibrated: ['recalibrate'],
  };
  const actions = map[event];
  if (!actions || !actions.length) return 0;
  const now = fmtTs(new Date());
  let n = 0;
  const mark = db.prepare(
    `UPDATE pending_commands SET acked_at = ?
     WHERE id = ? AND acked_at IS NULL AND sent_at IS NOT NULL`
  );
  for (const a of actions) {
    const row = db.prepare(
      `SELECT id FROM pending_commands
       WHERE device_id = ? AND action = ? AND sent_at IS NOT NULL AND acked_at IS NULL
       ORDER BY id LIMIT 1`
    ).get(deviceId, a);
    if (row) { mark.run(now, row.id); n++; }
  }
  return n;
}

function commandPublicStatus(r) {
  if (r.acked_at) return 'acked';
  if ((r.attempts || 0) >= BRIDGE_MAX_RETRIES && r.sent_at) return 'failed';
  if (r.sent_at) return 'sending';
  return 'pending';
}

function handlePatchDevice(deviceId, body, res) {
  const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!dev) return sendJson(res, 404, { error: 'dispositivo não encontrado' });

  const sets = [];
  const params = [];
  if (body.status !== undefined) {
    const st = String(body.status).toUpperCase();
    if (st !== 'ONLINE' && st !== 'OFFLINE') return sendJson(res, 400, { error: 'status inválido' });
    sets.push('status = ?'); params.push(st);
  }
  if (body.armed !== undefined) {
    sets.push('armed = ?');
    params.push(body.armed == null ? null : (body.armed ? 1 : 0));
  }
  if (body.alarming !== undefined) {
    sets.push('alarming = ?'); params.push(body.alarming ? 1 : 0);
  }
  // P2: rotation visibility — a bridge informa qual user MQTT o nó usa
  // (MQTT_USERNAME). Só metadado, nunca senha.
  if (body.mqtt_user !== undefined) {
    sets.push('mqtt_user = ?');
    params.push(body.mqtt_user == null ? null : String(body.mqtt_user).slice(0, 64));
  }
  if (body.last_telemetry !== undefined) {
    sets.push('last_telemetry = ?');
    params.push(typeof body.last_telemetry === 'string' ? body.last_telemetry : JSON.stringify(body.last_telemetry));
  }
  // Every bridge touch refreshes last_seen.
  sets.push('last_seen = ?'); params.push(fmtTs(new Date()));

  if (!sets.length) return sendJson(res, 400, { error: 'nada para atualizar' });
  params.push(deviceId);
  db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  // P1: persist telemetry samples for the real chart (best-effort).
  try {
    if (body.last_telemetry !== undefined && body.last_telemetry !== null) {
      const t = typeof body.last_telemetry === 'string'
        ? JSON.parse(body.last_telemetry) : body.last_telemetry;
      insertTelemetrySample(deviceId, t);
    }
  } catch { /* telemetry is best-effort */ }
  // P0: state-based ACK — a fresh .../state confirming armed/alarming
  // resolves any sent-but-unacked commands for this device.
  try {
    if (body.armed !== undefined || body.alarming !== undefined) {
      const cur = db.prepare('SELECT armed, alarming FROM devices WHERE id = ?').get(deviceId);
      ackCommandsForState(deviceId, cur.armed === 1, cur.alarming === 1);
    }
  } catch { /* ACK is best-effort */ }
  // P1: same staleness rule as the list endpoint.
  sendJson(res, 200, toDeviceDTO(db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId)));
}

function handleQueueCommand(deviceId, body, res, req) {
  const currentActor = isOperatorAuthorized(req) && OPERATOR_TOKEN ? 'operator:token' : 'operator';
  const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!dev) return sendJson(res, 404, { error: 'dispositivo não encontrado' });
  if (!dev.mqtt_node) return sendJson(res, 400, { error: 'dispositivo sem nó MQTT (não é controlável)' });
  const action = String(body.action || '').trim();
  if (!CMD_ACTIONS.has(action)) {
    return sendJson(res, 400, { error: 'action inválida (arm, disarm, reset_alarm, test, recalibrate)' });
  }
  const now = fmtTs(new Date());
  const r = db.prepare(
    'INSERT INTO pending_commands (device_id, action, created_at) VALUES (?, ?, ?)'
  ).run(deviceId, action, now);
  const id = Number(r.lastInsertRowid);
  // P0: idempotent no-op — already in the requested state → ACK immediately
  // instead of retrying a command the ESP will (correctly) ignore.
  // Only when the state is KNOWN (armed !== null): with unknown state the
  // command must still be delivered so the ESP can report back.
  let status = 'pending';
  try {
    if (dev.armed !== null && dev.armed !== undefined &&
        commandSatisfiedByState(action, dev.armed === 1, dev.alarming === 1)) {
      db.prepare('UPDATE pending_commands SET acked_at = ? WHERE id = ?').run(now, id);
      status = 'acked';
    }
  } catch { /* ACK is best-effort */ }
  // P1: audit trail for every operator command.
  writeAudit('command:' + action, deviceId, 'cmd#' + id + ' ' + status, currentActor);
  sendJson(res, 201, { id, device_id: deviceId, action, queued: true, status });
}

// P0: dashboard polls this to render "enviando → confirmado/falhou".
function handleCommandStatus(commandId, res) {
  const r = db.prepare('SELECT * FROM pending_commands WHERE id = ?').get(commandId);
  if (!r) return sendJson(res, 404, { error: 'comando não encontrado' });
  sendJson(res, 200, {
    id: r.id, device_id: r.device_id, action: r.action,
    status: commandPublicStatus(r), attempts: r.attempts || 0,
    max_attempts: BRIDGE_MAX_RETRIES,
    created_at: r.created_at, sent_at: r.sent_at, acked_at: r.acked_at,
  });
}

// Internal: bridge fetches due commands (never-sent OR un-ACKed and due
// for retry) and claims them atomically (two bridges never double-send).
// P0: QoS-0-safe — a command lost while the ESP reconnects is re-sent
// until .../state (or .../log) ACKs it, up to BRIDGE_MAX_RETRIES.
function handleBridgeCommands(res) {
  const now = fmtTs(new Date());
  const rows = db.prepare(
    `SELECT pc.id, pc.device_id, pc.action, pc.attempts, d.mqtt_node
     FROM pending_commands pc JOIN devices d ON d.id = pc.device_id
     WHERE pc.acked_at IS NULL
       AND (pc.sent_at IS NULL
            OR (pc.attempts < ? AND (pc.last_try_at IS NULL OR pc.last_try_at <= ?)))
     ORDER BY pc.id`
  ).all(BRIDGE_MAX_RETRIES, fmtTs(new Date(Date.now() - BRIDGE_RETRY_MS)));
  if (rows.length) {
    const mark = db.prepare(
      `UPDATE pending_commands
       SET sent_at = COALESCE(sent_at, ?), last_try_at = ?, attempts = attempts + 1
       WHERE id = ? AND acked_at IS NULL`
    );
    rows.forEach((r) => mark.run(now, now, r.id));
  }
  sendJson(res, 200, rows.map((r) => ({
    id: r.id, device_id: r.device_id, action: r.action,
    mqtt_node: r.mqtt_node, attempt: (r.attempts || 0) + 1,
  })));
}

function handleStats(res) {
  const q = (sql) => db.prepare(sql).get().c;
  const today = `date(timestamp) = date('now', 'localtime')`;
  // P1: devicesOnline respeita staleness (mesma regra do GET /api/devices).
  let devicesOnline = 0;
  try {
    const devs = db.prepare('SELECT * FROM devices').all().map(toDeviceDTO);
    devicesOnline = devs.filter((d) => d.status === 'ONLINE').length;
  } catch {
    devicesOnline = q(`SELECT COUNT(*) AS c FROM devices WHERE status = 'ONLINE'`);
  }
  sendJson(res, 200, {
    totalHoje: q(`SELECT COUNT(*) AS c FROM logs WHERE ${today}`),
    capturasHoje: q(`SELECT COUNT(*) AS c FROM logs WHERE ${today} AND face_detectada = 1`),
    alertasHoje: q(`SELECT COUNT(*) AS c FROM logs WHERE ${today} AND acesso = 'Negado'`),
    devicesOnline,
    devicesTotal: q(`SELECT COUNT(*) AS c FROM devices`),
  });
}

// P1: telemetry history for the real chart (dist/pir/ldr over time).
function handleTelemetry(url, res) {
  const deviceId = (url.searchParams.get('device_id') || '').trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '120', 10) || 120, 1), 1000);
  const since = (url.searchParams.get('since') || '').trim();
  const conds = [];
  const params = [];
  if (deviceId) { conds.push('device_id = ?'); params.push(deviceId); }
  if (since) { conds.push('timestamp >= ?'); params.push(since); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT device_id, timestamp, dist, pir, ldr, ldr_anomaly
     FROM telemetry ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`
  ).all(...params, limit);
  sendJson(res, 200, rows.reverse());
}

// P1: operator audit trail (who armed/disarmed what, when).
function handleAuditList(url, res) {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500);
  const rows = db.prepare(
    `SELECT id, timestamp, actor, action, device_id, detail
     FROM audit_log ORDER BY id DESC LIMIT ?`
  ).all(limit);
  sendJson(res, 200, rows);
}

// P2: query shared by JSON + CSV export (same filters, newest-first, capped).
function queryTelemetryExport(url) {
  const deviceId = (url.searchParams.get('device_id') || '').trim();
  const since = (url.searchParams.get('since') || '').trim();
  const until = (url.searchParams.get('until') || '').trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '1000', 10) || 1000, 1), TELEMETRY_EXPORT_MAX);
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

// P2: export telemetry as CSV or JSON for analysis (retention-aware note in header).
function handleTelemetryExport(url, res) {
  const format = (url.searchParams.get('format') || 'csv').trim().toLowerCase();
  const rows = queryTelemetryExport(url);
  if (format === 'json') {
    return sendJson(res, 200, { retention_days: TELEMETRY_RETENTION_DAYS, count: rows.length, rows: rows.reverse() });
  }
  if (format !== 'csv') {
    return sendJson(res, 400, { error: 'format inválido (csv, json)' });
  }
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = ['device_id,timestamp,dist_cm,pir,ldr,ldr_anomaly'];
  for (const r of rows.reverse()) {
    lines.push([esc(r.device_id), esc(r.timestamp), esc(r.dist), esc(r.pir), esc(r.ldr), esc(r.ldr_anomaly)].join(','));
  }
  const s = lines.join('\n') + '\n';
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Content-Disposition': 'attachment; filename="elo5-telemetry.csv"',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(s);
}

// P2: rotation — atualiza o user MQTT de um nó (só metadado; a senha
// troca-se no broker via mosquitto_passwd; audita quem trocou).
function handleMqttUserRotation(deviceId, body, res, req) {
  const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!dev) return sendJson(res, 404, { error: 'dispositivo não encontrado' });
  if (body.mqtt_user === undefined) return sendJson(res, 400, { error: 'mqtt_user é obrigatório' });
  const mqttUser = body.mqtt_user == null ? '' : String(body.mqtt_user).trim();
  if (mqttUser && !/^[A-Za-z0-9._-]{1,64}$/.test(mqttUser)) {
    return sendJson(res, 400, { error: 'mqtt_user inválido (use letras, números, ponto, _ ou -)' });
  }
  db.prepare('UPDATE devices SET mqtt_user = ?, last_seen = last_seen WHERE id = ?')
    .run(mqttUser || null, deviceId);
  const actor = isOperatorAuthorized(req) && OPERATOR_TOKEN ? 'operator:token' : 'operator';
  writeAudit('mqtt-rotation', deviceId, `mqtt_user ${dev.mqtt_user || '(vazio)'} → ${mqttUser || '(vazio)'} — trocar a senha no broker (mosquitto_passwd) e no ESP (MQTT_PASSWORD)`, actor);
  sendJson(res, 200, toDeviceDTO(db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId)));
}

function isBridgeAuthorized(req) {
  return req.headers['x-bridge-key'] === (process.env.BRIDGE_KEY || 'elo5-local-bridge');
}

// ---- Static files ----
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStatic(pathname, res) {
  let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  // P1: no-cache for the dashboard shell so operator-token/ chart fixes land on refresh.
  const headers = { 'Content-Type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream' };
  if (/\.(html|js|css)$/i.test(abs)) headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(abs).pipe(res);
}

// ---- Router ----
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;

    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true, db: 'sqlite', time: fmtTs(new Date()),
        mqtt: bridgeStatus.connected ? { connected: true, at: bridgeStatus.updatedAt } : { connected: false },
        // P1: lets the dashboard adapt (show token field) without leaking the token.
        auth: { operatorRequired: !!OPERATOR_TOKEN },
        // P2: retention/export caps visible to the dashboard (no secrets).
        limits: {
          staleAfterMs: STALE_AFTER_MS, bridgeMaxRetries: BRIDGE_MAX_RETRIES,
          telemetryRetentionDays: TELEMETRY_RETENTION_DAYS,
          telemetryExportMax: TELEMETRY_EXPORT_MAX,
        },
      });
    }
    if (req.method === 'GET' && pathname === '/api/mqtt-status') {
      return sendJson(res, 200, { ...bridgeStatus });
    }
    if (req.method === 'GET' && pathname === '/api/employees') {
      return sendJson(res, 200, db.prepare('SELECT * FROM employees ORDER BY rowid').all());
    }
    if (req.method === 'GET' && pathname === '/api/devices') {
      // P1: staleness-based OFFLINE (same DB, honest status).
      return sendJson(res, 200, db.prepare('SELECT * FROM devices ORDER BY local').all().map(toDeviceDTO));
    }
    if (req.method === 'GET' && pathname === '/api/logs') return handleListLogs(url, res);
    if (req.method === 'GET' && pathname === '/api/stats') return handleStats(res);
    // P1: real telemetry history for the chart.
    if (req.method === 'GET' && pathname === '/api/telemetry') return handleTelemetry(url, res);
    // P2: telemetry export (CSV/JSON, operator-gated when auth is on).
    // P2: rotation visibility — qual user MQTT cada nó usa (sem vazar senhas).
    if (req.method === 'GET' && pathname === '/api/mqtt-users') {
      if (!requireOperator(req, res)) return;
      return sendJson(res, 200, db.prepare(
        'SELECT id, local, mqtt_node, mqtt_user, last_seen FROM devices ORDER BY local'
      ).all());
    }
    // P2: rotation — atualiza o user MQTT de um nó (só metadado; a senha
    // troca-se no broker via mosquitto_passwd; audita quem trocou).
    const mqttUserMatch = pathname.match(/^\/api\/mqtt-users\/([^/]+)$/);
    if (req.method === 'PATCH' && mqttUserMatch) {
      if (!requireOperator(req, res)) return;
      if (!requireRateLimit(req, res)) return;
      const body = await readBody(req);
      return handleMqttUserRotation(decodeURIComponent(mqttUserMatch[1]), body, res, req);
    }
    if (req.method === 'GET' && pathname === '/api/telemetry/export') {
      if (!requireOperator(req, res)) return;
      return handleTelemetryExport(url, res);
    }
    // P1: operator audit trail (requires operator when auth is enabled).
    if (req.method === 'GET' && pathname === '/api/audit') {
      if (!requireOperator(req, res)) return;
      return handleAuditList(url, res);
    }
    if (req.method === 'POST' && pathname === '/api/logs') {
      // P1: bridge (x-bridge-key) or operator may write logs; others 401 when auth is on.
      if (OPERATOR_TOKEN && !isBridgeAuthorized(req) && !isOperatorAuthorized(req)) {
        return sendJson(res, 401, { error: 'operador não autenticado (x-operator-token)' });
      }
      if (!requireRateLimit(req, res)) return;
      const body = await readBody(req);
      return handleCreateLog(body, res);
    }
    // Queue a command for an MQTT device (the bridge picks it up).
    const cmdMatch = pathname.match(/^\/api\/devices\/([^/]+)\/command$/);
    if (req.method === 'POST' && cmdMatch) {
      // P1: operator auth + rate limit on the mutating command route.
      if (!requireOperator(req, res)) return;
      if (!requireRateLimit(req, res)) return;
      const body = await readBody(req);
      return handleQueueCommand(decodeURIComponent(cmdMatch[1]), body, res, req);
    }
    // P0: poll a queued command until it is acked/failed (enviando → confirmado).
    const cmdStatusMatch = pathname.match(/^\/api\/commands\/(\d+)$/);
    if (req.method === 'GET' && cmdStatusMatch) {
      return handleCommandStatus(Number(cmdStatusMatch[1]), res);
    }
    // Internal: bridge updates device live-state (same key, see mqtt-bridge.js).
    const bridgeMatch = pathname.match(/^\/api\/_bridge\/devices\/([^/]+)$/);
    if (req.method === 'PATCH' && bridgeMatch) {
      if (!isBridgeAuthorized(req)) {
        return sendJson(res, 403, { error: 'bridge key inválida' });
      }
      const body = await readBody(req);
      return handlePatchDevice(decodeURIComponent(bridgeMatch[1]), body, res);
    }
    if (req.method === 'POST' && pathname === '/api/_bridge/heartbeat') {
      if (!isBridgeAuthorized(req)) {
        return sendJson(res, 403, { error: 'bridge key inválida' });
      }
      const { setBridgeStatus } = module.exports;
      setBridgeStatus({ connected: true });
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/_bridge/commands') {
      if (!isBridgeAuthorized(req)) {
        return sendJson(res, 403, { error: 'bridge key inválida' });
      }
      return handleBridgeCommands(res);
    }
    if (req.method === 'GET' && (pathname === '/' || !pathname.startsWith('/api'))) {
      return serveStatic(pathname, res);
    }
    return sendJson(res, 404, { error: 'rota não encontrada' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'erro interno' });
  }
});

server.listen(PORT, () => {
  console.log(`Elo5 API no ar → http://localhost:${PORT}`);
  console.log(`Banco: ${path.join(ROOT, 'elo5.db')}`);
});

// Internal API for mqtt-bridge.js (same process would share the DB lock;
// a separate process talks through these, plus PATCH /api/_bridge/devices/:id).
module.exports = {
  db, fmtTs, insertLog, toLogDTO, CMD_ACTIONS,
  setBridgeStatus(s) {
    bridgeStatus = { connected: !!s.connected, updatedAt: fmtTs(new Date()) };
  },
};
