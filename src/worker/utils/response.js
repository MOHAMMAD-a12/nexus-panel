// utils/response.js — standardized JSON + HTML responses

// Build response headers, appending `Set-Cookie` values correctly. A plain
// object cannot carry duplicate `set-cookie` keys, so callers pass cookies as
// { 'set-cookie': [...] } (an array) and we append them via Headers.
function buildHeaders(headers = {}) {
  const h = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === 'set-cookie') {
      const list = Array.isArray(v) ? v : [v];
      for (const c of list) if (c) h.append('set-cookie', c);
    } else if (v != null) {
      h.set(k, String(v));
    }
  }
  return h;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: buildHeaders(headers) });
}

export function ok(data, headers = {}) {
  return json({ ok: true, data, ts: nowTs() }, 200, headers);
}

export function created(data, headers = {}) {
  return json({ ok: true, data, ts: nowTs() }, 201, headers);
}

export function paginated(rows, meta, headers = {}) {
  return json({ ok: true, data: rows, meta, ts: nowTs() }, 200, headers);
}

export function error(message, status = 400, extra = {}) {
  return json({ ok: false, error: { message, status, ...extra } }, status);
}

export function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

export function nowTs() {
  return Math.floor(Date.now() / 1000);
}

export function cors(headers, origin) {
  const h = { ...headers };
  if (origin) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-credentials'] = 'true';
  }
  h['access-control-allow-headers'] = 'content-type, authorization, x-csrf-token, x-requested-with';
  h['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
  return h;
}
