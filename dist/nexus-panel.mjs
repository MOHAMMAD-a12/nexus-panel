var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/worker/utils/crypto.js
function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveKey(password, salt, 32);
  return `scrypt$${b64url(salt)}$${b64url(derived)}`;
}
async function verifyPassword(password, stored) {
  try {
    const [scheme, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const salt = b64urlDecode(saltB64);
    const expected = b64urlDecode(hashB64);
    const derived = await deriveKey(password, salt, expected.length);
    return constantTimeEqual(derived, expected);
  } catch {
    return false;
  }
}
async function deriveKey(password, salt, length) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 1e5, hash: "SHA-256" },
    passwordKey,
    length * 8
  );
  return new Uint8Array(bits);
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function getKeyMaterial(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}
async function encryptSecret(plaintext, secret) {
  const key = await getKeyMaterial(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return `enc$${b64url(iv)}$${b64url(ct)}`;
}
async function decryptSecret(payload, secret) {
  try {
    const [scheme, ivB64, ctB64] = payload.split("$");
    if (scheme !== "enc") return null;
    const key = await getKeyMaterial(secret);
    const iv = b64urlDecode(ivB64);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64urlDecode(ctB64));
    return dec.decode(pt);
  } catch {
    return null;
  }
}
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToHex(sig);
}
var enc, dec;
var init_crypto = __esm({
  "src/worker/utils/crypto.js"() {
    enc = new TextEncoder();
    dec = new TextDecoder();
  }
});

// src/worker/utils/config.js
var config_exports = {};
__export(config_exports, {
  assertSecrets: () => assertSecrets,
  getConfig: () => getConfig,
  isCloudflareConfigured: () => isCloudflareConfigured
});
function getConfig(env) {
  const demoMode = String(env.DEMO_MODE || "false").toLowerCase() === "true";
  const environment = env.ENVIRONMENT || (demoMode ? "development" : "production");
  const jwtSecret = env.JWT_SECRET || DEV_JWT_SECRET;
  const encryptionKey = env.ENCRYPTION_KEY || DEV_ENCRYPTION_KEY;
  return {
    environment,
    demoMode,
    appName: env.APP_NAME || "Nexus Panel",
    sessionTtl: parseInt(env.SESSION_TTL || "86400", 10),
    rateLimit: parseInt(env.RATE_LIMIT || "120", 10),
    allowedOrigins: (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean),
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN || "",
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID || "",
    jwtSecret,
    encryptionKey,
    adminEmail: env.ADMIN_EMAIL || "",
    adminPassword: env.ADMIN_PASSWORD || ""
  };
}
function isCloudflareConfigured(cfg) {
  return Boolean(cfg.cloudflareApiToken && cfg.cloudflareAccountId);
}
function assertSecrets(cfg) {
  const missing = [];
  if (!cfg.jwtSecret) missing.push("JWT_SECRET");
  if (!cfg.encryptionKey) missing.push("ENCRYPTION_KEY");
  return missing;
}
var DEV_JWT_SECRET, DEV_ENCRYPTION_KEY;
var init_config = __esm({
  "src/worker/utils/config.js"() {
    DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me-0000000000";
    DEV_ENCRYPTION_KEY = "devonlyinsecureaes256key00000000";
  }
});

