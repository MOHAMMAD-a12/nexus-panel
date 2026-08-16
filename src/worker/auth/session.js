// auth/session.js — session mgmt (JWT in secure httpOnly cookie + CSRF token)
import { signJWT, verifyJWT } from '../utils/jwt.js';
import { verifyPassword, hashPassword } from '../utils/crypto.js';
import { getConfig } from '../utils/config.js';
import { saveSession, readSession, destroySession } from '../database/kv.js';
import { randomId } from '../utils/id.js';
import { nowSec } from '../database/db.js';
import { loadRolePermissions } from './permissions.js';

const COOKIE_NAME = 'nexus_session';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'nexus_csrf';

export function cookieName() {
  return COOKIE_NAME;
}
export function csrfHeader() {
  return CSRF_HEADER;
}

export async function createSession(env, kv, user, ttl) {
  const token = randomId('sess', 24);
  await saveSession(kv, token, user.id, ttl);
  const jwt = await signJWT({ sub: user.id, uid: user.id }, getConfig(env).jwtSecret, ttl);
  const csrf = randomId('csrf', 16);
  return { token, jwt, csrf, ttl };
}

export function sessionCookie(token, ttl, secure = true) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${ttl}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function csrfCookie(csrf, secure = true) {
  return `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Strict; Max-Age=86400${secure ? '; Secure' : ''}`;
}

export function clearCookies() {
  return {
    'set-cookie': [
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`,
    ],
  };
}

function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

export function getSessionToken(request) {
  const cookies = parseCookies(request);
  return cookies[COOKIE_NAME] || null;
}

export function getCsrfToken(request) {
  return request.headers.get(CSRF_HEADER) || '';
}

export async function getCurrentUser(db, kv, request, env) {
  const token = getSessionToken(request);
  if (!token) return null;
  const userId = await readSession(kv, token);
  if (!userId) return null;
  const user = await db
    .prepare(
      `SELECT u.id, u.username, u.email, u.display_name, u.status, u.role_id, u.last_login, u.created_at,
              r.permissions as permissions
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`
    )
    .bind(userId)
    .first();
  if (!user) return null;
  if (user.status === 'disabled') return null;
  try {
    user.permissions = JSON.parse(user.permissions);
  } catch {
    user.permissions = [];
  }
  return user;
}

// CSRF check for state-changing requests
export function validateCsrf(request) {
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  const cookies = parseCookies(request);
  const cookieCsrf = cookies[CSRF_COOKIE];
  const headerCsrf = getCsrfToken(request);
  if (!cookieCsrf || !headerCsrf) return false;
  return cookieCsrf === headerCsrf;
}

// Build the `set-cookie` header object returned on login. The value is an array
// of cookie strings (a single header object key cannot carry duplicates).
// `secure` should be true only when the response is served over HTTPS — a
// `Secure` cookie on a plain-HTTP origin (local dev) is dropped by the browser.
export function buildAuthCookies(env, session, secure = true) {
  return {
    'set-cookie': [sessionCookie(session.token, session.ttl, secure), csrfCookie(session.csrf, secure)],
  };
}
