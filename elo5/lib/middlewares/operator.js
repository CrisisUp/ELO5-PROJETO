// Elo5 — item 2 do checklist: auth do operador isolada (espelho do server.js).
// Por enquanto o server.js ainda usa as funções originais; este módulo é a
// referência para a fiação futura — sem mudar comportamento.

'use strict';

function getOperatorToken(req) {
  const h = String(req.headers['x-operator-token'] || '').trim();
  if (h) return h;
  const auth = String(req.headers['authorization'] || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

// When OPERATOR_TOKEN is empty the API stays in open local mode (P0 behavior).
function isOperatorAuthorized(req, operatorToken) {
  if (!operatorToken) return true;
  const tok = getOperatorToken(req);
  return tok.length > 0 && tok === operatorToken;
}

function requireOperator(req, res, operatorToken, sendJson) {
  if (isOperatorAuthorized(req, operatorToken)) return true;
  sendJson(res, 401, { error: 'operador não autenticado (x-operator-token)' });
  return false;
}

function currentActor(req, operatorToken) {
  return isOperatorAuthorized(req, operatorToken) && operatorToken ? 'operator:token' : 'operator';
}

module.exports = { getOperatorToken, isOperatorAuthorized, requireOperator, currentActor };
