// Elo5 — funções puras extraídas do server.js (comportamento idêntico).
// Motivo: travar o comportamento em teste ANTES de qualquer refator (Clean Code,
// item 1 do checklist). Nenhuma depende de DB, HTTP ou env — entrada → saída.
//
// Quando o refator avançar, o server.js passa a exigir este módulo em vez de
// duplicar a lógica. Por enquanto ele ainda tem as cópias originais; este arquivo
// é a referência testada para a extração futura.

'use strict';

// ---- CSV (espelho de handleTelemetryExport > esc) ----
function escCsvValue(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildTelemetryCsv(rows) {
  const lines = ['device_id,timestamp,dist_cm,pir,ldr,ldr_anomaly'];
  for (const r of rows) {
    lines.push(
      [
        escCsvValue(r.device_id),
        escCsvValue(r.timestamp),
        escCsvValue(r.dist),
        escCsvValue(r.pir),
        escCsvValue(r.ldr),
        escCsvValue(r.ldr_anomaly),
      ].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

// ---- Rotação MQTT (espelho de handleMqttUserRotation > validação) ----
// Retorna { value } quando válido ou { error } quando inválido.
// '' (string vazia / null) significa "limpar" — permitido; undefined = ausente.
const MQTT_USER_RE = /^[A-Za-z0-9._-]{1,64}$/;

function validateMqttUser(raw) {
  if (raw === undefined) return { error: 'mqtt_user é obrigatório' };
  const value = raw == null ? '' : String(raw).trim();
  if (value && !MQTT_USER_RE.test(value)) {
    return { error: 'mqtt_user inválido (use letras, números, ponto, _ ou -)' };
  }
  return { value };
}

// ---- Telemetria (espelho de insertTelemetrySample > parsing, sem DB) ----
function toFiniteNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Devolve null quando a amostra não tem nada aproveitável (mesma guarda do server).
function normalizeTelemetrySample(data) {
  if (!data || typeof data !== 'object') return null;
  const dist =
    data.dist !== undefined
      ? toFiniteNumberOrNull(data.dist)
      : data.distance_cm !== undefined
        ? toFiniteNumberOrNull(data.distance_cm)
        : null;
  const pir = data.pir ? 1 : 0;
  const ldr = data.ldr !== undefined ? toFiniteNumberOrNull(data.ldr) : null;
  const ldrAnomaly = data.ldr_anomaly ? 1 : 0;
  if (dist == null && ldr == null && !pir && !ldrAnomaly) return null;
  return { dist, pir, ldr, ldrAnomaly };
}

// ---- Export (espelho de queryTelemetryExport > limit) ----
function capExportLimit(raw, max) {
  const parsed = parseInt(raw || '1000', 10) || 1000;
  return Math.min(Math.max(parsed, 1), max);
}

// ---- DTO de log (espelho de toLogDTO) ----
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

// ---- Retenção (espelho de pruneTelemetry > guarda) ----
// retentionDays === 0 significa "guardar tudo" (sem DELETE por idade).
function shouldPruneByAge(retentionDays) {
  return Boolean(retentionDays);
}

module.exports = {
  escCsvValue,
  buildTelemetryCsv,
  validateMqttUser,
  normalizeTelemetrySample,
  capExportLimit,
  toLogDTO,
  shouldPruneByAge,
};
