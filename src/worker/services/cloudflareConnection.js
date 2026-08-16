// services/cloudflareConnection.js — manages the panel's Cloudflare connection.
//
// SECURITY: The API token is NEVER returned to the client. It is stored in the
// credential manager (encrypted at rest in KV) and used only server-side when
// calling the Cloudflare API. The frontend only ever sees a masked preview and
// connection status. We never fake operations the Cloudflare API does not support.

import { CloudflareClient, API_BASE } from '../cloudflare/cf.js';
import { getConfig, isCloudflareConfigured } from '../utils/config.js';
import { activeCloudflareToken } from '../auth/credentials.js';
import { ExternalError } from '../utils/error.js';
import { count, query, queryOne, insert, update, remove, nowSec } from '../database/db.js';
import { randomId } from '../utils/id.js';

// Build a client from the encrypted credential store (preferred) or env. Never
// exposes the token.
async function buildClient(env, kv) {
  const cfg = getConfig(env);
  const creds = await activeCloudflareToken(kv, env);
  if (creds && creds.token) {
    return new CloudflareClient(creds.token, creds.accountId || cfg.cloudflareAccountId);
  }
  if (isCloudflareConfigured(cfg)) {
    return new CloudflareClient(cfg.cloudflareApiToken, cfg.cloudflareAccountId);
  }
  return null;
}

// Only returns safe summary — no token.
export async function getConnection(db, kv, env) {
  const cfg = getConfig(env);
  const rows = await query(db, 'SELECT * FROM cloudflare_connections ORDER BY created_at DESC LIMIT 1');
  const row = rows[0];
  const credsPresent = Boolean(await activeCloudflareToken(kv, env));
  const configured = isCloudflareConfigured(cfg) || credsPresent;
  if (!row && !configured) {
    return { connected: false, accountId: cfg.cloudflareAccountId || null, zone: null, status: 'not_configured', tokenPreview: null };
  }
  const client = await buildClient(env, kv);
  let status = 'disconnected';
  let account = cfg.cloudflareAccountId || null;
  let zone = null;
  if (client) {
    try {
      const me = await client.request('GET', '/user');
      status = 'connected';
      if (me && me.id) account = account || me.id;
    } catch {
      status = 'error';
    }
  }
  return {
    connected: status === 'connected',
    status,
    accountId: account,
    zone: row ? row.zone : null,
    domain: row ? row.domain : null,
    tokenPreview: credsPresent ? '••••' : null,
    savedAt: row ? row.updated_at : null,
  };
}

// Test the connection with a provided token — does NOT persist it. Returns status.
export async function testConnection({ accountId, tokenValue, zone, domain, env, kv }) {
  if (!accountId || !tokenValue) {
    throw new ExternalError('Account ID and API Token are required to test the connection.', 400);
  }
  const client = new CloudflareClient(tokenValue, accountId);
  // Verify token validity via /user and scope via /zones.
  const me = await client.request('GET', '/user').catch((e) => {
    throw new ExternalError(`Cloudflare rejected the token: ${e.meta?.code ? '(' + e.meta.code + ') ' : ''}${e.message}`, 401);
  });
  let zones = [];
  try {
    zones = await client.request('GET', '/zones', undefined, { params: { per_page: 50 } });
  } catch {
    zones = [];
  }
  const account = me && (me.account || me);
  return {
    ok: true,
    accountId: account?.id || accountId,
    accountName: account?.name || null,
    zoneCount: Array.isArray(zones) ? zones.length : (zones.result ? zones.result.length : 0),
    zones: Array.isArray(zones) ? zones.slice(0, 20) : (zones.result ? zones.result.slice(0, 20) : []),
    message: 'Connection successful. Token is valid.',
  };
}

// Save (persist) the connection using the encrypted credential store. Token is
// encrypted at rest — never stored as plaintext, never returned to client.
export async function saveConnection({ accountId, tokenValue, zone, domain, env, kv, db }) {
  if (!accountId || !tokenValue) {
    throw new ExternalError('Account ID and API Token are required.', 400);
  }
  // Validate before persisting.
  const test = await testConnection({ accountId, tokenValue, zone, domain, env, kv });
  const secret = getConfig(env).encryptionKey;
  // Store token via credential manager (encrypted KV), type 'cloudflare'.
  const { addCredential } = await import('../auth/credentials.js');
  // Replace any existing cloudflare cred. Keep a single active connection.
  const list = await listCredentialsSafe(kv);
  for (const c of list) {
    if (c.type === 'cloudflare') await deleteCredentialSafe(kv, c.id);
  }
  await addCredential(kv, {
    label: 'Cloudflare API Token',
    type: 'cloudflare',
    accountId,
    tokenValue,
    secret,
    scope: ['zones.read', 'zones.write', 'dns.read', 'dns.write'],
  });

  const id = randomId('cf', 10);
  const ts = nowSec();
  await insert(db, 'cloudflare_connections', {
    id,
    account_id: accountId,
    zone: zone || null,
    domain: domain || null,
    status: 'connected',
    created_at: ts,
    updated_at: ts,
  });
  return { ok: true, accountId, zone: zone || null, zoneCount: test.zoneCount, tokenPreview: '••••' };
}

async function listCredentialsSafe(kv) {
  try {
    const { listCredentials } = await import('../auth/credentials.js');
    return await listCredentials(kv);
  } catch {
    return [];
  }
}
async function deleteCredentialSafe(kv, id) {
  try {
    const { deleteCredential } = await import('../auth/credentials.js');
    await deleteCredential(kv, id);
  } catch {}
}

// Disconnect: remove stored credentials + connection row. Token is wiped, not leaked.
export async function disconnect(db, kv) {
  const list = await listCredentialsSafe(kv);
  for (const c of list) {
    if (c.type === 'cloudflare') await deleteCredentialSafe(kv, c.id);
  }
  const rows = await query(db, 'SELECT id FROM cloudflare_connections');
  for (const r of rows) await remove(db, 'cloudflare_connections', r.id);
  return { ok: true, connected: false };
}

// Refresh: re-ping Cloudflare and update status. Returns current status object.
export async function refreshConnection(db, kv, env) {
  return getConnection(db, kv, env);
}
