// deploy-bot/cloudflare.js — raw Cloudflare REST client for end-user deploys.
//
// Uses the user's OWN API token (Bearer) to provision resources on THEIR account:
//   • D1 database            POST /accounts/{acct}/d1/database
//   • KV namespace           POST /accounts/{acct}/storage/kv/namespaces
//   • Worker script upload   PUT  /accounts/{acct}/workers/scripts/{name}
//   • Secrets                PUT  /accounts/{acct}/workers/scripts/{name}/secrets/{secret}
//   • D1 migrations          POST /accounts/{acct}/d1/database/{id}/query
//   • workers.dev subdomain  GET  /accounts/{acct}/workers/subdomain
//
// We NEVER inline secrets into the script-upload request (they would appear in upload
// logs); secrets are set via the dedicated endpoint after the upload succeeds.
//
// Errors are surfaced as DeployError(step, message) so the bot can report a clear,
// human-readable failure at the right step — never a raw 500.

const API = 'https://api.cloudflare.com/client/v4';

import { cryptoRandomToken } from './lib/id.js';

export class DeployError extends Error {
  constructor(step, message) {
    super(message);
    this.step = step;
    this.name = 'DeployError';
  }
}

// fetch with retry/backoff: honor Retry-After on 429; exponential backoff on 5xx/network.
async function cfFetch(token, method, path, { body, headers, isJson = true } = {}) {
  const url = `${API}${path}`;
  let attempt = 0;
  const maxAttempts = 4;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(isJson && body != null ? { 'content-type': 'application/json' } : {}),
        ...(headers || {}),
      },
      body: body != null ? (isJson ? JSON.stringify(body) : body) : undefined,
    };
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (attempt < maxAttempts) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new DeployError('network', `Network error calling Cloudflare: ${e.message}`);
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
      if (attempt < maxAttempts) {
        await sleep(wait);
        continue;
      }
    }
    if (res.status >= 500 && attempt < maxAttempts) {
      await sleep(backoff(attempt));
      continue;
    }

    const text = await res.text().catch(() => '');
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const errMsg = describeError(json, res.status, text);
      throw new DeployError(`http_${res.status}`, errMsg);
    }
    return json;
  }
}

