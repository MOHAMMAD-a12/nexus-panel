// api/routes/subscriptions.js
import { ok, created, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, queryOne, insert, update, remove, count, nowSec } from '../../database/db.js';
import { validateBody, isString, isInt, isIn, isArray, optional, toBool } from '../../utils/validate.js';
import { NotFoundError, ValidationError } from '../../utils/error.js';
import { randomId, token } from '../../utils/id.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';
import { buildSubscriptionContent } from '../../services/subscriptions.js';

function serializeSub(row) {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    token: row.token,
    configs: row.configs,
    trafficLimit: row.traffic_limit,
    trafficUsed: row.traffic_used,
    deviceLimit: row.device_limit,
    expiration: row.expiration,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSubs(ctx) {
  await authenticate(ctx);
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const status = url.searchParams.get('status') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '20', 10));
  const offset = (page - 1) * pageSize;
  let where = ''; const params = [];
  if (search) { where += ' WHERE LOWER(name) LIKE ?'; params.push(`%${search}%`); }
  if (status) { where += (where ? ' AND' : ' WHERE') + ' status = ?'; params.push(status); }
  const total = await count(db, 'subscriptions', where, params);
  const rows = await query(db, `SELECT * FROM subscriptions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serializeSub), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function getSub(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, 'SELECT * FROM subscriptions WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('Subscription not found');
  return ok(serializeSub(row));
}

export async function createSub(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'subscriptions.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || 'invalid',
    owner: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    configs: (v) => optional(v, isArray, []),
    traffic_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), 0),
    device_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), 0),
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    status: (v) => optional(v, (x) => isIn(x, ['active', 'disabled', 'expired', 'revoked']), 'active'),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const id = randomId('sub', 10);
  const ts = nowSec();
  await insert(ctx.db, 'subscriptions', {
    id, name: clean.name, owner: clean.owner || null, token: token('sub', 24),
    configs: clean.configs || [], traffic_limit: clean.traffic_limit || 0, traffic_used: 0,
    device_limit: clean.device_limit || 0, expiration: clean.expiration || null,
    status: clean.status || 'active', created_at: ts, updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'subscription_created', resource: 'subscription', resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, 'SELECT * FROM subscriptions WHERE id = ?', [id]);
  return created(serializeSub(row));
}

export async function updateSub(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'subscriptions.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM subscriptions WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Subscription not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 120 }), undefined),
    owner: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    configs: (v) => optional(v, isArray, undefined),
    traffic_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), undefined),
    device_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), undefined),
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    status: (v) => optional(v, (x) => isIn(x, ['active', 'disabled', 'expired', 'revoked']), undefined),
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const data = {};
  for (const k of ['name', 'owner', 'configs', 'traffic_limit', 'device_limit', 'expiration', 'status']) if (k in clean) data[k] = clean[k];
  data.updated_at = nowSec();
  await update(ctx.db, 'subscriptions', ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: 'subscription_updated', resource: 'subscription', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, 'SELECT * FROM subscriptions WHERE id = ?', [ctx.params.id]);
  return ok(serializeSub(row));
}

export async function deleteSub(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'subscriptions.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM subscriptions WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Subscription not found');
  await remove(ctx.db, 'subscriptions', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'subscription_deleted', resource: 'subscription', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}

export async function regenerateSub(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'subscriptions.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM subscriptions WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Subscription not found');
  await update(ctx.db, 'subscriptions', ctx.params.id, { token: token('sub', 24), status: 'active', updated_at: nowSec() });
  await audit(ctx.db, { user: ctx.user, action: 'subscription_regenerated', resource: 'subscription', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, 'SELECT * FROM subscriptions WHERE id = ?', [ctx.params.id]);
  return ok(serializeSub(row));
}

export async function getSubscriptionLink(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, 'SELECT token FROM subscriptions WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('Subscription not found');
  const base = new URL(ctx.request.url).origin;
  return ok({ url: `${base}/s/${row.token}`, token: row.token });
}
