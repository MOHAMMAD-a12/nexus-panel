// deploy-bot/index.js — Telegram deploy bot Worker entry.
//
// POST /            → Telegram webhook (message updates).
// GET  /health      → liveness probe.
// POST /__assets    → internal: chained PHASE-2 worker that uploads dashboard files to the
//                     user's KV. Self-triggered by the bot while a namespace is still warming
//                     up, so each attempt gets a fresh waitUntil budget (a single invocation
//                     can't poll >30s for KV propagation). Auth: a shared INTERNAL_KEY header.
//
// Flow: /start → ask token → ask account id → deploy (progress msgs) → send URL + creds.
// User's CF token is encrypted at rest in BOT_KV between steps and purged on completion.

import { getBotConfig, isBotConfigured } from './config.js';
import { sendMessage } from './telegram.js';
import { MSG } from './messages.js';
import {
  loadSession,
  saveSession,
  clearSession,
  setTokenEncrypted,
  getTokenDecrypted,
  setAccountId,
  markDone,
  setAssetJob,
  clearToken,
  maskToken,
  STATES,
} from './state.js';
import { deployUserPanel, uploadAssetsStep } from './deploy.js';
import { fetchDashboardFiles } from './assets.js';
import { DeployError } from './cloudflare.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cfg = getBotConfig(env);

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, configured: isBotConfigured(cfg) });
    }

    // PHASE 2 self-chain endpoint.
    if (request.method === 'POST' && url.pathname === '/__assets') {
      return handleAssetsChain(request, env, cfg);
    }

    if (request.method !== 'POST' || url.pathname !== '/') {
      return new Response('Not found', { status: 404 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const message = update?.message;
    if (!message || !message.text) {
      return new Response('ok', { status: 200 }); // ignore non-text updates
    }

    const chatId = message.chat.id;
    const fromId = String(message.from?.id ?? '');
    const text = message.text.trim();

    // Authorized-users gate (optional).
    if (cfg.allowedUserIds.length && !cfg.allowedUserIds.includes(fromId)) {
      await sendMessage(cfg.botToken, chatId, MSG.notAuthorized).catch(() => {});
      return new Response('ok', { status: 200 });
    }

    if (!isBotConfigured(cfg)) {
      await sendMessage(cfg.botToken, chatId, MSG.bootError).catch(() => {});
      return new Response('ok', { status: 200 });
    }

    // Process asynchronously; Telegram expects a quick 200. Replies are sent via sendMessage.
    ctx.waitUntil(handleMessage({ cfg, env, chatId, fromId, text, selfUrl: request.url }));

    return new Response('ok', { status: 200 });
  },
};

async function handleMessage({ cfg, env, chatId, text, selfUrl }) {
  const kv = env.BOT_KV;
  const session = await loadSession(kv, chatId);
  const state = session.state || STATES.IDLE;

  // Global commands.
  if (text === '/cancel') {
    await resetToIdle(kv, chatId);
    await sendMessage(cfg.botToken, chatId, MSG.cancelled);
    return;
  }

  if (text === '/start' || text === '/help') {
    await resetToIdle(kv, chatId);
    const fresh = await loadSession(kv, chatId);
    fresh.state = STATES.AWAITING_TOKEN;
    await saveSession(kv, chatId, fresh);
    await sendMessage(cfg.botToken, chatId, MSG.start);
    return;
  }

  switch (state) {
    case STATES.AWAITING_TOKEN: {
      if (!looksLikeToken(text)) {
        await sendMessage(cfg.botToken, chatId, MSG.invalidToken);
        return;
      }
      await setTokenEncrypted(kv, chatId, text, cfg.botEncryptionKey);
      await sendMessage(cfg.botToken, chatId, MSG.awaitingAccount(maskToken(text)));
      return;
    }

    case STATES.AWAITING_ACCOUNT: {
      if (!looksLikeAccountId(text)) {
        await sendMessage(cfg.botToken, chatId, MSG.invalidAccount);
        return;
      }
      await setAccountId(kv, chatId, text);
      // Run the deploy. Token is decrypted transiently and purged on completion.
      await runDeploy({ cfg, env, kv, chatId, accountId: text, selfUrl });
      return;
    }

    case STATES.DEPLOYING:
    case STATES.DONE:
    default:
      // If a deploy already finished, prompt to start over; otherwise nudge.
      await sendMessage(
        cfg.botToken,
        chatId,
        state === STATES.DONE
          ? '✅ You already have a deploy. Send /start to deploy another, or /cancel to clear.'
          : 'Send /start to begin, or paste your Cloudflare API Token.'
      );
      return;
  }
}

async function runDeploy({ cfg, env, kv, chatId, accountId, selfUrl }) {
  let token = null;
  try {
    token = await getTokenDecrypted(kv, chatId, cfg.botEncryptionKey);
    if (!token) throw new DeployError('token', 'Stored token could not be decrypted.');

    const onProgress = async (label) => {
      await sendMessage(cfg.botToken, chatId, label).catch(() => {});
    };

    const result = await deployUserPanel({ token, accountId, cfg, onProgress });
    await markDone(kv, chatId, result);
    await sendMessage(
      cfg.botToken,
      chatId,
      MSG.done(result.url, result.adminEmail, result.adminPassword)
    );

    // PHASE 2: hand off dashboard-file upload. Keep the token (encrypted) in the session
    // and ask the worker to run the chained /__assets step. We do NOT await it — the user
    // already has their URL; assets land independently and we message on completion.
    await setAssetJob(kv, chatId, { kvId: result.assetJob.kvId, accountId });
    await sendMessage(cfg.botToken, chatId, MSG.assetsPending(result.url)).catch(() => {});
    triggerAssetsChain(selfUrl, cfg, chatId, 0);
  } catch (e) {
    // Log the real error to the Worker's observability so we can debug via `wrangler tail`.
    console.error('[deploy-bot] deploy failed:', e && e.stack ? e.stack : e);
    // Purge the token + session on any failure.
    await resetToIdle(kv, chatId);
    const step = e instanceof DeployError ? e.step : 'deploy';
    const message = e instanceof DeployError ? e.message : e.message || 'Unknown error';
    // Send the failure as plain text (parseMode=null): raw error strings often contain
    // `*`, `_`, or `{` which would break Telegram's Markdown entity parser.
    await sendMessage(
      cfg.botToken,
      chatId,
      `Deploy failed at: ${step}.\n${message}\n\nYour token has been discarded. Type /start to try again.`,
      null
    );
  } finally {
    token = null; // drop the decrypted token reference
  }
}

// Fire-and-forget: kick the same Worker again at /__assets so PHASE 2 runs in a *fresh*
// invocation with its own waitUntil budget. Auth via the internal key header.
function triggerAssetsChain(selfUrl, cfg, chatId, attempt) {
  const url = new URL(selfUrl);
  url.pathname = '/__assets';
  fetch(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': cfg.internalKey || '' },
    body: JSON.stringify({ chatId, attempt }),
  }).catch((err) => console.error('[deploy-bot] assets chain trigger failed:', err));
}

