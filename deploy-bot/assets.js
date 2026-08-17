// deploy-bot/assets.js — fetch the prebuilt panel bundle + migrations from GitHub raw,
// then upload the static dashboard files into the end-user's KV namespace.
//
// The bundle (dist/nexus-panel.mjs) and assets-manifest.json are committed to the repo and
// fetched via PROJECT_RAW_BASE. Each public/ file is written to the user's KV under the key
// `assets:<path>` with { contentType } metadata, which the panel's serveKvAsset() reads.

import { runMigration, kvNamespaceExists, DeployError } from './cloudflare.js';

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

// Upload every dashboard file into the user's KV via KV bulk-write in small chunks
// (<=10 keys per call) so the whole batch is only a handful of subrequests — a single
// Worker invocation is hard-capped at 50 subrequests (the free tier ignores max_subrequests).
//
// A freshly-created namespace can 404 on its first write for *several seconds* (sometimes
// >30s) while it propagates across Cloudflare's edge. A Worker's waitUntil budget is too
// short to poll in one shot, so instead of blocking we *chain* a fresh invocation on each
// propagation failure via `onRetry`. Each chained invocation gets its own time budget, so
// we can keep retrying until the namespace is ready. `attempt` is the retry index
// (0 = first try). `onRetry(next)` must kick off a new invocation that calls uploadAssets
// again with attempt = next. Returns the number of keys written on success.
export async function uploadAssets(
  token, accountId, kvId, dashboardFiles, { attempt = 0, maxAttempts = 20, onRetry } = {}
) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}`;

  const entries = dashboardFiles.map((f) => ({
    key: `assets:${f.path}`,
    value: f.content, // already base64 in the bundle
    metadata: { contentType: f.contentType },
    base64: true,
  }));

  // Give a freshly-created namespace time to settle before the first write, and a touch more
  // on each subsequent attempt. This sleep runs inside the (fresh) invocation's own budget.
  // Because PHASE 2 chains fresh invocations, we can afford to wait — each attempt is cheap.
  const wait = attempt === 0 ? 6000 : 5000;
  await new Promise((r) => setTimeout(r, wait));

  const CHUNK = 10;
  let failStatus = 0;
  let failErr = '';
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    const res = await fetch(`${base}/bulk/write`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(slice),
    });
    if (!res.ok) {
      failStatus = res.status;
      failErr = await res.text().catch(() => '');
      break;
    }
  }

  if (failStatus === 0) return entries.length; // every chunk wrote ok

  // Still failing. If it's the propagation 404 and we have retries left, chain a fresh
  // invocation to try again (new waitUntil budget each time). Otherwise give up clearly.
  if (failStatus === 404 && attempt < maxAttempts && typeof onRetry === 'function') {
    // Diagnostic: confirm the namespace actually exists. If it doesn't, the kvId is wrong
    // (or creation failed) and retrying forever is pointless — surface it loudly.
    const exists = await kvNamespaceExists(token, accountId, kvId).catch(() => null);
    console.log(
      `[deploy-bot] assets 404 attempt=${attempt} kvId=${kvId} namespaceExists=${exists}`
    );
    if (exists === false) {
      throw new DeployError(
        'assets',
        `KV namespace ${kvId} does not exist on your account. The deploy created it but it is missing — creation may have failed, or the token lacks KV permissions.`
      );
    }
    await onRetry(attempt + 1);
    return 0; // a later invocation continues; this one hands off and returns
  }
  throw new DeployError(
    'assets',
    `KV bulk write failed${failStatus === 404 ? ' (namespace never became ready)' : ''}: ${failErr.slice(0, 160)}`
  );
}

// Run both migrations on the user's D1.
export async function applyMigrations(token, accountId, d1Id, base) {
  const m1 = await fetchMigration(base, '0001_init.sql');
  await runMigration(token, accountId, d1Id, m1);
  const m2 = await fetchMigration(base, '0002_nexus.sql');
  await runMigration(token, accountId, d1Id, m2);
}