function backoff(attempt) {
  return Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function describeError(json, status, text) {
  if (json && json.errors && json.errors.length) {
    const e = json.errors[0];
    return `${e.message || 'Cloudflare API error'}${e.code ? ` (code ${e.code})` : ''}`;
  }
  if (status === 403) return 'Cloudflare rejected the request — your token likely lacks the required permissions (Workers Scripts Edit, D1 Edit, KV Storage Edit).';
  if (status === 401) return 'Cloudflare rejected the token (unauthorized).';
  return `Cloudflare API error (${status}): ${text.slice(0, 160)}`;
}

// ── Resource creation ───────────────────────────────────────────────

export async function createD1(token, accountId, name) {
  const json = await cfFetch(token, 'POST', `/accounts/${accountId}/d1/database`, {
    body: { name },
  });
  // Cloudflare returns the database id at the top level as `uuid` (per wrangler's
  // createD1Database -> db.uuid) and sometimes nested under result. Accept all variants.
  const id = json?.uuid || json?.result?.uuid || json?.result?.id || json?.id;
  if (!id) {
    const detail =
      json?.errors?.length
        ? json.errors.map((e) => `${e.message}${e.code ? ` (code ${e.code})` : ''}`).join('; ')
        : JSON.stringify(json).slice(0, 200);
    throw new DeployError('d1', `Cloudflare did not return a D1 database id. ${detail}`);
  }
  return id;
}

export async function createKV(token, accountId, title) {
  const json = await cfFetch(token, 'POST', `/accounts/${accountId}/storage/kv/namespaces`, {
    body: { title },
  });
  // The KV create endpoint returns the id at the TOP LEVEL (json.id), not nested under
  // result — unlike most CF endpoints. Mirror wrangler's `createKVNamespace` (response.id).
  const id = json?.id || json?.result?.id || json?.result?.uuid || json?.uuid;
  if (!id) {
    // Surface the raw response so we can see the exact shape via wrangler tail.
    throw new DeployError('kv', `No KV id. Raw response: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return id;
}

// Upload the bundled worker with bindings (non-secret only). We upload as a multipart
// form (field name "index.js") so Cloudflare correctly treats the bundle as an ES Module.
// The critical detail: the file part's Content-Type must be `application/javascript+module`
// (the `+module` suffix) — that is the exact signal wrangler sends. Without it, CF falls
// back to Service-Worker format and throws "Unexpected token 'export'" on the bundle's
// top-level `export`. Bindings are passed as a JSON `metadata` form field with a
// `main_module: "index.js"` key telling CF which part is the entrypoint.
export async function uploadScript(token, accountId, scriptName, scriptBody, bindings) {
  const boundary = `----nexusbot${cryptoRandomToken(16)}`;
  const enc = new TextEncoder();
  const parts = [];
  const push = (s) => parts.push(enc.encode(s));

  push(`--${boundary}\r\n`);
  push('content-disposition: form-data; name="index.js"; filename="index.js"\r\n');
  // The `+module` suffix is what tells Cloudflare this is an ES Module (not a
  // Service Worker). Without it, CF parses the bundle as a Service Worker and
  // chokes on top-level `export` (`Unexpected token 'export'`).
  push('content-type: application/javascript+module\r\n\r\n');
  parts.push(enc.encode(scriptBody));
  push('\r\n');
  push(`--${boundary}\r\n`);
  push('content-disposition: form-data; name="metadata"\r\n');
  push('content-type: application/json\r\n\r\n');
  parts.push(
    enc.encode(
      JSON.stringify({
        compatibility_date: '2024-11-01',
        compatibility_flags: ['nodejs_compat'],
        main_module: 'index.js',
        bindings,
      })
    )
  );
  push('\r\n');
  push(`--${boundary}--\r\n`);

  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    body.set(p, off);
    off += p.length;
  }

  const json = await cfFetch(token, 'PUT', `/accounts/${accountId}/workers/scripts/${scriptName}`, {
    isJson: false,
    body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  });
  if (!json?.success) throw new DeployError('upload', 'Worker script upload was not successful.');
  return true;
}

// Set a single secret via the dedicated endpoint (keeps secrets out of upload logs).
// Mirrors `wrangler secret put`: POST-style PUT to `.../secrets` (no name in the URL)
// with a body of { name, text, type: "secret_text" }.
export async function putSecret(token, accountId, scriptName, name, value) {
  const json = await cfFetch(
    token,
    'PUT',
    `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
    { body: { name, text: String(value), type: 'secret_text' } }
  );
  if (!json?.success) throw new DeployError('secrets', `Failed to set secret ${name}.`);
  return true;
}

// Run a migration SQL file against the D1 database.
export async function runMigration(token, accountId, d1Id, sql) {
  const json = await cfFetch(token, 'POST', `/accounts/${accountId}/d1/database/${d1Id}/query`, {
    body: { sql },
  });
  if (!json?.success) throw new DeployError('migrate', 'Database migration query failed.');
  return json.result;
}

// Resolve the account's *.workers.dev subdomain.
export async function getSubdomain(token, accountId) {
  const json = await cfFetch(token, 'GET', `/accounts/${accountId}/workers/subdomain`);
  return json?.result?.subdomain || '';
}

// Build the non-secret bindings array (secrets are attached separately).
export function buildBindings({ d1Id, kvId }) {
  return [
    { name: 'DB', type: 'd1', id: d1Id },
    { name: 'KV', type: 'kv_namespace', namespace_id: kvId },
    { name: 'ENVIRONMENT', type: 'plain_text', text: 'production' },
    { name: 'DEMO_MODE', type: 'plain_text', text: 'false' },
    { name: 'APP_NAME', type: 'plain_text', text: 'Nexus Panel' },
    { name: 'SESSION_TTL', type: 'plain_text', text: '86400' },
    { name: 'RATE_LIMIT', type: 'plain_text', text: '120' },
    { name: 'ALLOWED_ORIGINS', type: 'plain_text', text: '*' },
  ];
}
