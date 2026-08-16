// database/kv.js — KV helpers for settings cache, rate-limit counters, sessions

export async function kvGet(kv, key, fallback = null) {
  try {
    const v = await kv.get(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export async function kvGetJSON(kv, key, fallback = null) {
  const v = await kvGet(kv, key);
  if (v === null) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export async function kvSet(kv, key, value, opts = {}) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await kv.put(key, v, opts);
}

export async function kvSetJSON(kv, key, value, opts = {}) {
  await kvSet(kv, key, JSON.stringify(value), opts);
}

export async function kvDelete(kv, key) {
  await kv.delete(key);
}

// Session storage (token -> userId, with expiry)
export async function saveSession(kv, token, userId, ttl) {
  await kv.put(`sess:${token}`, userId, { expirationTtl: ttl });
}

export async function readSession(kv, token) {
  return kvGet(kv, `sess:${token}`);
}

export async function destroySession(kv, token) {
  await kvDelete(kv, `sess:${token}`);
}
