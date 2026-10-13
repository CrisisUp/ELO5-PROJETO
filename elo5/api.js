// Elo5 — API layer: fetch wrappers, operator token handling, telemetry export.
// ES module, no external deps.

const API_BASE = '';

/** Current operator token from localStorage (P1: x-operator-token header) */
let operatorToken = localStorage.getItem('elo5-operator-token') || '';

/** Build headers including operator token when present */
export function operatorHeaders() {
  return operatorToken ? { 'x-operator-token': operatorToken } : {};
}

/** Set/clear operator token in localStorage and memory */
export function setOperatorToken(tok) {
  operatorToken = String(tok || '').trim();
  if (operatorToken) {
    localStorage.setItem('elo5-operator-token', operatorToken);
  } else {
    localStorage.removeItem('elo5-operator-token');
  }
}

/** Get current token (for health check UI) */
export function getOperatorToken() {
  return operatorToken;
}

/**
 * Generic JSON API call with operator token header.
 * Throws on non-OK response with parsed error message.
 */
export async function api(path, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...operatorHeaders() };
  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Export telemetry as CSV or JSON blob download.
 * Uses fetch directly (not api()) because response is blob, not JSON.
 */
export async function exportTelemetry(format, deviceId = null) {
  try {
    const params = new URLSearchParams();
    params.set('format', format);
    params.set('limit', '5000');
    if (deviceId) params.set('device_id', deviceId);

    const res = await fetch(`${API_BASE}/api/telemetry/export?${params.toString()}`, {
      headers: { ...operatorHeaders() }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const ext = format === 'json' ? 'json' : 'csv';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `elo5-telemetry.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    alert(`Falha ao exportar telemetria: ${e.message}`);
  }
}

/** Format timestamp as "YYYY-MM-DD HH:MM:SS" */
export function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** HTML escape utility */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&', '<': '<', '>': '>', '"': '"', "'": '''
  }[c]));
}