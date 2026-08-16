// auth/credentials.js — Credential Manager for Cloudflare API tokens
// Tokens are NEVER exposed to the client in plaintext. Stored encrypted in KV.
// Supports masking, rotation, validation, permission scope checks, and audit.
import { encryptSecret, decryptSecret, sha256 } from '../utils/crypto.js';
import { randomId, token } from '../utils/id.js';
import { nowSec } from '../database/db.js';
import { kvGetJSON, kvSetJSON, kvDelete } from '../database/kv.js';
import { audit } from '../utils/logger.js';

const CRED_PREFIX = 'cred:';

export function maskToken(t) {
  if (!t || t.length < 12) return '••••';
  return `${t.slice(0, 6)}${'•'.repeat(Math.max(4, t.length - 10))}${t.slice(-4)}`;
}

// List credential metadata (no secrets)
export async function listCredentials(kv) {
  const ids = (await kvGetJSON(kv, 'cred:index', [])) || [];
  const out = [];
  for (const id of ids) {
    const c = await kvGetJSON(kv, CRED_PREFIX + id);
    if (!c) continue;
    out.push({
      id: c.id,
      label: c.label,
      type: c.type,
      account_id: c.account_id,
      masked: maskToken(c.hint),
      scope: c.scope || [],
      last_validated: c.last_validated || null,
      last_used: c.last_used || null,
      status: c.status,
      created_at: c.created_at,
      updated_at: c.updated_at,
    });
  }
  return out;
}

export async function getCredential(kv, id) {
  return kvGetJSON(kv, CRED_PREFIX + id);
}

export async function addCredential(kv, { label, type, accountId, tokenValue, secret, scope = [] }) {
  const id = randomId('cred', 10);
  const hint = tokenValue.slice(-4);
  const encrypted = await encryptSecret(tokenValue, secret);
  const ts = nowSec();
  const record = {
    id,
    label: label || 'Cloudflare Token',
    type: type || 'cloudflare',
    account_id: accountId || '',
    encrypted,
    hint,
    scope: scope || [],
    last_validated: null,
    last_used: null,
    status: 'unknown',
    created_at: ts,
    updated_at: ts,
  };
  await kvSetJSON(kv, CRED_PREFIX + id, record);
  const index = (await kvGetJSON(kv, 'cred:index', [])) || [];
  index.push(id);
  await kvSetJSON(kv, 'cred:index', index);
  return record.id;
}

export async function rotateCredential(kv, id, newValue, secret) {
  const c = await getCredential(kv, id);
  if (!c) return null;
  c.encrypted = await encryptSecret(newValue, secret);
  c.hint = newValue.slice(-4);
  c.last_validated = null;
  c.status = 'unknown';
  c.updated_at = nowSec();
  await kvSetJSON(kv, CRED_PREFIX + id, c);
  return id;
}

export async function deleteCredential(kv, id) {
  await kvDelete(kv, CRED_PREFIX + id);
  const index = (await kvGetJSON(kv, 'cred:index', [])) || [];
  await kvSetJSON(kv, 'cred:index', index.filter((x) => x !== id));
}

// Resolve the raw token (for backend use only)
export async function resolveToken(kv, id, secret) {
  const c = await getCredential(kv, id);
  if (!c) return null;
  const raw = await decryptSecret(c.encrypted, secret);
  c.last_used = nowSec();
  await kvSetJSON(kv, CRED_PREFIX + id, c);
  return raw;
}

// Use the primary token from env if present, else the first stored credential.
export async function activeCloudflareToken(kv, env) {
  if (env.CLOUDFLARE_API_TOKEN) return { token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, fromEnv: true };
  const list = await listCredentials(kv);
  if (!list.length) return null;
  const { encryptionKey } = (await import('../utils/config.js')).getConfig(env);
  const raw = await resolveToken(kv, list[0].id, encryptionKey);
  return { token: raw, accountId: list[0].account_id, fromEnv: false };
}