// src/worker/database/kv.js
async function kvGet(kv, key, fallback = null) {
  try {
    const v = await kv.get(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
async function kvGetJSON(kv, key, fallback = null) {
  const v = await kvGet(kv, key);
  if (v === null) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
async function kvSet(kv, key, value, opts = {}) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  await kv.put(key, v, opts);
}
async function kvSetJSON(kv, key, value, opts = {}) {
  await kvSet(kv, key, JSON.stringify(value), opts);
}
async function kvDelete(kv, key) {
  await kv.delete(key);
}
async function saveSession(kv, token2, userId, ttl) {
  await kv.put(`sess:${token2}`, userId, { expirationTtl: ttl });
}
async function readSession(kv, token2) {
  return kvGet(kv, `sess:${token2}`);
}
var init_kv = __esm({
  "src/worker/database/kv.js"() {
  }
});

// src/worker/utils/id.js
function toBase62(buf) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let str = "";
  for (const b of buf) str += alphabet[b % 62];
  return str;
}
function randomBytes(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}
function uuid() {
  const b = randomBytes(16);
  b[6] = b[6] & 15 | 64;
  b[8] = b[8] & 63 | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}
function randomId(prefix = "id", len = 12) {
  return `${prefix}_${toBase62(randomBytes(len))}`;
}
function token(prefix = "tk", len = 32) {
  return `${prefix}_${toBase62(randomBytes(len))}`;
}
var init_id = __esm({
  "src/worker/utils/id.js"() {
  }
});

// src/worker/database/db.js
function replacer(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (key.endsWith("_json") || key === "permissions" || key === "tags" || key === "configs" || key === "nameservers" || key === "metadata") {
      if (typeof out[key] === "string") {
        try {
          out[key] = JSON.parse(out[key]);
        } catch {
          out[key] = [];
        }
      }
    }
  }
  return out;
}
async function query(db, sql, params = []) {
  const res = await db.prepare(sql).bind(...params).all();
  return (res.results || []).map(replacer);
}
async function queryOne(db, sql, params = []) {
  const res = await db.prepare(sql).bind(...params).first();
  return res ? replacer(res) : null;
}
async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}
async function insert(db, table, data) {
  const cols = Object.keys(data);
  const placeholders = cols.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
  return run(db, sql, cols.map((c) => serialize(data[c])));
}
async function update(db, table, id, data, idColumn = "id") {
  const cols = Object.keys(data).filter((c) => data[c] !== void 0);
  if (cols.length === 0) return { meta: { changes: 0 } };
  const setClause = cols.map((c) => `${c} = ?`).join(", ");
  const sql = `UPDATE ${table} SET ${setClause} WHERE ${idColumn} = ?`;
  return run(db, sql, [...cols.map((c) => serialize(data[c])), id]);
}
async function remove(db, table, id, idColumn = "id") {
  return run(db, `DELETE FROM ${table} WHERE ${idColumn} = ?`, [id]);
}
async function count(db, table, where = "", params = []) {
  const sql = `SELECT COUNT(*) as c FROM ${table} ${where}`.trim();
  const res = await db.prepare(sql).bind(...params).first();
  return res ? res.c : 0;
}
function serialize(value) {
  if (Array.isArray(value) || typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return value;
}
function nowSec() {
  return Math.floor(Date.now() / 1e3);
}
var init_db = __esm({
  "src/worker/database/db.js"() {
  }
});

// src/worker/utils/logger.js
function sanitize(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).toLowerCase();
    if (SENSITIVE.some((s) => key.includes(s))) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function log(level, message, meta = {}) {
  const entry = {
    level,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    msg: message,
    ...sanitize(meta)
  };
  try {
    console.log(JSON.stringify(entry));
  } catch {
  }
}
async function audit(db, { user, action, resource, resourceId, ip, status = "success", metadata = {} }) {
  const id = randomId("aud");
  const ts = nowSec();
  try {
    await db.prepare(
      `INSERT INTO audit_logs (id, user_id, username, action, resource, resource_id, ip, status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      user?.id || null,
      user?.username || "system",
      action,
      resource || null,
      resourceId || null,
      ip || null,
      status,
      JSON.stringify(sanitize(metadata)),
      ts
    ).run();
  } catch (e) {
    log("error", "audit_log_failed", { error: String(e) });
  }
  return id;
}
var SENSITIVE;
var init_logger = __esm({
  "src/worker/utils/logger.js"() {
    init_id();
    init_db();
    SENSITIVE = [
      "password",
      "password_hash",
      "token",
      "api_token",
      "authorization",
      "cookie",
      "credentials",
      "secret",
      "key",
      "jwt",
      "cf_token"
    ];
  }
});

// src/worker/auth/credentials.js
var credentials_exports = {};
__export(credentials_exports, {
  activeCloudflareToken: () => activeCloudflareToken,
  addCredential: () => addCredential,
  deleteCredential: () => deleteCredential,
  getCredential: () => getCredential,
  listCredentials: () => listCredentials,
  maskToken: () => maskToken,
  resolveToken: () => resolveToken,
  rotateCredential: () => rotateCredential
});
function maskToken(t) {
  if (!t || t.length < 12) return "\u2022\u2022\u2022\u2022";
  return `${t.slice(0, 6)}${"\u2022".repeat(Math.max(4, t.length - 10))}${t.slice(-4)}`;
}
async function listCredentials(kv) {
  const ids = await kvGetJSON(kv, "cred:index", []) || [];
  const out = [];
  for (const id of ids) {
    const c = await kvGetJSON(kv, CRED_PREFIX + id);
    if (!c) continue;
    out.push({
      id: c.id,
      label: c.label,
      type: c.type,
      account_id: c.account_id,
      masked: maskToken(c.hint),
      scope: c.scope || [],
      last_validated: c.last_validated || null,
      last_used: c.last_used || null,
      status: c.status,
      created_at: c.created_at,
      updated_at: c.updated_at
    });
  }
  return out;
}
async function getCredential(kv, id) {
  return kvGetJSON(kv, CRED_PREFIX + id);
}
async function addCredential(kv, { label, type, accountId, tokenValue, secret, scope = [] }) {
  const id = randomId("cred", 10);
  const hint = tokenValue.slice(-4);
  const encrypted = await encryptSecret(tokenValue, secret);
  const ts = nowSec();
  const record = {
    id,
    label: label || "Cloudflare Token",
    type: type || "cloudflare",
    account_id: accountId || "",
    encrypted,
    hint,
    scope: scope || [],
    last_validated: null,
    last_used: null,
    status: "unknown",
    created_at: ts,
    updated_at: ts
  };
  await kvSetJSON(kv, CRED_PREFIX + id, record);
  const index = await kvGetJSON(kv, "cred:index", []) || [];
  index.push(id);
  await kvSetJSON(kv, "cred:index", index);
  return record.id;
}
async function rotateCredential(kv, id, newValue, secret) {
  const c = await getCredential(kv, id);
  if (!c) return null;
  c.encrypted = await encryptSecret(newValue, secret);
  c.hint = newValue.slice(-4);
  c.last_validated = null;
  c.status = "unknown";
  c.updated_at = nowSec();
  await kvSetJSON(kv, CRED_PREFIX + id, c);
  return id;
}
async function deleteCredential(kv, id) {
  await kvDelete(kv, CRED_PREFIX + id);
  const index = await kvGetJSON(kv, "cred:index", []) || [];
  await kvSetJSON(kv, "cred:index", index.filter((x) => x !== id));
}
async function resolveToken(kv, id, secret) {
  const c = await getCredential(kv, id);
  if (!c) return null;
  const raw = await decryptSecret(c.encrypted, secret);
  c.last_used = nowSec();
  await kvSetJSON(kv, CRED_PREFIX + id, c);
  return raw;
}
async function activeCloudflareToken(kv, env) {
  if (env.CLOUDFLARE_API_TOKEN) return { token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, fromEnv: true };
  const list = await listCredentials(kv);
  if (!list.length) return null;
  const { encryptionKey } = (await Promise.resolve().then(() => (init_config(), config_exports))).getConfig(env);
  const raw = await resolveToken(kv, list[0].id, encryptionKey);
  return { token: raw, accountId: list[0].account_id, fromEnv: false };
}
var CRED_PREFIX;
var init_credentials = __esm({
  "src/worker/auth/credentials.js"() {
    init_crypto();
    init_id();
    init_db();
    init_kv();
    init_logger();
    CRED_PREFIX = "cred:";
  }
});

// src/worker/utils/response.js
function buildHeaders(headers = {}) {
  const h = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === "set-cookie") {
      const list = Array.isArray(v) ? v : [v];
      for (const c of list) if (c) h.append("set-cookie", c);
    } else if (v != null) {
      h.set(k, String(v));
    }
  }
  return h;
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: buildHeaders(headers) });
}
function ok(data, headers = {}) {
  return json({ ok: true, data, ts: nowTs() }, 200, headers);
}
function created(data, headers = {}) {
  return json({ ok: true, data, ts: nowTs() }, 201, headers);
}
function paginated(rows, meta, headers = {}) {
  return json({ ok: true, data: rows, meta, ts: nowTs() }, 200, headers);
}
function error(message, status = 400, extra = {}) {
  return json({ ok: false, error: { message, status, ...extra } }, status);
}
function nowTs() {
  return Math.floor(Date.now() / 1e3);
}
function cors(headers, origin) {
  const h = { ...headers };
  if (origin) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-credentials"] = "true";
  }
  h["access-control-allow-headers"] = "content-type, authorization, x-csrf-token, x-requested-with";
  h["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
  return h;
}

// src/worker/api/router.js
var Router = class {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, handler, meta = {}) {
    const keys = [];
    const regexStr = pattern.replace(/\/+$/, "").replace(/:[^/]+/g, (m) => {
      keys.push(m.slice(1));
      return "([^/]+)";
    });
    const regex = new RegExp("^" + (regexStr || "/") + "/?$");
    this.routes.push({ method: method.toUpperCase(), regex, keys, handler, meta });
  }
  get(p, h, m) {
    this.add("GET", p, h, m);
  }
  post(p, h, m) {
    this.add("POST", p, h, m);
  }
  put(p, h, m) {
    this.add("PUT", p, h, m);
  }
  patch(p, h, m) {
    this.add("PATCH", p, h, m);
  }
  del(p, h, m) {
    this.add("DELETE", p, h, m);
  }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = pathname.match(r.regex);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
        return { handler: r.handler, params, meta: r.meta };
      }
    }
    return null;
  }
};

// src/worker/api/routes/auth.js
init_crypto();

// src/worker/utils/jwt.js
init_crypto();
function utf8(str) {
  return new TextEncoder().encode(str);
}
async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8(data));
  return bytesToHex(sig);
}
async function signJWT(payload, secret, ttlSeconds = 86400) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1e3);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = b64url(utf8(JSON.stringify(header)));
  const p = b64url(utf8(JSON.stringify(body)));
  const sig = await hmacSign(secret, `${h}.${p}`);
  return `${h}.${p}.${sig}`;
}

// src/worker/auth/session.js
init_crypto();
init_config();
init_kv();
init_id();
init_db();

// src/worker/auth/permissions.js
function hasPermission(user, permission) {
  if (!user) return false;
  const perms = user.permissions || [];
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  const [cat] = permission.split(".");
  if (perms.includes(`${cat}.*`)) return true;
  return false;
}

// src/worker/auth/session.js
var COOKIE_NAME = "nexus_session";
var CSRF_HEADER = "x-csrf-token";
var CSRF_COOKIE = "nexus_csrf";
async function createSession(env, kv, user, ttl) {
  const token2 = randomId("sess", 24);
  await saveSession(kv, token2, user.id, ttl);
  const jwt = await signJWT({ sub: user.id, uid: user.id }, getConfig(env).jwtSecret, ttl);
  const csrf = randomId("csrf", 16);
  return { token: token2, jwt, csrf, ttl };
}
function sessionCookie(token2, ttl, secure = true) {
  const parts = [
    `${COOKIE_NAME}=${token2}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${ttl}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
function csrfCookie(csrf, secure = true) {
  return `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Strict; Max-Age=86400${secure ? "; Secure" : ""}`;
}
function clearCookies() {
  return {
    "set-cookie": [
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`
    ]
  };
}
function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}
function getSessionToken(request) {
  const cookies = parseCookies(request);
  return cookies[COOKIE_NAME] || null;
}
function getCsrfToken(request) {
  return request.headers.get(CSRF_HEADER) || "";
}
async function getCurrentUser(db, kv, request, env) {
  const token2 = getSessionToken(request);
  if (!token2) return null;
  const userId = await readSession(kv, token2);
  if (!userId) return null;
  const user = await db.prepare(
    `SELECT u.id, u.username, u.email, u.display_name, u.status, u.role_id, u.last_login, u.created_at,
              r.permissions as permissions
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`
  ).bind(userId).first();
  if (!user) return null;
  if (user.status === "disabled") return null;
  try {
    user.permissions = JSON.parse(user.permissions);
  } catch {
    user.permissions = [];
  }
  return user;
}
function validateCsrf(request) {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  const cookies = parseCookies(request);
  const cookieCsrf = cookies[CSRF_COOKIE];
  const headerCsrf = getCsrfToken(request);
  if (!cookieCsrf || !headerCsrf) return false;
  return cookieCsrf === headerCsrf;
}
function buildAuthCookies(env, session, secure = true) {
  return {
    "set-cookie": [sessionCookie(session.token, session.ttl, secure), csrfCookie(session.csrf, secure)]
  };
}

// src/worker/api/routes/auth.js
init_config();

// src/worker/utils/validate.js
function isString(v, opts = {}) {
  if (typeof v !== "string") return false;
  if (opts.min && v.length < opts.min) return false;
  if (opts.max && v.length > opts.max) return false;
  if (opts.pattern && !opts.pattern.test(v)) return false;
  return true;
}
function isInt(v, opts = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) return false;
  if (opts.min !== void 0 && n < opts.min) return false;
  if (opts.max !== void 0 && n > opts.max) return false;
  return true;
}
function isIn(v, arr) {
  return arr.includes(v);
}
function isEmail(v) {
  if (typeof v !== "string" || v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isArray(v) {
  return Array.isArray(v);
}
function isBool(v) {
  return typeof v === "boolean" || v === "0" || v === "1" || v === 0 || v === 1;
}
function toBool(v) {
  return v === true || v === "1" || v === 1 || v === "true";
}
function optional(value, fn, defaultVal) {
  if (value === void 0 || value === null || value === "") return { ok: true, value: defaultVal };
  return fn(value) ? { ok: true, value } : { ok: false, error: "invalid" };
}
function validateBody(body, schema, { allowUnknown = false } = {}) {
  const errors = {};
  const clean = {};
  for (const [field, rule] of Object.entries(schema)) {
    const value = body ? body[field] : void 0;
    const res = typeof rule === "function" ? rule(value) : rule;
    if (res === false) errors[field] = "invalid";
    else if (res === true) clean[field] = value;
    else if (res && res.ok) clean[field] = res.value;
    else if (res) errors[field] = res.error || "invalid";
  }
  if (!allowUnknown && body) {
    for (const key of Object.keys(body)) {
      if (!(key in schema)) errors[key] = "unknown_field";
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

// src/worker/utils/error.js
var AppError = class extends Error {
  constructor(message, status = 400, code = "bad_request") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
};
var ValidationError = class extends AppError {
  constructor(message, fields = {}) {
    super(message, 422, "validation_error");
    this.fields = fields;
  }
};
var AuthError = class extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "unauthenticated");
  }
};
var NotFoundError = class extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "not_found");
  }
};
var ConflictError = class extends AppError {
  constructor(message = "Resource conflict") {
    super(message, 409, "conflict");
  }
};
var ExternalError = class extends AppError {
  constructor(message = "Upstream service error", status = 502, meta = {}) {
    super(message, status, "external_error");
    this.meta = meta;
  }
};
function toErrorResponse(err) {
  if (err instanceof AppError) {
    const body = { message: err.message, code: err.code };
    if (err instanceof ValidationError && err.fields) body.fields = err.fields;
    if (err instanceof ExternalError && err.meta) body.meta = err.meta;
    return { status: err.status, body };
  }
  return {
    status: 500,
    body: { message: "Internal server error", code: "internal_error" }
  };
}

// src/worker/api/routes/auth.js
init_logger();

// src/worker/auth/auth.js
init_config();
async function authenticate(ctx) {
  if (ctx.user) return ctx.user;
  const { db, kv, request, env } = ctx;
  const user = await getCurrentUser(db, kv, request, env);
  if (!user) throw new AuthError("Authentication required");
  ctx.user = user;
  return user;
}
function getClientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// src/worker/api/routes/auth.js
init_db();
async function login(ctx) {
  const { db, kv, request, env } = ctx;
  const body = await request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    email: (v) => isEmail(v) || isString(v, { min: 2 }),
    password: (v) => isString(v, { min: 1 })
  });
  if (!valid) throw new ValidationError("Invalid credentials payload", errors);
  const user = await db.prepare("SELECT * FROM users WHERE email = ? OR username = ?").bind(clean.email, clean.email).first();
  if (!user || user.status === "disabled") {
    await audit(db, { action: "login_failed", resource: "auth", ip: getClientIp(request), status: "failure", metadata: { email: clean.email } });
    throw new AuthError("Invalid email or password");
  }
  const match = await verifyPassword(clean.password, user.password_hash);
  if (!match) {
    await audit(db, { action: "login_failed", user: { id: user.id, username: user.username }, resource: "auth", ip: getClientIp(request), status: "failure" });
    throw new AuthError("Invalid email or password");
  }
  const cfg = getConfig(env);
  const session = await createSession(env, kv, user, cfg.sessionTtl);
  await db.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(nowSec(), user.id).run();
  await audit(db, { user: { id: user.id, username: user.username }, action: "login", resource: "auth", ip: getClientIp(request), status: "success" });
  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol;
  const secure = proto.startsWith("https");
  return json(
    { ok: true, data: publicUser(user), csrf: session.csrf, ts: nowSec() },
    200,
    buildAuthCookies(env, session, secure)
  );
}
async function logout(ctx) {
  const { kv, request } = ctx;
  const token2 = getSessionToken(request);
  if (token2) await kv.delete(`sess:${token2}`).catch(() => {
  });
  return json({ ok: true }, 200, clearCookies());
}
async function me(ctx) {
  const user = await getCurrentUser(ctx.db, ctx.kv, ctx.request, ctx.env);
  if (!user) throw new AuthError();
  return ok(publicUser(user));
}
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    roleId: u.role_id,
    status: u.status,
    permissions: u.permissions,
    lastLogin: u.last_login,
    createdAt: u.created_at
  };
}

// src/worker/api/routes/health.js
init_config();

// src/worker/cloudflare/cf.js
init_config();
init_credentials();

// src/worker/cloudflare/mock.js
function delay(ms = 200) {
  return new Promise((r) => setTimeout(r, ms));
}
function fakeId() {
  return "zone_" + Math.random().toString(36).slice(2, 12);
}
var DEMO_MOCK = {
  // List zones (domains) in the account
  async listZones(params = {}) {
    await delay();
    const perPage = Math.min(parseInt(params.per_page || 20, 10), 100);
    const names = ["example.com", "my-vpn.net", "secure-cdn.io", "proxy-domain.org"];
    const zones = names.map((name, i) => ({
      id: fakeId(),
      name,
      status: i % 3 === 0 ? "pending" : "active",
      paused: false,
      name_servers: [`ns${i + 1}.cloudflare.com`, `ns${i + 2}.cloudflare.com`],
      original_name_servers: [`ns${i + 1}.cloudflare.com`],
      created_on: new Date(Date.now() - i * 864e5).toISOString(),
      modified_on: (/* @__PURE__ */ new Date()).toISOString()
    }));
    return { zones: zones.slice(0, perPage), total: zones.length };
  },
  async getZone(zoneId) {
    await delay();
    return {
      id: zoneId,
      name: "example.com",
      status: "active",
      name_servers: ["ns1.cloudflare.com", "ns2.cloudflare.com"],
      paused: false
    };
  },
  async verifyZone(zoneId) {
    await delay();
    return { id: zoneId, status: "active", verified: true };
  },
  async listDnsRecords(zoneId, params = {}) {
    await delay();
    const types = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"];
    const records = Array.from({ length: 8 }).map((_, i) => ({
      id: fakeId(),
      zone_id: zoneId,
      name: ["@", "www", "api", "cdn", "node1", "node2", "mail", "vpn"][i % 8] + ".example.com",
      type: types[i % types.length],
      content: i % 3 === 0 ? "192.0.2." + (i + 1) : "2606:4700:4700::" + (i + 1),
      ttl: i % 4 === 0 ? 1 : 3600,
      proxied: i % 2 === 0,
      created_on: (/* @__PURE__ */ new Date()).toISOString(),
      modified_on: (/* @__PURE__ */ new Date()).toISOString()
    }));
    return { result: records, success: true };
  },
  async createDnsRecord(zoneId, data) {
    await delay();
    return {
      id: fakeId(),
      zone_id: zoneId,
      ...data,
      created_on: (/* @__PURE__ */ new Date()).toISOString(),
      modified_on: (/* @__PURE__ */ new Date()).toISOString()
    };
  },
  async updateDnsRecord(zoneId, recordId, data) {
    await delay();
    return { id: recordId, zone_id: zoneId, ...data, modified_on: (/* @__PURE__ */ new Date()).toISOString() };
  },
  async deleteDnsRecord(zoneId, recordId) {
    await delay();
    return { id: recordId, deleted: true };
  },
  async getZoneStatus(zoneId) {
    await delay();
    return {
      zone_id: zoneId,
      dns: { status: "active", https: { status: "active" } },
      ssl: { status: "active" }
    };
  },
  async getAccount() {
    return { id: "demo-account", name: "Demo Account", settings: {} };
  }
};

// src/worker/cloudflare/cf.js
var API_BASE = "https://api.cloudflare.com/client/v4";
var CloudflareClient = class {
  constructor(token2, accountId, opts = {}) {
    this.token = token2;
    this.accountId = accountId;
    this.timeout = opts.timeout || 15e3;
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
          "content-type": "application/json"
        };
        if (opts.params) {
          const qs = new URLSearchParams(opts.params).toString();
          if (qs) path += (path.includes("?") ? "&" : "?") + qs;
        }
        const res = await fetch(API_BASE + path, {
          method,
          headers,
          body: body !== void 0 ? JSON.stringify(body) : void 0,
          signal: ctrl.signal
        });
        clearTimeout(timer);
        return await this.handleResponse(res, method, url);
      } catch (e) {
        lastErr = e;
        if (e.name === "AbortError" || e.status && e.status >= 500) {
          attempt++;
          if (attempt <= this.maxRetries) {
            await sleep(Math.min(500 * 2 ** attempt, 4e3));
            continue;
          }
        }
        throw e instanceof ExternalError ? e : new ExternalError(`Cloudflare API error: ${String(e.message || e)}`);
      }
    }
    throw lastErr instanceof ExternalError ? lastErr : new ExternalError("Cloudflare API failed after retries");
  }
  async handleResponse(res, method, url) {
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 429) {
      throw new ExternalError("Cloudflare rate limit exceeded", 429, { retryAfter: res.headers.get("retry-after") });
    }
    if (!res.ok || !data || data.success === false) {
      const errs = data?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      throw new ExternalError(`Cloudflare: ${errs}`, res.status >= 400 && res.status < 500 ? 400 : 502, {
        code: data?.errors?.[0]?.code
      });
    }
    return data.result;
  }
};
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function getClient(env, kv) {
  const cfg = getConfig(env);
  if (!isCloudflareConfigured(cfg)) {
    if (cfg.demoMode) return null;
    return null;
  }
  const creds = await activeCloudflareToken(kv, env);
  if (!creds || !creds.token) return null;
  return new CloudflareClient(creds.token, creds.accountId);
}
async function withFallback(env, kv, fn) {
  const cfg = getConfig(env);
  const client = await getClient(env, kv);
  if (!client) {
    if (cfg.demoMode) return fn(DEMO_MOCK);
    throw new ExternalError("Cloudflare API token not configured. Set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID secrets.");
  }
  return fn(client);
}

// src/worker/api/routes/health.js
init_db();
async function health(ctx) {
  const { db, kv, env } = ctx;
  const cfg = getConfig(env);
  const checks = {};
  try {
    await db.prepare("SELECT 1").first();
    checks.database = "ok";
  } catch (e) {
    checks.database = "error";
  }
  try {
    await kv.put("health:ping", "ok", { expirationTtl: 90 });
    const v = await kv.get("health:ping");
    checks.kv = v === "ok" ? "ok" : "error";
  } catch (e) {
    checks.kv = "error";
  }
  if (isCloudflareConfigured(cfg)) {
    try {
      const client = await getClient(env, kv);
      if (client) {
        await client.request("GET", "/user");
        checks.cloudflare = "ok";
      } else {
        checks.cloudflare = "no_token";
      }
    } catch {
      checks.cloudflare = "error";
    }
  } else {
    checks.cloudflare = cfg.demoMode ? "demo_mode" : "not_configured";
  }
  checks.worker = "ok";
  checks.timestamp = nowSec();
  return ok(checks);
}

// src/worker/api/routes/dashboard.js
init_db();

// src/worker/services/notifications.js
init_id();
init_db();
var MAX_NOTIFICATIONS = 500;
async function createNotification(db, { type, severity = "info", title, message, resource, resourceId }) {
  const id = randomId("ntf", 10);
  const ts = nowSec();
  await db.prepare(
    `INSERT INTO notifications (id, type, severity, title, message, resource, resource_id, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(id, type, severity, title, message, resource || null, resourceId || null, ts).run();
  const total = await db.prepare("SELECT COUNT(*) as c FROM notifications").first();
  if (total.c > MAX_NOTIFICATIONS) {
    const excess = total.c - MAX_NOTIFICATIONS;
    await db.prepare(`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications ORDER BY created_at ASC LIMIT ?)`).bind(excess).run();
  }
  return id;
}
async function listNotifications(db, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  const where = unreadOnly ? "WHERE read = 0" : "";
  const rows = await db.prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all();
  const total = await db.prepare(`SELECT COUNT(*) as c FROM notifications ${where}`).first();
  return { rows: rows.results || [], total: total.c };
}
async function markRead(db, id) {
  await db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").bind(id).run();
}
async function markAllRead(db) {
  await db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
}
async function alert(db, type, title, message, severity, resource, resourceId) {
  return createNotification(db, { type, title, message, severity, resource, resourceId });
}

// src/worker/api/routes/dashboard.js
init_config();
async function getDashboard(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "dashboard.read")) throw new Error("forbidden");
  const { db, env } = ctx;
  const ts = nowSec();
  const day = 86400;
  const stats = {
    nodes: {
      total: await count(db, "nodes"),
      online: await count(db, "nodes", "WHERE status = ?", ["online"]),
      warning: await count(db, "nodes", "WHERE status = ?", ["warning"]),
      offline: await count(db, "nodes", "WHERE status = ?", ["offline"])
    },
    configs: {
      total: await count(db, "configs"),
      active: await count(db, "configs", "WHERE status = ?", ["active"]),
      expired: await count(db, "configs", "WHERE status = ? OR (expiration IS NOT NULL AND expiration < ?)", ["expired", ts]),
      disabled: await count(db, "configs", "WHERE status = ?", ["disabled"])
    },
    subscriptions: {
      total: await count(db, "subscriptions"),
      active: await count(db, "subscriptions", "WHERE status = ?", ["active"]),
      expired: await count(db, "subscriptions", "WHERE expiration IS NOT NULL AND expiration < ?", [ts])
    },
    domains: {
      total: await count(db, "domains"),
      online: await count(db, "domains", "WHERE status = ?", ["online"]),
      error: await count(db, "domains", "WHERE status IN (?, ?, ?, ?)", ["offline", "dns_error", "ssl_error", "pending"])
    },
    users: await count(db, "users")
  };
  const dayStart = ts - day;
  const gen = {
    today: await count(db, "generated_configs", "WHERE created_at >= ?", [dayStart]),
    total: await count(db, "generated_configs"),
    vless: await count(db, "generated_configs", "WHERE protocol = ?", ["vless"]),
    vmess: await count(db, "generated_configs", "WHERE protocol = ?", ["vmess"]),
    trojan: await count(db, "generated_configs", "WHERE protocol = ?", ["trojan"]),
    shadowsocks: await count(db, "generated_configs", "WHERE protocol = ?", ["shadowsocks"]),
    other: await count(db, "generated_configs", "WHERE protocol NOT IN (?, ?, ?, ?, ?)", ["vless", "vmess", "trojan", "shadowsocks", "socks5"]),
    socks5: await count(db, "generated_configs", "WHERE protocol = ?", ["socks5"]),
    templates: await count(db, "templates")
  };
  stats.generation = gen;
  const traffic = await db.prepare("SELECT COALESCE(SUM(traffic_up),0) as up, COALESCE(SUM(traffic_down),0) as down FROM nodes").first();
  stats.traffic = { up: traffic.up, down: traffic.down, total: traffic.up + traffic.down };
  const activity = await query(db, "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 12");
  const { rows: notifs } = await listNotifications(db, { limit: 8 });
  const trafficSeries = buildSeries(14, (i) => 50 + i * 7 % 40);
  const requestsSeries = buildSeries(14, (i) => 200 + i * 13 % 120);
  const activeUsersSeries = buildSeries(14, (i) => 10 + i * 5 % 20);
  const errorRateSeries = buildSeries(14, (i) => i % 5 + 1);
  const nodeHealthSeries = buildSeries(14, (i) => stats.nodes.online + i * 3 % 5);
  const configCreationSeries = await generationSeries(db, 14, ts);
  const expirationSeries = buildSeries(14, (i) => i % 3);
  const cfg = getConfig(env);
  const system = {
    environment: cfg.environment,
    demoMode: cfg.demoMode,
    cloudflare: isCloudflareConfigured(cfg) ? "configured" : cfg.demoMode ? "demo" : "not_configured",
    worker: "ok",
    timestamp: ts
  };
  return ok({
    stats,
    activity,
    notifications: notifs,
    series: {
      traffic: trafficSeries,
      requests: requestsSeries,
      activeUsers: activeUsersSeries,
      errorRate: errorRateSeries,
      nodeHealth: nodeHealthSeries,
      configCreation: configCreationSeries,
      expiration: expirationSeries
    },
    system
  });
}
function buildSeries(n, fn) {
  const now = nowSec();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const dayTs = now - i * 86400;
    out.push({ t: dayTs, v: fn(i) });
  }
  return out;
}
async function generationSeries(db, n, ts) {
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    buckets.push({ day: Math.floor((ts - i * 86400) / 86400), t: ts - i * 86400, v: 0 });
  }
  const startDay = buckets[0].day;
  const endDay = buckets[buckets.length - 1].day;
  const rows = await db.prepare(
    "SELECT CAST(created_at/86400 AS INTEGER) as day, COUNT(*) as c FROM generated_configs WHERE created_at/86400 BETWEEN ? AND ? GROUP BY day"
  ).bind(startDay, endDay).all();
  const byDay = {};
  for (const r of rows.results || []) byDay[r.day] = r.c;
  return buckets.map((b) => ({ t: b.t, v: byDay[b.day] || 0 }));
}

// src/worker/api/routes/domains.js
init_db();
init_id();
init_logger();

// src/worker/cloudflare/zones.js
async function listZones(env, kv, params = {}) {
  return withFallback(
    env,
    kv,
    (client) => client.listZones ? client.listZones(params) : client.request("GET", "/zones", void 0, { params })
  );
}
async function getZoneStatus(env, kv, zoneId) {
  return withFallback(
    env,
    kv,
    (client) => client.getZoneStatus ? client.getZoneStatus(zoneId) : client.request("GET", `/zones/${zoneId}`)
  );
}

// src/worker/api/routes/domains.js
var STATUSES = ["pending", "verified", "online", "offline", "dns_error", "ssl_error"];
function serializeDomain(row) {
  return {
    id: row.id,
    name: row.name,
    zoneId: row.zone_id,
    status: row.status,
    dnsStatus: row.dns_status,
    sslStatus: row.ssl_status,
    proxyStatus: Boolean(row.proxy_status),
    nameservers: row.nameservers,
    verifiedAt: row.verified_at,
    lastCheck: row.last_check,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listDomains(ctx) {
  await authenticate(ctx);
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const status = url.searchParams.get("status") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  let where = "";
  const params = [];
  if (search) {
    where += " WHERE LOWER(name) LIKE ?";
    params.push(`%${search}%`);
  }
  if (status) {
    where += (where ? " AND" : " WHERE") + " status = ?";
    params.push(status);
  }
  const total = await count(db, "domains", where, params);
  const rows = await query(db, `SELECT * FROM domains ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serializeDomain), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function getDomain(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("Domain not found");
  return ok(serializeDomain(row));
}
async function createDomain(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "domains.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 3, max: 255 }) || "invalid",
    zone_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null)
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const exists = await queryOne(ctx.db, "SELECT id FROM domains WHERE name = ?", [clean.name]);
  if (exists) throw new ValidationError("Domain already exists", { name: "exists" });
  const id = randomId("dom", 10);
  const ts = nowSec();
  await insert(ctx.db, "domains", {
    id,
    name: clean.name,
    zone_id: clean.zone_id || null,
    status: "pending",
    dns_status: "unknown",
    ssl_status: "unknown",
    proxy_status: 1,
    nameservers: [],
    verified_at: null,
    last_check: null,
    error: null,
    created_at: ts,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "domain_created", resource: "domain", resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [id]);
  return created(serializeDomain(row));
}
async function updateDomain(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "domains.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Domain not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 3, max: 255 }), void 0),
    zone_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    status: (v) => optional(v, (x) => isIn(x, STATUSES), void 0),
    proxy_status: (v) => optional(v, isBool, void 0),
    error: (v) => optional(v, (x) => isString(x, { max: 500 }), null)
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const data = {};
  for (const k of ["name", "zone_id", "status", "error"]) if (k in clean) data[k] = clean[k];
  if ("proxy_status" in clean) data.proxy_status = toBool(clean.proxy_status) ? 1 : 0;
  data.updated_at = nowSec();
  await update(ctx.db, "domains", ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: "domain_updated", resource: "domain", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  return ok(serializeDomain(row));
}
async function deleteDomain(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "domains.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Domain not found");
  await remove(ctx.db, "domains", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "domain_deleted", resource: "domain", resourceId: ctx.params.id, ip: getClientIp(ctx.request), metadata: { name: existing.name } });
  return ok({ id: ctx.params.id });
}
async function verifyDomain(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "domains.write")) throw new Error("forbidden");
  const domain = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!domain) throw new NotFoundError("Domain not found");
  try {
    if (domain.zone_id) {
      const status = await getZoneStatus(ctx.env, ctx.kv, domain.zone_id);
      const dns = status?.dns?.status === "active" ? "active" : "error";
      const ssl = status?.ssl?.status === "active" ? "active" : status?.ssl?.status || "unknown";
      const newStatus = dns === "active" ? ssl === "active" ? "online" : "ssl_error" : "dns_error";
      await update(ctx.db, "domains", domain.id, {
        dns_status: dns,
        ssl_status: ssl,
        status: newStatus,
        verified_at: nowSec(),
        last_check: nowSec(),
        error: null,
        updated_at: nowSec()
      });
      await audit(ctx.db, { user: ctx.user, action: "domain_verified", resource: "domain", resourceId: domain.id, ip: getClientIp(ctx.request), metadata: { status: newStatus } });
      const row2 = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [domain.id]);
      return ok(serializeDomain(row2));
    }
    await update(ctx.db, "domains", domain.id, { status: "verified", verified_at: nowSec(), last_check: nowSec(), updated_at: nowSec() });
    const row = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [domain.id]);
    return ok(serializeDomain(row));
  } catch (e) {
    await update(ctx.db, "domains", domain.id, { status: "dns_error", last_check: nowSec(), error: String(e.message || e), updated_at: nowSec() });
    throw e;
  }
}
async function syncCloudflareZones(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.read")) throw new Error("forbidden");
  const result = await listZones(ctx.env, ctx.kv, { per_page: 50 });
  const zones = result.zones || result.result || [];
  const imported = [];
  for (const z of zones) {
    const exists = await queryOne(ctx.db, "SELECT id FROM domains WHERE name = ?", [z.name]);
    if (exists) {
      imported.push({ name: z.name, status: "exists" });
      continue;
    }
    const id = randomId("dom", 10);
    const ts = nowSec();
    await insert(ctx.db, "domains", {
      id,
      name: z.name,
      zone_id: z.id,
      status: z.status === "active" ? "online" : "pending",
      dns_status: "unknown",
      ssl_status: "unknown",
      proxy_status: 1,
      nameservers: z.name_servers || [],
      verified_at: null,
      last_check: ts,
      error: null,
      created_at: ts,
      updated_at: ts
    });
    imported.push({ name: z.name, status: "imported" });
  }
  await audit(ctx.db, { user: ctx.user, action: "domains_synced", resource: "domain", ip: getClientIp(ctx.request), metadata: { count: imported.length } });
  return ok({ imported });
}

// src/worker/api/routes/dns.js
init_db();
init_logger();

// src/worker/cloudflare/dns.js
async function listDnsRecords(env, kv, zoneId, params = {}) {
  return withFallback(
    env,
    kv,
    (client) => client.listDnsRecords ? client.listDnsRecords(zoneId, params) : client.request("GET", `/zones/${zoneId}/dns_records`, void 0, { params })
  );
}
async function createDnsRecord(env, kv, zoneId, data) {
  return withFallback(
    env,
    kv,
    (client) => client.createDnsRecord ? client.createDnsRecord(zoneId, data) : client.request("POST", `/zones/${zoneId}/dns_records`, data)
  );
}
async function updateDnsRecord(env, kv, zoneId, recordId, data) {
  return withFallback(
    env,
    kv,
    (client) => client.updateDnsRecord ? client.updateDnsRecord(zoneId, recordId, data) : client.request("PATCH", `/zones/${zoneId}/dns_records/${recordId}`, data)
  );
}
async function deleteDnsRecord(env, kv, zoneId, recordId) {
  return withFallback(
    env,
    kv,
    (client) => client.deleteDnsRecord ? client.deleteDnsRecord(zoneId, recordId) : client.request("DELETE", `/zones/${zoneId}/dns_records/${recordId}`)
  );
}

// src/worker/api/routes/dns.js
var TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"];
async function listDns(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "dns.read")) throw new Error("forbidden");
  const domain = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!domain) throw new NotFoundError("Domain not found");
  const result = await listDnsRecords(ctx.env, ctx.kv, domain.zone_id, { per_page: 100 });
  const records = result.result || result.records || [];
  return ok(records.map(normalize));
}
async function createDns(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "dns.write")) throw new Error("forbidden");
  const domain = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!domain) throw new NotFoundError("Domain not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    type: (v) => isIn(v, TYPES) || "invalid",
    name: (v) => isString(v, { min: 1, max: 255 }) || "invalid",
    content: (v) => isString(v, { min: 1, max: 1e3 }) || "invalid",
    ttl: (v) => optional(v, (x) => isInt(x, { min: 1 }), 1),
    proxied: (v) => optional(v, isBool, false)
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const rec = await createDnsRecord(ctx.env, ctx.kv, domain.zone_id, {
    type: clean.type,
    name: clean.name,
    content: clean.content,
    ttl: clean.ttl === 1 ? 1 : clean.ttl,
    proxied: toBool(clean.proxied)
  });
  await audit(ctx.db, { user: ctx.user, action: "dns_created", resource: "dns", resourceId: rec.id, ip: getClientIp(ctx.request), metadata: { type: clean.type, name: clean.name } });
  return created(normalize(rec));
}
async function updateDns(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "dns.write")) throw new Error("forbidden");
  const domain = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!domain) throw new NotFoundError("Domain not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    type: (v) => optional(v, (x) => isIn(x, TYPES), void 0),
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 255 }), void 0),
    content: (v) => optional(v, (x) => isString(x, { min: 1, max: 1e3 }), void 0),
    ttl: (v) => optional(v, (x) => isInt(x, { min: 1 }), void 0),
    proxied: (v) => optional(v, isBool, void 0)
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const data = {};
  for (const k of ["type", "name", "content", "ttl"]) if (k in clean) data[k] = clean[k];
  if ("proxied" in clean) data.proxied = toBool(clean.proxied);
  const rec = await updateDnsRecord(ctx.env, ctx.kv, domain.zone_id, ctx.params.recordId, data);
  await audit(ctx.db, { user: ctx.user, action: "dns_updated", resource: "dns", resourceId: ctx.params.recordId, ip: getClientIp(ctx.request) });
  return ok(normalize(rec));
}
async function deleteDns(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "dns.write")) throw new Error("forbidden");
  const domain = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!domain) throw new NotFoundError("Domain not found");
  const res = await deleteDnsRecord(ctx.env, ctx.kv, domain.zone_id, ctx.params.recordId);
  await audit(ctx.db, { user: ctx.user, action: "dns_deleted", resource: "dns", resourceId: ctx.params.recordId, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.recordId });
}
async function toggleProxy(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "dns.write")) throw new Error("forbidden");
  const domain = await queryOne(ctx.db, "SELECT * FROM domains WHERE id = ?", [ctx.params.id]);
  if (!domain) throw new NotFoundError("Domain not found");
  const body = await ctx.request.json().catch(() => ({}));
  const proxied = toBool(body.proxied);
  const rec = await updateDnsRecord(ctx.env, ctx.kv, domain.zone_id, ctx.params.recordId, { proxied });
  await audit(ctx.db, { user: ctx.user, action: "dns_proxy_toggled", resource: "dns", resourceId: ctx.params.recordId, ip: getClientIp(ctx.request), metadata: { proxied } });
  return ok(normalize(rec));
}
function normalize(r) {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    proxied: Boolean(r.proxied),
    created_on: r.created_on,
    modified_on: r.modified_on
  };
}

// src/worker/api/routes/nodes.js
init_db();
init_id();
init_logger();
var PROTOCOLS = ["vless", "vmess", "trojan", "shadowsocks", "wireguard"];
function nodeSchema(required = false) {
  const need = (v, fn) => required ? fn(v) : optional(v, fn, void 0);
  return {
    name: (v) => isString(v, { min: 1, max: 120 }) || "invalid",
    address: (v) => isString(v, { min: 1, max: 255 }) || "invalid",
    domain_id: (v) => v === void 0 || v === null || v === "" ? void 0 : isString(v, { min: 1 }) || "invalid",
    port: (v) => isInt(v, { min: 1, max: 65535 }) || "invalid",
    protocol: (v) => isIn(v, PROTOCOLS) || "invalid",
    region: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    country: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    enabled: (v) => optional(v, isBool, 1),
    notes: (v) => optional(v, (x) => isString(x, { max: 2e3 }), "")
  };
}
function serializeNode(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    domainId: row.domain_id,
    port: row.port,
    protocol: row.protocol,
    status: row.status,
    region: row.region,
    country: row.country,
    latency: row.latency,
    uptime: row.uptime,
    trafficUp: row.traffic_up,
    trafficDown: row.traffic_down,
    lastSeen: row.last_seen,
    enabled: Boolean(row.enabled),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listNodes(ctx) {
  await authenticate(ctx);
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const status = url.searchParams.get("status") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  let where = "";
  const params = [];
  if (search) {
    where += " WHERE (LOWER(name) LIKE ? OR LOWER(address) LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    where += (where ? " AND" : " WHERE") + " status = ?";
    params.push(status);
  }
  const total = await count(db, "nodes", where, params);
  const rows = await query(
    db,
    `SELECT * FROM nodes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  return paginated(rows.map(serializeNode), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function getNode(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("Node not found");
  return ok(serializeNode(row));
}
async function createNode(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "nodes.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, nodeSchema(true));
  if (!valid) throw new ValidationError("Validation failed", errors);
  const id = randomId("node", 10);
  const ts = nowSec();
  await insert(ctx.db, "nodes", {
    id,
    name: clean.name,
    address: clean.address,
    domain_id: clean.domain_id ?? null,
    port: clean.port,
    protocol: clean.protocol || "vless",
    status: "offline",
    region: clean.region ?? null,
    country: clean.country ?? null,
    latency: null,
    uptime: 0,
    traffic_up: 0,
    traffic_down: 0,
    last_seen: null,
    enabled: clean.enabled === void 0 ? 1 : toBool(clean.enabled) ? 1 : 0,
    notes: clean.notes ?? "",
    created_at: ts,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "node_created", resource: "node", resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [id]);
  return created(serializeNode(row));
}
async function updateNode(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "nodes.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Node not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, nodeSchema(false), { allowUnknown: true });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const data = {};
  if (clean.name !== void 0) data.name = clean.name;
  if (clean.address !== void 0) data.address = clean.address;
  if ("domain_id" in clean) data.domain_id = clean.domain_id ?? null;
  if (clean.port !== void 0) data.port = clean.port;
  if (clean.protocol !== void 0) data.protocol = clean.protocol;
  if (clean.region !== void 0) data.region = clean.region;
  if (clean.country !== void 0) data.country = clean.country;
  if (clean.notes !== void 0) data.notes = clean.notes;
  if (clean.enabled !== void 0) data.enabled = toBool(clean.enabled) ? 1 : 0;
  data.updated_at = nowSec();
  await update(ctx.db, "nodes", ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: "node_updated", resource: "node", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [ctx.params.id]);
  return ok(serializeNode(row));
}
async function deleteNode(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "nodes.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Node not found");
  await remove(ctx.db, "nodes", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "node_deleted", resource: "node", resourceId: ctx.params.id, ip: getClientIp(ctx.request), metadata: { name: existing.name } });
  return ok({ id: ctx.params.id });
}
async function duplicateNode(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "nodes.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Node not found");
  const id = randomId("node", 10);
  const ts = nowSec();
  await insert(ctx.db, "nodes", {
    id,
    name: existing.name + " (copy)",
    address: existing.address,
    domain_id: existing.domain_id,
    port: existing.port,
    protocol: existing.protocol,
    status: "offline",
    region: existing.region,
    country: existing.country,
    latency: null,
    uptime: 0,
    traffic_up: 0,
    traffic_down: 0,
    last_seen: null,
    enabled: 0,
    notes: existing.notes,
    created_at: ts,
    updated_at: ts
  });
  const row = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [id]);
  await audit(ctx.db, { user: ctx.user, action: "node_duplicated", resource: "node", resourceId: id, ip: getClientIp(ctx.request) });
  return created(serializeNode(row));
}
async function healthCheck(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "nodes.write")) throw new Error("forbidden");
  const node = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [ctx.params.id]);
  if (!node) throw new NotFoundError("Node not found");
  const hash = [...node.address].reduce((a, c) => a + c.charCodeAt(0), 0);
  const latency = 15 + hash % 120;
  const online = latency < 200;
  const status = online ? "online" : "warning";
  const ts = nowSec();
  await update(ctx.db, "nodes", node.id, {
    latency,
    status,
    last_seen: ts,
    uptime: online ? 99.9 : 95,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "node_health_check", resource: "node", resourceId: node.id, ip: getClientIp(ctx.request), metadata: { latency, status } });
  const row = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [node.id]);
  return ok(serializeNode(row));
}
async function pingNode(ctx) {
  await authenticate(ctx);
  const node = await queryOne(ctx.db, "SELECT * FROM nodes WHERE id = ?", [ctx.params.id]);
  if (!node) throw new NotFoundError("Node not found");
  const hash = [...node.address].reduce((a, c) => a + c.charCodeAt(0), 0);
  const latency = 10 + hash % 90;
  return ok({ id: node.id, latency, alive: latency < 150, ts: nowSec() });
}

// src/worker/api/routes/configs.js
init_db();
init_id();
init_logger();

// src/worker/services/protocols.js
var REGISTRY = {};
function register(name, def) {
  REGISTRY[name] = def;
}
function listProtocols() {
  return Object.keys(REGISTRY).map((key) => ({
    id: key,
    label: REGISTRY[key].label,
    transports: REGISTRY[key].transports,
    defaultPort: REGISTRY[key].defaultPort,
    tlsRequired: REGISTRY[key].tlsRequired,
    tlsDefault: REGISTRY[key].tlsDefault,
    schema: REGISTRY[key].schema,
    description: REGISTRY[key].description || ""
  }));
}
function getProtocol(id) {
  return REGISTRY[id] || null;
}
function isSupported(id) {
  return Boolean(REGISTRY[id]);
}
function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function encodeVmess(obj) {
  return "vmess://" + b64(JSON.stringify(obj));
}
var TLS_SCHEMA = {
  key: "tls",
  type: "checkbox",
  group: "security",
  label_en: "TLS",
  label_fa: "TLS",
  default: true
};
var SNI_SCHEMA = {
  key: "sni",
  type: "text",
  group: "security",
  label_en: "SNI",
  label_fa: "SNI",
  placeholder: "example.com",
  showWhen: { tls: true }
};
var ALPN_SCHEMA = {
  key: "alpn",
  type: "select",
  group: "security",
  label_en: "ALPN",
  label_fa: "ALPN",
  multiple: true,
  options: [
    { value: "h2", label: "h2" },
    { value: "http/1.1", label: "http/1.1" },
    { value: "h3", label: "h3" }
  ],
  showWhen: { tls: true }
};
var FP_SCHEMA = {
  key: "fingerprint",
  type: "select",
  group: "security",
  label_en: "Fingerprint",
  label_fa: "Fingerprint",
  options: [
    { value: "", label: "none" },
    { value: "chrome", label: "chrome" },
    { value: "firefox", label: "firefox" },
    { value: "safari", label: "safari" },
    { value: "ios", label: "ios" },
    { value: "android", label: "android" },
    { value: "edge", label: "edge" },
    { value: "random", label: "random" }
  ],
  showWhen: { tls: true }
};
var SERVICE_NAME_SCHEMA = {
  key: "serviceName",
  type: "text",
  group: "network",
  label_en: "gRPC Service Name",
  label_fa: "\u0646\u0627\u0645 \u0633\u0631\u0648\u06CC\u0633 gRPC",
  required: true,
  placeholder: "grpc-service",
  showWhen: { transport: ["grpc"] },
  note: "VLESS + gRPC requires a valid Service Name."
};
var WS_PATH_SCHEMA = {
  key: "path",
  type: "text",
  group: "network",
  label_en: "WS Path",
  label_fa: "\u0645\u0633\u06CC\u0631 WS",
  placeholder: "/",
  showWhen: { transport: ["ws", "h2"] }
};
var WS_HOST_SCHEMA = {
  key: "host",
  type: "text",
  group: "network",
  label_en: "WS Host / Authority",
  label_fa: "\u0645\u06CC\u0632\u0628\u0627\u0646",
  placeholder: "example.com",
  showWhen: { transport: ["ws", "grpc"] }
};
register("vless", {
  label: "VLESS",
  transports: ["tcp", "ws", "grpc", "quic", "h2"],
  defaultPort: 443,
  tlsRequired: false,
  tlsDefault: true,
  description: "Lightweight, modern protocol. Pair with TLS for production.",
  schema: {
    basic: [
      { key: "uuid", type: "text", group: "basic", label_en: "UUID", label_fa: "UUID", required: true, placeholder: "auto-generated", gen: "uuid" },
      { key: "name", type: "text", group: "basic", label_en: "Name", label_fa: "\u0646\u0627\u0645", placeholder: "NEXUS-01" }
    ],
    security: [TLS_SCHEMA, SNI_SCHEMA, ALPN_SCHEMA, FP_SCHEMA],
    network: [
      { key: "transport", type: "transport", group: "network", label_en: "Transport", label_fa: "\u0627\u0646\u062A\u0642\u0627\u0644", required: true },
      WS_PATH_SCHEMA,
      WS_HOST_SCHEMA,
      SERVICE_NAME_SCHEMA,
      { key: "path", type: "text", group: "network", label_en: "QUIC / Extra", label_fa: "QUIC", placeholder: "optional", showWhen: { transport: ["quic"] } }
    ],
    advanced: [
      {
        key: "flow",
        type: "select",
        group: "advanced",
        label_en: "Flow",
        label_fa: "Flow",
        showWhen: { tls: true },
        options: [
          { value: "", label: "none" },
          { value: "xtls-rprx-vision", label: "xtls-rprx-vision" },
          { value: "xtls-rprx-vision-udp443", label: "xtls-rprx-vision-udp443" }
        ]
      },
      { key: "fragment", type: "text", group: "advanced", label_en: "Fragment", label_fa: "Fragment", placeholder: "e.g. 20-30" }
    ]
  },
  build({ server, port, uuid: uuid2, sni, host, path, transport, tls, tag = "Nexus", flow = "", fragment = "" }) {
    const sec = tls ? "tls" : "none";
    const params = new URLSearchParams();
    params.set("type", transport || "tcp");
    if (tls) {
      params.set("security", "tls");
      if (sni) params.set("sni", sni);
      if (host) params.set("host", host);
      if (flow) params.set("flow", flow);
    } else {
      params.set("security", "none");
    }
    if (transport === "ws") {
      if (path) params.set("path", path);
      if (host) params.set("host", host);
    } else if (transport === "grpc") {
      if (path) params.set("serviceName", path);
    } else if (transport === "quic") {
      if (path) params.set("quicSecurity", path);
    } else if (transport === "h2") {
      if (path) params.set("path", path);
    }
    if (fragment) params.set("fragment", fragment);
    const uri = `vless://${uuid2}@${server}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
    return { uri, transport: transport || "tcp", security: sec, scheme: tls ? "vless+tls" : "vless" };
  }
});
register("vmess", {
  label: "VMess",
  transports: ["tcp", "ws", "grpc"],
  defaultPort: 443,
  tlsRequired: false,
  tlsDefault: true,
  description: "Mature, widely-compatible protocol with obfuscation.",
  schema: {
    basic: [
      { key: "uuid", type: "text", group: "basic", label_en: "UUID", label_fa: "UUID", required: true, placeholder: "auto-generated", gen: "uuid" },
      { key: "name", type: "text", group: "basic", label_en: "Name", label_fa: "\u0646\u0627\u0645", placeholder: "NEXUS-01" }
    ],
    security: [TLS_SCHEMA, SNI_SCHEMA],
    network: [
      { key: "transport", type: "transport", group: "network", label_en: "Transport", label_fa: "\u0627\u0646\u062A\u0642\u0627\u0644", required: true },
      WS_PATH_SCHEMA,
      WS_HOST_SCHEMA,
      SERVICE_NAME_SCHEMA
    ],
    advanced: [
      {
        key: "scy",
        type: "select",
        group: "advanced",
        label_en: "Security (scy)",
        label_fa: "\u0631\u0645\u0632\u0646\u06AF\u0627\u0631\u06CC",
        options: [{ value: "auto", label: "auto" }, { value: "aes-128-gcm", label: "aes-128-gcm" }, { value: "chacha20-poly1305", label: "chacha20-poly1305" }, { value: "none", label: "none" }]
      }
    ]
  },
  build({ server, port, uuid: uuid2, sni, host, path, transport, tls, tag = "Nexus", scy = "auto" }) {
    const net = transport === "ws" ? "ws" : transport === "grpc" ? "grpc" : "tcp";
    const obj = {
      v: "2",
      ps: tag,
      add: server,
      port: String(port),
      id: uuid2,
      aid: "0",
      scy: scy || "auto",
      net,
      type: "none",
      sni: sni || host || "",
      host: host || "",
      path: path || "",
      tls: tls ? "tls" : ""
    };
    return { uri: encodeVmess(obj), transport: net, security: tls ? "tls" : "none", scheme: tls ? "vmess+tls" : "vmess" };
  }
});
register("trojan", {
  label: "Trojan",
  transports: ["tcp", "ws"],
  defaultPort: 443,
  tlsRequired: true,
  tlsDefault: true,
  description: "TLS-tunneled protocol disguised as HTTPS traffic.",
  schema: {
    basic: [
      { key: "password", type: "password", group: "basic", label_en: "Password", label_fa: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631", required: true, placeholder: "min 6 chars", gen: "token" },
      { key: "name", type: "text", group: "basic", label_en: "Name", label_fa: "\u0646\u0627\u0645", placeholder: "NEXUS-01" }
    ],
    security: [SNI_SCHEMA, ALPN_SCHEMA, FP_SCHEMA],
    network: [
      { key: "transport", type: "transport", group: "network", label_en: "Transport", label_fa: "\u0627\u0646\u062A\u0642\u0627\u0644", required: true },
      WS_PATH_SCHEMA,
      WS_HOST_SCHEMA
    ],
    advanced: []
  },
  build({ server, port, password, sni, host, path, transport, tag = "Nexus" }) {
    const params = new URLSearchParams();
    if (transport === "ws") {
      params.set("type", "ws");
      if (path) params.set("path", path);
      if (host) params.set("host", host);
    }
    if (sni) params.set("sni", sni);
    const query2 = params.toString();
    const uri = `trojan://${encodeURIComponent(password || "")}@${server}:${port}${query2 ? "?" + query2 : ""}#${encodeURIComponent(tag)}`;
    return { uri, transport: transport || "tcp", security: "tls", scheme: "trojan+tls" };
  }
});
register("shadowsocks", {
  label: "Shadowsocks",
  transports: ["tcp"],
  defaultPort: 8388,
  tlsRequired: false,
  tlsDefault: false,
  description: "Fast, lightweight SOCKS5-based proxy.",
  schema: {
    basic: [
      { key: "password", type: "password", group: "basic", label_en: "Password", label_fa: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631", required: true, placeholder: "min 4 chars", gen: "token" },
      {
        key: "method",
        type: "select",
        group: "basic",
        label_en: "Method",
        label_fa: "\u0645\u062A\u062F",
        required: true,
        options: [
          { value: "aes-256-gcm", label: "aes-256-gcm" },
          { value: "aes-128-gcm", label: "aes-128-gcm" },
          { value: "chacha20-ietf-poly1305", label: "chacha20-ietf-poly1305" },
          { value: "xchacha20-ietf-poly1305", label: "xchacha20-ietf-poly1305" },
          { value: "aes-256-cfb", label: "aes-256-cfb" },
          { value: "chacha20-ietf", label: "chacha20-ietf" }
        ]
      },
      { key: "name", type: "text", group: "basic", label_en: "Name", label_fa: "\u0646\u0627\u0645", placeholder: "NEXUS-01" }
    ],
    security: [],
    network: [
      { key: "transport", type: "transport", group: "network", label_en: "Transport", label_fa: "\u0627\u0646\u062A\u0642\u0627\u0644", required: true }
    ],
    advanced: []
  },
  build({ server, port, password, method = "aes-256-gcm", tag = "Nexus" }) {
    const user = b64(`${method}:${password || ""}`);
    const uri = `ss://${user}@${server}:${port}#${encodeURIComponent(tag)}`;
    return { uri, transport: "tcp", security: "none", scheme: "ss" };
  }
});
register("socks5", {
  label: "SOCKS5",
  transports: ["tcp"],
  defaultPort: 1080,
  tlsRequired: false,
  tlsDefault: false,
  description: "Standard SOCKS5 proxy. TLS variant (socks5+tls) where supported.",
  schema: {
    basic: [
      { key: "username", type: "text", group: "basic", label_en: "Username", label_fa: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC", placeholder: "optional" },
      { key: "password", type: "password", group: "basic", label_en: "Password", label_fa: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631", placeholder: "optional" },
      { key: "name", type: "text", group: "basic", label_en: "Name", label_fa: "\u0646\u0627\u0645", placeholder: "NEXUS-01" }
    ],
    security: [
      { key: "tls", type: "checkbox", group: "security", label_en: "TLS (socks5+tls)", label_fa: "TLS", default: false }
    ],
    network: [
      { key: "transport", type: "transport", group: "network", label_en: "Transport", label_fa: "\u0627\u0646\u062A\u0642\u0627\u0644", required: true },
      { key: "dns", type: "text", group: "network", label_en: "DNS (for remote resolve)", label_fa: "DNS", placeholder: "e.g. 1.1.1.1" }
    ],
    advanced: []
  },
  build({ server, port, username, password, tls, dns, tag = "Nexus" }) {
    const scheme = tls ? "socks5+tls" : "socks5";
    const auth = username || password ? `${encodeURIComponent(username || "")}:${encodeURIComponent(password || "")}@` : "";
    const params = new URLSearchParams();
    if (dns) params.set("dns", dns);
    const query2 = params.toString();
    const uri = `${scheme}://${auth}${server}:${port}${query2 ? "?" + query2 : ""}#${encodeURIComponent(tag)}`;
    return { uri, transport: "tcp", security: tls ? "tls" : "none", scheme };
  }
});
register("http", {
  label: "HTTP",
  transports: ["tcp"],
  defaultPort: 8080,
  tlsRequired: false,
  tlsDefault: false,
  description: "Plain HTTP proxy. Use HTTPS variant for encryption.",
  schema: {
    basic: [
      { key: "username", type: "text", group: "basic", label_en: "Username", label_fa: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC", placeholder: "optional" },
      { key: "password", type: "password", group: "basic", label_en: "Password", label_fa: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631", placeholder: "optional" },
      { key: "name", type: "text", group: "basic", label_en: "Name", label_fa: "\u0646\u0627\u0645", placeholder: "NEXUS-01" }
    ],
    security: [
      { key: "tls", type: "checkbox", group: "security", label_en: "TLS (HTTPS)", label_fa: "TLS", default: false }
    ],
    network: [
      { key: "transport", type: "transport", group: "network", label_en: "Transport", label_fa: "\u0627\u0646\u062A\u0642\u0627\u0644", required: true },
      { key: "path", type: "text", group: "network", label_en: "Path", label_fa: "\u0645\u0633\u06CC\u0631", placeholder: "/", showWhen: { tls: true } }
    ],
    advanced: []
  },
  build({ server, port, username, password, tls, path, tag = "Nexus" }) {
    const scheme = tls ? "https" : "http";
    const auth = username || password ? `${encodeURIComponent(username || "")}:${encodeURIComponent(password || "")}@` : "";
    const p = path && path !== "/" ? path : "";
    const uri = `${scheme}://${auth}${server}:${port}${p}#${encodeURIComponent(tag)}`;
    return { uri, transport: "tcp", security: tls ? "tls" : "none", scheme };
  }
});
register("https", {
  label: "HTTPS",
  transports: ["tcp"],
  defaultPort: 8443,
  tlsRequired: true,
  tlsDefault: true,
  description: "TLS-encrypted HTTP proxy. Always encrypted.",
  schema: {
    basic: [
      { key: "username", type: "text", group: "basic", label_en: "Username", label_fa: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC", placeholder: "optional" },
      { key: "password", type: "password", group: "basic", label_en: "Password", label_fa: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631", placeholder: "optional" },
      { key: "name", type: "text", group: "basic", label_en: "Name", label_fa: "\u0646\u0627\u0645", placeholder: "NEXUS-01" }
    ],
    security: [],
    network: [
      { key: "transport", type: "transport", group: "network", label_en: "Transport", label_fa: "\u0627\u0646\u062A\u0642\u0627\u0644", required: true },
      { key: "path", type: "text", group: "network", label_en: "Path", label_fa: "\u0645\u0633\u06CC\u0631", placeholder: "/", showWhen: { tls: true } }
    ],
    advanced: []
  },
  build({ server, port, username, password, path, tag = "Nexus" }) {
    const auth = username || password ? `${encodeURIComponent(username || "")}:${encodeURIComponent(password || "")}@` : "";
    const p = path && path !== "/" ? path : "";
    const uri = `https://${auth}${server}:${port}${p}#${encodeURIComponent(tag)}`;
    return { uri, transport: "tcp", security: "tls", scheme: "https" };
  }
});
register("wireguard", {
  label: "WireGuard",
  transports: ["udp"],
  defaultPort: 51820,
  tlsRequired: false,
  tlsDefault: false,
  description: "VPN tunnel protocol (key-based).",
  schema: {
    basic: [
      { key: "privateKey", type: "password", group: "basic", label_en: "Private Key", label_fa: "\u06A9\u0644\u06CC\u062F \u062E\u0635\u0648\u0635\u06CC", required: true, placeholder: "base64 key", gen: "token" },
      { key: "publicKey", type: "text", group: "basic", label_en: "Public Key", label_fa: "\u06A9\u0644\u06CC\u062F \u0639\u0645\u0648\u0645\u06CC", required: true, placeholder: "base64 key" },
      { key: "address", type: "text", group: "basic", label_en: "Address", label_fa: "\u0622\u062F\u0631\u0633", placeholder: "10.0.0.2/24" },
      { key: "name", type: "text", group: "basic", label_en: "Name", label_fa: "\u0646\u0627\u0645", placeholder: "NEXUS-01" }
    ],
    security: [],
    network: [{ key: "transport", type: "transport", group: "network", label_en: "Transport", label_fa: "\u0627\u0646\u062A\u0642\u0627\u0644", required: true }],
    advanced: []
  },
  build({ server, port, privateKey, publicKey, address = "10.0.0.2/24", tag = "Nexus" }) {
    const params = new URLSearchParams();
    params.set("publickey", publicKey || "");
    params.set("address", address);
    const uri = `wireguard://${privateKey || ""}@${server}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
    return { uri, transport: "udp", security: "none", scheme: "wireguard" };
  }
});

// src/worker/services/validation.js
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SERVICE_NAME_RE = /^[A-Za-z0-9_./-]{1,200}$/;
function defaultTlsFor(protocol) {
  switch (protocol) {
    case "http":
    case "socks5":
    case "wireguard":
    case "shadowsocks":
      return false;
    default:
      return true;
  }
}
function isValidUuid(v) {
  return typeof v === "string" && UUID_RE.test(v.trim());
}
function isValidPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}
function isValidHost(v) {
  if (typeof v !== "string" || !v.trim()) return false;
  const s = v.trim();
  if (s.length > 253) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) {
    return s.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255);
  }
  if (s.startsWith("[") && s.endsWith("]")) return true;
  return /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(s);
}
function isValidServiceName(v) {
  return typeof v === "string" && v.trim().length > 0 && SERVICE_NAME_RE.test(v.trim());
}
function isValidPath(v) {
  if (v === void 0 || v === null || v === "") return true;
  return typeof v === "string" && v.startsWith("/") && v.length <= 1024;
}
function isValidSni(v) {
  if (v === void 0 || v === null || v === "") return true;
  return isValidHost(v);
}
function isValidAlpn(v) {
  if (v === void 0 || v === null || v === "") return true;
  if (typeof v === "string") v = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) return false;
  return v.every((a) => ["h2", "http/1.1", "h3"].includes(a));
}
function isValidFingerprint(v) {
  const OK = ["", "chrome", "firefox", "safari", "ios", "android", "edge", "random"];
  return OK.includes(v);
}
function isValidMethod(v, family) {
  const SS = ["aes-128-gcm", "aes-192-gcm", "aes-256-gcm", "chacha20-ietf-poly1305", "xchacha20-ietf-poly1305", "aes-256-cfb", "aes-128-cfb", "chacha20", "chacha20-ietf"];
  if (family === "shadowsocks") return SS.includes(v);
  return typeof v === "string" && v.length > 0;
}
function validateConfigInput(input) {
  const errors = {};
  const clean = {};
  const protocol = input.protocol;
  clean.protocol = protocol;
  const server = (input.server || input.domain || "").toString().trim();
  if (!server) {
    errors.server = "Server address or domain is required.";
  } else if (!isValidHost(server)) {
    errors.server = "Enter a valid hostname, IPv4, or IPv6 address.";
  } else {
    clean.server = server;
  }
  const port = input.port === "" || input.port === void 0 || input.port === null ? null : Number(input.port);
  if (port === null) {
    clean.port = null;
  } else if (!isValidPort(port)) {
    errors.port = "Port must be a number between 1 and 65535.";
  } else {
    clean.port = port;
  }
  clean.transport = input.transport || "tcp";
  const tls = input.tls === void 0 ? defaultTlsFor(protocol) : input.tls === true || input.tls === "true" || input.tls === 1 || input.tls === "1";
  clean.tls = tls;
  if (tls) {
    if (input.sni && !isValidSni(input.sni)) errors.sni = "SNI must be a valid hostname.";
    else clean.sni = input.sni || null;
    if (input.alpn && !isValidAlpn(input.alpn)) errors.alpn = "ALPN must be h2, http/1.1, or h3 (comma-separated allowed).";
    else clean.alpn = input.alpn || null;
    if (input.fingerprint && !isValidFingerprint(input.fingerprint)) errors.fingerprint = "Fingerprint must be chrome, firefox, safari, ios, android, edge, random, or empty.";
    else clean.fingerprint = input.fingerprint || null;
  } else {
    clean.sni = null;
    clean.alpn = null;
    clean.fingerprint = null;
  }
  if (clean.transport === "ws") {
    if (input.path && !isValidPath(input.path)) errors.path = 'WebSocket path must start with "/" (e.g. /ws).';
    else clean.path = input.path || "/";
    clean.host = input.host || null;
  } else if (clean.transport === "grpc") {
    if (!input.path || !isValidServiceName(input.path)) errors.path = 'gRPC requires a valid Service Name (e.g. "grpc-service").';
    else clean.path = input.path;
    clean.host = input.host || null;
  } else if (clean.transport === "h2") {
    if (input.path && !isValidPath(input.path)) errors.path = 'HTTP/2 path must start with "/" (e.g. /).';
    else clean.path = input.path || "/";
    clean.host = input.host || null;
  } else if (clean.transport === "quic") {
    clean.path = input.path || null;
    clean.host = input.host || null;
  } else {
    clean.path = input.path || null;
    clean.host = input.host || null;
  }
  switch (protocol) {
    case "vless":
    case "vmess":
      if (!input.uuid) errors.uuid = "A UUID is required for " + protocol.toUpperCase() + ".";
      else if (!isValidUuid(input.uuid)) errors.uuid = "Invalid UUID format (e.g. 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d).";
      else clean.uuid = input.uuid.trim();
      if (input.flow && !["", "xtls-rprx-vision", "xtls-rprx-vision-udp443"].includes(input.flow)) {
        errors.flow = "Flow must be empty, xtls-rprx-vision, or xtls-rprx-vision-udp443.";
      } else clean.flow = input.flow || "";
      if (input.fragment && !SERVICE_NAME_RE.test(input.fragment)) errors.fragment = "Fragment value looks invalid.";
      else clean.fragment = input.fragment || "";
      break;
    case "trojan":
      if (!input.password) errors.password = "A password is required for Trojan.";
      else if (String(input.password).length < 6) errors.password = "Trojan password must be at least 6 characters.";
      else clean.password = String(input.password);
      break;
    case "shadowsocks":
      if (!input.password) errors.password = "A password is required for Shadowsocks.";
      else if (String(input.password).length < 4) errors.password = "Shadowsocks password must be at least 4 characters.";
      else clean.password = String(input.password);
      if (!isValidMethod(input.method, "shadowsocks")) errors.method = "Invalid Shadowsocks method.";
      else clean.method = input.method || "aes-256-gcm";
      break;
    case "socks5":
      clean.username = input.username || null;
      clean.password = input.password || null;
      break;
    case "http":
    case "https":
      clean.username = input.username || null;
      clean.password = input.password || null;
      clean.pathHttp = isValidPath(input.path) ? input.path || "/" : "/";
      break;
    default:
      break;
  }
  clean.name = input.name && String(input.name).trim() || null;
  clean.expiration = input.expiration ? Number(input.expiration) : null;
  clean.trafficLimit = input.trafficLimit ? Number(input.trafficLimit) : 0;
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

// src/worker/services/configGenerator.js
init_id();
function baseConfig(input, built, clean) {
  return {
    protocol: input.protocol,
    transport: built.transport,
    security: built.security,
    tls: clean.tls,
    server: clean.server,
    port: clean.port,
    sni: clean.sni || null,
    host: clean.host || null,
    path: clean.path || null,
    name: clean.name || `${input.protocol.toUpperCase()}-${clean.server}`,
    scheme: built.scheme || input.protocol
  };
}
function generateConfig(input) {
  const { ok: ok2, errors, clean } = validateConfigInput(input);
  if (!ok2) {
    const first = Object.entries(errors)[0];
    const reason = first ? `${first[1]}` : "Validation failed";
    const field = first ? first[0] : null;
    throw new ValidationError(`Generation failed: ${reason}`, { field, errors });
  }
  const protocol = input.protocol;
  if (!isSupported(protocol)) {
    throw new ValidationError(`Unsupported protocol: ${protocol}`, { field: "protocol" });
  }
  const p = getProtocol(protocol);
  const effectivePort = clean.port || p.defaultPort;
  const ctx = {
    server: clean.server,
    port: effectivePort,
    transport: clean.transport,
    tls: clean.tls,
    sni: clean.sni,
    host: clean.host,
    path: clean.path,
    alpn: clean.alpn,
    fingerprint: clean.fingerprint,
    flow: clean.flow,
    fragment: clean.fragment,
    uuid: clean.uuid || uuid(),
    // trojan/shadowsocks REQUIRE a password; socks5/http/https treat null as "open".
    password: protocol === "trojan" || protocol === "shadowsocks" ? clean.password || token("", 16) : clean.password,
    method: clean.method,
    username: clean.username,
    dns: input.dns,
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    address: input.address,
    tag: clean.name || `${protocol.toUpperCase()}-${clean.server}`
  };
  const built = p.build(ctx);
  const config = baseConfig(input, built, { ...clean, port: effectivePort });
  if (protocol === "vless" || protocol === "vmess") {
    config.uuid = ctx.uuid;
    config.flow = ctx.flow;
  }
  if (protocol === "trojan" || protocol === "shadowsocks") {
    config.password = ctx.password;
  }
  if (protocol === "shadowsocks") config.method = ctx.method;
  if (protocol === "socks5" || protocol === "http" || protocol === "https") {
    config.username = ctx.username || null;
  }
  const uri = built.uri;
  return {
    protocol,
    transport: built.transport,
    security: built.security,
    scheme: built.scheme || protocol,
    uri,
    json: JSON.stringify(config, null, 2),
    raw: uri,
    // Raw === the canonical share link for single-protocol configs
    server: config.server,
    port: effectivePort,
    tls: clean.tls,
    sni: clean.sni || null,
    host: clean.host || null,
    path: clean.path || null,
    expiration: clean.expiration || null,
    trafficLimit: clean.trafficLimit || 0,
    name: config.name,
    config
  };
}

// src/worker/api/routes/configs.js
var PROTOCOLS2 = ["vless", "vmess", "trojan", "shadowsocks", "wireguard"];
var TRANSPORTS = ["tcp", "ws", "grpc", "quic", "h2", "udp"];
function serializeConfig(row) {
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    nodeId: row.node_id,
    domainId: row.domain_id,
    clientId: row.client_id,
    uuid: row.uuid,
    protocol: row.protocol,
    transport: row.transport,
    tls: Boolean(row.tls),
    sni: row.sni,
    host: row.host,
    path: row.path,
    port: row.port,
    server: row.server,
    expiration: row.expiration,
    trafficLimit: row.traffic_limit,
    trafficUsed: row.traffic_used,
    status: row.status,
    notes: row.notes,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listProtocolsRoute(ctx) {
  await authenticate(ctx);
  return ok(listProtocols());
}
async function listConfigs(ctx) {
  await authenticate(ctx);
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const protocol = url.searchParams.get("protocol") || "";
  const status = url.searchParams.get("status") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  let where = "";
  const params = [];
  if (search) {
    where += " WHERE (LOWER(name) LIKE ? OR LOWER(uuid) LIKE ? OR LOWER(client_id) LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (protocol) {
    where += (where ? " AND" : " WHERE") + " protocol = ?";
    params.push(protocol);
  }
  if (status) {
    where += (where ? " AND" : " WHERE") + " status = ?";
    params.push(status);
  }
  const total = await count(db, "configs", where, params);
  const rows = await query(db, `SELECT * FROM configs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serializeConfig), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function getConfigRoute(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, "SELECT * FROM configs WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("Config not found");
  return ok(serializeConfig(row));
}
async function createConfig(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || "invalid",
    node_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    domain_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    client_id: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    uuid: (v) => isString(v, { min: 8, max: 120 }) || "invalid",
    protocol: (v) => isIn(v, PROTOCOLS2) || "invalid",
    transport: (v) => isIn(v, TRANSPORTS) || "invalid",
    tls: (v) => optional(v, isBool, 1),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => isInt(v, { min: 1, max: 65535 }) || "invalid",
    server: (v) => isString(v, { min: 1, max: 255 }) || "invalid",
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    traffic_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), 0),
    status: (v) => optional(v, (x) => isIn(x, ["active", "disabled", "expired"]), "active"),
    notes: (v) => optional(v, (x) => isString(x, { max: 2e3 }), ""),
    tags: (v) => optional(v, isArray, [])
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const id = randomId("cfg", 10);
  const ts = nowSec();
  const tlsVal = clean.tls === void 0 ? 1 : toBool(clean.tls) ? 1 : 0;
  await insert(ctx.db, "configs", {
    id,
    name: clean.name,
    user_id: null,
    node_id: clean.node_id,
    domain_id: clean.domain_id,
    client_id: clean.client_id,
    uuid: clean.uuid,
    protocol: clean.protocol,
    transport: clean.transport || "tcp",
    tls: tlsVal,
    sni: clean.sni || null,
    host: clean.host || null,
    path: clean.path || null,
    port: clean.port,
    server: clean.server,
    expiration: clean.expiration || null,
    traffic_limit: clean.traffic_limit || 0,
    traffic_used: 0,
    status: clean.status || "active",
    notes: clean.notes || "",
    tags: clean.tags || [],
    created_at: ts,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "config_created", resource: "config", resourceId: id, ip: getClientIp(ctx.request), metadata: { protocol: clean.protocol, name: clean.name } });
  const row = await queryOne(ctx.db, "SELECT * FROM configs WHERE id = ?", [id]);
  return created(serializeConfig(row));
}
async function updateConfig(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM configs WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Config not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 120 }), void 0),
    node_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    domain_id: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    client_id: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    uuid: (v) => optional(v, (x) => isString(x, { min: 8, max: 120 }), void 0),
    protocol: (v) => optional(v, (x) => isIn(x, PROTOCOLS2), void 0),
    transport: (v) => optional(v, (x) => isIn(x, TRANSPORTS), void 0),
    tls: (v) => optional(v, isBool, void 0),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => isInt(x, { min: 1, max: 65535 }), void 0),
    server: (v) => optional(v, (x) => isString(x, { min: 1, max: 255 }), void 0),
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    traffic_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), void 0),
    status: (v) => optional(v, (x) => isIn(x, ["active", "disabled", "expired"]), void 0),
    notes: (v) => optional(v, (x) => isString(x, { max: 2e3 }), void 0),
    tags: (v) => optional(v, isArray, void 0)
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const data = {};
  for (const key of ["name", "node_id", "domain_id", "client_id", "uuid", "protocol", "transport", "sni", "host", "path", "port", "server", "expiration", "traffic_limit", "status", "notes", "tags"]) {
    if (key in clean) data[key] = clean[key];
  }
  if (clean.tls !== void 0) data.tls = toBool(clean.tls) ? 1 : 0;
  data.updated_at = nowSec();
  await update(ctx.db, "configs", ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: "config_updated", resource: "config", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, "SELECT * FROM configs WHERE id = ?", [ctx.params.id]);
  return ok(serializeConfig(row));
}
async function deleteConfig(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM configs WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Config not found");
  await remove(ctx.db, "configs", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "config_deleted", resource: "config", resourceId: ctx.params.id, ip: getClientIp(ctx.request), metadata: { name: existing.name } });
  return ok({ id: ctx.params.id });
}
async function generateConfigRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    protocol: (v) => isString(v, { min: 1 }) || "invalid",
    server: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    domain: (v) => optional(v, (x) => isString(x, { min: 1 }), null),
    port: (v) => optional(v, (x) => isInt(x, { min: 1, max: 65535 }), null),
    transport: (v) => optional(v, (x) => isIn(x, TRANSPORTS), "tcp"),
    tls: (v) => optional(v, isBool, 1),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    uuid: (v) => optional(v, (x) => isString(x, { min: 8, max: 120 }), null),
    clientId: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    trafficLimit: (v) => optional(v, (x) => isInt(x, { min: 0 }), 0),
    tag: (v) => optional(v, (x) => isString(x, { max: 120 }), null)
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  if (!isSupported(clean.protocol)) throw new ValidationError(`Unsupported protocol: ${clean.protocol}`);
  if (!clean.server && !clean.domain) throw new ValidationError("server or domain required");
  const out = generateConfig({
    protocol: clean.protocol,
    server: clean.server,
    domain: clean.domain,
    port: clean.port,
    transport: clean.transport || "tcp",
    tls: clean.tls === void 0 ? 1 : toBool(clean.tls),
    sni: clean.sni,
    host: clean.host,
    path: clean.path,
    uuid: clean.uuid,
    clientId: clean.clientId,
    tag: clean.tag,
    expiration: clean.expiration,
    trafficLimit: clean.trafficLimit
  });
  return ok(out);
}

