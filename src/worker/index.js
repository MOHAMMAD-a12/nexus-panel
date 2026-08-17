// worker/index.js — Cloudflare Worker entry point
import { buildRouter } from './api/index.js';
import { json, error as jsonError, cors, html, redirect } from './utils/response.js';
import { toErrorResponse, AppError, AuthError, ForbiddenError, ValidationError } from './utils/error.js';
import { getConfig, assertSecrets } from './utils/config.js';
import { rateLimit, clientKey } from './middleware/ratelimit.js';
import { getCurrentUser, getSessionToken, validateCsrf } from './auth/session.js';
import { authenticateApiKey, hasApiScope } from './auth/apikey.js';
import { ensureAdmin, seedDemoData } from './services/seed.js';
import { runScheduled } from './scheduler.js';
import { buildSubscriptionContent } from './services/subscriptions.js';
import { NotFoundError } from './utils/error.js';

const router = buildRouter();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const cfg = getConfig(env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors({}, request.headers.get('origin') || '*') });
    }

    // ─────────── Public subscription route (no auth) ───────────
    if (pathname.startsWith('/s/')) {
      const token = pathname.slice(3);
      try {
        const content = await buildSubscriptionContent(env.DB, env.KV, token, url.host);
        env.KV.put(`sub_used:${token}`, String(Math.floor(Date.now() / 1000))).catch(() => {});
        return new Response(content, {
          status: 200,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      } catch (e) {
        const err = toErrorResponse(e);
        return new Response(err.body.message, {
          status: e instanceof AuthError ? 401 : e instanceof ValidationError ? 400 : e instanceof NotFoundError ? 404 : 500,
        });
      }
    }

    // ─────────── Auth endpoint (rate-limited, no auth required) ───────────
    if (pathname === '/api/auth/login' || pathname === '/api/health') {
      const limit = await rateLimit(env.KV, `rl:${clientKey(request, env)}:${pathname}`, cfg.rateLimit);
      const headers = cors({}, request.headers.get('origin') || '*');
      if (!limit.allowed) {
        return jsonError('Rate limit exceeded', 429, { retryAfter: limit.retryAfter });
      }
      try {
        // First-run admin bootstrap if no users exist
        await ensureAdmin(env.DB, env.KV, cfg);
        if (cfg.demoMode) await seedDemoData(env.DB, env.KV, true).catch(() => {});
        return await routeRequest(request, env, ctx, null, headers);
      } catch (e) {
        return handleError(e, headers);
      }
    }

    // ─────────── API key authentication (Bearer) ───────────
    let apiKey = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = await authenticateApiKey(env.DB, authHeader, env);
    }

    // ─────────── Session authentication (cookie) ───────────
    let user = null;
    if (!apiKey) {
      user = await getCurrentUser(env.DB, env.KV, request, env);
    }

    // ─────────── Rate limiting for API ───────────
    const rlKey = `rl:${clientKey(request, env)}:api`;
    const limit = await rateLimit(env.KV, rlKey, apiKey ? apiKey.rateLimit : cfg.rateLimit);
    const corsHeaders = cors({}, request.headers.get('origin') || '*');
    if (!limit.allowed) {
      return jsonError('Rate limit exceeded', 429, { retryAfter: limit.retryAfter });
    }

    // ─────────── CSRF guard for state-changing requests ───────────
    if (!apiKey) {
      const method = request.method.toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && cfg.environment !== 'development') {
        if (!validateCsrf(request)) {
          return jsonError('Invalid or missing CSRF token', 403);
        }
      }
    } else {
      // API key: check scope
      const requiredScope = scopeForPath(pathname, request.method);
      if (requiredScope && !hasApiScope(apiKey, requiredScope)) {
        return jsonError('API key lacks required scope', 403);
      }
    }

    try {
      await ensureAdmin(env.DB, env.KV, cfg);
      if (cfg.demoMode) await seedDemoData(env.DB, env.KV, true).catch(() => {});
      return await routeRequest(request, env, ctx, apiKey ? { id: apiKey.ownerId, username: apiKey.name, permissions: apiKey.scopes } : user, corsHeaders, apiKey);
    } catch (e) {
      return handleError(e, corsHeaders);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event, env));
  },
};

function scopeForPath(pathname, method) {
  const map = {
    '/api/generate': 'configs',
    '/api/templates': 'configs',
    '/api/generated': 'configs',
    '/api/endpoints': 'configs',
    '/api/domains': 'domains',
    '/api/dns': 'dns',
    '/api/nodes': 'nodes',
    '/api/configs': 'configs',
    '/api/subscriptions': 'subscriptions',
    '/api/cloudflare': 'cloudflare',
    '/api/credentials': 'cloudflare',
    '/api/users': 'users',
    '/api/apikeys': 'apikeys',
    '/api/logs': 'logs',
    '/api/settings': 'settings',
    '/api/notifications': 'notifications',
    '/api/dashboard': 'dashboard',
  };
  for (const [prefix, cat] of Object.entries(map)) {
    if (pathname.startsWith(prefix)) {
      return method === 'GET' ? `${cat}.read` : `${cat}.write`;
    }
  }
  return null;
}

async function routeRequest(request, env, ctx, identity, corsHeaders, apiKey = null) {
  const url = new URL(request.url);
  const match = router.match(request.method, url.pathname);
  if (!match) {
    // Let ASSETS handle non-API routes
    if (!url.pathname.startsWith('/api/')) {
      // Normal deploy (wrangler.toml [assets]) serves static files via ASSETS binding.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      // Bot-deployed workers are created via the raw Cloudflare API without an ASSETS
      // binding, so they serve public/ files from their own KV namespace instead.
      // (Backward-compatible: this branch only runs when ASSETS is absent.)
      const kvAsset = await serveKvAsset(env.KV, url.pathname);
      if (kvAsset) return kvAsset;
      const indexHtml = await env.KV.get('assets:/index.html', { type: 'text', metadata: 'true' });
      if (indexHtml && indexHtml.value != null) {
        return new Response(indexHtml.value, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    }
    return jsonError(`No route for ${url.pathname}`, 404);
  }
  const ctxObj = {
    request,
    env,
    db: env.DB,
    kv: env.KV,
    user: identity,
    apiKey,
    params: match.params,
    identity,
  };
  const handler = match.handler;
  return handler(ctxObj);
}

function handleError(e, headers) {
  const mapped = toErrorResponse(e);
  if (!(e instanceof AppError)) {
    // Never leak internals to the client, but always log server-side.
    console.error('[unhandled]', e && e.stack ? e.stack : String(e));
  }
  return json({ ok: false, error: mapped.body }, mapped.status, headers);
}

// Serve a static file from KV. Keys are stored as `assets:<path>` (e.g.
// `assets:/css/styles.css`) with `{ contentType }` metadata. Falls back to
// `/index.html` for `/` so the SPA shell loads. Returns null when not found.
async function serveKvAsset(kv, pathname) {
  if (!kv) return null;
  const key = 'assets:' + (pathname === '/' ? '/index.html' : pathname);
  const got = await kv.get(key, { type: 'arrayBuffer', metadata: 'true' });
  if (!got || got.value == null) return null;
  const ct = got.metadata?.contentType || 'application/octet-stream';
  return new Response(got.value, {
    status: 200,
    headers: { 'content-type': ct, 'cache-control': 'public, max-age=300' },
  });
}
