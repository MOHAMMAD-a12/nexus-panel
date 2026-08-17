// deploy-bot/lib/id.js — local copy of the panel's id/token helpers.
//
// Self-contained (Web Crypto only) so the deploy-bot does not depend on src/worker/.

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

export function cryptoRandomToken(len = 32) {
  return toBase62(randomBytes(len));
}