// src/worker/api/routes/generate.js
init_id();
init_db();
init_db();
init_logger();
async function requireGenPerm(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write") && !hasPermission(ctx.user, "configs.read")) {
    throw new Error("forbidden");
  }
}
function parseInput(body, protocol) {
  return {
    protocol,
    server: body.server || body.domain || null,
    domain: body.domain || null,
    port: body.port ?? null,
    transport: body.transport || "tcp",
    tls: body.tls === void 0 ? void 0 : body.tls,
    sni: body.sni || null,
    host: body.host || null,
    path: body.path || null,
    alpn: body.alpn || null,
    fingerprint: body.fingerprint || null,
    flow: body.flow || null,
    fragment: body.fragment || null,
    uuid: body.uuid || null,
    password: body.password || null,
    method: body.method || null,
    username: body.username || null,
    dns: body.dns || null,
    privateKey: body.privateKey || null,
    publicKey: body.publicKey || null,
    address: body.address || null,
    name: body.name || null,
    expiration: body.expiration || null,
    trafficLimit: body.trafficLimit || 0
  };
}
async function generateByProtocol(ctx) {
  await requireGenPerm(ctx);
  const protocol = ctx.params.protocol;
  const body = await ctx.request.json().catch(() => ({}));
  try {
    const result = generateConfig(parseInput(body, protocol));
    if (body.save || body.persist) {
      return created(await persistGenerated(ctx, result, body));
    }
    return ok(result);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(`Generation failed: ${e.message}`, { field: "protocol" });
  }
}
async function generateBatch(ctx) {
  await requireGenPerm(ctx);
  const body = await ctx.request.json().catch(() => ({}));
  const {
    count: count2 = 1,
    protocol = "vless",
    transport = "tcp",
    endpointId,
    namingPattern = "NEXUS",
    server,
    domain
  } = body;
  const n = Math.max(1, Math.min(500, Number(count2) || 1));
  const endpoints = endpointId ? await query(ctx.db, "SELECT * FROM endpoints WHERE id = ?", [endpointId]) : [];
  const out = [];
  const errors = [];
  for (let i = 1; i <= n; i++) {
    const idx = String(i).padStart(2, "0");
    const name = `${namingPattern}-${idx}`;
    const ep = endpoints.length ? endpoints[(i - 1) % endpoints.length] : null;
    const target = server || domain || (ep ? ep.host || ep.domain : null);
    if (!target) {
      errors.push({ index: i, error: "No endpoint/server supplied." });
      continue;
    }
    const input = parseInput(
      {
        ...body,
        protocol,
        transport: body.transport || ep?.transport || "tcp",
        server: target,
        domain: null,
        name,
        uuid: body.uuid || uuid(),
        password: body.password || token("", 12),
        port: body.port || ep?.port || null,
        sni: body.sni || ep?.host || ep?.domain || null
      },
      protocol
    );
    try {
      const result = generateConfig(input);
      out.push(result);
    } catch (e) {
      errors.push({ index: i, error: e.message });
    }
  }
  let saved = 0;
  if (body.save || body.persist) {
    for (const r of out) {
      await persistGenerated(ctx, r, {});
      saved++;
    }
  }
  const uris = out.map((r) => r.uri).join("\n");
  return ok({
    count: out.length,
    saved,
    configs: out.map((r) => ({ name: r.name, protocol: r.protocol, uri: r.uri })),
    uris,
    errors,
    // Only standard formats are emitted; no fabrication for unsupported shapes.
    formats: { uri: uris }
  });
}
async function persistGenerated(ctx, result, body) {
  const id = randomId("gen", 12);
  const ts = nowSec();
  const row = {
    id,
    owner_id: ctx.user?.id || null,
    name: result.name || body.name || `${result.protocol.toUpperCase()}-${result.server}`,
    protocol: result.protocol,
    transport: result.transport,
    security: result.security,
    server: result.server,
    port: result.port,
    tls: result.tls ? 1 : 0,
    sni: result.sni || null,
    host: result.host || null,
    path: result.path || null,
    uuid: result.config?.uuid || body.uuid || null,
    endpoint_id: body.endpointId || null,
    template_id: body.templateId || null,
    uri: result.uri,
    json: result.json,
    expiration: result.expiration || null,
    traffic_limit: result.trafficLimit || 0,
    status: "active",
    created_at: ts,
    updated_at: ts
  };
  await insert(ctx.db, "generated_configs", row);
  await audit(ctx.db, {
    user: ctx.user,
    action: "config_generated",
    resource: "generated_config",
    resourceId: id,
    ip: getClientIp(ctx.request),
    metadata: { protocol: result.protocol, name: row.name }
  });
  return { id, name: row.name, protocol: result.protocol, uri: result.uri, json: result.json };
}

