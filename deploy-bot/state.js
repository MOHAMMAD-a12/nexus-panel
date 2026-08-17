// deploy-bot/state.js — per-chat deploy session state machine + encrypted token storage.
//
// SECURITY: the user's Cloudflare token is stored ONLY as encryptSecret(token, BOT_ENCRYPTION_KEY)
// in BOT_KV between chat steps. It is decrypted transiently inside deploy.js and deleted on
// success / cancel / failure. We never log the raw token; chat previews are masked.

import { encryptSecret, decryptSecret } from './lib/crypto.js';

const STATES = {
  IDLE: 'idle',
  AWAITING_TOKEN: 'awaiting_token',
  AWAITING_ACCOUNT: 'awaiting_account',
  DEPLOYING: 'deploying',
  DONE: 'done',
};

function keyFor(chatId) {
  return `deploy:${chatId}`;
}

export async function loadSession(kv, chatId) {
  if (!kv) return { state: STATES.IDLE };
  const raw = await kv.get(keyFor(chatId));
  if (!raw) return { state: STATES.IDLE };
  try {
    return JSON.parse(raw);
  } catch {
    return { state: STATES.IDLE };
  }
}

export async function saveSession(kv, chatId, session) {
  if (!kv) return;
  await kv.put(keyFor(chatId), JSON.stringify(session));
}

export async function clearSession(kv, chatId) {
  if (!kv) return;
  await kv.delete(keyFor(chatId));
}

// Store the token encrypted at rest. Never store the plaintext.
export async function setTokenEncrypted(kv, chatId, token, encryptionKey) {
  const tokenEnc = await encryptSecret(token, encryptionKey);
  const session = await loadSession(kv, chatId);
  session.state = STATES.AWAITING_ACCOUNT;
  session.tokenEnc = tokenEnc;
  await saveSession(kv, chatId, session);
  return session;
}

// Decrypt the token for the duration of the deploy. Caller must purge afterwards.
export async function getTokenDecrypted(kv, chatId, encryptionKey) {
  const session = await loadSession(kv, chatId);
  if (!session.tokenEnc) return null;
  return decryptSecret(session.tokenEnc, encryptionKey);
}

export async function setAccountId(kv, chatId, accountId) {
  const session = await loadSession(kv, chatId);
  session.accountId = accountId;
  session.state = STATES.DEPLOYING;
  await saveSession(kv, chatId, session);
  return session;
}

export async function markDone(kv, chatId, result) {
  const session = await loadSession(kv, chatId);
  session.state = STATES.DONE;
  session.result = result;
  // Token is removed from the session entirely — never persisted after deploy.
  delete session.tokenEnc;
  await saveSession(kv, chatId, session);
}

// PHASE 2 hand-off: keep the (encrypted) token in the session while the dashboard files are
// uploaded by chained invocations, but remember which KV namespace to write into.
export async function setAssetJob(kv, chatId, { kvId, accountId }) {
  const session = await loadSession(kv, chatId);
  session.state = 'assets';
  session.assetKvId = kvId;
  session.accountId = accountId;
  // tokenEnc is intentionally kept so chained /__assets invocations can decrypt it.
  await saveSession(kv, chatId, session);
}

// Purge only the token part of the session (called once assets succeed or give up).
export async function clearToken(kv, chatId) {
  const session = await loadSession(kv, chatId);
  delete session.tokenEnc;
  if (session.state === 'assets') session.state = STATES.DONE;
  await saveSession(kv, chatId, session);
}

export async function resetToIdle(kv, chatId) {
  await clearSession(kv, chatId);
}

export function maskToken(token) {
  if (!token || token.length < 8) return '••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export { STATES };
