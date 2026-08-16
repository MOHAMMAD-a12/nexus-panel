// api/routes/settings.js
import { ok } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { query, queryOne, insert, update } from '../../database/db.js';
import { validateBody, isString, isIn, isArray, optional } from '../../utils/validate.js';
import { ValidationError } from '../../utils/error.js';
import { nowSec } from '../../database/db.js';
import { getConfig } from '../../utils/config.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';
import { listCredentials, addCredential, rotateCredential, deleteCredential } from '../../auth/credentials.js';

const GROUPS = ['general', 'appearance', 'security', 'api', 'cloudflare', 'database', 'notifications', 'domains', 'subscriptions', 'system'];

export async function getSettings(ctx) {
  await authenticate(ctx);
  const rows = await query(ctx.db, 'SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) {
    const [group, key] = r.key.split(':');
    out[group] = out[group] || {};
    try { out[group][key] = JSON.parse(r.value); } catch { out[group][key] = r.value; }
  }
  return ok(out);
}

export async function getSettingGroup(ctx) {
  await authenticate(ctx);
  const group = ctx.params.group;
  if (!GROUPS.includes(group)) throw new ValidationError('Unknown group');
  const rows = await query(ctx.db, 'SELECT key, value FROM settings WHERE key LIKE ?', [`${group}:%`]);
  const out = {};
  for (const r of rows) {
    const key = r.key.split(':')[1];
    try { out[key] = JSON.parse(r.value); } catch { out[key] = r.value; }
  }
  return ok(out);
}

export async function updateSettingGroup(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'settings.write')) throw new Error('forbidden');
  const group = ctx.params.group;
  if (!GROUPS.includes(group)) throw new ValidationError('Unknown group');
  const body = await ctx.request.json().catch(() => ({}));
  const ts = nowSec();
  for (const [k, v] of Object.entries(body)) {
    const key = `${group}:${k}`;
    const existing = await queryOne(ctx.db, 'SELECT key FROM settings WHERE key = ?', [key]);
    const valStr = JSON.stringify(v);
    if (existing) await update(ctx.db, 'settings', key, { value: valStr, updated_at: ts }, 'key');
    else await insert(ctx.db, 'settings', { key, value: valStr, updated_at: ts });
  }
  await audit(ctx.db, { user: ctx.user, action: 'settings_updated', resource: 'settings', resourceId: group, ip: getClientIp(ctx.request) });
  return ok({ group });
}

// Credential manager (Cloudflare tokens) — never exposes raw token
export async function listCredentialsRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.read')) throw new Error('forbidden');
  const creds = await listCredentials(ctx.kv);
  return ok(creds);
}

export async function addCredentialRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    label: (v) => optional(v, (x) => isString(x, { max: 120 }), 'Cloudflare Token'),
    tokenValue: (v) => isString(v, { min: 10 }) || 'invalid',
    accountId: (v) => optional(v, (x) => isString(x, { max: 120 }), ''),
    scope: (v) => optional(v, (x) => Array.isArray(x), []),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const secret = getConfig(ctx.env).encryptionKey;
  const id = await addCredential(ctx.kv, {
    label: clean.label, type: 'cloudflare', accountId: clean.accountId,
    tokenValue: clean.tokenValue, secret, scope: clean.scope,
  });
  await audit(ctx.db, { user: ctx.user, action: 'credential_added', resource: 'credential', resourceId: id, ip: getClientIp(ctx.request) });
  return ok({ id });
}

export async function rotateCredentialRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.write')) throw new Error('forbidden');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean } = validateBody(body, { tokenValue: (v) => isString(v, { min: 10 }) || 'invalid' });
  if (!valid) throw new ValidationError('Validation failed');
  const secret = getConfig(ctx.env).encryptionKey;
  await rotateCredential(ctx.kv, ctx.params.id, clean.tokenValue, secret);
  await audit(ctx.db, { user: ctx.user, action: 'credential_rotated', resource: 'credential', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}

export async function deleteCredentialRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'cloudflare.write')) throw new Error('forbidden');
  await deleteCredential(ctx.kv, ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: 'credential_deleted', resource: 'credential', resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}
