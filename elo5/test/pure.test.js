// Elo5 — item 1 do checklist: trava o comportamento das regras puras.
// Zero dependências: só node:test + node:assert (rode com `! npm test`).
// Se algum teste falhar após um refator, o refator quebrou o comportamento.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  escCsvValue,
  buildTelemetryCsv,
  validateMqttUser,
  normalizeTelemetrySample,
  capExportLimit,
  toLogDTO,
  shouldPruneByAge,
} = require('../lib/pure');

describe('CSV export (esc)', () => {
  it('não escapa valor simples', () => {
    assert.equal(escCsvValue('IOT-CAM-ARMAZEMB'), 'IOT-CAM-ARMAZEMB');
    assert.equal(escCsvValue(123), '123');
  });
  it('null/undefined viram campo vazio', () => {
    assert.equal(escCsvValue(null), '');
    assert.equal(escCsvValue(undefined), '');
  });
  it('escapa vírgula, aspas e quebra de linha (RFC 4180)', () => {
    assert.equal(escCsvValue('a,b'), '"a,b"');
    assert.equal(escCsvValue('diz "oi"'), '"diz ""oi"""');
    assert.equal(escCsvValue('linha1\nlinha2'), '"linha1\nlinha2"');
  });
  it('buildTelemetryCsv gera header + linhas na ordem recebida', () => {
    const csv = buildTelemetryCsv([
      { device_id: 'A', timestamp: '2026-10-08 10:00:00', dist: 42.5, pir: 0, ldr: 1800, ldr_anomaly: 0 },
      { device_id: 'B', timestamp: '2026-10-08 10:00:02', dist: null, pir: 1, ldr: null, ldr_anomaly: 0 },
    ]);
    const lines = csv.split('\n');
    assert.equal(lines[0], 'device_id,timestamp,dist_cm,pir,ldr,ldr_anomaly');
    assert.equal(lines[1], 'A,2026-10-08 10:00:00,42.5,0,1800,0');
    assert.equal(lines[2], 'B,2026-10-08 10:00:02,,1,,0');
  });
});

describe('rotação mqtt_user (validação)', () => {
  it('aceita usuário válido e aparas espaços', () => {
    assert.deepEqual(validateMqttUser('elo5-esp-2'), { value: 'elo5-esp-2' });
    assert.deepEqual(validateMqttUser('  elo5.esp_2  '), { value: 'elo5.esp_2' });
  });
  it('ausente (undefined) é erro 400', () => {
    assert.deepEqual(validateMqttUser(undefined), { error: 'mqtt_user é obrigatório' });
  });
  it('vazio/null limpa (permitido)', () => {
    assert.deepEqual(validateMqttUser(''), { value: '' });
    assert.deepEqual(validateMqttUser(null), { value: '' });
  });
  it('rejeita traversal, espaços internos e excesso de tamanho', () => {
    assert.ok(validateMqttUser('../../etc').error);
    assert.ok(validateMqttUser('com espaço').error);
    assert.ok(validateMqttUser('a'.repeat(65)).error);
    assert.ok(validateMqttUser('com; DROP').error);
  });
});

describe('amostra de telemetria (parsing)', () => {
  it('aceita dist ou distance_cm como alias', () => {
    assert.deepEqual(normalizeTelemetrySample({ dist: 10, pir: 0 }).dist, 10);
    assert.deepEqual(normalizeTelemetrySample({ distance_cm: 20, pir: 0 }).dist, 20);
  });
  it('não-numérico vira null, pir/anomalia viram 0/1', () => {
    const s = normalizeTelemetrySample({ dist: 'abc', pir: 'x', ldr: '1800', ldr_anomaly: 0 });
    assert.deepEqual(s, { dist: null, pir: 1, ldr: 1800, ldrAnomaly: 0 });
  });
  it('amostra vazia retorna null (nada a persistir)', () => {
    assert.equal(normalizeTelemetrySample({}), null);
    assert.equal(normalizeTelemetrySample({ dist: 'xx', ldr: 'yy' }), null);
    assert.equal(normalizeTelemetrySample(null), null);
    assert.equal(normalizeTelemetrySample('lixo'), null);
  });
});

describe('limite do export (cap)', () => {
  it('default 1000, mínimo 1, teto no max', () => {
    assert.equal(capExportLimit(undefined, 5000), 1000);
    assert.equal(capExportLimit('abc', 5000), 1000);
    assert.equal(capExportLimit('-5', 5000), 1);
    assert.equal(capExportLimit('99999', 5000), 5000);
    assert.equal(capExportLimit('250', 5000), 250);
  });
});

describe('toLogDTO (origin default)', () => {
  it('origin ausente cai em manual (honestidade do badge)', () => {
    const dto = toLogDTO({
      id: '1', timestamp: 't', local: 'L', camera_status: 'Ativa',
      face_detectada: 0, confianca: null, acesso: 'Autorizado',
      device_id: 'D', origin: null, event: null, employee_id: null,
    });
    assert.equal(dto.origin, 'manual');
    assert.equal(dto.employee, null);
  });
  it('preserva esp32 e monta employee', () => {
    const dto = toLogDTO({
      id: '2', timestamp: 't', local: 'L', camera_status: 'Ativa',
      face_detectada: 1, confianca: 97.25, acesso: 'Autorizado',
      device_id: 'D', origin: 'esp32', event: 'pir',
      employee_id: 'E1', nome: 'N', cargo: 'C', depto: 'D', foto_url: 'F',
    });
    assert.equal(dto.origin, 'esp32');
    assert.equal(dto.confidence, '97.3');
    assert.deepEqual(dto.employee, { id: 'E1', name: 'N', role: 'C', dept: 'D', photo: 'F' });
  });
});

describe('retenção por idade (guarda)', () => {
  it('0 = guardar tudo (não apaga por idade)', () => {
    assert.equal(shouldPruneByAge(0), false);
    assert.equal(shouldPruneByAge(30), true);
  });
});
