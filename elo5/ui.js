// Elo5 — UI rendering: logs table, devices panel, audit, modals, filters.
// ES module, no external deps. All functions receive DOM elements as params.

import { escapeHtml, formatTimestamp } from './api.js';

/** Device icon mapping */
const DEVICE_ICONS = [
  { match: /portaria|gate/i, icon: 'fa-door-open', color: 'text-elo-teal' },
  { match: /armaz/i, icon: 'fa-warehouse', color: 'text-blue-400' },
  { match: /lab|p&d/i, icon: 'fa-vial-virus', color: 'text-amber-400' },
  { match: /diretoria/i, icon: 'fa-building', color: 'text-purple-400' },
];

export function deviceIcon(local) {
  for (const d of DEVICE_ICONS) {
    if (d.match.test(local)) return d;
  }
  return { icon: 'fa-microchip', color: 'text-gray-400' };
}

/** Format last_telemetry JSON for device list */
export function fmtTelemetry(dev) {
  if (!dev.last_telemetry) return '';
  try {
    const t = JSON.parse(dev.last_telemetry);
    const parts = [];
    if (t.dist !== undefined && t.dist < 900) parts.push('Dist ' + t.dist + 'cm');
    if (t.pir) parts.push('PIR ativo');
    if (t.ldr !== undefined) parts.push('LDR ' + t.ldr);
    if (t.ldr_anomaly) parts.push('⚠ luz');
    return parts.length ? parts.join(' · ') : '';
  } catch { return ''; }
}

/** Render logs table from logsStore */
export function renderLogsTable(logsStore, tbodyEl, emptyStateEl, counterBadgeEl, lastTopIdRef, audioEnabledRef, playBeepFn) {
  const filtered = logsStore;

  if (counterBadgeEl) {
    counterBadgeEl.innerText = `${filtered.length} registros`;
  }

  if (filtered.length === 0) {
    tbodyEl.innerHTML = '';
    if (emptyStateEl) emptyStateEl.classList.remove('hidden');
    return;
  } else {
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
  }

  // Flash only when top row is new (not re-rendered from poll)
  const topId = filtered.length ? filtered[0].id : null;
  const topIsFresh = topId && topId !== lastTopIdRef.current;
  lastTopIdRef.current = topId;

  let html = '';
  filtered.forEach((log, index) => {
    const isNew = index === 0 && topIsFresh;

    // Camera status badge
    let cameraBadge = '';
    if (log.cameraStatus === 'Ativa') {
      cameraBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Ativa - Gravação
      </span>`;
    } else {
      cameraBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-gray-900 text-gray-400 border border-gray-800">
        <i class="fa-solid fa-video-slash text-xs"></i> Desativada
      </span>`;
    }

    // Employee ID badge
    let empBadge = '';
    if (log.employee) {
      empBadge = `<span class="font-mono font-semibold text-white bg-elo-bg px-2 py-0.5 rounded border border-elo-border">${escapeHtml(log.employee.id)}</span>`;
    } else {
      empBadge = `<span class="font-semibold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">Não Identificado</span>`;
    }

    // Origin badge — zero-fake: simulated/manual rows are visibly labeled
    let originBadge = '';
    if (log.origin === 'simulacao') {
      originBadge = ` <span class="inline-block align-middle ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide bg-sky-950/70 text-sky-300 border border-sky-800/60" title="Registro simulado (origin=simulacao)">SIM</span>`;
    } else if (log.origin === 'manual') {
      originBadge = ` <span class="inline-block align-middle ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide bg-gray-900 text-gray-400 border border-gray-800" title="Registro manual (origin=manual)">MANUAL</span>`;
    }

    // Face preview thumbnail
    let faceThumb = '';
    if (log.faceDetected && log.employee) {
      faceThumb = `
        <div class="relative w-9 h-9 rounded-md overflow-hidden border border-elo-teal/60 mx-auto shadow">
          <img src="${escapeHtml(log.employee.photo)}" class="w-full h-full object-cover" loading="lazy" onerror="this.src='https://placehold.co/100x100/1f2937/00b894?text=Face'">
          <div class="absolute inset-0 border border-elo-teal animate-pulse"></div>
        </div>
      `;
    } else if (log.faceDetected && !log.employee) {
      faceThumb = `
        <div class="relative w-9 h-9 rounded-md overflow-hidden border border-amber-500 mx-auto bg-amber-950/50 flex items-center justify-center text-amber-400">
          <i class="fa-solid fa-user-secret text-sm"></i>
        </div>
      `;
    } else {
      faceThumb = `
        <div class="w-9 h-9 rounded-md bg-elo-bg border border-elo-border mx-auto flex items-center justify-center text-gray-600">
          <i class="fa-solid fa-eye-slash text-xs"></i>
        </div>
      `;
    }

    html += `
      <tr class="hover:bg-elo-hover/70 transition-colors duration-150 ${isNew ? 'animate-flash-new' : ''}">
        <td class="py-3 px-4 font-mono text-gray-300">${escapeHtml(log.timestamp)}</td>
        <td class="py-3 px-4 font-medium text-white">${escapeHtml(log.location)}</td>
        <td class="py-3 px-4">${cameraBadge}</td>
        <td class="py-3 px-4">${empBadge}${originBadge}</td>
        <td class="py-3 px-4 text-center">${faceThumb}</td>
        <td class="py-3 px-4 text-right">
          <button onclick="window.viewLogDetail?.('${log.id}')" class="text-xs bg-elo-bg hover:bg-elo-teal hover:text-black text-elo-teal border border-elo-teal/40 font-medium px-2.5 py-1 rounded transition flex items-center gap-1 ml-auto">
            <i class="fa-solid fa-magnifying-glass-plus"></i> Detalhes
          </button>
        </td>
      </tr>
    `;
  });

  tbodyEl.innerHTML = html;

  // Audio for new entries (already handled in prependLog, but keep for completeness)
  if (topIsFresh && audioEnabledRef.current && playBeepFn) {
    const topLog = filtered[0];
    if (topLog.accessStatus === 'Negado') {
      playBeepFn(400, 'sawtooth', 0.2);
    } else {
      playBeepFn(1200, 'sine', 0.05);
    }
  }
}

