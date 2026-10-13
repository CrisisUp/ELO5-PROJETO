// Elo5 — Simulation logic (demo traffic generator).
// Isolated in its own module for eventual removal when demo mode is deprecated.
// ES module, no external deps.

const LOCATIONS = [
  'Entrada Principal - Gate 1',
  'Entrada Principal - Gate 2',
  'Armazém B - Corredor 1',
  'Armazém B - Corredor 3',
  'Laboratório P&D - Acesso Restrito',
  'Recepção Central',
  'Diretoria Executiva'
];

/**
 * Build a random simulation payload matching the POST /api/logs schema.
 * origin='simulacao' so it's distinguishable from real/manual events.
 */
export function buildSimPayload(employeesCache) {
  const isUnknown = Math.random() < 0.15; // 15% chance of unauthorized alert
  const emp = (isUnknown || !employeesCache.length) ? null
    : employeesCache[Math.floor(Math.random() * employeesCache.length)];
  const location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  const cameraActive = Math.random() > 0.2; // 80% active camera

  return {
    location,
    cameraStatus: cameraActive ? 'Ativa' : 'Desativada',
    employeeId: emp ? emp.id : 'unknown',
    acesso: isUnknown ? 'Negado' : 'Autorizado',
    confianca: (94 + Math.random() * 5.8).toFixed(1),
    deviceId: 'IOT-SIM-' + location.substring(0, 4).toUpperCase().replace(/\s/g, ''),
    origin: 'simulacao'
  };
}

/**
 * Start the simulation interval.
 * Returns the interval ID for later clearing.
 */
export function startSimulation(api, prependLog, autoSimulationActiveRef) {
  return setInterval(async () => {
    if (!autoSimulationActiveRef.current) return;
    try {
      const created = await api('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSimPayload(autoSimulationActiveRef.employeesCache || []))
      });
      prependLog(created);
    } catch (e) {
      console.error('Simulação falhou (API offline?):', e);
    }
  }, 2500);
}

/**
 * Toggle simulation on/off.
 * Updates button UI and starts/stops interval.
 */
export function toggleAutoSimulation(
  btnEl, indEl, txtEl,
  autoSimulationActiveRef,
  startSimulationFn
) {
  autoSimulationActiveRef.current = !autoSimulationActiveRef.current;

  if (autoSimulationActiveRef.current) {
    indEl.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    txtEl.innerText = 'Simulação: ON';
    autoSimulationActiveRef.intervalId = startSimulationFn();
  } else {
    indEl.className = 'w-2 h-2 rounded-full bg-red-500';
    txtEl.innerText = 'Simulação: OFF';
    if (autoSimulationActiveRef.intervalId) {
      clearInterval(autoSimulationActiveRef.intervalId);
      autoSimulationActiveRef.intervalId = null;
    }
  }
}