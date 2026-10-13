// Elo5 — Main application bootstrap and orchestration.
// ES module, imports all feature modules.

import { api, operatorHeaders, setOperatorToken, getOperatorToken, exportTelemetry, formatTimestamp, escapeHtml } from './api.js';
import { initChart, initLdrChart, updateChartData } from './charts.js';
import { buildSimPayload, startSimulation, toggleAutoSimulation } from './sim.js';
import {
  renderLogsTable,
  buildQuery,
  loadLogs,
  loadStats,
  checkServer,
  applyOpMode,
  loadAudit,
  loadDevices,
  viewLogDetail,
  closeModal,
  openManualEventModal,
  submitManualEvent,
  createFilterLogs,
  deviceIcon,
  fmtTelemetry
} from './ui.js';

// ---- State ----
const logsStore = [];
let lastTopId = null;
let employeesCache = [];
let autoSimulationActive = false;
let simInterval = null;
let audioEnabled = false;
let audioCtx = null;
let liveChart = null;
let ldrChart = null;
let chartDeviceId = null;
const pendingCommands = new Map(); // deviceId -> {id, action, status, attempts}

// ---- DOM Element References (cached once) ----
const els = {
  // Header
  operatorTokenInput: null,
  soundIcon: null,
  opModeLabel: null,
  liveClock: null,
  serverDot: null,
  serverStatus: null,
  serverLatency: null,

  // Stats cards
  totalLogs: null,
  capturesCount: null,
  alertsCount: null,
  devicesCount: null,

  // Logs table
  searchInput: null,
  locationSelect: null,
  cameraSelect: null,
  logsTbody: null,
  emptyState: null,
  logsCounterBadge: null,

  // Audit
  auditTbody: null,
  auditBadge: null,

  // Devices
  devicesList: null,
  devicesCountLabel: null,

  // Charts
  liveChartEl: null,
  ldrChartEl: null,

  // Modals
  modalDetail: null,
  modalManual: null,

  // Simulation
  simBtn: null,
  simIndicator: null,
  simText: null,

  // Demo-only elements (hidden in real mode)
  demoOnlyElements: null,
};

function cacheDOM() {
  els.operatorTokenInput = document.getElementById('operator-token');
  els.soundIcon = document.getElementById('sound-icon');
  els.opModeLabel = document.getElementById('op-mode-label');
  els.liveClock = document.getElementById('live-clock');
  els.serverDot = document.getElementById('server-dot');
  els.serverStatus = document.getElementById('server-status');
  els.serverLatency = document.getElementById('server-latency');

  els.totalLogs = document.getElementById('metric-total-logs');
  els.capturesCount = document.getElementById('metric-captures-count');
  els.alertsCount = document.getElementById('stat-alerts-count');
  els.devicesCount = document.getElementById('stat-devices-count');

  els.searchInput = document.getElementById('input-search');
  els.locationSelect = document.getElementById('filter-location');
  els.cameraSelect = document.getElementById('filter-camera');
  els.logsTbody = document.getElementById('logs-table-body');
  els.emptyState = document.getElementById('empty-state');
  els.logsCounterBadge = document.getElementById('logs-counter-badge');

  els.auditTbody = document.getElementById('audit-table-body');
  els.auditBadge = document.getElementById('audit-counter-badge');

  els.devicesList = document.getElementById('devices-list');
  els.devicesCountLabel = document.getElementById('devices-count-label');

  els.liveChartEl = document.getElementById('liveChart');
  els.ldrChartEl = document.getElementById('ldrChart');

  els.modalDetail = document.getElementById('modal-detail');
  els.modalManual = document.getElementById('modal-manual');

  els.simBtn = document.getElementById('btn-toggle-sim');
  els.simIndicator = document.getElementById('sim-indicator');
  els.simText = document.getElementById('sim-text');

  els.demoOnlyElements = document.querySelectorAll('[data-demo-only]');
}

