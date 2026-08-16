// api/routes/endpoints.js — endpoint / location builder.
// These are user-managed locations (host/domain/port/country) used by the batch
// generator and as the SERVER for generated configs. They are NOT live servers and
// this panel never pretends to run a protocol runtime on them.
import { ok, created, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { insert, query, queryOne, update, remove, count, nowSec } from '../../database/db.js';
import { validateBody, isString, isIn, isArray, optional } from '../../utils/validate.js';
import { ValidationError, NotFoundError } from '../../utils/error.js';
import { randomId } from '../../utils/id.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';

const COUNTRIES = {
  DE: 'Germany', FR: 'France', NL: 'Netherlands', TR: 'Turkey', SG: 'Singapore', US: 'United States',
  GB: 'United Kingdom', JP: 'Japan', CA: 'Canada', AU: 'Australia', RU: 'Russia', BR: 'Brazil',
};

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host || null,
    domain: row.domain || null,
    port: row.port || null,
    country: row.country || null,
    countryName: row.country ? (COUNTRIES[row.country] || row.country) : null,
    city: row.city || null,
    provider: row.provider || null,
    region: row.region || null,
    tls: Boolean(row.tls),
    status: row.status || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEndpoints(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.read')) throw new Error('forbidden');
  const { db, request } = ctx;
  const url = new URL(request.url);
  const country = url.searchParams.get('country') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '50', 10));
  const offset = (page - 1) * pageSize;

  const clauses = [];
  const params = [];
  if (country) { clauses.push('country = ?'); params.push(country); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = await count(db, 'endpoints', where, params);
  const rows = await query(db, `SELECT * FROM endpoints ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serialize), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function getEndpoint(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.read')) throw new Error('forbidden');
  const row = await queryOne(ctx.db, 'SELECT * FROM endpoints WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('Endpoint not found');
  return ok(serialize(row));
}

export async function createEndpoint(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || 'invalid',
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => Number(x) >= 1 && Number(x) <= 65535, null),
    country: (v) => optional(v, (x) => isIn(x, Object.keys(COUNTRIES)), null),
    city: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    provider: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    region: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    tls: (v) => optional(v, (x) => x === true || x === false, false),
    status: (v) => optional(v, (x) => isIn(x, ['active', 'disabled', 'error']), 'active'),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  if (!clean.host && !clean.domain) throw new ValidationError('Host or domain is required.', { field: 'host' });

  const id = randomId('ep', 10);
  const ts = nowSec();
  await insert(ctx.db, 'endpoints', {
    id, name: clean.name, host: clean.host || null, domain: clean.domain || null, port: clean.port || null,
    country: clean.country || null, city: clean.city || null, provider: clean.provider || null,
    region: clean.region || null, tls: clean.tls ? 1 : 0, status: clean.status || 'active',
    created_at: ts, updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'endpoint_created', resource: 'endpoint', resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, 'SELECT * FROM endpoints WHERE id = ?', [id]);
  return created(serialize(row));
}

export async function updateEndpoint(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM endpoints WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Endpoint not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 120 }), undefined),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => Number(x) >= 1 && Number(x) <= 65535, null),
    country: (v) => optional(v, (x) => isIn(x, Object.keys(COUNTRIES)), undefined),
    city: (v) => optional(v, (x) => isString(x, { max: 120 }), undefined),
    provider: (v) => optional(v, (x) => isString(x, { max: 120 }), undefined),
    region: (v) => optional(v, (x) => isString(x, { max: 64 }), undefined),
    tls: (v) => optional(v, (x) => x === true || x === false, undefined),
    status: (v) => optional(v, (x) => isIn(x, ['active', 'disabled', 'error']), undefined),
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const data = {};
  for (const k of ['name', 'host', 'domain', 'country', 'city', 'provider', 'region', 'status']) {
    if (k in clean) data[k] = clean[k];
  }
  if (clean.tls !== undefined) data.tls = clean.tls ? 1 : 0;
  if (clean.port !== undefined) data.port = clean.port;
  data.updated_at = nowSec();
  await update(ctx.db, 'endpoints', ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: 'endpoint_updated', resource: 'endpoint', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, 'SELECT * FROM endpoints WHERE id = ?', [ctx.params.id]);
  return ok(serialize(row));
}

export async function deleteEndpoint(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM endpoints WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Endpoint not found');
  await remove(ctx.db, 'endpoints', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'endpoint_deleted', resource: 'endpoint', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}
