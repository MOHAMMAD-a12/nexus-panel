// cloudflare/cf.js — Cloudflare API service layer
// All requests originate from the backend Worker. The API token is read ONLY
// from env (or via the Credential Manager) and is never sent to the client.
import { ExternalError } from '../utils/error.js';
import { getConfig, isCloudflareConfigured } from '../utils/config.js';
import { activeCloudflareToken } from '../auth/credentials.js';
import { DEMO_MOCK } from './mock.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

class CloudflareClient {
  constructor(token, accountId, opts = {}) {
    this.token = token;
    this.accountId = accountId;
    this.timeout = opts.timeout || 15000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async request(method, path, body, opts = {}) {
    const url = API_BASE + path;
    let attempt = 0;
    let lastErr;
    while (attempt <= this.maxRetries) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeout);
        const headers = {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        };
        if (opts.params) {
          const qs = new URLSearchParams(opts.params).toString();
          if (qs) path += (path.includes('?') ? '&' : '?') + qs;
        }
        const res = await fetch(API_BASE + path, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        return await this.handleResponse(res, method, url);
      } catch (e) {
        lastErr = e;
        // Retry on network/timeout or 5xx
        if (e.name === 'AbortError' || (e.status && e.status >= 500)) {
          attempt++;
          if (attempt <= this.maxRetries) {
            await sleep(Math.min(500 * 2 ** attempt, 4000));
            continue;
          }
        }
        throw e instanceof ExternalError ? e : new ExternalError(`Cloudflare API error: ${String(e.message || e)}`);
      }
    }
    throw lastErr instanceof ExternalError ? lastErr : new ExternalError('Cloudflare API failed after retries');
  }

  async handleResponse(res, method, url) {
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 429) {
      throw new ExternalError('Cloudflare rate limit exceeded', 429, { retryAfter: res.headers.get('retry-after') });
    }
    if (!res.ok || !data || data.success === false) {
      const errs = data?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      throw new ExternalError(`Cloudflare: ${errs}`, res.status >= 400 && res.status < 500 ? 400 : 502, {
        code: data?.errors?.[0]?.code,
      });
    }
    return data.result;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Build a client from env / credentials, or return null if not configured.
export async function getClient(env, kv) {
  const cfg = getConfig(env);
  if (!isCloudflareConfigured(cfg)) {
    if (cfg.demoMode) return null; // caller decides to use mock
    return null;
  }
  const creds = await activeCloudflareToken(kv, env);
  if (!creds || !creds.token) return null;
  return new CloudflareClient(creds.token, creds.accountId);
}

export async function withFallback(env, kv, fn) {
  const cfg = getConfig(env);
  const client = await getClient(env, kv);
  if (!client) {
    if (cfg.demoMode) return fn(DEMO_MOCK);
    throw new ExternalError('Cloudflare API token not configured. Set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID secrets.');
  }
  return fn(client);
}

export { CloudflareClient, API_BASE };