/** Build query string for /api/logs from filter inputs */
export function buildQuery(searchInput, locationSelect, cameraSelect) {
  const params = new URLSearchParams();
  const search = searchInput?.value?.trim() || '';
  const location = locationSelect?.value || '';
  const camera = cameraSelect?.value || '';
  if (search) params.set('search', search);
  if (location) params.set('location', location);
  if (camera) params.set('camera', camera);
  params.set('limit', '50');
  return params.toString();
}

/** Load logs via API and render */
export async function loadLogs(api, buildQueryFn, renderLogsTableFn) {
  try {
    const logs = await api('/api/logs?' + buildQueryFn());
    // The caller will replace logsStore and call renderLogsTable
    return logs;
  } catch (e) {
    console.error('Falha ao carregar logs:', e);
    return [];
  }
}

/** Load stats and update metric cards */
export async function loadStats(api, elements) {
  try {
    const s = await api('/api/stats');
    if (elements.totalLogs) elements.totalLogs.innerText = s.totalHoje.toLocaleString('pt-BR');
    if (elements.capturesCount) elements.capturesCount.innerText = s.capturasHoje.toLocaleString('pt-BR');
    if (elements.alertsCount) elements.alertsCount.innerText = s.alertasHoje;
    if (elements.devicesCount) elements.devicesCount.innerText = s.devicesOnline + '/' + s.devicesTotal;
  } catch (e) {
    console.error('Falha ao carregar métricas:', e);
  }
}

