// api/routes/templates.js — user-defined generation templates
// Templates store ONLY the parameters needed to regenerate a config. Secrets
// (UUID/password) are regenerated or filled from the store at generation time and
// are never returned in plaintext by list/detail endpoints unless explicitly safe.
import { ok, created, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { insert, query, queryOne, update, remove, count, nowSec } from '../../database/db.js';
import { validateBody, isString, isIn, isArray, optional } from '../../utils/validate.js';
import { ValidationError, NotFoundError } from '../../utils/error.js';
import { randomId } from '../../utils/id.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    transport: row.transport,
    tls: Boolean(row.tls),
    server: row.server || null,
    domain: row.domain || null,
    port: row.port || null,
    sni: row.sni || null,
    host: row.host || null,
    path: row.path || null,
    alpn: row.alpn || null,
    fingerprint: row.fingerprint || null,
    flow: row.flow || null,
    fragment: row.fragment || null,
    method: row.method || null,
    tags: row.tags,
    description: row.description || '',
    usageCount: row.usage_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTemplates(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.read')) throw new Error('forbidden');
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '20', 10));
  const offset = (page - 1) * pageSize;

  let where = '';
  const params = [];
  if (search) { where = 'WHERE LOWER(name) LIKE ?'; params.push(`%${search}%`); }
  const total = await count(db, 'templates', where, params);
  const rows = await query(db, `SELECT * FROM templates ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serialize), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function createTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || 'invalid',
    protocol: (v) => isIn(v, ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks5', 'http', 'https', 'wireguard']) || 'invalid',
    transport: (v) => optional(v, (x) => isString(x, { max: 16 }), 'tcp'),
    tls: (v) => optional(v, (x) => x === true || x === false, true),
    server: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => Number(x) >= 1 && Number(x) <= 65535, null),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    alpn: (v) => optional(v, (x) => isArray(x) || isString(x), null),
    fingerprint: (v) => optional(v, (x) => isString(x, { max: 32 }), null),
    flow: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    fragment: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    method: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    description: (v) => optional(v, (x) => isString(x, { max: 500 }), ''),
    tags: (v) => optional(v, isArray, []),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);

  const id = randomId('tpl', 10);
  const ts = nowSec();
  await insert(ctx.db, 'templates', {
    id, name: clean.name, protocol: clean.protocol, transport: clean.transport || 'tcp',
    tls: clean.tls ? 1 : 0, server: clean.server || null, domain: clean.domain || null,
    port: clean.port || null, sni: clean.sni || null, host: clean.host || null, path: clean.path || null,
    alpn: clean.alpn || null, fingerprint: clean.fingerprint || null, flow: clean.flow || null,
    fragment: clean.fragment || null, method: clean.method || null, description: clean.description || '',
    tags: clean.tags || [], usage_count: 0, created_at: ts, updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'template_created', resource: 'template', resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, 'SELECT * FROM templates WHERE id = ?', [id]);
  return created(serialize(row));
}

export async function getTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.read')) throw new Error('forbidden');
  const row = await queryOne(ctx.db, 'SELECT * FROM templates WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('Template not found');
  return ok(serialize(row));
}

export async function updateTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM templates WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Template not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 120 }), undefined),
    protocol: (v) => optional(v, (x) => isIn(x, ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks5', 'http', 'https', 'wireguard']), undefined),
    transport: (v) => optional(v, (x) => isString(x, { max: 16 }), undefined),
    tls: (v) => optional(v, (x) => x === true || x === false, undefined),
    server: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => Number(x) >= 1 && Number(x) <= 65535, null),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    alpn: (v) => optional(v, (x) => isArray(x) || isString(x), null),
    fingerprint: (v) => optional(v, (x) => isString(x, { max: 32 }), null),
    flow: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    fragment: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    method: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    description: (v) => optional(v, (x) => isString(x, { max: 500 }), undefined),
    tags: (v) => optional(v, isArray, undefined),
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const data = {};
  for (const k of ['name', 'protocol', 'transport', 'server', 'domain', 'sni', 'host', 'path', 'alpn', 'fingerprint', 'flow', 'fragment', 'method', 'description', 'tags']) {
    if (k in clean) data[k] = clean[k];
  }
  if (clean.tls !== undefined) data.tls = clean.tls ? 1 : 0;
  if (clean.port !== undefined) data.port = clean.port;
  data.updated_at = nowSec();
  await update(ctx.db, 'templates', ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: 'template_updated', resource: 'template', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, 'SELECT * FROM templates WHERE id = ?', [ctx.params.id]);
  return ok(serialize(row));
}

export async function deleteTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM templates WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Template not found');
  await remove(ctx.db, 'templates', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'template_deleted', resource: 'template', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}

// Duplicate: copy params into a new template (no secrets carried over).
export async function duplicateTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM templates WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Template not found');
  const id = randomId('tpl', 10);
  const ts = nowSec();
  await insert(ctx.db, 'templates', {
    id, name: `${existing.name} (copy)`, protocol: existing.protocol, transport: existing.transport,
    tls: existing.tls, server: existing.server, domain: existing.domain, port: existing.port,
    sni: existing.sni, host: existing.host, path: existing.path, alpn: existing.alpn,
    fingerprint: existing.fingerprint, flow: existing.flow, fragment: existing.fragment,
    method: existing.method, description: existing.description, tags: existing.tags,
    usage_count: 0, created_at: ts, updated_at: ts,
  });
  const row = await queryOne(ctx.db, 'SELECT * FROM templates WHERE id = ?', [id]);
  return created(serialize(row));
}
