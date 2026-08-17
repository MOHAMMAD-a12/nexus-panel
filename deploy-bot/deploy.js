// deploy-bot/deploy.js — orchestrates the end-to-end deploy for one user.
//
// Sequence: fetch bundle → create D1 → create KV → upload script (bindings) → set secrets
// → upload dashboard assets → run migrations → resolve subdomain → return URL + admin creds.
// Progress is streamed to the chat via the supplied `onProgress(stepLabel)` callback.
//
// SECURITY: the user's token is passed in (already decrypted) and used only for Cloudflare
// calls. It is NEVER returned to the chat. Admin creds are generated here and shown once.

import { cryptoRandomToken, randomBytes } from './lib/id.js';
import { bytesToHex } from './lib/crypto.js';
import {
  createD1,
  createKV,
  uploadScript,
  putSecret,
  getSubdomain,
  buildBindings,
  DeployError,
} from './cloudflare.js';
import {
  fetchBundle,
  fetchDashboardFiles,
  uploadAssets,
  applyMigrations,
} from './assets.js';
import { MSG } from './messages.js';

// Cloudflare Worker / D1 / KV names must be lowercase alphanumeric + dashes only.
const rand = (n = 6) => cryptoRandomToken(n).toLowerCase();

// Generate a strong admin password (>=12 chars, mixed).
function genAdminPassword() {
  const a = cryptoRandomToken(10);
  const b = cryptoRandomToken(6);
  return `${a}-${b}`.slice(0, 18);
}

export async function deployUserPanel({ token, accountId, cfg, onProgress }) {
  const progress = (label) => onProgress && onProgress(label);
  let scriptName = '';
  const randSuffix = rand();

  try {
    // Fetch the prebuilt bundle + inlined dashboard files up front (cheap, fails fast if
    // misconfigured). Both are single fetches — keeps us under the Worker subrequest cap.
    progress(MSG.progress.start);
    const [bundle, dashboardFiles] = await Promise.all([
      fetchBundle(cfg.projectRawBase),
      fetchDashboardFiles(cfg.projectRawBase),
    ]);

    // 1) D1
    progress(MSG.progress.d1);
    const d1Name = `${cfg.scriptPrefix}-db-${randSuffix}`;
    const d1Id = await createD1(token, accountId, d1Name);
    progress(MSG.progress.d1Done);

    // 2) KV
    progress(MSG.progress.kv);
    const kvTitle = `${cfg.scriptPrefix}-kv-${randSuffix}`;
    const kvId = await createKV(token, accountId, kvTitle);
    progress(MSG.progress.kvDone);

    // 3) Upload worker script with bindings (secrets attached next, separately).
    progress(MSG.progress.upload);
    scriptName = `${cfg.scriptPrefix}-${randSuffix}`;
    const bindings = buildBindings({ d1Id, kvId });
    await uploadScript(token, accountId, scriptName, bundle, bindings);
    progress(MSG.progress.uploadDone);

    // 4) Secrets — generated server-side; user's own token pre-connects their panel.
    progress(MSG.progress.secrets);
    const adminEmail = `admin-${rand(5)}@nexus-panel.local`;
    const adminPassword = genAdminPassword();
    const secrets = {
      JWT_SECRET: bytesToHex(randomBytes(32)),
      ENCRYPTION_KEY: cryptoRandomToken(32),
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD: adminPassword,
      CLOUDFLARE_API_TOKEN: token, // pre-connect the deployed panel to the user's CF
      CLOUDFLARE_ACCOUNT_ID: accountId,
    };
    for (const [name, value] of Object.entries(secrets)) {
      await putSecret(token, accountId, scriptName, name, value);
    }
    progress(MSG.progress.secretsDone);

    // 5) Upload dashboard static files into the user's KV (all inlined in one JSON payload).
    progress(MSG.progress.assets);
    const uploaded = await uploadAssets(token, accountId, kvId, dashboardFiles);
    progress(MSG.progress.assetsDone);

    // 6) Migrations on D1.
    progress(MSG.progress.migrate);
    await applyMigrations(token, accountId, d1Id, cfg.projectRawBase);
    progress(MSG.progress.migrateDone);

    // 7) Resolve subdomain + build final URL.
    progress(MSG.progress.subdomain);
    const subdomain = await getSubdomain(token, accountId);
    if (!subdomain) {
      throw new DeployError('subdomain', MSG.noSubdomain);
    }
    const url = `https://${scriptName}.${subdomain}.workers.dev`;

    return { url, adminEmail, adminPassword };
  } catch (e) {
    // Re-throw DeployError as-is; wrap anything else with a step hint.
    if (e instanceof DeployError) throw e;
    throw new DeployError('deploy', e.message || 'Unexpected deploy error.');
  }
}
