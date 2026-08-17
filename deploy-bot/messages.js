// deploy-bot/messages.js — all user-facing strings, centralized and Markdown-formatted.
//
// Telegram Markdown: *bold*, `code`. We avoid characters that break Markdown parsing
// (parentheses in URLs are fine; we keep links plain). Keep every user-visible copy here
// so the bot's UX is consistent and easy to localize later.

export const MSG = {
  start: `🤖 *Nexus Panel — Auto Deploy Bot*

I'll deploy a fresh **Nexus Panel** onto *your own* Cloudflare account — no server needed.

You'll need two things from Cloudflare:
1. A **API Token** (create at dash.cloudflare.com → My Profile → API Tokens) with permissions:
   • *Account → Workers Scripts → Edit*
   • *Account → D1 → Edit*
   • *Account → Workers KV Storage → Edit*
2. Your **Account ID** (dash.cloudflare.com → right sidebar).

Send me your API Token now. It is encrypted and never shown back to you.
Type /cancel anytime to abort.`,

  awaitingAccount: (preview) =>
    `🔑 Received your token (\`${preview}\`).\n\nNow send your **Account ID**.`,

  invalidToken: `❌ That doesn't look like a Cloudflare API token. Send the token string (it usually starts with a letter/number and is ~40 chars).`,

  invalidAccount: `❌ That doesn't look like an Account ID (expected ~32 hex chars). Send the Account ID.`,

  cancelled: `✅ Cancelled. Your token has been discarded. Send /start to begin again.`,

  notAuthorized: `🚫 This bot is restricted to specific users.`,

  progress: {
    start: '🚀 Starting deploy…',
    d1: '🗄️ Creating D1 database…',
    d1Done: '✅ D1 database ready',
    kv: '📦 Creating KV namespace…',
    kvDone: '✅ KV namespace ready',
    upload: '⬆️ Uploading Nexus Panel worker…',
    uploadDone: '✅ Worker uploaded',
    secrets: '🔐 Setting secrets…',
    secretsDone: '✅ Secrets set',
    assets: '📁 Uploading dashboard files…',
    assetsDone: '✅ Dashboard files ready',
    migrate: '🗃️ Running database migrations…',
    migrateDone: '✅ Schema ready',
    subdomain: '🌐 Resolving your workers.dev URL…',
  },

  // step = one of the progress keys; message = human-readable cause.
  failed: (step, message) =>
    `❌ Deploy failed at: *${step}*.\n${message}\n\nYour token has been discarded. Type /start to try again.`,

  done: (url, email, password) =>
    `🎉 *Your Nexus Panel is live!*

🔗 ${url}
👤 Admin email: \`${email}\`
🔒 Password: \`${password}\`

_This password is shown only once — save it now._
Log in, then change it under Settings. Your panel is pre-connected to your Cloudflare account.`,

  noSubdomain: `⚠️ Your Cloudflare account has no \`*.workers.dev\` subdomain yet. Enable one at Workers → Your subdomain in the dashboard, then send /start again.`,

  bootError: `⚠️ The bot is not fully configured (missing BOT_TOKEN / BOT_ENCRYPTION_KEY / PROJECT_RAW_BASE). Contact the operator.`,
};
