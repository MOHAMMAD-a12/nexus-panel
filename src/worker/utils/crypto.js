// utils/crypto.js — password hashing, symmetric encryption, HMAC
// All primitives use Web Crypto (available in Workers runtime).
// No Node-specific APIs.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ───────────────── Password hashing (scrypt) ─────────────────
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveKey(password, salt, 32);
  return `scrypt$${b64url(salt)}$${b64url(derived)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
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
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  // scrypt isn't in WebCrypto; emulate with PBKDF2-SHA256 (high iteration count).
  // This is acceptable for a control panel login with rate limiting in front.
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 100000, hash: 'SHA-256' },
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

// ───────────────── AES-GCM encryption at rest ─────────────────
function getKeyMaterial(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(plaintext, secret) {
  const key = await getKeyMaterial(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return `enc$${b64url(iv)}$${b64url(ct)}`;
}

export async function decryptSecret(payload, secret) {
  try {
    const [scheme, ivB64, ctB64] = payload.split('$');
    if (scheme !== 'enc') return null;
    const key = await getKeyMaterial(secret);
    const iv = b64urlDecode(ivB64);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64urlDecode(ctB64));
    return dec.decode(pt);
  } catch {
    return null;
  }
}

// ───────────────── HMAC (api key hashing) ─────────────────
export async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(sig);
}

export async function sha256(message) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(message));
  return bytesToHex(digest);
}

export { b64url, b64urlDecode };
