// auth/apikey.js — authenticate API requests via Bearer token (server-to-server)
import { hmac } from '../utils/crypto.js';
import { queryOne, update } from '../database/db.js';
import { hasPermission } from './permissions.js';
import { getConfig } from '../utils/config.js';

export async function authenticateApiKey(db, authHeader, env) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const raw = authHeader.slice(7).trim();
  if (!raw) return null;
  const prefix = raw.slice(0, 11);
  const row = await db.prepare('SELECT * FROM api_keys WHERE key_prefix = ? AND status = ?').bind(prefix, 'active').first();
  if (!row) return null;
  const secret = getConfig(env).encryptionKey;
  const expected = await hmac(secret, raw);
  if (expected !== row.key_hash) return null;
  // expiration check
  if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    scopes: safeParse(row.scopes, []),
    rateLimit: row.rate_limit,
  };
}

export function hasApiScope(key, scope) {
  if (!key) return false;
  if (key.scopes.includes('*')) return true;
  if (key.scopes.includes(scope)) return true;
  const [cat] = scope.split('.');
  return key.scopes.includes(`${cat}.*`);
}

function safeParse(str, fallback) {
  try { const v = JSON.parse(str); return Array.isArray(v) ? v : fallback; } catch { return fallback; }
}