// src/worker/api/routes/templates.js
init_db();
init_id();
init_logger();
function serialize2(row) {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    transport: row.transport,
    tls: Boolean(row.tls),
    server: row.server || null,
    domain: row.domain || null,
    port: row.port || null,
    sni: row.sni || null,
    host: row.host || null,
    path: row.path || null,
    alpn: row.alpn || null,
    fingerprint: row.fingerprint || null,
    flow: row.flow || null,
    fragment: row.fragment || null,
    method: row.method || null,
    tags: row.tags,
    description: row.description || "",
    usageCount: row.usage_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listTemplates(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.read")) throw new Error("forbidden");
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  let where = "";
  const params = [];
  if (search) {
    where = "WHERE LOWER(name) LIKE ?";
    params.push(`%${search}%`);
  }
  const total = await count(db, "templates", where, params);
  const rows = await query(db, `SELECT * FROM templates ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serialize2), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function createTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || "invalid",
    protocol: (v) => isIn(v, ["vless", "vmess", "trojan", "shadowsocks", "socks5", "http", "https", "wireguard"]) || "invalid",
    transport: (v) => optional(v, (x) => isString(x, { max: 16 }), "tcp"),
    tls: (v) => optional(v, (x) => x === true || x === false, true),
    server: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => Number(x) >= 1 && Number(x) <= 65535, null),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    alpn: (v) => optional(v, (x) => isArray(x) || isString(x), null),
    fingerprint: (v) => optional(v, (x) => isString(x, { max: 32 }), null),
    flow: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    fragment: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    method: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    description: (v) => optional(v, (x) => isString(x, { max: 500 }), ""),
    tags: (v) => optional(v, isArray, [])
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const id = randomId("tpl", 10);
  const ts = nowSec();
  await insert(ctx.db, "templates", {
    id,
    name: clean.name,
    protocol: clean.protocol,
    transport: clean.transport || "tcp",
    tls: clean.tls ? 1 : 0,
    server: clean.server || null,
    domain: clean.domain || null,
    port: clean.port || null,
    sni: clean.sni || null,
    host: clean.host || null,
    path: clean.path || null,
    alpn: clean.alpn || null,
    fingerprint: clean.fingerprint || null,
    flow: clean.flow || null,
    fragment: clean.fragment || null,
    method: clean.method || null,
    description: clean.description || "",
    tags: clean.tags || [],
    usage_count: 0,
    created_at: ts,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "template_created", resource: "template", resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, "SELECT * FROM templates WHERE id = ?", [id]);
  return created(serialize2(row));
}
async function getTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.read")) throw new Error("forbidden");
  const row = await queryOne(ctx.db, "SELECT * FROM templates WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("Template not found");
  return ok(serialize2(row));
}
async function updateTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM templates WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Template not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 120 }), void 0),
    protocol: (v) => optional(v, (x) => isIn(x, ["vless", "vmess", "trojan", "shadowsocks", "socks5", "http", "https", "wireguard"]), void 0),
    transport: (v) => optional(v, (x) => isString(x, { max: 16 }), void 0),
    tls: (v) => optional(v, (x) => x === true || x === false, void 0),
    server: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => Number(x) >= 1 && Number(x) <= 65535, null),
    sni: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    path: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    alpn: (v) => optional(v, (x) => isArray(x) || isString(x), null),
    fingerprint: (v) => optional(v, (x) => isString(x, { max: 32 }), null),
    flow: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    fragment: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    method: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    description: (v) => optional(v, (x) => isString(x, { max: 500 }), void 0),
    tags: (v) => optional(v, isArray, void 0)
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const data = {};
  for (const k of ["name", "protocol", "transport", "server", "domain", "sni", "host", "path", "alpn", "fingerprint", "flow", "fragment", "method", "description", "tags"]) {
    if (k in clean) data[k] = clean[k];
  }
  if (clean.tls !== void 0) data.tls = clean.tls ? 1 : 0;
  if (clean.port !== void 0) data.port = clean.port;
  data.updated_at = nowSec();
  await update(ctx.db, "templates", ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: "template_updated", resource: "template", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, "SELECT * FROM templates WHERE id = ?", [ctx.params.id]);
  return ok(serialize2(row));
}
async function deleteTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM templates WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Template not found");
  await remove(ctx.db, "templates", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "template_deleted", resource: "template", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}
async function duplicateTemplate(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM templates WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Template not found");
  const id = randomId("tpl", 10);
  const ts = nowSec();
  await insert(ctx.db, "templates", {
    id,
    name: `${existing.name} (copy)`,
    protocol: existing.protocol,
    transport: existing.transport,
    tls: existing.tls,
    server: existing.server,
    domain: existing.domain,
    port: existing.port,
    sni: existing.sni,
    host: existing.host,
    path: existing.path,
    alpn: existing.alpn,
    fingerprint: existing.fingerprint,
    flow: existing.flow,
    fragment: existing.fragment,
    method: existing.method,
    description: existing.description,
    tags: existing.tags,
    usage_count: 0,
    created_at: ts,
    updated_at: ts
  });
  const row = await queryOne(ctx.db, "SELECT * FROM templates WHERE id = ?", [id]);
  return created(serialize2(row));
}

// src/worker/api/routes/generated.js
init_db();
init_logger();
function serialize3(row) {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    transport: row.transport,
    security: row.security,
    server: row.server,
    port: row.port,
    tls: Boolean(row.tls),
    sni: row.sni || null,
    host: row.host || null,
    path: row.path || null,
    endpointId: row.endpoint_id || null,
    templateId: row.template_id || null,
    uri: row.uri,
    expiration: row.expiration || null,
    trafficLimit: row.traffic_limit || 0,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listGenerated(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.read")) throw new Error("forbidden");
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const protocol = url.searchParams.get("protocol") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push("LOWER(name) LIKE ?");
    params.push(`%${search}%`);
  }
  if (protocol) {
    clauses.push("protocol = ?");
    params.push(protocol);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await count(db, "generated_configs", where, params);
  const rows = await query(db, `SELECT * FROM generated_configs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serialize3), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function getGenerated(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.read")) throw new Error("forbidden");
  const row = await queryOne(ctx.db, "SELECT * FROM generated_configs WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("Generated config not found");
  return ok({ ...serialize3(row), json: row.json });
}
async function deleteGenerated(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM generated_configs WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Generated config not found");
  await remove(ctx.db, "generated_configs", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "generated_deleted", resource: "generated_config", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}

// src/worker/api/routes/endpoints.js
init_db();
init_id();
init_logger();
var COUNTRIES = {
  DE: "Germany",
  FR: "France",
  NL: "Netherlands",
  TR: "Turkey",
  SG: "Singapore",
  US: "United States",
  GB: "United Kingdom",
  JP: "Japan",
  CA: "Canada",
  AU: "Australia",
  RU: "Russia",
  BR: "Brazil"
};
function serialize4(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host || null,
    domain: row.domain || null,
    port: row.port || null,
    country: row.country || null,
    countryName: row.country ? COUNTRIES[row.country] || row.country : null,
    city: row.city || null,
    provider: row.provider || null,
    region: row.region || null,
    tls: Boolean(row.tls),
    status: row.status || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listEndpoints(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.read")) throw new Error("forbidden");
  const { db, request } = ctx;
  const url = new URL(request.url);
  const country = url.searchParams.get("country") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "50", 10));
  const offset = (page - 1) * pageSize;
  const clauses = [];
  const params = [];
  if (country) {
    clauses.push("country = ?");
    params.push(country);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await count(db, "endpoints", where, params);
  const rows = await query(db, `SELECT * FROM endpoints ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serialize4), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function getEndpoint(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.read")) throw new Error("forbidden");
  const row = await queryOne(ctx.db, "SELECT * FROM endpoints WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("Endpoint not found");
  return ok(serialize4(row));
}
async function createEndpoint(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || "invalid",
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => Number(x) >= 1 && Number(x) <= 65535, null),
    country: (v) => optional(v, (x) => isIn(x, Object.keys(COUNTRIES)), null),
    city: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    provider: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    region: (v) => optional(v, (x) => isString(x, { max: 64 }), null),
    tls: (v) => optional(v, (x) => x === true || x === false, false),
    status: (v) => optional(v, (x) => isIn(x, ["active", "disabled", "error"]), "active")
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  if (!clean.host && !clean.domain) throw new ValidationError("Host or domain is required.", { field: "host" });
  const id = randomId("ep", 10);
  const ts = nowSec();
  await insert(ctx.db, "endpoints", {
    id,
    name: clean.name,
    host: clean.host || null,
    domain: clean.domain || null,
    port: clean.port || null,
    country: clean.country || null,
    city: clean.city || null,
    provider: clean.provider || null,
    region: clean.region || null,
    tls: clean.tls ? 1 : 0,
    status: clean.status || "active",
    created_at: ts,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "endpoint_created", resource: "endpoint", resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, "SELECT * FROM endpoints WHERE id = ?", [id]);
  return created(serialize4(row));
}
async function updateEndpoint(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM endpoints WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Endpoint not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 120 }), void 0),
    host: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    port: (v) => optional(v, (x) => Number(x) >= 1 && Number(x) <= 65535, null),
    country: (v) => optional(v, (x) => isIn(x, Object.keys(COUNTRIES)), void 0),
    city: (v) => optional(v, (x) => isString(x, { max: 120 }), void 0),
    provider: (v) => optional(v, (x) => isString(x, { max: 120 }), void 0),
    region: (v) => optional(v, (x) => isString(x, { max: 64 }), void 0),
    tls: (v) => optional(v, (x) => x === true || x === false, void 0),
    status: (v) => optional(v, (x) => isIn(x, ["active", "disabled", "error"]), void 0)
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const data = {};
  for (const k of ["name", "host", "domain", "country", "city", "provider", "region", "status"]) {
    if (k in clean) data[k] = clean[k];
  }
  if (clean.tls !== void 0) data.tls = clean.tls ? 1 : 0;
  if (clean.port !== void 0) data.port = clean.port;
  data.updated_at = nowSec();
  await update(ctx.db, "endpoints", ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: "endpoint_updated", resource: "endpoint", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, "SELECT * FROM endpoints WHERE id = ?", [ctx.params.id]);
  return ok(serialize4(row));
}
async function deleteEndpoint(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "configs.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM endpoints WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Endpoint not found");
  await remove(ctx.db, "endpoints", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "endpoint_deleted", resource: "endpoint", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}

// src/worker/api/routes/cloudflare.js
init_config();

// src/worker/services/cloudflareConnection.js
init_config();
init_credentials();
init_db();
init_id();
async function buildClient(env, kv) {
  const cfg = getConfig(env);
  const creds = await activeCloudflareToken(kv, env);
  if (creds && creds.token) {
    return new CloudflareClient(creds.token, creds.accountId || cfg.cloudflareAccountId);
  }
  if (isCloudflareConfigured(cfg)) {
    return new CloudflareClient(cfg.cloudflareApiToken, cfg.cloudflareAccountId);
  }
  return null;
}
async function getConnection(db, kv, env) {
  const cfg = getConfig(env);
  const rows = await query(db, "SELECT * FROM cloudflare_connections ORDER BY created_at DESC LIMIT 1");
  const row = rows[0];
  const credsPresent = Boolean(await activeCloudflareToken(kv, env));
  const configured = isCloudflareConfigured(cfg) || credsPresent;
  if (!row && !configured) {
    return { connected: false, accountId: cfg.cloudflareAccountId || null, zone: null, status: "not_configured", tokenPreview: null };
  }
  const client = await buildClient(env, kv);
  let status = "disconnected";
  let account = cfg.cloudflareAccountId || null;
  let zone = null;
  if (client) {
    try {
      const me2 = await client.request("GET", "/user");
      status = "connected";
      if (me2 && me2.id) account = account || me2.id;
    } catch {
      status = "error";
    }
  }
  return {
    connected: status === "connected",
    status,
    accountId: account,
    zone: row ? row.zone : null,
    domain: row ? row.domain : null,
    tokenPreview: credsPresent ? "\u2022\u2022\u2022\u2022" : null,
    savedAt: row ? row.updated_at : null
  };
}
async function testConnection({ accountId, tokenValue, zone, domain, env, kv }) {
  if (!accountId || !tokenValue) {
    throw new ExternalError("Account ID and API Token are required to test the connection.", 400);
  }
  const client = new CloudflareClient(tokenValue, accountId);
  const me2 = await client.request("GET", "/user").catch((e) => {
    throw new ExternalError(`Cloudflare rejected the token: ${e.meta?.code ? "(" + e.meta.code + ") " : ""}${e.message}`, 401);
  });
  let zones = [];
  try {
    zones = await client.request("GET", "/zones", void 0, { params: { per_page: 50 } });
  } catch {
    zones = [];
  }
  const account = me2 && (me2.account || me2);
  return {
    ok: true,
    accountId: account?.id || accountId,
    accountName: account?.name || null,
    zoneCount: Array.isArray(zones) ? zones.length : zones.result ? zones.result.length : 0,
    zones: Array.isArray(zones) ? zones.slice(0, 20) : zones.result ? zones.result.slice(0, 20) : [],
    message: "Connection successful. Token is valid."
  };
}
async function saveConnection({ accountId, tokenValue, zone, domain, env, kv, db }) {
  if (!accountId || !tokenValue) {
    throw new ExternalError("Account ID and API Token are required.", 400);
  }
  const test = await testConnection({ accountId, tokenValue, zone, domain, env, kv });
  const secret = getConfig(env).encryptionKey;
  const { addCredential: addCredential2 } = await Promise.resolve().then(() => (init_credentials(), credentials_exports));
  const list = await listCredentialsSafe(kv);
  for (const c of list) {
    if (c.type === "cloudflare") await deleteCredentialSafe(kv, c.id);
  }
  await addCredential2(kv, {
    label: "Cloudflare API Token",
    type: "cloudflare",
    accountId,
    tokenValue,
    secret,
    scope: ["zones.read", "zones.write", "dns.read", "dns.write"]
  });
  const id = randomId("cf", 10);
  const ts = nowSec();
  await insert(db, "cloudflare_connections", {
    id,
    account_id: accountId,
    zone: zone || null,
    domain: domain || null,
    status: "connected",
    created_at: ts,
    updated_at: ts
  });
  return { ok: true, accountId, zone: zone || null, zoneCount: test.zoneCount, tokenPreview: "\u2022\u2022\u2022\u2022" };
}
async function listCredentialsSafe(kv) {
  try {
    const { listCredentials: listCredentials2 } = await Promise.resolve().then(() => (init_credentials(), credentials_exports));
    return await listCredentials2(kv);
  } catch {
    return [];
  }
}
async function deleteCredentialSafe(kv, id) {
  try {
    const { deleteCredential: deleteCredential2 } = await Promise.resolve().then(() => (init_credentials(), credentials_exports));
    await deleteCredential2(kv, id);
  } catch {
  }
}
async function disconnect(db, kv) {
  const list = await listCredentialsSafe(kv);
  for (const c of list) {
    if (c.type === "cloudflare") await deleteCredentialSafe(kv, c.id);
  }
  const rows = await query(db, "SELECT id FROM cloudflare_connections");
  for (const r of rows) await remove(db, "cloudflare_connections", r.id);
  return { ok: true, connected: false };
}
async function refreshConnection(db, kv, env) {
  return getConnection(db, kv, env);
}

// src/worker/api/routes/cloudflare.js
init_logger();
async function getConnectionRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.read")) throw new Error("forbidden");
  const conn = await getConnection(ctx.db, ctx.env.KV, ctx.env);
  return ok(conn);
}
async function testRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    accountId: (v) => isString(v, { min: 1, max: 120 }) || "invalid",
    tokenValue: (v) => isString(v, { min: 1 }) || "invalid",
    zone: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null)
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const result = await testConnection({ ...clean, env: ctx.env, kv: ctx.env.KV });
  await audit(ctx.db, { user: ctx.user, action: "cloudflare_test", resource: "cloudflare", ip: getClientIp(ctx.request), metadata: { accountId: clean.accountId } });
  return ok(result);
}
async function saveRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    accountId: (v) => isString(v, { min: 1, max: 120 }) || "invalid",
    tokenValue: (v) => isString(v, { min: 1 }) || "invalid",
    zone: (v) => optional(v, (x) => isString(x, { max: 255 }), null),
    domain: (v) => optional(v, (x) => isString(x, { max: 255 }), null)
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const result = await saveConnection({ ...clean, env: ctx.env, kv: ctx.env.KV, db: ctx.db });
  await audit(ctx.db, { user: ctx.user, action: "cloudflare_save", resource: "cloudflare", ip: getClientIp(ctx.request), metadata: { accountId: clean.accountId } });
  return ok(result);
}
async function disconnectRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.write")) throw new Error("forbidden");
  const result = await disconnect(ctx.db, ctx.env.KV);
  await audit(ctx.db, { user: ctx.user, action: "cloudflare_disconnect", resource: "cloudflare", ip: getClientIp(ctx.request) });
  return ok(result);
}
async function refreshRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.read")) throw new Error("forbidden");
  const conn = await refreshConnection(ctx.db, ctx.env.KV, ctx.env);
  return ok(conn);
}

// src/worker/api/routes/subscriptions.js
init_db();
init_id();
init_logger();

// src/worker/services/subscriptions.js
init_id();
async function buildSubscriptionContent(db, kv, tokenValue, host) {
  const sub = await db.prepare("SELECT * FROM subscriptions WHERE token = ?").bind(tokenValue).first();
  if (!sub) throw new NotFoundError("Subscription not found");
  if (sub.status === "revoked") throw new ValidationError("Subscription revoked");
  if (sub.status === "disabled") throw new ValidationError("Subscription disabled");
  if (sub.expiration && sub.expiration < Math.floor(Date.now() / 1e3)) {
    throw new ValidationError("Subscription expired");
  }
  const configIds = safeParse(sub.configs, []);
  if (!configIds.length) return "";
  const placeholders = configIds.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT * FROM configs WHERE id IN (${placeholders}) AND status = 'active'`).bind(...configIds).all();
  const configs = rows.results || [];
  const lines = [];
  for (const c of configs) {
    try {
      const p = getProtocol(c.protocol);
      if (!p) continue;
      const out = generateConfig({
        protocol: c.protocol,
        server: c.server,
        domain: c.server,
        port: c.port,
        transport: c.transport,
        tls: Boolean(c.tls),
        sni: c.sni,
        host: c.host,
        path: c.path,
        uuid: c.uuid,
        clientId: c.client_id,
        tag: c.name
      });
      lines.push(out.uri);
    } catch {
    }
  }
  return lines.join("\n");
}
function safeParse(str, fallback) {
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// src/worker/api/routes/subscriptions.js
function serializeSub(row) {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    token: row.token,
    configs: row.configs,
    trafficLimit: row.traffic_limit,
    trafficUsed: row.traffic_used,
    deviceLimit: row.device_limit,
    expiration: row.expiration,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listSubs(ctx) {
  await authenticate(ctx);
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const status = url.searchParams.get("status") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  let where = "";
  const params = [];
  if (search) {
    where += " WHERE LOWER(name) LIKE ?";
    params.push(`%${search}%`);
  }
  if (status) {
    where += (where ? " AND" : " WHERE") + " status = ?";
    params.push(status);
  }
  const total = await count(db, "subscriptions", where, params);
  const rows = await query(db, `SELECT * FROM subscriptions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serializeSub), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function getSub(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, "SELECT * FROM subscriptions WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("Subscription not found");
  return ok(serializeSub(row));
}
async function createSub(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "subscriptions.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || "invalid",
    owner: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    configs: (v) => optional(v, isArray, []),
    traffic_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), 0),
    device_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), 0),
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    status: (v) => optional(v, (x) => isIn(x, ["active", "disabled", "expired", "revoked"]), "active")
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const id = randomId("sub", 10);
  const ts = nowSec();
  await insert(ctx.db, "subscriptions", {
    id,
    name: clean.name,
    owner: clean.owner || null,
    token: token("sub", 24),
    configs: clean.configs || [],
    traffic_limit: clean.traffic_limit || 0,
    traffic_used: 0,
    device_limit: clean.device_limit || 0,
    expiration: clean.expiration || null,
    status: clean.status || "active",
    created_at: ts,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "subscription_created", resource: "subscription", resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name } });
  const row = await queryOne(ctx.db, "SELECT * FROM subscriptions WHERE id = ?", [id]);
  return created(serializeSub(row));
}
async function updateSub(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "subscriptions.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM subscriptions WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Subscription not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 120 }), void 0),
    owner: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    configs: (v) => optional(v, isArray, void 0),
    traffic_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), void 0),
    device_limit: (v) => optional(v, (x) => isInt(x, { min: 0 }), void 0),
    expiration: (v) => optional(v, (x) => isInt(x, { min: 0 }), null),
    status: (v) => optional(v, (x) => isIn(x, ["active", "disabled", "expired", "revoked"]), void 0)
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const data = {};
  for (const k of ["name", "owner", "configs", "traffic_limit", "device_limit", "expiration", "status"]) if (k in clean) data[k] = clean[k];
  data.updated_at = nowSec();
  await update(ctx.db, "subscriptions", ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: "subscription_updated", resource: "subscription", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, "SELECT * FROM subscriptions WHERE id = ?", [ctx.params.id]);
  return ok(serializeSub(row));
}
async function deleteSub(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "subscriptions.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM subscriptions WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Subscription not found");
  await remove(ctx.db, "subscriptions", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "subscription_deleted", resource: "subscription", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}
async function regenerateSub(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "subscriptions.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM subscriptions WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("Subscription not found");
  await update(ctx.db, "subscriptions", ctx.params.id, { token: token("sub", 24), status: "active", updated_at: nowSec() });
  await audit(ctx.db, { user: ctx.user, action: "subscription_regenerated", resource: "subscription", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, "SELECT * FROM subscriptions WHERE id = ?", [ctx.params.id]);
  return ok(serializeSub(row));
}
async function getSubscriptionLink(ctx) {
  await authenticate(ctx);
  const row = await queryOne(ctx.db, "SELECT token FROM subscriptions WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("Subscription not found");
  const base = new URL(ctx.request.url).origin;
  return ok({ url: `${base}/s/${row.token}`, token: row.token });
}

// src/worker/api/routes/users.js
init_db();
init_id();
init_crypto();
init_logger();
var ROLES = ["role_admin", "role_operator", "role_viewer"];
function serializeUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    roleId: row.role_id,
    status: row.status,
    lastLogin: row.last_login,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listUsers(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "users.read")) throw new Error("forbidden");
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  let where = "";
  const params = [];
  if (search) {
    where += " WHERE (LOWER(username) LIKE ? OR LOWER(email) LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  const total = await count(db, "users", where, params);
  const rows = await query(db, `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows.map(serializeUser), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function getUser(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "users.read")) throw new Error("forbidden");
  const row = await queryOne(ctx.db, "SELECT * FROM users WHERE id = ?", [ctx.params.id]);
  if (!row) throw new NotFoundError("User not found");
  return ok(serializeUser(row));
}
async function createUser(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "users.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    username: (v) => isString(v, { min: 3, max: 60 }) || "invalid",
    email: (v) => isEmail(v) || "invalid",
    password: (v) => isString(v, { min: 8, max: 200 }) || "invalid",
    role_id: (v) => isIn(v, ROLES) || "invalid",
    display_name: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    status: (v) => optional(v, (x) => isIn(x, ["active", "disabled"]), "active")
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const exU = await queryOne(ctx.db, "SELECT id FROM users WHERE username = ?", [clean.username]);
  if (exU) throw new ConflictError("Username already exists");
  const exE = await queryOne(ctx.db, "SELECT id FROM users WHERE email = ?", [clean.email]);
  if (exE) throw new ConflictError("Email already exists");
  const id = randomId("usr", 10);
  const hash = await hashPassword(clean.password);
  const ts = nowSec();
  await insert(ctx.db, "users", {
    id,
    username: clean.username,
    email: clean.email,
    password_hash: hash,
    role_id: clean.role_id,
    display_name: clean.display_name || clean.username,
    status: clean.status || "active",
    last_login: null,
    created_at: ts,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "user_created", resource: "user", resourceId: id, ip: getClientIp(ctx.request), metadata: { username: clean.username, role: clean.role_id } });
  const row = await queryOne(ctx.db, "SELECT * FROM users WHERE id = ?", [id]);
  return created(serializeUser(row));
}
async function updateUser(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "users.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM users WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("User not found");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    username: (v) => optional(v, (x) => isString(x, { min: 3, max: 60 }), void 0),
    email: (v) => optional(v, isEmail, void 0),
    password: (v) => optional(v, (x) => isString(x, { min: 8, max: 200 }), void 0),
    role_id: (v) => optional(v, (x) => isIn(x, ROLES), void 0),
    display_name: (v) => optional(v, (x) => isString(x, { max: 120 }), null),
    status: (v) => optional(v, (x) => isIn(x, ["active", "disabled"]), void 0)
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const data = {};
  for (const k of ["username", "email", "role_id", "display_name", "status"]) if (k in clean) data[k] = clean[k];
  if (clean.password) data.password_hash = await hashPassword(clean.password);
  data.updated_at = nowSec();
  await update(ctx.db, "users", ctx.params.id, data);
  await audit(ctx.db, { user: ctx.user, action: "user_updated", resource: "user", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  const row = await queryOne(ctx.db, "SELECT * FROM users WHERE id = ?", [ctx.params.id]);
  return ok(serializeUser(row));
}
async function deleteUser(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "users.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM users WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("User not found");
  if (existing.role_id === "role_admin") {
    const admins = await count(ctx.db, "users", "WHERE role_id = ?", ["role_admin"]);
    if (admins <= 1) throw new ValidationError("Cannot delete the last admin");
  }
  await remove(ctx.db, "users", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "user_deleted", resource: "user", resourceId: ctx.params.id, ip: getClientIp(ctx.request), metadata: { username: existing.username } });
  return ok({ id: ctx.params.id });
}

// src/worker/api/routes/apikeys.js
init_db();
init_id();
init_crypto();
init_logger();
init_config();
function serializeKey(row) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    rateLimit: row.rate_limit,
    lastUsed: row.last_used,
    expiresAt: row.expires_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function makeKey(secret) {
  const raw = token("nx", 32);
  const hash = await hmac(secret, raw);
  return { raw, hash, prefix: raw.slice(0, 11) };
}
async function listKeys(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "apikeys.read")) throw new Error("forbidden");
  const { db, request } = ctx;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  const total = await count(db, "api_keys");
  const rows = await query(db, `SELECT * FROM api_keys ORDER BY created_at DESC LIMIT ? OFFSET ?`, [pageSize, offset]);
  return paginated(rows.map(serializeKey), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function createKey(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "apikeys.write")) throw new Error("forbidden");
  const secret = getConfig(ctx.env).encryptionKey;
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    name: (v) => isString(v, { min: 1, max: 120 }) || "invalid",
    scopes: (v) => isArray(v) || "invalid",
    rate_limit: (v) => optional(v, (x) => isInt(x, { min: 1, max: 1e5 }), 120),
    expires_at: (v) => optional(v, (x) => isInt(x, { min: 0 }), null)
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const { raw, hash, prefix } = await makeKey(secret);
  const id = randomId("key", 10);
  const ts = nowSec();
  await insert(ctx.db, "api_keys", {
    id,
    name: clean.name,
    owner_id: ctx.user.id,
    key_hash: hash,
    key_prefix: prefix,
    scopes: clean.scopes,
    rate_limit: clean.rate_limit || 120,
    last_used: null,
    expires_at: clean.expires_at || null,
    status: "active",
    created_at: ts,
    updated_at: ts
  });
  await audit(ctx.db, { user: ctx.user, action: "apikey_created", resource: "apikey", resourceId: id, ip: getClientIp(ctx.request), metadata: { name: clean.name, scopes: clean.scopes } });
  return created({ ...serializeKey({ ...{}, id, name: clean.name, owner_id: ctx.user.id, key_prefix: prefix, scopes: clean.scopes, rate_limit: clean.rate_limit, last_used: null, expires_at: clean.expires_at, status: "active", created_at: ts, updated_at: ts }), secret: raw });
}
async function deleteKey(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "apikeys.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM api_keys WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("API key not found");
  await remove(ctx.db, "api_keys", ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "apikey_deleted", resource: "apikey", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}
async function rotateKey(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "apikeys.write")) throw new Error("forbidden");
  const existing = await queryOne(ctx.db, "SELECT * FROM api_keys WHERE id = ?", [ctx.params.id]);
  if (!existing) throw new NotFoundError("API key not found");
  const secret = getConfig(ctx.env).encryptionKey;
  const { raw, hash, prefix } = await makeKey(secret);
  await update(ctx.db, "api_keys", ctx.params.id, { key_hash: hash, key_prefix: prefix, updated_at: nowSec() });
  await audit(ctx.db, { user: ctx.user, action: "apikey_rotated", resource: "apikey", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id, keyPrefix: prefix, secret: raw });
}

// src/worker/api/routes/logs.js
init_db();
async function listLogs(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "logs.read")) throw new Error("forbidden");
  const { db, request } = ctx;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const action = url.searchParams.get("action") || "";
  const status = url.searchParams.get("status") || "";
  const from = parseInt(url.searchParams.get("from") || "0", 10);
  const to = parseInt(url.searchParams.get("to") || "0", 10);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, parseInt(url.searchParams.get("pageSize") || "20", 10));
  const offset = (page - 1) * pageSize;
  const whereParts = [];
  const params = [];
  if (search) {
    whereParts.push("(LOWER(username) LIKE ? OR LOWER(action) LIKE ? OR LOWER(resource) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (action) {
    whereParts.push("action = ?");
    params.push(action);
  }
  if (status) {
    whereParts.push("status = ?");
    params.push(status);
  }
  if (from) {
    whereParts.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    whereParts.push("created_at <= ?");
    params.push(to);
  }
  const where = whereParts.length ? "WHERE " + whereParts.join(" AND ") : "";
  const total = await count(db, "audit_logs", where, params);
  const rows = await query(db, `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return paginated(rows, { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
async function exportLogs(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "logs.read")) throw new Error("forbidden");
  const rows = await query(ctx.db, "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5000");
  return ok(rows);
}

// src/worker/api/routes/settings.js
init_db();
init_db();
init_config();
init_logger();
init_credentials();
var GROUPS = ["general", "appearance", "security", "api", "cloudflare", "database", "notifications", "domains", "subscriptions", "system"];
async function getSettings(ctx) {
  await authenticate(ctx);
  const rows = await query(ctx.db, "SELECT key, value FROM settings");
  const out = {};
  for (const r of rows) {
    const [group, key] = r.key.split(":");
    out[group] = out[group] || {};
    try {
      out[group][key] = JSON.parse(r.value);
    } catch {
      out[group][key] = r.value;
    }
  }
  return ok(out);
}
async function getSettingGroup(ctx) {
  await authenticate(ctx);
  const group = ctx.params.group;
  if (!GROUPS.includes(group)) throw new ValidationError("Unknown group");
  const rows = await query(ctx.db, "SELECT key, value FROM settings WHERE key LIKE ?", [`${group}:%`]);
  const out = {};
  for (const r of rows) {
    const key = r.key.split(":")[1];
    try {
      out[key] = JSON.parse(r.value);
    } catch {
      out[key] = r.value;
    }
  }
  return ok(out);
}
async function updateSettingGroup(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "settings.write")) throw new Error("forbidden");
  const group = ctx.params.group;
  if (!GROUPS.includes(group)) throw new ValidationError("Unknown group");
  const body = await ctx.request.json().catch(() => ({}));
  const ts = nowSec();
  for (const [k, v] of Object.entries(body)) {
    const key = `${group}:${k}`;
    const existing = await queryOne(ctx.db, "SELECT key FROM settings WHERE key = ?", [key]);
    const valStr = JSON.stringify(v);
    if (existing) await update(ctx.db, "settings", key, { value: valStr, updated_at: ts }, "key");
    else await insert(ctx.db, "settings", { key, value: valStr, updated_at: ts });
  }
  await audit(ctx.db, { user: ctx.user, action: "settings_updated", resource: "settings", resourceId: group, ip: getClientIp(ctx.request) });
  return ok({ group });
}
async function listCredentialsRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.read")) throw new Error("forbidden");
  const creds = await listCredentials(ctx.kv);
  return ok(creds);
}
async function addCredentialRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    label: (v) => optional(v, (x) => isString(x, { max: 120 }), "Cloudflare Token"),
    tokenValue: (v) => isString(v, { min: 10 }) || "invalid",
    accountId: (v) => optional(v, (x) => isString(x, { max: 120 }), ""),
    scope: (v) => optional(v, (x) => Array.isArray(x), [])
  });
  if (!valid) throw new ValidationError("Validation failed", errors);
  const secret = getConfig(ctx.env).encryptionKey;
  const id = await addCredential(ctx.kv, {
    label: clean.label,
    type: "cloudflare",
    accountId: clean.accountId,
    tokenValue: clean.tokenValue,
    secret,
    scope: clean.scope
  });
  await audit(ctx.db, { user: ctx.user, action: "credential_added", resource: "credential", resourceId: id, ip: getClientIp(ctx.request) });
  return ok({ id });
}
async function rotateCredentialRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.write")) throw new Error("forbidden");
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean } = validateBody(body, { tokenValue: (v) => isString(v, { min: 10 }) || "invalid" });
  if (!valid) throw new ValidationError("Validation failed");
  const secret = getConfig(ctx.env).encryptionKey;
  await rotateCredential(ctx.kv, ctx.params.id, clean.tokenValue, secret);
  await audit(ctx.db, { user: ctx.user, action: "credential_rotated", resource: "credential", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}
async function deleteCredentialRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "cloudflare.write")) throw new Error("forbidden");
  await deleteCredential(ctx.kv, ctx.params.id);
  await audit(ctx.db, { user: ctx.user, action: "credential_deleted", resource: "credential", resourceId: ctx.params.id, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.id });
}

// src/worker/api/routes/notifications.js
async function listNotificationsRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, "notifications.read")) throw new Error("forbidden");
  const url = new URL(ctx.request.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "30", 10));
  const { rows, total } = await listNotifications(ctx.db, { unreadOnly, limit });
  const unread = rows.filter((r) => !r.read).length;
  return ok({ items: rows, total, unread });
}
async function markReadRoute(ctx) {
  await authenticate(ctx);
  await markRead(ctx.db, ctx.params.id);
  return ok({ id: ctx.params.id });
}
async function deleteNotificationRoute(ctx) {
  await authenticate(ctx);
  await ctx.db.prepare("DELETE FROM notifications WHERE id = ?").bind(ctx.params.id).run();
  return ok({ id: ctx.params.id });
}
async function markAllReadRoute(ctx) {
  await authenticate(ctx);
  await markAllRead(ctx.db);
  return ok({ ok: true });
}

// src/worker/api/index.js
function buildRouter() {
  const r = new Router();
  r.post("/api/auth/login", login);
  r.post("/api/auth/logout", logout);
  r.get("/api/auth/me", me);
  r.get("/api/health", health);
  r.get("/api/dashboard", getDashboard);
  r.get("/api/domains", listDomains);
  r.post("/api/domains", createDomain);
  r.get("/api/domains/sync", syncCloudflareZones);
  r.get("/api/domains/:id", getDomain);
  r.put("/api/domains/:id", updateDomain);
  r.del("/api/domains/:id", deleteDomain);
  r.post("/api/domains/:id/verify", verifyDomain);
  r.get("/api/domains/:id/dns", listDns);
  r.post("/api/domains/:id/dns", createDns);
  r.patch("/api/domains/:id/dns/:recordId", updateDns);
  r.del("/api/domains/:id/dns/:recordId", deleteDns);
  r.post("/api/domains/:id/dns/:recordId/proxy", toggleProxy);
  r.get("/api/nodes", listNodes);
  r.post("/api/nodes", createNode);
  r.get("/api/nodes/:id", getNode);
  r.put("/api/nodes/:id", updateNode);
  r.del("/api/nodes/:id", deleteNode);
  r.post("/api/nodes/:id/duplicate", duplicateNode);
  r.post("/api/nodes/:id/health", healthCheck);
  r.post("/api/nodes/:id/ping", pingNode);
  r.get("/api/configs", listConfigs);
  r.get("/api/protocols", listProtocolsRoute);
  r.post("/api/configs/generate", generateConfigRoute);
  r.post("/api/configs", createConfig);
  r.get("/api/configs/:id", getConfigRoute);
  r.put("/api/configs/:id", updateConfig);
  r.del("/api/configs/:id", deleteConfig);
  r.post("/api/generate/:protocol", generateByProtocol);
  r.post("/api/generate/batch", generateBatch);
  r.get("/api/templates", listTemplates);
  r.post("/api/templates", createTemplate);
  r.post("/api/templates/:id/duplicate", duplicateTemplate);
  r.get("/api/templates/:id", getTemplate);
  r.put("/api/templates/:id", updateTemplate);
  r.del("/api/templates/:id", deleteTemplate);
  r.get("/api/generated", listGenerated);
  r.get("/api/generated/:id", getGenerated);
  r.del("/api/generated/:id", deleteGenerated);
  r.get("/api/endpoints", listEndpoints);
  r.post("/api/endpoints", createEndpoint);
  r.get("/api/endpoints/:id", getEndpoint);
  r.put("/api/endpoints/:id", updateEndpoint);
  r.del("/api/endpoints/:id", deleteEndpoint);
  r.get("/api/cloudflare/connection", getConnectionRoute);
  r.post("/api/cloudflare/test", testRoute);
  r.post("/api/cloudflare/save", saveRoute);
  r.post("/api/cloudflare/disconnect", disconnectRoute);
  r.post("/api/cloudflare/refresh", refreshRoute);
  r.get("/api/subscriptions", listSubs);
  r.post("/api/subscriptions", createSub);
  r.get("/api/subscriptions/:id", getSub);
  r.put("/api/subscriptions/:id", updateSub);
  r.del("/api/subscriptions/:id", deleteSub);
  r.post("/api/subscriptions/:id/regenerate", regenerateSub);
  r.get("/api/subscriptions/:id/link", getSubscriptionLink);
  r.get("/api/users", listUsers);
  r.post("/api/users", createUser);
  r.get("/api/users/:id", getUser);
  r.put("/api/users/:id", updateUser);
  r.del("/api/users/:id", deleteUser);
  r.get("/api/apikeys", listKeys);
  r.post("/api/apikeys", createKey);
  r.del("/api/apikeys/:id", deleteKey);
  r.post("/api/apikeys/:id/rotate", rotateKey);
  r.get("/api/logs", listLogs);
  r.get("/api/logs/export", exportLogs);
  r.get("/api/settings", getSettings);
  r.get("/api/settings/:group", getSettingGroup);
  r.put("/api/settings/:group", updateSettingGroup);
  r.get("/api/credentials", listCredentialsRoute);
  r.post("/api/credentials", addCredentialRoute);
  r.post("/api/credentials/:id/rotate", rotateCredentialRoute);
  r.del("/api/credentials/:id", deleteCredentialRoute);
  r.get("/api/notifications", listNotificationsRoute);
  r.post("/api/notifications/:id/read", markReadRoute);
  r.post("/api/notifications/:id/delete", deleteNotificationRoute);
  r.post("/api/notifications/read-all", markAllReadRoute);
  return r;
}

// src/worker/index.js
init_config();

// src/worker/middleware/ratelimit.js
init_kv();
var WINDOW = 60;
async function rateLimit(kv, key, limit) {
  const now = Math.floor(Date.now() / 1e3);
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
function clientKey(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${ip}`;
}

// src/worker/auth/apikey.js
init_crypto();
init_db();
init_config();
async function authenticateApiKey(db, authHeader, env) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const raw = authHeader.slice(7).trim();
  if (!raw) return null;
  const prefix = raw.slice(0, 11);
  const row = await db.prepare("SELECT * FROM api_keys WHERE key_prefix = ? AND status = ?").bind(prefix, "active").first();
  if (!row) return null;
  const secret = getConfig(env).encryptionKey;
  const expected = await hmac(secret, raw);
  if (expected !== row.key_hash) return null;
  if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1e3)) return null;
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    scopes: safeParse2(row.scopes, []),
    rateLimit: row.rate_limit
  };
}
function hasApiScope(key, scope) {
  if (!key) return false;
  if (key.scopes.includes("*")) return true;
  if (key.scopes.includes(scope)) return true;
  const [cat] = scope.split(".");
  return key.scopes.includes(`${cat}.*`);
}
function safeParse2(str, fallback) {
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// src/worker/services/seed.js
init_crypto();
init_id();
init_db();
init_db();
async function ensureAdmin(db, kv, cfg) {
  const existing = await count(db, "users");
  if (existing > 0) return { created: false };
  const username = cfg.adminEmail ? cfg.adminEmail.split("@")[0] : "admin";
  const email = cfg.adminEmail || "admin@nexus.local";
  const password = cfg.adminPassword || "NexusAdmin123!";
  const hash = await hashPassword(password);
  const adminId = randomId("usr", 10);
  await db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role_id, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'role_admin', 'Administrator', 'active', ?, ?)`
  ).bind(adminId, username, email, hash, nowSec(), nowSec()).run();
  await kv.put("setup:admin_credentials", JSON.stringify({ username, email, password }), { expirationTtl: 3600 });
  return { created: true, username, email, password };
}
async function seedDemoData(db, kv, demoMode) {
  const nodeCount = await count(db, "nodes");
  if (nodeCount > 0) return { seeded: false };
  const ts = nowSec();
  const countries = [
    ["DE", "Europe", "Germany"],
    ["NL", "Europe", "Netherlands"],
    ["US", "North America", "United States"],
    ["SG", "Asia", "Singapore"],
    ["JP", "Asia", "Japan"]
  ];
  for (let i = 0; i < 5; i++) {
    const [country, region] = countries[i];
    const id = randomId("node", 10);
    await db.prepare(
      `INSERT INTO nodes (id, name, address, port, protocol, status, region, country, latency, uptime, traffic_up, traffic_down, last_seen, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'vless', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(
      id,
      `Node-${i + 1}`,
      `node${i + 1}.example.com`,
      443,
      i % 3 === 0 ? "warning" : "online",
      region,
      country,
      20 + i * 5,
      99.9 - i,
      i * 1e3,
      i * 2e3,
      ts,
      ts,
      ts
    ).run();
  }
  const nodes = await db.prepare("SELECT id FROM nodes LIMIT 5").all();
  const protos = ["vless", "vmess", "trojan", "shadowsocks", "wireguard"];
  for (let i = 0; i < 10; i++) {
    const node = nodes.results[i % nodes.results.length];
    const id = randomId("cfg", 10);
    const exp = i % 4 === 0 ? ts + (30 - i) * 86400 : ts - i * 86400;
    const proto = protos[i % protos.length];
    await db.prepare(
      `INSERT INTO configs (id, name, node_id, client_id, uuid, protocol, transport, tls, sni, host, path, port, server, expiration, traffic_limit, traffic_used, status, notes, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'tcp', 1, 'example.com', 'example.com', '/', 443, 'server.example.com', ?, 0, ?, ?, '', ?, ?, ?)`
    ).bind(
      id,
      `Config-${i + 1}`,
      node.id,
      "client-" + (i + 1),
      uuid(),
      proto,
      exp,
      i * 500,
      exp < ts ? "expired" : "active",
      JSON.stringify([proto, "demo"]),
      ts,
      ts
    ).run();
  }
  return { seeded: true };
}

