// api/routes/configs.js
import { ok, created, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, queryOne, insert, update, remove, count, nowSec } from '../../database/db.js';
import { validateBody, isString, isInt, isIn, isBool, isArray, optional, toBool } from '../../utils/validate.js';
import { NotFoundError, ValidationError } from '../../utils/error.js';
import { randomId, uuid } from '../../utils/id.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';
import { generateConfig } from '../../services/configGenerator.js';
import { listProtocols, getProtocol, isSupported } from '../../services/protocols.js';

const PROTOCOLS = ['vless', 'vmess', 'trojan', 'shadowsocks', 'wireguard'];
const TRANSPORTS = ['tcp', 'ws', 'grpc', 'quic', 'h2', 'udp'];

function serializeConfig(row) {
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    nodeId: row.node_id,
    domainId: row.domain_id,
    clientId: row.client_id,
    uuid: row.uuid,
    protocol: row.protocol,
    transport: row.transport,
    tls: Boolean(row.tls),
    sni: row.sni,
    host: row.host,
    path: row.path,
    port: row.port,
    server: row.server,
    expiration: row.expiration,
    trafficLimit: row.traffic_limit,
    trafficUsed: row.traffic_used,
    status: row.status,
    notes: row.notes,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProtocolsRoute(ctx) {
  await authenticate(ctx);
  return ok(listProtocols());
}

export async function listConfigs(ctx) {
  await authenticate(ctx);
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const protocol = url.searchParams.get('protocol') || '';
  const status = url.searchParams.get('status') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '20', 10));
  const offset = (page - 1) * pageSize;

  let where = '';
  const params = [];
  if (search) {
    where += ' WHERE (LOWER(name) LIKE ? OR LOWER(uuid) LIKE ? OR LOWER(client_id) LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (protocol) {
    where += (where ? ' AND' : ' WHERE') + ' protocol = ?';
    params.push(protocol);
  }
  if (status) {
    where += (where ? ' AND' : ' WHERE') + ' status = ?';
    params.push(status);
  }
  const total = await count(db, 'configs', where, params);
  const rows = await query(db, `SELECT * FROM configs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serializeConfig), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function getConfigRoute(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, 'SELECT * FROM configs WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('Config not found');
  return ok(serializeConfig(row));
}

export async function createConfig(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || 'invalid',
    node_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    domain_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    client_id: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    uuid: (v) => isString(v, { min: 8, max: 120 }) || 'invalid',
    protocol: (v) => isIn(v, PROTOCOLS) || 'invalid',
    transport: (v) => isIn(v, TRANSPORTS) || 'invalid',
    tls: (v) => optional(v, isBool, 1),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => isInt(v, { min: 1, max: 65535 }) || 'invalid',
    server: (v) => isString(v, { min: 1, max: 255 }) || 'invalid',
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    traffic_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), 0),
    status: (v) => optional(v, (x) => isIn(x, ['active', 'disabled', 'expired']), 'active'),
    notes: (v) => optional(v, (x) => isString(x, { max: 2000 }), ''),
    tags: (v) => optional(v, isArray, []),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);

  const id = randomId('cfg', 10);
  const ts = nowSec();
  const tlsVal = clean.tls === undefined ? 1 : toBool(clean.tls) ? 1 : 0;
  await insert(ctx.db, 'configs', {
    id,
    name: clean.name,
    user_id: null,
    node_id: clean.node_id,
    domain_id: clean.domain_id,
    client_id: clean.client_id,
    uuid: clean.uuid,
    protocol: clean.protocol,
    transport: clean.transport || 'tcp',
    tls: tlsVal,
    sni: clean.sni || null,
    host: clean.host || null,
    path: clean.path || null,
    port: clean.port,
    server: clean.server,
    expiration: clean.expiration || null,
    traffic_limit: clean.traffic_limit || 0,
    traffic_used: 0,
    status: clean.status || 'active',
    notes: clean.notes || '',
    tags: clean.tags || [],
    created_at: ts,
    updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'config_created', resource: 'config', resourceId: id, ip: getClientIp(ctx.request), metadata: { protocol: clean.protocol, name: clean.name } });
  const row = await queryOne(ctx.db, 'SELECT * FROM configs WHERE id = ?', [id]);
  return created(serializeConfig(row));
}

export async function updateConfig(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM configs WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Config not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 120 }), undefined),
    node_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    domain_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    client_id: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    uuid: (v) => optional(v, (x) => isString(x, { min: 8, max: 120 }), undefined),
    protocol: (v) => optional(v, (x) => isIn(x, PROTOCOLS), undefined),
    transport: (v) => optional(v, (x) => isIn(x, TRANSPORTS), undefined),
    tls: (v) => optional(v, isBool, undefined),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => isInt(x, { min: 1, max: 65535 }), undefined),
    server: (v) => optional(v, (x) => isString(x, { min: 1, max: 255 }), undefined),
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    traffic_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), undefined),
    status: (v) => optional(v, (x) => isIn(x, ['active', 'disabled', 'expired']), undefined),
    notes: (v) => optional(v, (x) => isString(x, { max: 2000 }), undefined),
    tags: (v) => optional(v, isArray, undefined),
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError('Validation failed', errors);

  const data = {};
  for (const key of ['name', 'node_id', 'domain_id', 'client_id', 'uuid', 'protocol', 'transport', 'sni', 'host', 'path', 'port', 'server', 'expiration', 'traffic_limit', 'status', 'notes', 'tags']) {
    if (key in clean) data[key] = clean[key];
  }
  if (clean.tls !== undefined) data.tls = toBool(clean.tls) ? 1 : 0;
  data.updated_at = nowSec();
  await update(ctx.db, 'configs', ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: 'config_updated', resource: 'config', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, 'SELECT * FROM configs WHERE id = ?', [ctx.params.id]);
  return ok(serializeConfig(row));
}

export async function deleteConfig(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM configs WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Config not found');
  await remove(ctx.db, 'configs', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'config_deleted', resource: 'config', resourceId: ctx.params.id, ip: getClientIp(ctx.request), metadata: { name: existing.name } });
  return ok({ id: ctx.params.id });
}

export async function generateConfigRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    protocol: (v) => isString(v, { min: 1 }) || 'invalid',
    server: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    domain: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    port: (v) => optional(v, (x) => isInt(x, { min: 1, max: 65535 }), null),
    transport: (v) => optional(v, (x) => isIn(x, TRANSPORTS), 'tcp'),
    tls: (v) => optional(v, isBool, 1),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    uuid: (v) => optional(v, (x) => isString(x, { min: 8, max: 120 }), null),
    clientId: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    trafficLimit: (v) => optional(v, (x) => isInt(x, { min: 0 }), 0),
    tag: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  if (!isSupported(clean.protocol)) throw new ValidationError(`Unsupported protocol: ${clean.protocol}`);
  if (!clean.server && !clean.domain) throw new ValidationError('server or domain required');

  const out = generateConfig({
    protocol: clean.protocol,
    server: clean.server,
    domain: clean.domain,
    port: clean.port,
    transport: clean.transport || 'tcp',
    tls: clean.tls === undefined ? 1 : toBool(clean.tls),
    sni: clean.sni,
    host: clean.host,
    path: clean.path,
    uuid: clean.uuid,
    clientId: clean.clientId,
    tag: clean.tag,
    expiration: clean.expiration,
    trafficLimit: clean.trafficLimit,
  });
  return ok(out);
}
