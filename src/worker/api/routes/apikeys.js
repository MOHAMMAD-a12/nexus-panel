// api/routes/apikeys.js — internal API credential management
import { ok, created, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, queryOne, insert, update, remove, count, nowSec } from '../../database/db.js';
import { validateBody, isString, isInt, isArray, optional, toBool } from '../../utils/validate.js';
import { NotFoundError, ValidationError } from '../../utils/error.js';
import { randomId, token } from '../../utils/id.js';
import { hmac } from '../../utils/crypto.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';
import { getConfig } from '../../utils/config.js';

function serializeKey(row) {
  return {
    id: row.id, name: row.name, ownerId: row.owner_id, keyPrefix: row.key_prefix,
    scopes: row.scopes, rateLimit: row.rate_limit, lastUsed: row.last_used,
    expiresAt: row.expires_at, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Generate a raw key + store only prefix + hash
async function makeKey(secret) {
  const raw = token('nx', 32);
  const hash = await hmac(secret, raw);
  return { raw, hash, prefix: raw.slice(0, 11) };
}

export async function listKeys(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'apikeys.read')) throw new Error('forbidden');
  const { db, request } = ctx;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '20', 10));
  const offset = (page - 1) * pageSize;
  const total = await count(db, 'api_keys');
  const rows = await query(db, `SELECT * FROM api_keys ORDER BY created_at DESC LIMIT ? OFFSET ?`, [pageSize, offset]);
  return paginated(rows.map(serializeKey), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function createKey(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'apikeys.write')) throw new Error('forbidden');
  const secret = getConfig(ctx.env).encryptionKey;
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || 'invalid',
    scopes: (v) => isArray(v) || 'invalid',
    rate_limit: (v) => optional(v, (x) => isInt(x, { min: 1, max: 100000 }), 120),
    expires_at: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const { raw, hash, prefix } = await makeKey(secret);
  const id = randomId('key', 10);
  const ts = nowSec();
  await insert(ctx.db, 'api_keys', {
    id, name: clean.name, owner_id: ctx.user.id, key_hash: hash, key_prefix: prefix,
    scopes: clean.scopes, rate_limit: clean.rate_limit || 120, last_used: null,
    expires_at: clean.expires_at || null, status: 'active', created_at: ts, updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'apikey_created', resource: 'apikey', resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name, scopes: clean.scopes } });
  return created({ ...serializeKey({ ...{}, id, name: clean.name, owner_id: ctx.user.id, key_prefix: prefix, scopes: clean.scopes, rate_limit: clean.rate_limit, last_used: null, expires_at: clean.expires_at, status: 'active', created_at: ts, updated_at: ts }), secret: raw });
}

export async function deleteKey(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'apikeys.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM api_keys WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('API key not found');
  await remove(ctx.db, 'api_keys', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'apikey_deleted', resource: 'apikey', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}

export async function rotateKey(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'apikeys.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM api_keys WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('API key not found');
  const secret = getConfig(ctx.env).encryptionKey;
  const { raw, hash, prefix } = await makeKey(secret);
  await update(ctx.db, 'api_keys', ctx.params.id, { key_hash: hash, key_prefix: prefix, updated_at: nowSec() });
  await audit(ctx.db, { user: ctx.user, action: 'apikey_rotated', resource: 'apikey', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id, keyPrefix: prefix, secret: raw });
}
