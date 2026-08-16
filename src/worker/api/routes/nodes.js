// api/routes/nodes.js
import { ok, created, paginated, error } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, queryOne, insert, update, remove, count, nowSec } from '../../database/db.js';
import { validateBody, isString, isInt, isIn, isBool, optional, toBool } from '../../utils/validate.js';
import { NotFoundError, ValidationError, ConflictError } from '../../utils/error.js';
import { randomId } from '../../utils/id.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';

const PROTOCOLS = ['vless', 'vmess', 'trojan', 'shadowsocks', 'wireguard'];

function nodeSchema(required = false) {
  const need = (v, fn) => (required ? fn(v) : optional(v, fn, undefined));
  return {
    name: (v) => isString(v, { min: 1, max: 120 }) || 'invalid',
    address: (v) => isString(v, { min: 1, max: 255 }) || 'invalid',
    domain_id: (v) => (v === undefined || v === null || v === '' ? undefined : isString(v, { min: 1 }) || 'invalid'),
    port: (v) => isInt(v, { min: 1, max: 65535 }) || 'invalid',
    protocol: (v) => isIn(v, PROTOCOLS) || 'invalid',
    region: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    country: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    enabled: (v) => optional(v, isBool, 1),
    notes: (v) => optional(v, (x) => isString(x, { max: 2000 }), ''),
  };
}

function serializeNode(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    domainId: row.domain_id,
    port: row.port,
    protocol: row.protocol,
    status: row.status,
    region: row.region,
    country: row.country,
    latency: row.latency,
    uptime: row.uptime,
    trafficUp: row.traffic_up,
    trafficDown: row.traffic_down,
    lastSeen: row.last_seen,
    enabled: Boolean(row.enabled),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listNodes(ctx) {
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
  if (search) {
    where += ' WHERE (LOWER(name) LIKE ? OR LOWER(address) LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    where += (where ? ' AND' : ' WHERE') + ' status = ?';
    params.push(status);
  }

  const total = await count(db, 'nodes', where, params);
  const rows = await query(
    db,
    `SELECT * FROM nodes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  return paginated(rows.map(serializeNode), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function getNode(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('Node not found');
  return ok(serializeNode(row));
}

export async function createNode(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'nodes.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, nodeSchema(true));
  if (!valid) throw new ValidationError('Validation failed', errors);

  const id = randomId('node', 10);
  const ts = nowSec();
  await insert(ctx.db, 'nodes', {
    id,
    name: clean.name,
    address: clean.address,
    domain_id: clean.domain_id ?? null,
    port: clean.port,
    protocol: clean.protocol || 'vless',
    status: 'offline',
    region: clean.region ?? null,
    country: clean.country ?? null,
    latency: null,
    uptime: 0,
    traffic_up: 0,
    traffic_down: 0,
    last_seen: null,
    enabled: clean.enabled === undefined ? 1 : toBool(clean.enabled) ? 1 : 0,
    notes: clean.notes ?? '',
    created_at: ts,
    updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'node_created', resource: 'node', resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [id]);
  return created(serializeNode(row));
}

export async function updateNode(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'nodes.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Node not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, nodeSchema(false), { allowUnknown: true });
  if (!valid) throw new ValidationError('Validation failed', errors);

  const data = {};
  if (clean.name !== undefined) data.name = clean.name;
  if (clean.address !== undefined) data.address = clean.address;
  if ('domain_id' in clean) data.domain_id = clean.domain_id ?? null;
  if (clean.port !== undefined) data.port = clean.port;
  if (clean.protocol !== undefined) data.protocol = clean.protocol;
  if (clean.region !== undefined) data.region = clean.region;
  if (clean.country !== undefined) data.country = clean.country;
  if (clean.notes !== undefined) data.notes = clean.notes;
  if (clean.enabled !== undefined) data.enabled = toBool(clean.enabled) ? 1 : 0;
  data.updated_at = nowSec();

  await update(ctx.db, 'nodes', ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: 'node_updated', resource: 'node', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [ctx.params.id]);
  return ok(serializeNode(row));
}

export async function deleteNode(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'nodes.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Node not found');
  await remove(ctx.db, 'nodes', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'node_deleted', resource: 'node', resourceId: ctx.params.id, ip: getClientIp(ctx.request), metadata: { name: existing.name } });
  return ok({ id: ctx.params.id });
}

export async function duplicateNode(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'nodes.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Node not found');
  const id = randomId('node', 10);
  const ts = nowSec();
  await insert(ctx.db, 'nodes', {
    id,
    name: existing.name + ' (copy)',
    address: existing.address,
    domain_id: existing.domain_id,
    port: existing.port,
    protocol: existing.protocol,
    status: 'offline',
    region: existing.region,
    country: existing.country,
    latency: null,
    uptime: 0,
    traffic_up: 0,
    traffic_down: 0,
    last_seen: null,
    enabled: 0,
    notes: existing.notes,
    created_at: ts,
    updated_at: ts,
  });
  const row = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [id]);
  await audit(ctx.db, { user: ctx.user, action: 'node_duplicated', resource: 'node', resourceId: id, ip: getClientIp(ctx.request) });
  return created(serializeNode(row));
}

// Health check: simulate reachability + latency (real check would use a probe)
export async function healthCheck(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'nodes.write')) throw new Error('forbidden');
  const node = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [ctx.params.id]);
  if (!node) throw new NotFoundError('Node not found');

  // Deterministic-ish latency from address hash (no Math.random in worker-bound logic beyond allowed)
  const hash = [...node.address].reduce((a, c) => a + c.charCodeAt(0), 0);
  const latency = 15 + (hash % 120);
  const online = latency < 200;
  const status = online ? 'online' : 'warning';
  const ts = nowSec();
  await update(ctx.db, 'nodes', node.id, {
    latency,
    status,
    last_seen: ts,
    uptime: online ? 99.9 : 95.0,
    updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'node_health_check', resource: 'node', resourceId: node.id, ip: getClientIp(ctx.request), metadata: { latency, status } });
  const row = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [node.id]);
  return ok(serializeNode(row));
}

export async function pingNode(ctx) {
  await authenticate(ctx);
  const node = await queryOne(ctx.db, 'SELECT * FROM nodes WHERE id = ?', [ctx.params.id]);
  if (!node) throw new NotFoundError('Node not found');
  const hash = [...node.address].reduce((a, c) => a + c.charCodeAt(0), 0);
  const latency = 10 + (hash % 90);
  return ok({ id: node.id, latency, alive: latency < 150, ts: nowSec() });
}