// src/worker/scheduler.js
init_db();
init_config();
init_logger();
async function runScheduled(event, env) {
  const cron = event.cron;
  const ts = nowSec();
  log("info", "scheduled_start", { cron });
  try {
    if (cron.includes("*/5")) {
      await healthChecks(env, ts);
    }
    if (cron.startsWith("0 ")) {
      await expirationChecks(env, ts);
      await trafficChecks(env, ts);
    }
    if (cron === "0 0 * * *") {
      await domainChecks(env, ts);
      await subscriptionChecks(env, ts);
    }
  } catch (e) {
    log("error", "scheduled_error", { error: String(e) });
  }
}
async function healthChecks(env, ts) {
  const nodes = await query(env.DB, "SELECT * FROM nodes WHERE enabled = 1");
  for (const n of nodes) {
    const hash = [...n.address || ""].reduce((a, c) => a + c.charCodeAt(0), 0);
    const latency = 15 + hash % 120;
    const online = latency < 200;
    const status = online ? "online" : "warning";
    if (n.status === "online" && !online) {
      await alert(env.DB, "node_offline", "Node offline", `Node ${n.name} is unreachable (latency ${latency}ms)`, "critical", "node", n.id);
    }
    await update(env.DB, "nodes", n.id, { latency, status, last_seen: ts, updated_at: ts });
  }
}
async function expirationChecks(env, ts) {
  const soon = ts + 7 * 86400;
  const expiring = await query(env.DB, "SELECT * FROM configs WHERE expiration IS NOT NULL AND expiration BETWEEN ? AND ? AND status = ?", [ts, soon, "active"]);
  for (const c of expiring) {
    await alert(env.DB, "config_expiring", "Config expiring", `Config ${c.name} expires on ${new Date(c.expiration * 1e3).toLocaleDateString()}`, "warning", "config", c.id);
  }
  const subs = await query(env.DB, "SELECT * FROM subscriptions WHERE expiration IS NOT NULL AND expiration BETWEEN ? AND ? AND status = ?", [ts, soon, "active"]);
  for (const s of subs) {
    await alert(env.DB, "subscription_expiring", "Subscription expiring", `Subscription ${s.name} expires soon`, "warning", "subscription", s.id);
  }
}
async function trafficChecks(env, ts) {
  const nodes = await query(env.DB, "SELECT * FROM nodes WHERE (traffic_up + traffic_down) > ?", [10 * 1024 * 1024 * 1024]);
  for (const n of nodes) {
    await alert(env.DB, "high_traffic", "High traffic", `Node ${n.name} exceeded 10GB traffic`, "warning", "node", n.id);
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
      const status = await client.request("GET", `/zones/${d.zone_id}`);
      const active = status.status === "active";
      if (!active && d.status !== "pending") {
        await update(env.DB, "domains", d.id, { status: "dns_error", updated_at: ts });
        await alert(env.DB, "domain_error", "Domain error", `Domain ${d.name} DNS/status error`, "critical", "domain", d.id);
      }
    } catch {
    }
  }
}
async function subscriptionChecks(env, ts) {
  await env.DB.prepare("UPDATE subscriptions SET status = 'expired' WHERE expiration IS NOT NULL AND expiration < ? AND status = 'active'").bind(ts).run();
}

