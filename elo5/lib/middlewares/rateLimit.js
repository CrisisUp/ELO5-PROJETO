// Elo5 — item 2 do checklist: rate limit isolado (espelho do server.js).
// Simple fixed-window, in-memory, per IP. Sem mudar comportamento.

'use strict';

function getClientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'local';
}

// buckets: Map ip -> { count, resetAt }. Passado por parâmetro para ser testável;
// o server.js original usa o Map global `rateBuckets`.
function checkRateLimit(req, buckets, rateLimitMax) {
  const ip = getClientIp(req);
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + 60000 };
    buckets.set(ip, b);
  }
  b.count++;
  if (buckets.size > 1000) {
    // Evict expired buckets opportunistically to bound memory.
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }
  return b.count <= rateLimitMax;
}

function createRateLimiter(rateLimitMax) {
  const buckets = new Map();
  return {
    buckets,
    check(req) { return checkRateLimit(req, buckets, rateLimitMax); },
    require(req, res, sendJson) {
      if (this.check(req)) return true;
      sendJson(res, 429, { error: 'muitas requisições — tente de novo em instantes' });
      return false;
    },
  };
}

module.exports = { getClientIp, checkRateLimit, createRateLimiter };
