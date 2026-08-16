// api/router.js — tiny pattern-matching router with :params
import { error as jsonError } from '../utils/response.js';

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, meta = {}) {
    // pattern like /api/nodes/:id
    const keys = [];
    const regexStr = pattern
      .replace(/\/+$/, '')
      .replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      });
    const regex = new RegExp('^' + (regexStr || '/') + '/?$');
    this.routes.push({ method: method.toUpperCase(), regex, keys, handler, meta });
  }

  get(p, h, m) { this.add('GET', p, h, m); }
  post(p, h, m) { this.add('POST', p, h, m); }
  put(p, h, m) { this.add('PUT', p, h, m); }
  patch(p, h, m) { this.add('PATCH', p, h, m); }
  del(p, h, m) { this.add('DELETE', p, h, m); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = pathname.match(r.regex);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params, meta: r.meta };
      }
    }
    return null;
  }
}

// Helper to read JSON body safely
export async function readJson(request) {
  try {
    const ct = request.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return {};
    return await request.json();
  } catch {
    return {};
  }
}

export function notFound(pathname) {
  return jsonError(`No route for ${pathname}`, 404);
}
