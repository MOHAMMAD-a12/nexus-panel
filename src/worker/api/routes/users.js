// api/routes/users.js
import { ok, created, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, queryOne, insert, update, remove, count, nowSec } from '../../database/db.js';
import { validateBody, isString, isEmail, isIn, optional, toBool } from '../../utils/validate.js';
import { NotFoundError, ValidationError, ConflictError } from '../../utils/error.js';
import { randomId } from '../../utils/id.js';
import { hashPassword } from '../../utils/crypto.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';

const ROLES = ['role_admin', 'role_operator', 'role_viewer'];

function serializeUser(row) {
  return {
    id: row.id, username: row.username, email: row.email, displayName: row.display_name,
    roleId: row.role_id, status: row.status, lastLogin: row.last_login,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listUsers(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'users.read')) throw new Error('forbidden');
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get('pageSize') || '20', 10));
  const offset = (page - 1) * pageSize;
  let where = ''; const params = [];
  if (search) { where += ' WHERE (LOWER(username) LIKE ? OR LOWER(email) LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const total = await count(db, 'users', where, params);
  const rows = await query(db, `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serializeUser), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function getUser(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'users.read')) throw new Error('forbidden');
  const row = await queryOne(ctx.db, 'SELECT * FROM users WHERE id = ?', [ctx.params.id]);
  if (!row) throw new NotFoundError('User not found');
  return ok(serializeUser(row));
}

export async function createUser(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'users.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    username: (v) => isString(v, { min: 3, max: 60 }) || 'invalid',
    email: (v) => isEmail(v) || 'invalid',
    password: (v) => isString(v, { min: 8, max: 200 }) || 'invalid',
    role_id: (v) => isIn(v, ROLES) || 'invalid',
    display_name: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    status: (v) => optional(v, (x) => isIn(x, ['active', 'disabled']), 'active'),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const exU = await queryOne(ctx.db, 'SELECT id FROM users WHERE username = ?', [clean.username]);
  if (exU) throw new ConflictError('Username already exists');
  const exE = await queryOne(ctx.db, 'SELECT id FROM users WHERE email = ?', [clean.email]);
  if (exE) throw new ConflictError('Email already exists');
  const id = randomId('usr', 10);
  const hash = await hashPassword(clean.password);
  const ts = nowSec();
  await insert(ctx.db, 'users', {
    id, username: clean.username, email: clean.email, password_hash: hash,
    role_id: clean.role_id, display_name: clean.display_name || clean.username,
    status: clean.status || 'active', last_login: null, created_at: ts, updated_at: ts,
  });
  await audit(ctx.db, { user: ctx.user, action: 'user_created', resource: 'user', resourceId: id, ip: getClientIp(ctx.request), metadata: { username: clean.username, role: clean.role_id } });
  const row = await queryOne(ctx.db, 'SELECT * FROM users WHERE id = ?', [id]);
  return created(serializeUser(row));
}

export async function updateUser(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'users.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM users WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('User not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    username: (v) => optional(v, (x) => isString(x, { min: 3, max: 60 }), undefined),
    email: (v) => optional(v, isEmail, undefined),
    password: (v) => optional(v, (x) => isString(x, { min: 8, max: 200 }), undefined),
    role_id: (v) => optional(v, (x) => isIn(x, ROLES), undefined),
    display_name: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    status: (v) => optional(v, (x) => isIn(x, ['active', 'disabled']), undefined),
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const data = {};
  for (const k of ['username', 'email', 'role_id', 'display_name', 'status']) if (k in clean) data[k] = clean[k];
  if (clean.password) data.password_hash = await hashPassword(clean.password);
  data.updated_at = nowSec();
  await update(ctx.db, 'users', ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: 'user_updated', resource: 'user', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, 'SELECT * FROM users WHERE id = ?', [ctx.params.id]);
  return ok(serializeUser(row));
}

export async function deleteUser(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'users.write')) throw new Error('forbidden');
  const existing = await queryOne(ctx.db, 'SELECT * FROM users WHERE id = ?', [ctx.params.id]);
  if (!existing) throw new NotFoundError('User not found');
  if (existing.role_id === 'role_admin') {
    const admins = await count(ctx.db, 'users', 'WHERE role_id = ?', ['role_admin']);
    if (admins <= 1) throw new ValidationError('Cannot delete the last admin');
  }
  await remove(ctx.db, 'users', ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'user_deleted', resource: 'user', resourceId: ctx.params.id, ip: getClientIp(ctx.request), metadata: { username: existing.username } });
  return ok({ id: ctx.params.id });
}