/** Check server health and update status indicators */
export async function checkServer(api, elements) {
  const { dot, label, latency, opModeLabel } = elements;
  const t0 = performance.now();
  try {
    const health = await api('/api/health');
    const ms = Math.round(performance.now() - t0);
    if (dot) dot.className = 'h-3 w-3 rounded-full bg-emerald-500 animate-pulse';
    if (label) label.innerText = 'API Local';
    if (latency) latency.innerText = 'Latência: ' + ms + 'ms';
    if (opModeLabel) applyOpMode(health && health.auth && health.auth.operatorRequired, { opModeLabel });
  } catch (e) {
    if (dot) dot.className = 'h-3 w-3 rounded-full bg-red-500';
    if (label) label.innerText = 'API Offline';
    if (latency) latency.innerText = 'sem conexão — suba com: node server.js';
  }
}

/** Apply operation mode (real vs bancada) — hides demo controls when real */
export function applyOpMode(real, elements) {
  const { opModeLabel, demoOnlyElements } = elements;
  if (opModeLabel) {
    opModeLabel.innerText = real ? 'Operação real' : 'Bancada';
    opModeLabel.className = 'font-semibold ' + (real ? 'text-elo-teal' : 'text-amber-400');
  }
  if (demoOnlyElements) {
    demoOnlyElements.forEach((el) => {
      el.style.display = real ? 'none' : '';
    });
  }
}

