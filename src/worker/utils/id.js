// utils/id.js — id + token generation helpers (Web Crypto based, Worker-safe)

function toBase62(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let str = '';
  for (const b of buf) str += alphabet[b % 62];
  return str;
}

export function randomBytes(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

export function uuid() {
  // RFC4122 v4
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

export function randomId(prefix = 'id', len = 12) {
  return `${prefix}_${toBase62(randomBytes(len))}`;
}

export function token(prefix = 'tk', len = 32) {
  return `${prefix}_${toBase62(randomBytes(len))}`;
}

export function cryptoRandomToken(len = 32) {
  return toBase62(randomBytes(len));
}
