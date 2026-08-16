// utils/logger.js — structured logging + audit log persistence
import { randomId } from './id.js';
import { nowSec } from '../database/db.js';

// Sensitive keys that must never be logged
const SENSITIVE = [
  'password',
  'password_hash',
  'token',
  'api_token',
  'authorization',
  'cookie',
  'credentials',
  'secret',
  'key',
  'jwt',
  'cf_token',
];

export function sanitize(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).toLowerCase();
    if (SENSITIVE.some((s) => key.includes(s))) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function log(level, message, meta = {}) {
  const entry = {
    level,
    ts: new Date().toISOString(),
    msg: message,
    ...sanitize(meta),
  };
  // Not console.log in prod-sensitive contexts; keep structured.
  try {
    console.log(JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

// Audit log: persists an action to audit_logs table (best-effort)
export async function audit(db, { user, action, resource, resourceId, ip, status = 'success', metadata = {} }) {
  const id = randomId('aud');
  const ts = nowSec();
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, username, action, resource, resource_id, ip, status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        user?.id || null,
        user?.username || 'system',
        action,
        resource || null,
        resourceId || null,
        ip || null,
        status,
        JSON.stringify(sanitize(metadata)),
        ts
      )
      .run();
  } catch (e) {
    log('error', 'audit_log_failed', { error: String(e) });
  }
  return id;
}
