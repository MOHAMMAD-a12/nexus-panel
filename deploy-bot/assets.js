// deploy-bot/assets.js — fetch the prebuilt panel bundle + migrations from GitHub raw,
// then upload the static dashboard files into the end-user's KV namespace.
//
// The bundle (dist/nexus-panel.mjs) and assets-manifest.json are committed to the repo and
// fetched via PROJECT_RAW_BASE. Each public/ file is written to the user's KV under the key
// `assets:<path>` with { contentType } metadata, which the panel's serveKvAsset() reads.

import { runMigration, DeployError } from './cloudflare.js';

async function fetchText(base, path) {
  const res = await fetch(`${base}/${path}`, { headers: { 'user-agent': 'nexus-deploy-bot' } });
  if (!res.ok) {
    throw new DeployError(
      'assets',
      `Could not fetch ${path} from the project repo (${res.status}). Check PROJECT_RAW_BASE.`
    );
  }
  return res.text();
}

// Download the worker bundle text.
export async function fetchBundle(base) {
  return fetchText(base, 'dist/nexus-panel.mjs');
}

// Download + parse the single bundled dashboard-files payload (one fetch instead of N).
export async function fetchDashboardFiles(base) {
  const text = await fetchText(base, 'dist/dashboard-files.json');
  try {
    const files = JSON.parse(text);
    if (!Array.isArray(files)) throw new Error('not an array');
    return files;
  } catch {
    throw new DeployError('assets', 'dashboard-files.json is malformed.');
  }
}

// Download a migration SQL file.
export async function fetchMigration(base, file) {
  return fetchText(base, `migrations/${file}`);
}

// Upload every dashboard file into the user's KV. All file contents are inlined in
// dashboard-files.json (base64). We use KV bulk-write in small chunks (<=10 keys each) so
// the whole batch is just a handful of subrequests — critical because a single Worker
// invocation is hard-capped at 50 subrequests (the free tier ignores max_subrequests).
// A freshly-created namespace can 404 on its first write for a few seconds while it
// propagates, so we retry the bulk call with a short backoff.
export async function uploadAssets(token, accountId, kvId, dashboardFiles) {
  console.log('[deploy-bot] uploadAssets kvId:', kvId, 'accountId:', accountId);
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}`;

  const entries = dashboardFiles.map((f) => ({
    key: `assets:${f.path}`,
    value: f.content, // already base64 in the bundle
    metadata: { contentType: f.contentType },
    base64: true,
  }));

  const CHUNK = 10;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    let lastErr = '';
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
      const res = await fetch(`${base}/bulk/write`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(slice),
      });
      if (res.ok) {
        ok = true;
        break;
      }
      lastErr = await res.text().catch(() => '');
    }
    if (!ok) {
      throw new DeployError('assets', `KV bulk write failed: ${lastErr.slice(0, 160)}`);
    }
  }
  return entries.length;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Run both migrations on the user's D1.
export async function applyMigrations(token, accountId, d1Id, base) {
  const m1 = await fetchMigration(base, '0001_init.sql');
  await runMigration(token, accountId, d1Id, m1);
  const m2 = await fetchMigration(base, '0002_nexus.sql');
  await runMigration(token, accountId, d1Id, m2);
}
