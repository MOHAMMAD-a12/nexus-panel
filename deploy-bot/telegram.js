// deploy-bot/telegram.js — minimal Telegram Bot API client.
//
// Only the calls the deploy-bot needs: sendMessage and setWebhook. All requests go
// to https://api.telegram.org/bot<TOKEN>/<method>. The bot token is supplied per call
// (from env.BOT_TOKEN) and is NEVER logged.

const TG_BASE = 'https://api.telegram.org/bot';

async function tgFetch(token, method, payload, isForm = false) {
  const url = `${TG_BASE}${token}/${method}`;
  const init = isForm
    ? { method: 'POST', body: payload }
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      };
  const res = await fetch(url, init);
  // We intentionally do not echo the token; on failure we only surface status + error.
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telegram ${method} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

// Send a chat message. `parseMode` 'Markdown' enables *bold* / `code` in messages.js.
export async function sendMessage(token, chatId, text, parseMode = 'Markdown') {
  return tgFetch(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });
}

// Register the webhook URL for this bot. Call once after deploy (or via curl).
export async function setWebhook(token, url) {
  return tgFetch(token, 'setWebhook', { url, allowed_updates: ['message'] });
}

// Acknowledge a callback query (used if we later add inline buttons). No-op safe.
export async function answerCallbackQuery(token, callbackQueryId, text = '') {
  return tgFetch(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}
