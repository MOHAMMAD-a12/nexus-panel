// api/routes/generated.js — generation history (saved configs)
import { ok, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, queryOne, remove, count, nowSec } from '../../database/db.js';
import { NotFoundError } from '../../utils/error.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    transport: row.transport,
    security: row.security,
    server: row.server,
    port: row.port,
    tls: Boolean(row.tls),
    sni: row.sni || null,
    host: row.host || null,
    path: row.path || null,
    endpointId: row.endpoint_id || null,
    templateId: row.template_id || null,
    uri: row.uri,
    expiration: row.expiration || null,
    trafficLimit: row.traffic_limit || 0,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listGenerated(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.read')) throw new Error('forbidden');
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const protocol = url.searchParams.get('protocol') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '20', 10));
  const offset = (page - 1) * pageSize;

  const clauses = [];
  const params = [];
  if (search) { clauses.push('LOWER(name) LIKE ?'); params.push(`%${search}%`); }
  if (protocol) { clauses.push('protocol = ?'); params.push(protocol); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = await count(db, 'generated_configs', where, params);
  const rows = await query(db, `SELECT * FROM generated_configs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serialize), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function getGenerated(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.read')) throw new Error('forbidden');
  const row = await queryOne(ctx.db, 'SELECT * FROM generated_configs WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('Generated config not found');
  return ok({ ...serialize(row), json: row.json });
}

export async function deleteGenerated(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM generated_configs WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('Generated config not found');
  await remove(ctx.db, 'generated_configs', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'generated_deleted', resource: 'generated_config', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}
