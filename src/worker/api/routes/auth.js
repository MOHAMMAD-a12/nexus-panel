// api/routes/auth.js
import { json, ok, error } from '../../utils/response.js';
import { verifyPassword } from '../../utils/crypto.js';
import { createSession, buildAuthCookies, clearCookies, getSessionToken } from '../../auth/session.js';
import { getCurrentUser } from '../../auth/session.js';
import { getConfig } from '../../utils/config.js';
import { validateBody, isString, isEmail } from '../../utils/validate.js';
import { AppError, AuthError, ValidationError } from '../../utils/error.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';
import { nowSec } from '../../database/db.js';

export async function login(ctx) {
  const { db, kv, request, env } = ctx;
  const body = await request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    email: (v) => isEmail(v) || isString(v, { min: 2 }),
    password: (v) => isString(v, { min: 1 }),
  });
  if (!valid) throw new ValidationError('Invalid credentials payload', errors);

  const user = await db
    .prepare('SELECT * FROM users WHERE email = ? OR username = ?')
    .bind(clean.email, clean.email)
    .first();
  if (!user || user.status === 'disabled') {
    await audit(db, { action: 'login_failed', resource: 'auth', ip: getClientIp(request), status: 'failure', metadata: { email: clean.email } });
    throw new AuthError('Invalid email or password');
  }
  const match = await verifyPassword(clean.password, user.password_hash);
  if (!match) {
    await audit(db, { action: 'login_failed', user: { id: user.id, username: user.username }, resource: 'auth', ip: getClientIp(request), status: 'failure' });
    throw new AuthError('Invalid email or password');
  }

  const cfg = getConfig(env);
  const session = await createSession(env, kv, user, cfg.sessionTtl);
  await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(nowSec(), user.id).run();
  await audit(db, { user: { id: user.id, username: user.username }, action: 'login', resource: 'auth', ip: getClientIp(request), status: 'success' });

  // Only mark cookies `Secure` when the request itself is over HTTPS. Local dev
  // runs on plain HTTP, where a `Secure` cookie would be silently dropped.
  const proto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol;
  const secure = proto.startsWith('https');
  return json(
    { ok: true, data: publicUser(user), csrf: session.csrf, ts: nowSec() },
    200,
    buildAuthCookies(env, session, secure)
  );
}

export async function logout(ctx) {
  const { kv, request } = ctx;
  const token = getSessionToken(request);
  if (token) await kv.delete(`sess:${token}`).catch(() => {});
  return json({ ok: true }, 200, clearCookies());
}

export async function me(ctx) {
  const user = await getCurrentUser(ctx.db, ctx.kv, ctx.request, ctx.env);
  if (!user) throw new AuthError();
  return ok(publicUser(user));
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    roleId: u.role_id,
    status: u.status,
    permissions: u.permissions,
    lastLogin: u.last_login,
    createdAt: u.created_at,
  };
}
