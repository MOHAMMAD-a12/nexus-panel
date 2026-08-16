// services/seed.js — initial data seeding (admin user + optional demo data)
import { hashPassword } from '../utils/crypto.js';
import { randomId, uuid } from '../utils/id.js';
import { nowSec } from '../database/db.js';
import { count } from '../database/db.js';

export async function ensureAdmin(db, kv, cfg) {
  const existing = await count(db, 'users');
  if (existing > 0) return { created: false };

  const username = cfg.adminEmail ? cfg.adminEmail.split('@')[0] : 'admin';
  const email = cfg.adminEmail || 'admin@nexus.local';
  const password = cfg.adminPassword || 'NexusAdmin123!';
  const hash = await hashPassword(password);

  const adminId = randomId('usr', 10);
  await db
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, role_id, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'role_admin', 'Administrator', 'active', ?, ?)`
    )
    .bind(adminId, username, email, hash, nowSec(), nowSec())
    .run();

  // Persist generated creds to KV for first-run discovery (demo only).
  await kv.put('setup:admin_credentials', JSON.stringify({ username, email, password }), { expirationTtl: 3600 });
  return { created: true, username, email, password };
}

export async function seedDemoData(db, kv, demoMode) {
  const nodeCount = await count(db, 'nodes');
  if (nodeCount > 0) return { seeded: false };

  const ts = nowSec();
  const countries = [
    ['DE', 'Europe', 'Germany'],
    ['NL', 'Europe', 'Netherlands'],
    ['US', 'North America', 'United States'],
    ['SG', 'Asia', 'Singapore'],
    ['JP', 'Asia', 'Japan'],
  ];
  for (let i = 0; i < 5; i++) {
    const [country, region] = countries[i];
    const id = randomId('node', 10);
    await db
      .prepare(
        `INSERT INTO nodes (id, name, address, port, protocol, status, region, country, latency, uptime, traffic_up, traffic_down, last_seen, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'vless', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(
        id,
        `Node-${i + 1}`,
        `node${i + 1}.example.com`,
        443,
        i % 3 === 0 ? 'warning' : 'online',
        region,
        country,
        20 + i * 5,
        99.9 - i,
        i * 1000,
        i * 2000,
        ts,
        ts,
        ts
      )
      .run();
  }

  // Demo configs
  const nodes = await db.prepare('SELECT id FROM nodes LIMIT 5').all();
  const protos = ['vless', 'vmess', 'trojan', 'shadowsocks', 'wireguard'];
  for (let i = 0; i < 10; i++) {
    const node = nodes.results[i % nodes.results.length];
    const id = randomId('cfg', 10);
    const exp = i % 4 === 0 ? ts + (30 - i) * 86400 : ts - i * 86400;
    const proto = protos[i % protos.length];
    await db
      .prepare(
        `INSERT INTO configs (id, name, node_id, client_id, uuid, protocol, transport, tls, sni, host, path, port, server, expiration, traffic_limit, traffic_used, status, notes, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'tcp', 1, 'example.com', 'example.com', '/', 443, 'server.example.com', ?, 0, ?, ?, '', ?, ?, ?)`
      )
      .bind(
        id,
        `Config-${i + 1}`,
        node.id,
        'client-' + (i + 1),
        uuid(),
        proto,
        exp,
        i * 500,
        exp < ts ? 'expired' : 'active',
        JSON.stringify([proto, 'demo']),
        ts,
        ts
      )
      .run();
  }

  return { seeded: true };
}
