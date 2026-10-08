// Elo5 — item 3 do checklist: regra P1 de staleness isolada (espelho do server.js).
// Um dispositivo sem toque da bridge há mais de STALE_AFTER_MS aparece OFFLINE,
// mesmo que a linha ainda diga ONLINE (sobrevive a restarts).

'use strict';

function parseTs(s) {
  // fmtTs produces "YYYY-MM-DD HH:MM:SS" in local time.
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function toDeviceDTO(r, staleAfterMs) {
  if (!r) return r;
  const out = { ...r };
  try {
    const age = Date.now() - parseTs(r.last_seen);
    if (Number.isFinite(age) && age > staleAfterMs) out.status = 'OFFLINE';
  } catch { /* keep stored status */ }
  return out;
}

module.exports = { parseTs, toDeviceDTO };
