// deploy-bot/index.js — Telegram deploy bot Worker entry.
//
// POST /            → Telegram webhook (message updates).
// GET  /health      → liveness probe.
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
  resetToIdle,
  maskToken,
  STATES,
} from './state.js';
import { deployUserPanel } from './deploy.js';
import { DeployError } from './cloudflare.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cfg = getBotConfig(env);

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, configured: isBotConfigured(cfg) });
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
    ctx.waitUntil(handleMessage({ cfg, env, chatId, fromId, text }));

    return new Response('ok', { status: 200 });
  },
};

async function handleMessage({ cfg, env, chatId, text }) {
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
      await runDeploy({ cfg, env, kv, chatId, accountId: text });
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

async function runDeploy({ cfg, env, kv, chatId, accountId }) {
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
  } catch (e) {
    // Log the real error to the Worker's observability so we can debug via `wrangler tail`.
    console.error('[deploy-bot] deploy failed:', e && e.stack ? e.stack : e);
    // Purge the token + session on any failure.
    await resetToIdle(kv, chatId);
    const step = e instanceof DeployError ? e.step : 'deploy';
    let message = e instanceof DeployError ? e.message : e.message || 'Unknown error';
    // Send the failure as plain text (parseMode=null): raw error strings often contain
    // `*`, `_`, or `{` which would break Telegram's Markdown entity parser.
    await sendMessage(cfg.botToken, chatId, `Deploy failed at: ${step}.\n${message}\n\nYour token has been discarded. Type /start to try again.`, null);
  } finally {
    token = null; // drop the decrypted token reference
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
