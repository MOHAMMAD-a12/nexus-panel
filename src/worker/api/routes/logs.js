// api/routes/logs.js — audit log query + export
import { ok, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, count, nowSec } from '../../database/db.js';
import { getClientIp } from '../../auth/auth.js';

export async function listLogs(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'logs.read')) throw new Error('forbidden');
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const action = url.searchParams.get('action') || '';
  const status = url.searchParams.get('status') || '';
  const from = parseInt(url.searchParams.get('from') || '0', 10);
  const to = parseInt(url.searchParams.get('to') || '0', 10);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '20', 10));
  const offset = (page - 1) * pageSize;

  const whereParts = [];
  const params = [];
  if (search) { whereParts.push('(LOWER(username) LIKE ? OR LOWER(action) LIKE ? OR LOWER(resource) LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (action) { whereParts.push('action = ?'); params.push(action); }
  if (status) { whereParts.push('status = ?'); params.push(status); }
  if (from) { whereParts.push('created_at >= ?'); params.push(from); }
  if (to) { whereParts.push('created_at <= ?'); params.push(to); }
  const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';

  const total = await count(db, 'audit_logs', where, params);
  const rows = await query(db, `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows, { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function exportLogs(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'logs.read')) throw new Error('forbidden');
  const rows = await query(ctx.db, 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5000');
  return ok(rows);
}
