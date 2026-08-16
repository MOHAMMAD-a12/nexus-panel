// services/subscriptions.js — subscription generation, validation, serving
import { token } from '../utils/id.js';
import { generateConfig } from './configGenerator.js';
import { getProtocol } from './protocols.js';
import { ValidationError, NotFoundError } from '../utils/error.js';

// Build a subscription token (used in the public route /s/:token)
export async function ensureToken(db, subId) {
  const sub = await db.prepare('SELECT token FROM subscriptions WHERE id = ?').bind(subId).first();
  if (!sub) throw new NotFoundError('Subscription not found');
  return sub.token;
}

export async function buildSubscriptionContent(db, kv, tokenValue, host) {
  const sub = await db.prepare('SELECT * FROM subscriptions WHERE token = ?').bind(tokenValue).first();
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.status === 'revoked') throw new ValidationError('Subscription revoked');
  if (sub.status === 'disabled') throw new ValidationError('Subscription disabled');
  if (sub.expiration && sub.expiration < Math.floor(Date.now() / 1000)) {
    throw new ValidationError('Subscription expired');
  }

  const configIds = safeParse(sub.configs, []);
  if (!configIds.length) return '';

  const placeholders = configIds.map(() => '?').join(',');
  const rows = await db
    .prepare(`SELECT * FROM configs WHERE id IN (${placeholders}) AND status = 'active'`)
    .bind(...configIds)
    .all();
  const configs = rows.results || [];

  const lines = [];
  for (const c of configs) {
    try {
      const p = getProtocol(c.protocol);
      if (!p) continue;
      const out = generateConfig({
        protocol: c.protocol,
        server: c.server,
        domain: c.server,
        port: c.port,
        transport: c.transport,
        tls: Boolean(c.tls),
        sni: c.sni,
        host: c.host,
        path: c.path,
        uuid: c.uuid,
        clientId: c.client_id,
        tag: c.name,
      });
      lines.push(out.uri);
    } catch {
      /* skip invalid */
    }
  }
  return lines.join('\n');
}

function safeParse(str, fallback) {
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
