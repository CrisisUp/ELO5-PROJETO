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

const config = require('./lib/config');
const {
  isOperatorAuthorized: isOperatorAuthorizedWith,
  currentActor: currentActorWith,
} = require('./lib/middlewares/operator');
const { createRateLimiter, getClientIp: getClientIpLib, checkRateLimit: checkRateLimitLib } = require('./lib/middlewares/rateLimit');
const { API_SECURITY_HEADERS, isBridgeAuthorized: isBridgeAuthorizedWith } = require('./lib/middlewares/security');
const {
  buildTelemetryCsv: buildTelemetryCsvLib,
  validateMqttUser: validateMqttUserLib,
  normalizeTelemetrySample: normalizeTelemetrySampleLib,
  capExportLimit: capExportLimitLib,
} = require('./lib/pure');
// Item 3: repositories (SQL por tabela) + services (regra sem SQL inline).
const devicesRepo = require('./lib/repositories/devices');
const logsRepo = require('./lib/repositories/logs');
const telemetryRepo = require('./lib/repositories/telemetry');
const commandsRepo = require('./lib/repositories/commands');
const auditRepo = require('./lib/repositories/audit');
const ackTracker = require('./lib/services/ackTracker');
const staleness = require('./lib/services/staleness');
const retention = require('./lib/services/retention');

const PORT = config.PORT;
const OPERATOR_TOKEN = config.OPERATOR_TOKEN;
const STALE_AFTER_MS = config.STALE_AFTER_MS;
const RATE_LIMIT_MAX = config.RATE_LIMIT_MAX;
const TELEMETRY_RETENTION_DAYS = config.TELEMETRY_RETENTION_DAYS;
const TELEMETRY_EXPORT_MAX = config.TELEMETRY_EXPORT_MAX;
const BRIDGE_MAX_RETRIES = config.BRIDGE_MAX_RETRIES;
const BRIDGE_RETRY_MS = config.BRIDGE_RETRY_MS;
const CMD_ACTIONS = config.CMD_ACTIONS;
const rateLimiter = createRateLimiter(RATE_LIMIT_MAX);
const rateBuckets = rateLimiter.buckets;
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

// ---- Shared utilities (kept in server.js for mqtt-bridge.js compatibility) ----
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
    // P1 hardening: minimal security headers on every API response (fiado em lib/).
    ...API_SECURITY_HEADERS,
  });
  res.end(s);
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

// ---- P1: hardening + operator auth + staleness helpers (fiado em lib/) ----
function getClientIp(req) {
  return getClientIpLib(req);
}

// Simple fixed-window rate limit for mutating routes (in-memory, per IP).
// Returns true when allowed, false when the caller should answer 429.
function checkRateLimit(req) {
  return checkRateLimitLib(req, rateBuckets, RATE_LIMIT_MAX);
}

// When OPERATOR_TOKEN is empty the API stays in open local mode (P0 behavior).
function isOperatorAuthorized(req) {
  return isOperatorAuthorizedWith(req, OPERATOR_TOKEN);
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
  auditRepo.writeAudit(db, fmtTs, { action, deviceId, detail, actor });
}

// P1 staleness: a device whose last_seen is older than STALE_AFTER_MS is
// reported OFFLINE even if the DB row still says ONLINE (survives restarts).
function parseTs(s) { return staleness.parseTs(s); }
function toDeviceDTO(r) { return staleness.toDeviceDTO(r, STALE_AFTER_MS); }

// P2: prune telemetry older than TELEMETRY_RETENTION_DAYS (best-effort, runs on sample insert).
function pruneTelemetry() { retention.pruneTelemetry(db, TELEMETRY_RETENTION_DAYS); }

// P1: persist one telemetry sample (best-effort; keeps last_telemetry working as before).
function insertTelemetrySample(deviceId, data) {
  retention.persistSample(db, fmtTs, TELEMETRY_RETENTION_DAYS, deviceId, data);
}

// ---- Phase 2: device live-state + command queue (used by mqtt-bridge.js) ----
let bridgeStatus = { connected: false, updatedAt: null };

// P0: does an observed device state satisfy a queued command? (fiado em lib/services/ackTracker.js)
function commandSatisfiedByState(action, armed, alarming) {
  return ackTracker.commandSatisfiedByState(action, armed, alarming);
}

// P0: mark un-ACKed sent commands as ACKed when the ESP state confirms them.
// Returns number of commands ACKed.
function ackCommandsForState(deviceId, armed, alarming) {
  return ackTracker.ackCommandsForState(db, fmtTs, deviceId, armed, alarming);
}

// P0: log-event based ACK (precise for test/recalibrate/arm/disarm/reset).
function ackCommandsForLogEvent(deviceId, event) {
  return ackTracker.ackCommandsForLogEvent(db, fmtTs, deviceId, event);
}

function commandPublicStatus(r) {
  return ackTracker.commandPublicStatusWithRetries(r, BRIDGE_MAX_RETRIES);
}

// ---- Build dependencies object for router ----
const deps = {
  db,
  config,
  fmtTs,
  toLogDTO,
  toDeviceDTO,
  sendJson,
  readBody,
  writeAudit,
  bridgeStatus,
  setBridgeStatus(s) {
    bridgeStatus = { connected: !!s.connected, updatedAt: fmtTs(new Date()) };
  },
  // repos
  devicesRepo,
  logsRepo,
  telemetryRepo,
  commandsRepo,
  auditRepo,
  // services
  ackTracker,
  staleness,
  retention,
  // pure libs
  buildTelemetryCsvLib,
  validateMqttUserLib,
  capExportLimitLib,
  normalizeTelemetrySampleLib,
  // middlewares
  isOperatorAuthorized: isOperatorAuthorizedWith,
  currentActor: currentActorWith,
  createRateLimiter,
  getClientIp: getClientIpLib,
  checkRateLimit: checkRateLimitLib,
  API_SECURITY_HEADERS,
  isBridgeAuthorized: isBridgeAuthorizedWith,
  // constants
  PORT,
  OPERATOR_TOKEN,
  STALE_AFTER_MS,
  RATE_LIMIT_MAX,
  TELEMETRY_RETENTION_DAYS,
  TELEMETRY_EXPORT_MAX,
  BRIDGE_MAX_RETRIES,
  BRIDGE_RETRY_MS,
  CMD_ACTIONS,
  rateBuckets,
  ROOT,
};

// ---- Create modular router ----
const { createRouter } = require('./lib/router');
const handleRequest = createRouter(deps);

// ---- HTTP Server ----
const server = http.createServer(handleRequest);

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