/** Load operator audit trail */
export async function loadAudit(api, elements) {
  const { tbody, badge } = elements;
  if (!tbody) return;
  try {
    const rows = await api('/api/audit?limit=30');
    const list = Array.isArray(rows) ? rows : [];
    if (badge) badge.innerText = list.length + (list.length === 1 ? ' registro' : ' registros');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-gray-500 text-[11px]">Nenhuma ação de operador registrada ainda — arme/desamarre um dispositivo.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((a) => `
      <tr class="hover:bg-elo-hover/70 transition-colors duration-150">
        <td class="py-2.5 px-4 font-mono text-gray-300 whitespace-nowrap">${escapeHtml(a.timestamp)}</td>
        <td class="py-2.5 px-4 font-mono text-[11px] text-elo-teal">${escapeHtml(a.actor)}</td>
        <td class="py-2.5 px-4 font-medium text-white">${escapeHtml(a.action)}</td>
        <td class="py-2.5 px-4 font-mono text-[11px] text-gray-400">${escapeHtml(a.device_id || '—')}</td>
        <td class="py-2.5 px-4 text-gray-400 text-[11px]">${escapeHtml(a.detail || '')}</td>
      </tr>`).join('');
  } catch (e) {
    if (badge) badge.innerText = '—';
    const needToken = /operador não autenticado/i.test(e.message || '');
    tbody.innerHTML = needToken
      ? '<tr><td colspan="5" class="py-4 text-center text-amber-400 text-[11px]">Defina o token do operador no topo para ver a auditoria.</td></tr>'
      : '<tr><td colspan="5" class="py-4 text-center text-gray-500 text-[11px]">API offline — suba com: node server.js</td></tr>';
  }
}

/** Load devices panel with command buttons and MQTT rotation */
export async function loadDevices(api, elements, pendingCommands, sendDeviceCommand, rotateMqttUser) {
  const { listEl, countLabel } = elements;
  try {
    const devs = await api('/api/devices');
    // Find ESP32 node for chart
    let chartDeviceId = null;
    try {
      const esp = devs.find((d) => d.mqtt_node) || null;
      chartDeviceId = esp ? esp.id : null;
    } catch { /* keep previous */ }

    if (countLabel) countLabel.innerText = devs.length + (devs.length === 1 ? ' Unidade' : ' Unidades');

    listEl.innerHTML = devs.map((dev) => {
      const { icon, color } = deviceIcon(dev.local);
      const online = dev.status === 'ONLINE';
      const alarming = !!dev.alarming;
      const badge = alarming
        ? '<span class="text-[10px] text-red-400 font-mono bg-red-950/60 border border-red-800/50 px-1.5 py-0.5 rounded animate-pulse">ALARME</span>'
        : online
          ? '<span class="text-[10px] text-emerald-400 font-mono bg-emerald-950/60 border border-emerald-800/50 px-1.5 py-0.5 rounded">ONLINE</span>'
          : '<span class="text-[10px] text-gray-500 font-mono bg-gray-900 border border-gray-800 px-1.5 py-0.5 rounded">OFFLINE</span>';
      const armBadge = dev.armed === 1
        ? '<span class="text-[10px] text-amber-400 font-mono bg-amber-950/60 border border-amber-800/50 px-1.5 py-0.5 rounded">ARMADO</span>'
        : dev.armed === 0
          ? '<span class="text-[10px] text-gray-500 font-mono bg-gray-900 border border-gray-800 px-1.5 py-0.5 rounded">DESARMADO</span>'
          : '';
      const tele = fmtTelemetry(dev);
      const pend = pendingCommands.get(dev.id);
      const busy = pend && (pend.status === 'pending' || pend.status === 'sending');
      const pendLine = pend
        ? (pend.status === 'acked'
            ? '<p class="text-[10px] text-emerald-400 font-mono mt-1.5">✓ Confirmado pelo ESP32</p>'
            : pend.status === 'failed'
              ? '<p class="text-[10px] text-red-400 font-mono mt-1.5">✗ Sem resposta do ESP32 — tente de novo</p>'
              : '<p class="text-[10px] text-amber-400 font-mono mt-1.5 animate-pulse">Enviando ' + escapeHtml(pend.action) + '…</p>')
        : '';
      const rotateBtn = dev.mqtt_node ? `
        <button onclick="window.rotateMqttUser?.('${escapeHtml(dev.id)}', '${escapeHtml(dev.mqtt_user || '')}')" title="Trocar usuário MQTT (só metadado — a senha troca-se no broker + ESP)" class="w-full mt-1.5 text-[10px] font-mono px-2 py-1 rounded bg-elo-bg border border-elo-border text-gray-500 hover:text-amber-400 hover:border-amber-800/50 transition">⟳ MQTT ${escapeHtml(dev.mqtt_user || 'sem user')}</button>` : '';
      const cmds = dev.mqtt_node ? `
        <div class="flex gap-1.5 mt-2">
          <button ${busy ? 'disabled' : ''} onclick="window.sendDeviceCommand?.('${escapeHtml(dev.id)}', 'arm')" title="Armar alarme" class="flex-1 text-[10px] font-semibold px-2 py-1 rounded bg-amber-950/60 border border-amber-800/50 text-amber-400 hover:bg-amber-900/60 transition disabled:opacity-40 disabled:cursor-wait">Armar</button>
          <button ${busy ? 'disabled' : ''} onclick="window.sendDeviceCommand?.('${escapeHtml(dev.id)}', 'disarm')" title="Desarmar alarme" class="flex-1 text-[10px] font-semibold px-2 py-1 rounded bg-elo-bg border border-elo-border text-gray-300 hover:border-elo-teal transition disabled:opacity-40 disabled:cursor-wait">Desarmar</button>
        </div>${pendLine}${rotateBtn}` : '';
      return `
        <div class="p-2.5 bg-elo-bg rounded-lg border ${alarming ? 'border-red-800/60' : 'border-elo-border'}">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2.5">
              <i class="fa-solid ${icon} ${color}"></i>
              <div>
                <p class="text-white font-medium">${escapeHtml(dev.local)}</p>
                <p class="text-[10px] text-gray-400">${escapeHtml(dev.tipo || '')}</p>
                ${tele ? `<p class="text-[10px] text-elo-teal font-mono">${escapeHtml(tele)}</p>` : ''}
                ${dev.mqtt_user ? `<p class="text-[10px] text-gray-500 font-mono">MQTT ${escapeHtml(dev.mqtt_user)}</p>` : ''}
              </div>
            </div>
            <div class="flex flex-col items-end gap-1">${badge}${armBadge}</div>
          </div>
          ${cmds}
        </div>`;
    }).join('');

    return chartDeviceId;
  } catch (e) {
    console.error('Falha ao carregar dispositivos:', e);
    listEl.innerHTML = '<p class="text-gray-500 text-[11px] py-2 text-center">API offline — suba com: node server.js</p>';
    return null;
  }
}

/** View log detail modal */
export function viewLogDetail(log, elements) {
  const { modal, title, timestamp, location, devId, camBadge, faceImg, faceBox, empName, empRole, empId, accessStatus, confidenceEl } = elements;
  if (!modal) return;

  title.innerText = `Detalhes do Log - ${log.id}`;
  timestamp.innerText = log.timestamp;
  location.innerText = log.location;
  devId.innerText = log.deviceId;

  if (camBadge) {
    if (log.cameraStatus === 'Ativa') {
      camBadge.className = 'text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-700 px-2 py-0.5 rounded';
      camBadge.innerText = 'CÂMERA ATIVA';
    } else {
      camBadge.className = 'text-[10px] bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded';
      camBadge.innerText = 'DESATIVADA';
    }
  }

  if (faceImg) {
    if (log.employee) {
      faceImg.src = log.employee.photo;
      if (empName) empName.innerText = log.employee.name;
      if (empRole) empRole.innerText = `${log.employee.role} - ${log.employee.dept}`;
      if (empId) empId.innerText = log.employee.id;
      if (faceBox) {
        faceBox.style.display = 'block';
        faceBox.style.top = '20%';
        faceBox.style.left = '25%';
        faceBox.style.width = '50%';
        faceBox.style.height = '50%';
      }
      if (confidenceEl) confidenceEl.innerText = log.confidence + '%';
    } else {
      faceImg.src = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80';
      if (empName) empName.innerText = 'Pessoa Não Cadastrada';
      if (empRole) empRole.innerText = 'Alerta de Segurança / Visitante';
      if (empId) empId.innerText = 'N/A';
      if (faceBox) faceBox.style.display = 'none';
    }
  }

  if (accessStatus) {
    if (log.accessStatus === 'Autorizado') {
      accessStatus.className = 'font-semibold text-emerald-400 flex items-center gap-1';
      accessStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Autorizado';
    } else {
      accessStatus.className = 'font-semibold text-red-400 flex items-center gap-1';
      accessStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Negado - Alerta';
    }
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

/** Close any modal by ID */
export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

/** Open manual event modal */
export function openManualEventModal() {
  const modal = document.getElementById('modal-manual');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

/** Submit manual event form */
export async function submitManualEvent(e, api, prependLog, closeModalFn) {
  e.preventDefault();
  const locationEl = document.getElementById('manual-location');
  const camStatusEl = document.getElementById('manual-camera-status');
  const empEl = document.getElementById('manual-employee');
  const accessEl = document.getElementById('manual-access');
  if (!locationEl || !camStatusEl || !empEl || !accessEl) return;

  const location = locationEl.value;
  const camStatus = camStatusEl.value;
  const empVal = empEl.value;
  const accessStatus = accessEl.value;

  try {
    const created = await api('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location,
        cameraStatus: camStatus,
        employeeId: empVal === '' ? 'unknown' : empVal,
        acesso: accessStatus,
        confianca: (96 + Math.random() * 3.8).toFixed(1),
        deviceId: 'IOT-MANUAL-01',
        origin: 'manual'
      })
    });
    prependLog(created);
    closeModalFn('modal-manual');
  } catch (err) {
    alert('Falha ao gravar evento: ' + err.message);
  }
}

/** Debounced filter function creator */
export function createFilterLogs(loadLogsFn) {
  let filterTimer = null;
  return function filterLogs() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadLogsFn, 250);
  };
}