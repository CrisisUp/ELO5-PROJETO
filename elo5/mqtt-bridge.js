// Elo5 System — Fase 2: ponte MQTT (HiveMQ → API → SQLite)
// Assina os tópicos do ESP32, grava alarmes como logs (origin='esp32'),
// atualiza o estado vivo dos dispositivos e entrega comandos (armar/desarmar).
//
// Uso:
//   npm install          (instala a lib `mqtt`)
//   node server.js       (terminal 1 — a API precisa estar no ar)
//   node mqtt-bridge.js  (terminal 2 — esta ponte)
//
// Env (opcional):
//   MQTT_URL=mqtt://broker.hivemq.com:1883  API_BASE=http://localhost:3000
//   MQTT_ROOT=elo5  BRIDGE_KEY=elo5-local-bridge
// P1 — broker próprio com TLS/auth (ex.: Mosquitto local):
//   MQTT_URL=mqtts://seu-broker:8883  MQTT_USERNAME=elo5-bridge
//   MQTT_PASSWORD=...  MQTT_CA_FILE=/caminho/ca.crt  (TLS com CA própria)
//   Sem MQTT_USERNAME o bridge conecta anônimo (comportamento P0, HiveMQ público).

const mqtt = require('mqtt');
const fs = require('node:fs');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const MQTT_URL = process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883';
const TOPIC_ROOT = process.env.MQTT_ROOT || 'elo5';
const BRIDGE_KEY = process.env.BRIDGE_KEY || 'elo5-local-bridge';
// P1: credenciais do broker (vazias = anônimo, como no HiveMQ público).
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const MQTT_CA_FILE = process.env.MQTT_CA_FILE || '';

function buildMqttOptions() {
  const opts = {
    clientId: `elo5-bridge-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 3000,
    keepalive: 30,
  };
  if (MQTT_USERNAME) {
    opts.username = MQTT_USERNAME;
    if (MQTT_PASSWORD) opts.password = MQTT_PASSWORD;
  }
  if (MQTT_CA_FILE) {
    try {
      opts.ca = fs.readFileSync(MQTT_CA_FILE);
      opts.rejectUnauthorized = true;
    } catch (e) {
      console.error(`[bridge] MQTT_CA_FILE ilegível (${MQTT_CA_FILE}):`, e.message);
      process.exit(1);
    }
  }
  return opts;
}

const headers = { 'Content-Type': 'application/json', 'x-bridge-key': BRIDGE_KEY };

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${opts.method || 'GET'} ${path} → ${err.error || res.status}`);
  }
  return res.json();
}

// ---- Device map: mqtt_node → device row ----
let devicesByNode = new Map();

async function refreshDevices() {
  const devs = await api('/api/devices');
  devicesByNode = new Map(devs.filter((d) => d.mqtt_node).map((d) => [d.mqtt_node, d]));
  console.log(`[bridge] ${devicesByNode.size} nó(s) MQTT mapeado(s): ${[...devicesByNode.keys()].join(', ') || 'nenhum'}`);
}

async function resolveDevice(node) {
  let dev = devicesByNode.get(node);
  if (!dev) {
    await refreshDevices(); // maybe it was just added
    dev = devicesByNode.get(node);
  }
  return dev || null;
}