// ---- Audio ----
function playBeep(freq = 800, type = 'sine', duration = 0.08) {
  if (!audioEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.error(e);
  }
}

function toggleAudio() {
  audioEnabled = !audioEnabled;
  if (els.soundIcon) {
    els.soundIcon.className = audioEnabled
      ? 'fa-solid fa-volume-high text-elo-teal'
      : 'fa-solid fa-volume-xmark text-gray-500';
  }
  if (audioEnabled) playBeep(900, 'sine', 0.1);
}

// Expose globally for inline onclick handlers in HTML
window.toggleAudio = toggleAudio;
window.viewLogDetail = (id) => {
  const log = logsStore.find(l => l.id === id);
  if (log) viewLogDetail(log, modalDetailElements());
};
window.closeModal = closeModal;
window.openManualEventModal = openManualEventModal;
window.submitManualEvent = (e) => submitManualEvent(e, api, prependLog, closeModal);
window.sendDeviceCommand = (deviceId, action) => sendDeviceCommand(deviceId, action);
window.rotateMqttUser = (deviceId, currentUser) => rotateMqttUser(deviceId, currentUser);
window.exportTelemetry = (format) => exportTelemetry(format, chartDeviceId);
window.filterLogs = createFilterLogs(refreshLogs);

// ---- Helpers for modal elements (lazy) ----
function modalDetailElements() {
  return {
    modal: els.modalDetail,
    title: document.getElementById('modal-title'),
    timestamp: document.getElementById('modal-timestamp'),
    location: document.getElementById('modal-location'),
    devId: document.getElementById('modal-dev-id'),
    camBadge: document.getElementById('modal-cam-badge'),
    faceImg: document.getElementById('modal-face-img'),
    faceBox: document.getElementById('modal-face-box'),
    empName: document.getElementById('modal-emp-name'),
    empRole: document.getElementById('modal-emp-role'),
    empId: document.getElementById('modal-emp-id'),
    accessStatus: document.getElementById('modal-access-status'),
    confidenceEl: document.getElementById('modal-confidence'),
  };
}

// ---- Prepend a new log (from simulation/manual/command) ----
function prependLog(logItem) {
  logsStore.unshift(logItem);
  if (logsStore.length > 50) logsStore.pop();
  renderLogsTable(
    logsStore,
    els.logsTbody,
    els.emptyState,
    els.logsCounterBadge,
    { current: lastTopId },
    { current: audioEnabled },
    playBeep
  );
  lastTopId = logsStore[0]?.id ?? null;
  updateChartData(liveChart, ldrChart, api, chartDeviceId);
  loadStats(api, {
    totalLogs: els.totalLogs,
    capturesCount: els.capturesCount,
    alertsCount: els.alertsCount,
    devicesCount: els.devicesCount,
  });
}

// ---- Refresh functions ----
async function refreshLogs() {
  const logs = await loadLogs(api, () => buildQuery(els.searchInput, els.locationSelect, els.cameraSelect), renderLogsTable);
  logsStore.length = 0;
  logsStore.push(...logs);
  renderLogsTable(
    logsStore,
    els.logsTbody,
    els.emptyState,
    els.logsCounterBadge,
    { current: lastTopId },
    { current: audioEnabled },
    playBeep
  );
  lastTopId = logsStore[0]?.id ?? null;
}

async function refreshAll() {
  await Promise.all([
    refreshLogs(),
    loadStats(api, {
      totalLogs: els.totalLogs,
      capturesCount: els.capturesCount,
      alertsCount: els.alertsCount,
      devicesCount: els.devicesCount,
    }),
    checkServer(api, {
      dot: els.serverDot,
      label: els.serverStatus,
      latency: els.serverLatency,
      opModeLabel: els.opModeLabel,
      demoOnlyElements: Array.from(els.demoOnlyElements),
    }),
    loadAudit(api, { tbody: els.auditTbody, badge: els.auditBadge }),
  ]);
  const newChartDeviceId = await loadDevices(api, {
    listEl: els.devicesList,
    countLabel: els.devicesCountLabel,
  }, pendingCommands, sendDeviceCommand, rotateMqttUser);
  if (newChartDeviceId) chartDeviceId = newChartDeviceId;
  await updateChartData(liveChart, ldrChart, api, chartDeviceId);
}

