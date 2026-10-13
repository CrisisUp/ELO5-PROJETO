// Elo5 — Chart.js initialization and data updates.
// ES module, no external deps (Chart.js loaded globally via CDN in index.html).

/** Initialize the distance chart (cm) */
export function initChart() {
  const el = document.getElementById('liveChart');
  if (!el || typeof Chart === 'undefined') return null;
  const ctx = el.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 150);
  gradient.addColorStop(0, 'rgba(0, 184, 148, 0.4)');
  gradient.addColorStop(1, 'rgba(0, 184, 148, 0.0)');

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Distância (cm)',
        data: [],
        borderColor: '#00b894',
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 1.5,
        pointHoverRadius: 3,
        pointBackgroundColor: '#00b894'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6b7280', font: { size: 9 } } },
        y: { grid: { color: '#1f2937' }, ticks: { color: '#6b7280', font: { size: 9 } } }
      }
    }
  });
}

/** Initialize the LDR chart (luminosity 0-4095) */
export function initLdrChart() {
  const el = document.getElementById('ldrChart');
  if (!el || typeof Chart === 'undefined') return null;
  const ctx = el.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 150);
  gradient.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
  gradient.addColorStop(1, 'rgba(251, 191, 36, 0.0)');

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Luminosidade (LDR)',
        data: [],
        borderColor: '#fbbf24',
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 1.5,
        pointHoverRadius: 3,
        pointBackgroundColor: '#fbbf24'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6b7280', font: { size: 9 } } },
        y: { grid: { color: '#1f2937' }, ticks: { color: '#6b7280', font: { size: 9 } }, suggestedMin: 0, suggestedMax: 4095 }
      }
    }
  });
}

/**
 * Fetch telemetry and update both charts.
 * No direct DOM access — receives chart instances + api fn + deviceId.
 */
export async function updateChartData(liveChart, ldrChart, api, deviceId) {
  if (!liveChart && !ldrChart) return;
  try {
    const qs = deviceId
      ? `?device_id=${encodeURIComponent(deviceId)}&limit=24`
      : '?limit=24';
    const rows = await api('/api/telemetry' + qs);
    const list = Array.isArray(rows) ? rows : [];

    if (liveChart) {
      const samples = list
        .filter((r) => r.dist !== null && r.dist !== undefined && Number(r.dist) < 900)
        .slice(-24);
      if (samples.length) { // no data: don't invent
        liveChart.data.labels = samples.map((r) => String(r.timestamp).slice(11, 16));
        liveChart.data.datasets[0].data = samples.map((r) => Number(r.dist));
        liveChart.data.datasets[0].label = 'Distância (cm)';
        liveChart.update();
      }
    }
    if (ldrChart) {
      const ldrSamples = list
        .filter((r) => r.ldr !== null && r.ldr !== undefined)
        .slice(-24);
      if (ldrSamples.length) { // no data: don't invent
        ldrChart.data.labels = ldrSamples.map((r) => String(r.timestamp).slice(11, 16));
        ldrChart.data.datasets[0].data = ldrSamples.map((r) => Number(r.ldr));
        ldrChart.update();
      }
    }
  } catch (e) {
    console.error('Falha ao carregar telemetria:', e);
  }
}