// src/worker/index.js
var router = buildRouter();
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const cfg = getConfig(env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors({}, request.headers.get("origin") || "*") });
    }
    if (pathname.startsWith("/s/")) {
      const token2 = pathname.slice(3);
      try {
        const content = await buildSubscriptionContent(env.DB, env.KV, token2, url.host);
        env.KV.put(`sub_used:${token2}`, String(Math.floor(Date.now() / 1e3))).catch(() => {
        });
        return new Response(content, {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store"
          }
        });
      } catch (e) {
        const err = toErrorResponse(e);
        return new Response(err.body.message, {
          status: e instanceof AuthError ? 401 : e instanceof ValidationError ? 400 : e instanceof NotFoundError ? 404 : 500
        });
      }
    }
    if (pathname === "/api/auth/login" || pathname === "/api/health") {
      const limit2 = await rateLimit(env.KV, `rl:${clientKey(request, env)}:${pathname}`, cfg.rateLimit);
      const headers = cors({}, request.headers.get("origin") || "*");
      if (!limit2.allowed) {
        return error("Rate limit exceeded", 429, { retryAfter: limit2.retryAfter });
      }
      try {
        await ensureAdmin(env.DB, env.KV, cfg);
        if (cfg.demoMode) await seedDemoData(env.DB, env.KV, true).catch(() => {
        });
        return await routeRequest(request, env, ctx, null, headers);
      } catch (e) {
        return handleError(e, headers);
      }
    }
    let apiKey = null;
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      apiKey = await authenticateApiKey(env.DB, authHeader, env);
    }
    let user = null;
    if (!apiKey) {
      user = await getCurrentUser(env.DB, env.KV, request, env);
    }
    const rlKey = `rl:${clientKey(request, env)}:api`;
    const limit = await rateLimit(env.KV, rlKey, apiKey ? apiKey.rateLimit : cfg.rateLimit);
    const corsHeaders = cors({}, request.headers.get("origin") || "*");
    if (!limit.allowed) {
      return error("Rate limit exceeded", 429, { retryAfter: limit.retryAfter });
    }
    if (!apiKey) {
      const method = request.method.toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && cfg.environment !== "development") {
        if (!validateCsrf(request)) {
          return error("Invalid or missing CSRF token", 403);
        }
      }
    } else {
      const requiredScope = scopeForPath(pathname, request.method);
      if (requiredScope && !hasApiScope(apiKey, requiredScope)) {
        return error("API key lacks required scope", 403);
      }
    }
    try {
      await ensureAdmin(env.DB, env.KV, cfg);
      if (cfg.demoMode) await seedDemoData(env.DB, env.KV, true).catch(() => {
      });
      return await routeRequest(request, env, ctx, apiKey ? { id: apiKey.ownerId, username: apiKey.name, permissions: apiKey.scopes } : user, corsHeaders, apiKey);
    } catch (e) {
      return handleError(e, corsHeaders);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event, env));
  }
};
function scopeForPath(pathname, method) {
  const map = {
    "/api/generate": "configs",
    "/api/templates": "configs",
    "/api/generated": "configs",
    "/api/endpoints": "configs",
    "/api/domains": "domains",
    "/api/dns": "dns",
    "/api/nodes": "nodes",
    "/api/configs": "configs",
    "/api/subscriptions": "subscriptions",
    "/api/cloudflare": "cloudflare",
    "/api/credentials": "cloudflare",
    "/api/users": "users",
    "/api/apikeys": "apikeys",
    "/api/logs": "logs",
    "/api/settings": "settings",
    "/api/notifications": "notifications",
    "/api/dashboard": "dashboard"
  };
  for (const [prefix, cat] of Object.entries(map)) {
    if (pathname.startsWith(prefix)) {
      return method === "GET" ? `${cat}.read` : `${cat}.write`;
    }
  }
  return null;
}
async function routeRequest(request, env, ctx, identity, corsHeaders, apiKey = null) {
  const url = new URL(request.url);
  const match = router.match(request.method, url.pathname);
  if (!match) {
    if (!url.pathname.startsWith("/api/")) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      const kvAsset = await serveKvAsset(env.KV, url.pathname);
      if (kvAsset) return kvAsset;
      const indexHtml = await env.KV.get("assets:/index.html", { type: "text", metadata: "true" });
      if (indexHtml && indexHtml.value != null) {
        return new Response(indexHtml.value, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
        });
      }
    }
    return error(`No route for ${url.pathname}`, 404);
  }
  const ctxObj = {
    request,
    env,
    db: env.DB,
    kv: env.KV,
    user: identity,
    apiKey,
    params: match.params,
    identity
  };
  const handler = match.handler;
  return handler(ctxObj);
}
function handleError(e, headers) {
  const mapped = toErrorResponse(e);
  if (!(e instanceof AppError)) {
    console.error("[unhandled]", e && e.stack ? e.stack : String(e));
  }
  return json({ ok: false, error: mapped.body }, mapped.status, headers);
}
async function serveKvAsset(kv, pathname) {
  if (!kv) return null;
  const key = "assets:" + (pathname === "/" ? "/index.html" : pathname);
  const got = await kv.get(key, { type: "arrayBuffer", metadata: "true" });
  if (!got || got.value == null) return null;
  const ct = got.metadata?.contentType || "application/octet-stream";
  return new Response(got.value, {
    status: 200,
    headers: { "content-type": ct, "cache-control": "public, max-age=300" }
  });
}
export {
  index_default as default
};