// ---- Device Commands ----
async function pollCommandStatus(deviceId, cmdId) {
  const t0 = Date.now();
  let last = pendingCommands.get(deviceId);
  while (Date.now() - t0 < 45000) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const s = await api('/api/commands/' + cmdId);
      pendingCommands.set(deviceId, s);
      last = s;
      await loadDevices(api, {
        listEl: els.devicesList,
        countLabel: els.devicesCountLabel,
      }, pendingCommands, sendDeviceCommand, rotateMqttUser);
      if (s.status === 'acked' || s.status === 'failed') break;
    } catch (e) {
      console.error('Falha ao consultar comando:', e);
      break;
    }
  }
  const holdMs = last && last.status === 'failed' ? 10000 : 4000;
  setTimeout(() => {
    if (pendingCommands.get(deviceId)?.id === cmdId) {
      pendingCommands.delete(deviceId);
      loadDevices(api, {
        listEl: els.devicesList,
        countLabel: els.devicesCountLabel,
      }, pendingCommands, sendDeviceCommand, rotateMqttUser);
    }
  }, holdMs);
}

async function sendDeviceCommand(deviceId, action) {
  const pend = pendingCommands.get(deviceId);
  if (pend && (pend.status === 'pending' || pend.status === 'sending')) return;

  try {
    const health = await api('/api/health').catch(() => null);
    if (health && health.auth && health.auth.operatorRequired && !getOperatorToken()) {
      if (els.operatorTokenInput) {
        els.operatorTokenInput.classList.remove('hidden');
        els.operatorTokenInput.classList.add('md:block');
        els.operatorTokenInput.focus();
      }
      alert('Defina o token do operador no topo (campo "Token operador").');
      return;
    }
  } catch { /* health is best-effort */ }

  try {
    const queued = await api('/api/devices/' + encodeURIComponent(deviceId) + '/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    pendingCommands.set(deviceId, {
      id: queued.id, action: queued.action,
      status: queued.status || 'pending', attempts: 0,
    });
    await loadDevices(api, {
      listEl: els.devicesList,
      countLabel: els.devicesCountLabel,
    }, pendingCommands, sendDeviceCommand, rotateMqttUser);
    pollCommandStatus(deviceId, queued.id);
  } catch (e) {
    alert('Falha ao enviar comando: ' + e.message);
  }
}

// ---- MQTT User Rotation ----
async function rotateMqttUser(deviceId, currentUser) {
  try {
    const health = await api('/api/health').catch(() => null);
    if (health && health.auth && health.auth.operatorRequired && !getOperatorToken()) {
      if (els.operatorTokenInput) {
        els.operatorTokenInput.classList.remove('hidden');
        els.operatorTokenInput.classList.add('md:block');
        els.operatorTokenInput.focus();
      }
      alert('Defina o token do operador no topo (campo "Token operador").');
      return;
    }
  } catch { /* health is best-effort */ }

  const next = prompt(
    'Novo usuário MQTT para ' + deviceId + ' (letras, números, ponto, _ ou -).\n' +
    'Depois troque a SENHA no broker (mosquitto_passwd) e no ESP (MQTT_PASSWORD).',
    currentUser || 'elo5-esp'
  );
  if (next === null) return; // cancelou
  const mqttUser = String(next).trim();
  if (!mqttUser) { alert('Usuário vazio — nada foi alterado.'); return; }

  try {
    await api('/api/mqtt-users/' + encodeURIComponent(deviceId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mqtt_user: mqttUser })
    });
    alert('Usuário MQTT atualizado para "' + mqttUser + '".\nLembrete: troque a senha no broker + ESP, senão o nó perde a conexão.');
    await loadDevices(api, {
      listEl: els.devicesList,
      countLabel: els.devicesCountLabel,
    }, pendingCommands, sendDeviceCommand, rotateMqttUser);
    await loadAudit(api, { tbody: els.auditTbody, badge: els.auditBadge });
  } catch (e) {
    alert('Falha na rotação: ' + e.message);
  }
}

