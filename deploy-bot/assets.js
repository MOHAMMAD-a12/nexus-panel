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
// dashboard-files.json (base64). We write each key with an individual PUT rather than a
// bulk-write: a freshly-created namespace can intermittently 404 on bulk-write, and per-key
// PUTs isolate a bad file without failing the whole batch. With max_subrequests=1000 this
// stays well under the cap.
export async function uploadAssets(token, accountId, kvId, dashboardFiles) {
  for (const f of dashboardFiles) {
    // Decode the base64 payload back to raw bytes for the PUT body.
    const binary = atob(f.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/assets:${f.path}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': f.contentType,
        },
        body: bytes,
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DeployError('assets', `KV put failed for ${f.path} (${res.status}): ${text.slice(0, 160)}`);
    }
  }
  return dashboardFiles.length;
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
