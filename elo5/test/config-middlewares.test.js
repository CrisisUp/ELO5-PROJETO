// Elo5 — item 2 do checklist: trava config + middlewares extraídos.
// Rode com `! npm test` (a partir de elo5/).

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseConfig } = require('../lib/config');
const {
  getOperatorToken, isOperatorAuthorized, currentActor,
} = require('../lib/middlewares/operator');
const { getClientIp, checkRateLimit, createRateLimiter } = require('../lib/middlewares/rateLimit');
const { API_SECURITY_HEADERS, isBridgeAuthorized } = require('../lib/middlewares/security');

const fakeReq = (headers = {}, ip = '1.2.3.4') => ({ headers, socket: { remoteAddress: ip } });

describe('config (parseConfig)', () => {
  it('defaults preservam bancada aberta (P0/P1)', () => {
    const c = parseConfig({});
    assert.equal(c.PORT, 3000);
    assert.equal(c.OPERATOR_TOKEN, '');
    assert.equal(c.STALE_AFTER_MS, 90000);
    assert.equal(c.RATE_LIMIT_MAX, 120);
    assert.equal(c.TELEMETRY_RETENTION_DAYS, 30);
    assert.equal(c.TELEMETRY_EXPORT_MAX, 5000);
    assert.equal(c.BRIDGE_MAX_RETRIES, 5);
    assert.equal(c.BRIDGE_RETRY_MS, 5000);
    assert.equal(c.BRIDGE_KEY, 'elo5-local-bridge');
  });
  it('env sobrescreve com pisos/tetos idênticos ao server.js', () => {
    const c = parseConfig({
      STALE_AFTER_MS: '1000', // piso 15000
      RATE_LIMIT_MAX: '1', // piso 10
      TELEMETRY_RETENTION_DAYS: '0', // 0 = guardar tudo
      TELEMETRY_EXPORT_MAX: '99999', // teto 20000
      BRIDGE_MAX_RETRIES: '-2', // piso 1 (nota: '0' cai no default 5, igual ao server.js)
    });
    assert.equal(c.STALE_AFTER_MS, 15000);
    assert.equal(c.RATE_LIMIT_MAX, 10);
    assert.equal(c.TELEMETRY_RETENTION_DAYS, 0);
    assert.equal(c.TELEMETRY_EXPORT_MAX, 20000);
    assert.equal(c.BRIDGE_MAX_RETRIES, 1);
  });
  it("'0' no BRIDGE_MAX_RETRIES cai no default 5 (igual ao server.js)", () => {
    assert.equal(parseConfig({ BRIDGE_MAX_RETRIES: '0' }).BRIDGE_MAX_RETRIES, 5);
  });
  it('TELEMETRY_RETENTION_DAYS ausente = 30', () => {
    assert.equal(parseConfig({}).TELEMETRY_RETENTION_DAYS, 30);
    assert.equal(parseConfig({ TELEMETRY_RETENTION_DAYS: '45' }).TELEMETRY_RETENTION_DAYS, 45);
  });
  it('CMD_ACTIONS contém as 5 ações P0', () => {
    const c = parseConfig({});
    for (const a of ['arm', 'disarm', 'reset_alarm', 'test', 'recalibrate']) {
      assert.ok(c.CMD_ACTIONS.has(a), a);
    }
  });
});

describe('operator auth', () => {
  it('sem token configurado = modo local aberto', () => {
    assert.equal(isOperatorAuthorized(fakeReq(), ''), true);
  });
  it('com token: aceita header e Bearer, rejeita errado/ausente', () => {
    assert.equal(
      isOperatorAuthorized(fakeReq({ 'x-operator-token': 'segredo' }), 'segredo'), true);
    assert.equal(
      isOperatorAuthorized(fakeReq({ authorization: 'Bearer segredo' }), 'segredo'), true);
    assert.equal(isOperatorAuthorized(fakeReq(), 'segredo'), false);
    assert.equal(
      isOperatorAuthorized(fakeReq({ 'x-operator-token': 'outro' }), 'segredo'), false);
  });
  it('getOperatorToken prefere x-operator-token, apara espaços', () => {
    assert.equal(
      getOperatorToken(fakeReq({ 'x-operator-token': '  a  ', authorization: 'Bearer b' })), 'a');
    assert.equal(getOperatorToken(fakeReq({ authorization: 'Bearer   b  ' })), 'b');
    assert.equal(getOperatorToken(fakeReq()), '');
  });
  it('currentActor distingue token de operador genérico', () => {
    assert.equal(currentActor(fakeReq({ 'x-operator-token': 's' }), 's'), 'operator:token');
    assert.equal(currentActor(fakeReq(), ''), 'operator');
  });
});

describe('rate limit', () => {
  it('getClientIp prefere x-forwarded-for', () => {
    assert.equal(
      getClientIp(fakeReq({ 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }, '2.2.2.2')), '9.9.9.9');
    assert.equal(getClientIp(fakeReq({}, '2.2.2.2')), '2.2.2.2');
  });
  it('bloqueia após o limite e isola por IP', () => {
    const buckets = new Map();
    for (let i = 0; i < 3; i++) assert.equal(checkRateLimit(fakeReq(), buckets, 3), true);
    assert.equal(checkRateLimit(fakeReq(), buckets, 3), false);
    assert.equal(checkRateLimit(fakeReq({}, '9.9.9.9'), buckets, 3), true);
  });
  it('createRateLimiter zera ao trocar de janela (resetAt no passado)', () => {
    const rl = createRateLimiter(1);
    assert.equal(rl.check(fakeReq()), true);
    assert.equal(rl.check(fakeReq()), false);
    rl.buckets.get('1.2.3.4').resetAt = Date.now() - 1;
    assert.equal(rl.check(fakeReq()), true);
  });
});

describe('security', () => {
  it('headers mínimos presentes', () => {
    assert.deepEqual(API_SECURITY_HEADERS, {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
  });
  it('bridge auth compara x-bridge-key', () => {
    assert.equal(isBridgeAuthorized(fakeReq({ 'x-bridge-key': 'k' }), 'k'), true);
    assert.equal(isBridgeAuthorized(fakeReq({}), 'k'), false);
  });
});
