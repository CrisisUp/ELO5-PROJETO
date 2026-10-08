// Elo5 — item 2 do checklist: todo `process.env` parseado num lugar só.
// Espelho fiel do server.js (mesmas expressões, mesmos defaults). Por enquanto o
// server.js ainda usa as consts originais; este módulo é a referência testada
// para a extração futura — a fiação acontece depois, sem mudar nenhum valor.

'use strict';

// Parseia a partir de um objeto env (default: process.env) para ser testável.
function parseConfig(env = process.env) {
  // TELEMETRY_RETENTION_DAYS: '' (não setado) = 30; '0' = guardar tudo.
  const retRaw = String(env.TELEMETRY_RETENTION_DAYS ?? '').trim();
  return {
    PORT: env.PORT || 3000,
    OPERATOR_TOKEN: String(env.OPERATOR_TOKEN || '').trim(),
    STALE_AFTER_MS: Math.max(15000, parseInt(env.STALE_AFTER_MS || '90000', 10) || 90000),
    RATE_LIMIT_MAX: Math.max(10, parseInt(env.RATE_LIMIT_MAX || '120', 10) || 120),
    TELEMETRY_RETENTION_DAYS: retRaw === '' ? 30 : Math.max(0, parseInt(retRaw, 10) || 0),
    TELEMETRY_EXPORT_MAX: Math.min(
      20000, Math.max(100, parseInt(env.TELEMETRY_EXPORT_MAX || '5000', 10) || 5000)),
    BRIDGE_MAX_RETRIES: Math.max(1, parseInt(env.BRIDGE_MAX_RETRIES || '5', 10) || 5),
    BRIDGE_RETRY_MS: Math.max(1000, parseInt(env.BRIDGE_RETRY_MS || '5000', 10) || 5000),
    BRIDGE_KEY: env.BRIDGE_KEY || 'elo5-local-bridge',
    CMD_ACTIONS: new Set(['arm', 'disarm', 'reset_alarm', 'test', 'recalibrate']),
  };
}

const config = parseConfig(process.env);

module.exports = config;
module.exports.parseConfig = parseConfig;