// PHASE 2 handler: runs in its own invocation. If the KV namespace is still warming up,
// `uploadAssetsStep` calls our onRetry -> schedule another /__assets invocation (attempt+1).
async function handleAssetsChain(request, env, cfg) {
  const internalKey = request.headers.get('x-internal-key');
  if (!cfg.internalKey || internalKey !== cfg.internalKey) {
    return new Response('unauthorized', { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const { chatId, attempt = 0 } = body;
  const kv = env.BOT_KV;
  const session = await loadSession(kv, chatId);
  if (!session || !session.tokenEnc || !session.assetKvId) {
    return new Response('no job', { status: 200 });
  }
  let token = null;
  try {
    token = await getTokenDecrypted(kv, chatId, cfg.botEncryptionKey);
    if (!token) throw new DeployError('token', 'Stored token could not be decrypted.');

    // We need the dashboard files payload again. Reusing the same fetch as PHASE 1 keeps
    // the bundle single-source. (Small, cached on Cloudflare's side.)
    const dashboardFiles = await fetchDashboardFiles(cfg.projectRawBase);

    let done = false;
    const written = await uploadAssetsStep(token, session.accountId, session.assetKvId, dashboardFiles, {
      attempt,
      onRetry: (next) => {
        // Chain a fresh invocation (new waitUntil budget). Signal done handling below.
        triggerAssetsChain(env, cfg, chatId, next);
      },
    });
    if (written > 0) {
      done = true;
      await clearToken(kv, chatId);
      await sendMessage(cfg.botToken, chatId, MSG.assetsDone).catch(() => {});
    }
    return Response.json({ ok: true, done, written });
  } catch (e) {
    console.error('[deploy-bot] assets chain failed:', e && e.stack ? e.stack : e);
    // Give up: purge the token, tell the user. They can re-/start to retry just assets? The
    // resources already exist; the only gap is static files. Report clearly.
    await clearToken(kv, chatId);
    const step = e instanceof DeployError ? e.step : 'assets';
    const message = e instanceof DeployError ? e.message : e.message || 'Unknown error';
    await sendMessage(
      cfg.botToken,
      chatId,
      `Dashboard file upload failed at: ${step}.\n${message}\n\nYour panel is deployed but its static files may be missing. Re-run /start, or check wrangler tail.`,
      null
    ).catch(() => {});
    return Response.json({ ok: false, error: message });
  } finally {
    token = null;
  }
}

function looksLikeToken(s) {
  // Cloudflare API tokens: typically 40+ chars, alphanumeric + a few symbols.
  return /^[A-Za-z0-9_\-]{30,}$/.test(s);
}

function looksLikeAccountId(s) {
  // Cloudflare Account IDs are 32-char hex strings.
  return /^[a-f0-9]{32}$/i.test(s);
}
