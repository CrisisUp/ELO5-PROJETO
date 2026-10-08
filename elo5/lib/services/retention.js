// Elo5 — item 3 do checklist: retenção de telemetria isolada (espelho do server.js).
// retentionDays === 0 significa "guardar tudo" (sem DELETE por idade).
// Na migração TimescaleDB, o pruneByAge vira retention policy — a interface fica.

'use strict';

const telemetryRepo = require('../repositories/telemetry');

function shouldPruneByAge(retentionDays) {
  return Boolean(retentionDays);
}

function pruneTelemetry(db, retentionDays) {
  if (!shouldPruneByAge(retentionDays)) return;
  try {
    telemetryRepo.pruneByAge(db, retentionDays);
  } catch { /* prune is best-effort */ }
}

function persistSample(db, fmtTs, retentionDays, deviceId, sample) {
  telemetryRepo.insertSample(db, {
    deviceId: String(deviceId),
    timestamp: fmtTs(new Date()),
    dist: sample.dist,
    pir: sample.pir,
    ldr: sample.ldr,
    ldrAnomaly: sample.ldrAnomaly,
  });
  try {
    telemetryRepo.prunePerDevice(db, deviceId);
  } catch { /* prune is best-effort */ }
  pruneTelemetry(db, retentionDays);
}

module.exports = { shouldPruneByAge, pruneTelemetry, persistSample };
