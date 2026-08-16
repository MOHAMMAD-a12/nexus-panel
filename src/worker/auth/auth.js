// auth/auth.js — authentication + authorization middleware for routes
import { getCurrentUser, validateCsrf } from './session.js';
import { hasPermission } from './permissions.js';
import { AppError, AuthError, ForbiddenError } from '../utils/error.js';
import { getConfig } from '../utils/config.js';

// Authenticate: returns user or throws AuthError.
// If a session/identity was already resolved upstream (e.g. API-key or cookie),
// reuse it; otherwise look up the session cookie.
export async function authenticate(ctx) {
  if (ctx.user) return ctx.user;
  const { db, kv, request, env } = ctx;
  const user = await getCurrentUser(db, kv, request, env);
  if (!user) throw new AuthError('Authentication required');
  ctx.user = user;
  return user;
}

// Authorize: checks a required permission
export function authorize(ctx, permission) {
  if (!hasPermission(ctx.user, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

// Higher-order: require a permission for the handler
export function withAuth(handler, permission) {
  return async (ctx) => {
    await authenticate(ctx);
    if (permission) authorize(ctx, permission);
    return handler(ctx);
  };
}

// CSRF guard
export function guardCsrf(ctx) {
  const cfg = getConfig(ctx.env);
  if (cfg.environment === 'development' && cfg.demoMode) return; // relax in pure demo
  if (!validateCsrf(ctx.request)) {
    throw new ForbiddenError('Invalid or missing CSRF token');
  }
}

export function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
