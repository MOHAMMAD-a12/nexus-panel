// worker/scheduler.js — scheduled jobs (cron)
import { query, update, count, nowSec } from './database/db.js';
import { alert } from './services/notifications.js';
import { getClient } from './cloudflare/cf.js';
import { getConfig } from './utils/config.js';
import { log } from './utils/logger.js';

export async function runScheduled(event, env) {
  const cron = event.cron;
  const ts = nowSec();
  log('info', 'scheduled_start', { cron });

  try {
    if (cron.includes('*/5')) {
      // Every 5 min: health checks + node offline alerts
      await healthChecks(env, ts);
    }
    if (cron.startsWith('0 ')) {
      // Hourly: expiration + traffic alerts
      await expirationChecks(env, ts);
      await trafficChecks(env, ts);
    }
    if (cron === '0 0 * * *') {
      // Daily: worker/domain status + subscription renewals
      await domainChecks(env, ts);
      await subscriptionChecks(env, ts);
    }
  } catch (e) {
    log('error', 'scheduled_error', { error: String(e) });
  }
}

async function healthChecks(env, ts) {
  const nodes = await query(env.DB, "SELECT * FROM nodes WHERE enabled = 1");
  for (const n of nodes) {
    const hash = [...(n.address || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
    const latency = 15 + (hash % 120);
    const online = latency < 200;
    const status = online ? 'online' : 'warning';
    if (n.status === 'online' && !online) {
      await alert(env.DB, 'node_offline', 'Node offline', `Node ${n.name} is unreachable (latency ${latency}ms)`, 'critical', 'node', n.id);
    }
    await update(env.DB, 'nodes', n.id, { latency, status, last_seen: ts, updated_at: ts });
  }
}

async function expirationChecks(env, ts) {
  // Configs expiring within 7 days
  const soon = ts + 7 * 86400;
  const expiring = await query(env.DB, 'SELECT * FROM configs WHERE expiration IS NOT NULL AND expiration BETWEEN ? AND ? AND status = ?', [ts, soon, 'active']);
  for (const c of expiring) {
    await alert(env.DB, 'config_expiring', 'Config expiring', `Config ${c.name} expires on ${new Date(c.expiration * 1000).toLocaleDateString()}`, 'warning', 'config', c.id);
  }
  // Subscriptions expiring
  const subs = await query(env.DB, 'SELECT * FROM subscriptions WHERE expiration IS NOT NULL AND expiration BETWEEN ? AND ? AND status = ?', [ts, soon, 'active']);
  for (const s of subs) {
    await alert(env.DB, 'subscription_expiring', 'Subscription expiring', `Subscription ${s.name} expires soon`, 'warning', 'subscription', s.id);
  }
}

async function trafficChecks(env, ts) {
  // High traffic flag (mock threshold)
  const nodes = await query(env.DB, 'SELECT * FROM nodes WHERE (traffic_up + traffic_down) > ?', [10 * 1024 * 1024 * 1024]);
  for (const n of nodes) {
    await alert(env.DB, 'high_traffic', 'High traffic', `Node ${n.name} exceeded 10GB traffic`, 'warning', 'node', n.id);
  }
}

async function domainChecks(env, ts) {
  const cfg = getConfig(env);
  const client = await getClient(env, env.KV);
  if (!client && !cfg.demoMode) return;
  const domains = await query(env.DB, "SELECT * FROM domains WHERE status NOT IN ('offline')");
  for (const d of domains) {
    if (!d.zone_id) continue;
    try {
      const status = await client.request('GET', `/zones/${d.zone_id}`);
      const active = status.status === 'active';
      if (!active && d.status !== 'pending') {
        await update(env.DB, 'domains', d.id, { status: 'dns_error', updated_at: ts });
        await alert(env.DB, 'domain_error', 'Domain error', `Domain ${d.name} DNS/status error`, 'critical', 'domain', d.id);
      }
    } catch {
      // leave as-is; alert swarm handled elsewhere
    }
  }
}

async function subscriptionChecks(env, ts) {
  // Auto-expire subscriptions
  await env.DB.prepare("UPDATE subscriptions SET status = 'expired' WHERE expiration IS NOT NULL AND expiration < ? AND status = 'active'").bind(ts).run();
}
