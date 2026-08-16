// core/api.js — API client. Reads CSRF token from cookie (set at login).
const BASE = '';

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function request(method, path, body, { raw = false, full = false } = {}) {
  const headers = {};
  const csrf = getCookie('nexus_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  headers['x-requested-with'] = 'fetch';

  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError('Network error — is the worker running?', 'network');
  }

  if (res.status === 401) {
    // Session expired → bounce to login
    const data = await res.json().catch(() => ({}));
    if (window.__nexus && window.__nexus.onUnauthenticated) window.__nexus.onUnauthenticated();
    throw new ApiError(data.error?.message || 'Session expired', 'unauthenticated');
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { ok: false, raw: text }; }

  if (!res.ok || (data && data.ok === false)) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    const fields = data?.error?.fields || {};
    throw new ApiError(msg, 'error', res.status, fields);
  }
  if (raw) return data;
  if (full) return { data: data?.data ?? null, meta: data?.meta ?? null };
  return data?.data ?? null;
}

export class ApiError extends Error {
  constructor(message, code = 'error', status = 0, fields = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export const api = {
  get: (p, opts) => request('GET', p, undefined, opts),
  post: (p, b, opts) => request('POST', p, b, opts),
  put: (p, b, opts) => request('PUT', p, b, opts),
  patch: (p, b, opts) => request('PATCH', p, b, opts),
  del: (p, b, opts) => request('DELETE', p, b, opts),
  raw: (m, p, b) => request(m, p, b, { raw: true }),
  // Returns the full { data, meta } envelope so DataTable pagination works.
  list: (p) => request('GET', p, undefined, { full: true }),
};
