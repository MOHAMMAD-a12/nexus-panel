// api/routes/health.js — system health + Cloudflare connectivity
import { ok } from '../../utils/response.js';
import { getConfig, isCloudflareConfigured } from '../../utils/config.js';
import { getClient } from '../../cloudflare/cf.js';
import { nowSec } from '../../database/db.js';

export async function health(ctx) {
  const { db, kv, env } = ctx;
  const cfg = getConfig(env);
  const checks = {};

  // DB
  try {
    await db.prepare('SELECT 1').first();
    checks.database = 'ok';
  } catch (e) {
    checks.database = 'error';
  }

  // KV
  try {
    await kv.put('health:ping', 'ok', { expirationTtl: 90 });
    const v = await kv.get('health:ping');
    checks.kv = v === 'ok' ? 'ok' : 'error';
  } catch (e) {
    checks.kv = 'error';
  }

  // Cloudflare
  if (isCloudflareConfigured(cfg)) {
    try {
      const client = await getClient(env, kv);
      if (client) {
        await client.request('GET', '/user');
        checks.cloudflare = 'ok';
      } else {
        checks.cloudflare = 'no_token';
      }
    } catch {
      checks.cloudflare = 'error';
    }
  } else {
    checks.cloudflare = cfg.demoMode ? 'demo_mode' : 'not_configured';
  }

  checks.worker = 'ok';
  checks.timestamp = nowSec();

  return ok(checks);
}