// ---- Simulation toggle (uses sim.js) ----
function handleToggleSimulation() {
  const ref = {
    current: autoSimulationActive,
    employeesCache,
    intervalId: simInterval,
  };
  toggleAutoSimulation(
    els.simBtn,
    els.simIndicator,
    els.simText,
    ref,
    () => startSimulation(api, prependLog, ref)
  );
  autoSimulationActive = ref.current;
  simInterval = ref.intervalId;
}

// ---- Live Clock ----
function updateClock() {
  if (els.liveClock) {
    els.liveClock.innerText = formatTimestamp(new Date()) + ' UTC-3';
  }
}
setInterval(updateClock, 1000);
updateClock();

// ---- Bootstrap ----
window.onload = async function() {
  cacheDOM();

  // Operator token input
  if (els.operatorTokenInput) {
    els.operatorTokenInput.value = getOperatorToken() || '';
    els.operatorTokenInput.addEventListener('change', () => {
      setOperatorToken(els.operatorTokenInput.value);
    });
    try {
      const health = await api('/api/health').catch(() => null);
      if (health && health.auth && health.auth.operatorRequired) {
        els.operatorTokenInput.classList.remove('hidden');
        els.operatorTokenInput.classList.add('md:block');
      }
    } catch (e) { console.error(e); }
  }

  // Sound toggle
  const soundBtn = document.getElementById('btn-sound-toggle');
  if (soundBtn) soundBtn.onclick = toggleAudio;

  // Simulation toggle
  if (els.simBtn) els.simBtn.onclick = handleToggleSimulation;

  // Init charts
  liveChart = initChart();
  ldrChart = initLdrChart();

  // Load employees (for manual event modal select)
  try {
    employeesCache = await api('/api/employees');
    // Keep legacy EMPLOYEES array in sync for manual-event modal
    if (employeesCache.length) {
      window.EMPLOYEES = employeesCache.map((e) => ({
        id: e.id, name: e.nome, role: e.cargo, dept: e.depto, photo: e.foto_url
      }));
    }
  } catch (e) {
    console.error('API offline — abra via http://localhost:3000 (node server.js):', e);
  }

  // Initial load
  await refreshAll();

  // Start simulation armed but idle (toggle controls it)
  const ref = {
    current: autoSimulationActive,
    employeesCache,
    intervalId: simInterval,
  };
  simInterval = startSimulation(api, prependLog, ref);

  // Polling intervals
  setInterval(refreshLogs, 5000);
  setInterval(() => loadStats(api, {
    totalLogs: els.totalLogs,
    capturesCount: els.capturesCount,
    alertsCount: els.alertsCount,
    devicesCount: els.devicesCount,
  }), 10000);
  setInterval(() => checkServer(api, {
    dot: els.serverDot,
    label: els.serverStatus,
    latency: els.serverLatency,
    opModeLabel: els.opModeLabel,
    demoOnlyElements: Array.from(els.demoOnlyElements),
  }), 15000);
  setInterval(() => loadDevices(api, {
    listEl: els.devicesList,
    countLabel: els.devicesCountLabel,
  }, pendingCommands, sendDeviceCommand, rotateMqttUser).then(id => { if (id) chartDeviceId = id; }), 5000);
  setInterval(() => updateChartData(liveChart, ldrChart, api, chartDeviceId), 10000);
  setInterval(() => loadAudit(api, { tbody: els.auditTbody, badge: els.auditBadge }), 15000);
};