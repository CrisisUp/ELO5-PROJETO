// Elo5 — item 2 do checklist: security headers isolados (espelho do server.js).
// Sem mudar comportamento: mesmos 3 headers em toda resposta JSON da API.

'use strict';

const API_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function jsonHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    ...API_SECURITY_HEADERS,
    ...extra,
  };
}

function isBridgeAuthorized(req, bridgeKey) {
  return req.headers['x-bridge-key'] === bridgeKey;
}

module.exports = { API_SECURITY_HEADERS, jsonHeaders, isBridgeAuthorized };
