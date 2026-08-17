// deploy-bot/lib/crypto.js — local copy of the panel's crypto helpers.
//
// Self-contained so the deploy-bot has no dependency on src/worker/. Only the two
// helpers the bot needs (bytesToHex + AES-GCM encrypt/decrypt) are kept. Web Crypto only.

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

export { b64url, b64urlDecode };
