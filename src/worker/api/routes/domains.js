// api/routes/domains.js
import { ok, created, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, queryOne, insert, update, remove, count, nowSec } from '../../database/db.js';
import { validateBody, isString, isIn, isBool, optional, toBool } from '../../utils/validate.js';
import { NotFoundError, ValidationError } from '../../utils/error.js';
import { randomId } from '../../utils/id.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';
import { getZone, verifyZone, getZoneStatus } from '../../cloudflare/zones.js';
import { listZones } from '../../cloudflare/zones.js';

const STATUSES = ['pending', 'verified', 'online', 'offline', 'dns_error', 'ssl_error'];

function serializeDomain(row) {
  return {
    id: row.id,
    name: row.name,
    zoneId: row.zone_id,
    status: row.status,
    dnsStatus: row.dns_status,
    sslStatus: row.ssl_status,
    proxyStatus: Boolean(row.proxy_status),
    nameservers: row.nameservers,
    verifiedAt: row.verified_at,
    lastCheck: row.last_check,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDomains(ctx) {
  await authenticate(ctx);
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const status = url.searchParams.get('status') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '20', 10));
  const offset = (page - 1) * pageSize;
  let where = '';
  const params = [];
  if (search) { where += ' WHERE LOWER(name) LIKE ?'; params.push(`%${search}%`); }
  if (status) { where += (where ? ' AND' : ' WHERE') + ' status = ?'; params.push(status); }
  const total = await count(db, 'domains', where, params);
  const rows = await query(db, `SELECT * FROM domains ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serializeDomain), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function getDomain(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('Domain not found');
  return ok(serializeDomain(row));
}

export async function createDomain(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'domains.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 3, max: 255 }) || 'invalid',
    zone_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const exists = await queryOne(ctx.db, 'SELECT id FROM domains WHERE name = ?', [clean.name]);
  if (exists) throw new ValidationError('Domain already exists', { name: 'exists' });

  const id = randomId('dom', 10);
  const ts = nowSec();
  await insert(ctx.db, 'domains', {
    id, name: clean.name, zone_id: clean.zone_id || null,
    status: 'pending', dns_status: 'unknown', ssl_status: 'unknown',
    proxy_status: 1, nameservers: [], verified_at: null, last_check: null, error: null,
    created_at: ts, updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'domain_created', resource: 'domain', resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [id]);
  return created(serializeDomain(row));
}

export async function updateDomain(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'domains.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Domain not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 3, max: 255 }), undefined),
    zone_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    status: (v) => optional(v, (x) => isIn(x, STATUSES), undefined),
    proxy_status: (v) => optional(v, isBool, undefined),
    error: (v) => optional(v, (x) => isString(x, { max: 500 }), null),
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const data = {};
  for (const k of ['name', 'zone_id', 'status', 'error']) if (k in clean) data[k] = clean[k];
  if ('proxy_status' in clean) data.proxy_status = toBool(clean.proxy_status) ? 1 : 0;
  data.updated_at = nowSec();
  await update(ctx.db, 'domains', ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: 'domain_updated', resource: 'domain', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  return ok(serializeDomain(row));
}

export async function deleteDomain(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'domains.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Domain not found');
  await remove(ctx.db, 'domains', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'domain_deleted', resource: 'domain', resourceId: ctx.params.id, ip: getClientIp(ctx.request), metadata: { name: existing.name } });
  return ok({ id: ctx.params.id });
}

export async function verifyDomain(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'domains.write')) throw new Error('forbidden');
  const domain = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!domain) throw new NotFoundError('Domain not found');
  try {
    if (domain.zone_id) {
      const status = await getZoneStatus(ctx.env, ctx.kv, domain.zone_id);
      const dns = status?.dns?.status === 'active' ? 'active' : 'error';
      const ssl = status?.ssl?.status === 'active' ? 'active' : (status?.ssl?.status || 'unknown');
      const newStatus = dns === 'active' ? (ssl === 'active' ? 'online' : 'ssl_error') : 'dns_error';
      await update(ctx.db, 'domains', domain.id, {
        dns_status: dns, ssl_status: ssl, status: newStatus,
        verified_at: nowSec(), last_check: nowSec(), error: null, updated_at: nowSec(),
      });
      await audit(ctx.db, { user: ctx.user, action: 'domain_verified', resource: 'domain', resourceId: domain.id, ip: getClientIp(ctx.request), metadata: { status: newStatus } });
      const row = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [domain.id]);
      return ok(serializeDomain(row));
    }
    await update(ctx.db, 'domains', domain.id, { status: 'verified', verified_at: nowSec(), last_check: nowSec(), updated_at: nowSec() });
    const row = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [domain.id]);
    return ok(serializeDomain(row));
  } catch (e) {
    await update(ctx.db, 'domains', domain.id, { status: 'dns_error', last_check: nowSec(), error: String(e.message || e), updated_at: nowSec() });
    throw e;
  }
}

// Pull zones from Cloudflare into the panel
export async function syncCloudflareZones(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.read')) throw new Error('forbidden');
  const result = await listZones(ctx.env, ctx.kv, { per_page: 50 });
  const zones = result.zones || result.result || [];
  const imported = [];
  for (const z of zones) {
    const exists = await queryOne(ctx.db, 'SELECT id FROM domains WHERE name = ?', [z.name]);
    if (exists) { imported.push({ name: z.name, status: 'exists' }); continue; }
    const id = randomId('dom', 10);
    const ts = nowSec();
    await insert(ctx.db, 'domains', {
      id, name: z.name, zone_id: z.id,
      status: z.status === 'active' ? 'online' : 'pending',
      dns_status: 'unknown', ssl_status: 'unknown', proxy_status: 1,
      nameservers: z.name_servers || [], verified_at: null, last_check: ts, error: null,
      created_at: ts, updated_at: ts,
    });
    imported.push({ name: z.name, status: 'imported' });
  }
  await audit(ctx.db, { user: ctx.user, action: 'domains_synced', resource: 'domain', ip: getClientIp(ctx.request), metadata: { count: imported.length } });
  return ok({ imported });
}
