// Elo5 — item 3 do checklist: export CSV isolado (espelho do server.js).
// Re-exporta as funções puras testadas para que rotas/services usem um só caminho.

'use strict';

const { buildTelemetryCsv, escCsvValue, capExportLimit } = require('../pure');

module.exports = { buildTelemetryCsv, escCsvValue, capExportLimit };
