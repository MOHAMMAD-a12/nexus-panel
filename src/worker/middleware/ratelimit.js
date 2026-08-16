// middleware/ratelimit.js — sliding-window rate limiting via KV
import { kvGet, kvSetJSON } from '../database/kv.js';

const WINDOW = 60; // seconds

export async function rateLimit(kv, key, limit) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW;
  const recordKey = `rl:${key}`;
  let rec = await (async () => {
    try {
      const raw = await kv.get(recordKey);
      return raw ? JSON.parse(raw) : { timestamps: [] };
    } catch {
      return { timestamps: [] };
    }
  })();

  rec.timestamps = (rec.timestamps || []).filter((t) => t > windowStart);
  const current = rec.timestamps.length;

  if (current >= limit) {
    const oldest = rec.timestamps[0] || now;
    const retryAfter = Math.max(1, WINDOW - (now - oldest));
    return { allowed: false, remaining: 0, retryAfter, limit };
  }

  rec.timestamps.push(now);
  await kvSetJSON(kv, recordKey, rec, { expirationTtl: WINDOW + 5 });
  return { allowed: true, remaining: limit - rec.timestamps.length, retryAfter: 0, limit };
}

export function clientKey(request, env) {
  // Prefer CF-provided IP, fall back to header
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return `${ip}`;
}
