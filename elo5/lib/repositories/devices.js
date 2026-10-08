// Elo5 — item 3 do checklist: SQL de devices isolado (espelho do server.js).
// Todo acesso a `devices` passa por aqui; o server.js ainda usa as queries
// originais — a fiação acontece depois, sem mudar nenhum SQL.

'use strict';

function getDevice(db, id) {
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
}

function listDevices(db) {
  return db.prepare('SELECT * FROM devices ORDER BY local').all();
}

function listDevicesForMqtt(db) {
  return db
    .prepare('SELECT id, local, mqtt_node, mqtt_user, last_seen FROM devices ORDER BY local')
    .all();
}

function listAllDevices(db) {
  return db.prepare('SELECT * FROM devices').all();
}

function getArmedState(db, deviceId) {
  return db.prepare('SELECT armed, alarming FROM devices WHERE id = ?').get(deviceId);
}

// Atualização genérica (montada pelo chamador, igual ao handlePatchDevice).
// sets: ['status = ?', ...], params: valores na mesma ordem.
function updateDeviceSets(db, deviceId, sets, params) {
  db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`).run(...params, deviceId);
}

function updateMqttUser(db, deviceId, mqttUser) {
  db.prepare('UPDATE devices SET mqtt_user = ?, last_seen = last_seen WHERE id = ?')
    .run(mqttUser || null, deviceId);
}

module.exports = {
  getDevice,
  listDevices,
  listDevicesForMqtt,
  listAllDevices,
  getArmedState,
  updateDeviceSets,
  updateMqttUser,
};
