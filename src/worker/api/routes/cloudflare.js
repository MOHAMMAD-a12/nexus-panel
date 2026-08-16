// api/routes/cloudflare.js — Cloudflare connection management.
// SECURITY: the API token is never returned. All responses are status/preview only.
// Operations that the Cloudflare API does not support are NOT faked.
import { ok } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { validateBody, isString, optional } from '../../utils/validate.js';
import { ValidationError } from '../../utils/error.js';
import { getConfig } from '../../utils/config.js';
import { getConnection, testConnection, saveConnection, disconnect, refreshConnection } from '../../services/cloudflareConnection.js';
import { getClientIp } from '../../auth/auth.js';
import { audit } from '../../utils/logger.js';

export async function getConnectionRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.read')) throw new Error('forbidden');
  const conn = await getConnection(ctx.db, ctx.env.KV, ctx.env);
  return ok(conn);
}

export async function testRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    accountId: (v) => isString(v, { min: 1, max: 120 }) || 'invalid',
    tokenValue: (v) => isString(v, { min: 1 }) || 'invalid',
    zone: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const result = await testConnection({ ...clean, env: ctx.env, kv: ctx.env.KV });
  await audit(ctx.db, { user: ctx.user, action: 'cloudflare_test', resource: 'cloudflare', ip: getClientIp(ctx.request), metadata: { accountId: clean.accountId } });
  return ok(result);
}

export async function saveRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    accountId: (v) => isString(v, { min: 1, max: 120 }) || 'invalid',
    tokenValue: (v) => isString(v, { min: 1 }) || 'invalid',
    zone: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const result = await saveConnection({ ...clean, env: ctx.env, kv: ctx.env.KV, db: ctx.db });
  await audit(ctx.db, { user: ctx.user, action: 'cloudflare_save', resource: 'cloudflare', ip: getClientIp(ctx.request), metadata: { accountId: clean.accountId } });
  return ok(result);
}

export async function disconnectRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.write')) throw new Error('forbidden');
  const result = await disconnect(ctx.db, ctx.env.KV);
  await audit(ctx.db, { user: ctx.user, action: 'cloudflare_disconnect', resource: 'cloudflare', ip: getClientIp(ctx.request) });
  return ok(result);
}

export async function refreshRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.read')) throw new Error('forbidden');
  const conn = await refreshConnection(ctx.db, ctx.env.KV, ctx.env);
  return ok(conn);
}