function patchDevice(id, body) {
  return api(`/api/_bridge/devices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }).catch((e) => console.error(`[bridge] patch ${id} falhou:`, e.message));
}

function createLog(payload) {
  return api('/api/logs', { method: 'POST', body: JSON.stringify(payload) });
}

// ---- Handlers per topic ----
const ALARM_LABELS = { pir: 'Presença (PIR)', proximity: 'Proximidade (HC-SR04)', ldr: 'Luminosidade (LDR)' };

async function handleAlarm(node, data) {
  const dev = await resolveDevice(node);
  if (!dev) return console.warn(`[bridge] alarme de nó desconhecido: ${node}`);
  const label = ALARM_LABELS[data.type] || String(data.type || 'desconhecido');
  console.log(`[bridge] 🚨 ALARME ${dev.local} — ${label} (valor=${data.value})`);
  try {
    await createLog({
      location: dev.local,
      cameraStatus: 'Desativada', // ESP32 sensorial: sem câmera neste nó
      employeeId: null,
      acesso: 'Negado',
      confianca: null,
      deviceId: dev.id,
      origin: 'esp32',
    });
  } catch (e) {
    console.error('[bridge] INSERT alarme falhou:', e.message);
  }
  await patchDevice(dev.id, { status: 'ONLINE', alarming: true });
}

async function handleState(node, data) {
  const dev = await resolveDevice(node);
  if (!dev) return;
  const armed = data.armed === true || data.armed === 1;
  const alarming = data.alarm === true || data.alarm === 1;
  console.log(`[bridge] estado ${dev.local}: armed=${armed} alarming=${alarming}`);
  // P2: rotation visibility — registra qual user MQTT está ativo (só metadado).
  const patch = { status: 'ONLINE', armed, alarming };
  if (MQTT_USERNAME && dev.mqtt_user !== MQTT_USERNAME) patch.mqtt_user = MQTT_USERNAME;
  await patchDevice(dev.id, patch);
}

// Eventos de auditoria vindos do tópico .../log.
// (alarm_pir/proximity/ldr são ignorados aqui — o tópico .../alarm já gerou o log.)
const SKIP_LOG_EVENTS = new Set(['alarm_pir', 'alarm_proximity', 'alarm_ldr']);

async function handleLogEvent(node, data) {
  const dev = await resolveDevice(node);
  if (!dev) return;
  const event = String(data.event || '');
  if (!event || SKIP_LOG_EVENTS.has(event)) return;
  console.log(`[bridge] evento ${dev.local}: ${event}`);
  try {
    await createLog({
      location: dev.local,
      cameraStatus: 'Desativada',
      employeeId: null,
      acesso: 'Autorizado',
      confianca: null,
      deviceId: dev.id,
      origin: 'esp32',
      event, // P0: a API usa o nome do evento para dar ACK no comando (test, armed, ...)
    });
  } catch (e) {
    console.error('[bridge] INSERT evento falhou:', e.message);
  }
  // Eventos que encerram o alarme limpam o flag no painel.
  if (event === 'alarm_reset' || event === 'alarm_timeout' || event === 'disarmed' || event === 'disarmed_button') {
    await patchDevice(dev.id, { alarming: false });
  }
}

async function handleSensors(node, data) {
  const dev = await resolveDevice(node);
  if (!dev) return;
  await patchDevice(dev.id, { status: 'ONLINE', last_telemetry: data });
}

async function handleStatus(node, text) {
  const dev = await resolveDevice(node);
  if (!dev) return;
  const online = text === 'online';
  console.log(`[bridge] ${dev.local} → ${online ? 'ONLINE' : 'OFFLINE'}`);
  // P2: rotation visibility também no LWT (antes mesmo do primeiro .../state).
  const patch = { status: online ? 'ONLINE' : 'OFFLINE' };
  if (online && MQTT_USERNAME && dev.mqtt_user !== MQTT_USERNAME) patch.mqtt_user = MQTT_USERNAME;
  await patchDevice(dev.id, patch);
}

function route(topic, raw) {
  // topic: elo5/<node>/<kind>
  const parts = topic.split('/');
  if (parts.length < 3) return;
  const node = parts[1];
  const kind = parts.slice(2).join('/');
  const text = raw.toString().trim();

  if (kind === 'status') return handleStatus(node, text);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return console.warn(`[bridge] JSON inválido em ${topic}: ${text.slice(0, 80)}`);
  }
  if (kind === 'alarm') return handleAlarm(node, data);
  if (kind === 'state') return handleState(node, data);
  if (kind === 'log') return handleLogEvent(node, data);
  if (kind === 'sensors') return handleSensors(node, data);
}

// ---- Command delivery: site → fila → ESP32 (P0: com retry até ACK) ----
async function pumpCommands(client) {
  try {
    const cmds = await api('/api/_bridge/commands');
    for (const c of cmds) {
      const topic = `${TOPIC_ROOT}/${c.mqtt_node}/cmd`;
      client.publish(topic, JSON.stringify({ action: c.action }));
      // P0: attempt N>1 significa que o ESP não confirmou (.../state ou .../log)
      // a tempo — provavelmente estava reconectando quando o QoS 0 foi perdido.
      const retry = c.attempt && c.attempt > 1 ? ` (tentativa ${c.attempt})` : '';
      console.log(`[bridge] ➜ comando ${c.action} → ${topic}${retry}`);
    }
  } catch (e) {
    console.error('[bridge] pump commands falhou:', e.message);
  }
}

async function heartbeat() {
  try {
    await api('/api/_bridge/heartbeat', { method: 'POST', body: '{}' });
  } catch (e) {
    console.error('[bridge] heartbeat falhou (API fora do ar?):', e.message);
  }
}

// ---- Main ----
async function main() {
  try {
    await refreshDevices();
  } catch (e) {
    console.error('[bridge] API fora do ar? Suba com `node server.js` primeiro.', e.message);
    process.exit(1);
  }

  const client = mqtt.connect(MQTT_URL, buildMqttOptions());

  client.on('connect', () => {
    console.log(`[bridge] conectado ao broker ${MQTT_URL}`);
    client.subscribe(`${TOPIC_ROOT}/#`, (err) => {
      if (err) console.error('[bridge] subscribe falhou:', err.message);
      else console.log(`[bridge] assinando ${TOPIC_ROOT}/#`);
    });
    heartbeat();
  });

  client.on('message', (topic, payload) => {
    try {
      route(topic, payload);
    } catch (e) {
      console.error(`[bridge] erro ao rotear ${topic}:`, e.message);
    }
  });

  client.on('error', (e) => console.error('[bridge] MQTT erro:', e.message));
  client.on('reconnect', () => console.log('[bridge] reconectando ao broker…'));

  setInterval(() => pumpCommands(client), 2000);
  setInterval(heartbeat, 15000);
  setInterval(refreshDevices, 60000);
}

main();
