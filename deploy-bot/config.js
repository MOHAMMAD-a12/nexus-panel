// deploy-bot/config.js — bot runtime configuration derived from env bindings.
//
// SECURITY: BOT_TOKEN and BOT_ENCRYPTION_KEY are read as secrets from env (set via
// `wrangler secret put`). PROJECT_RAW_BASE is a non-secret [vars] value pointing at
// the GitHub raw tree the deploy-bot fetches the panel bundle + migrations from.

export function getBotConfig(env) {
  const allowedRaw = env.ALLOWED_TELEGRAM_USER_IDS || '';
  const allowedIds = allowedRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => String(s));

  return {
    botToken: env.BOT_TOKEN || '',
    botEncryptionKey: env.BOT_ENCRYPTION_KEY || '',
    projectRawBase: (env.PROJECT_RAW_BASE || '').replace(/\/+$/, ''), // no trailing slash
    allowedUserIds: allowedIds,
    // Subdomain prefix for each deployed panel worker.
    scriptPrefix: 'nexus-panel',
  };
}

export function isBotConfigured(cfg) {
  return Boolean(cfg.botToken && cfg.botEncryptionKey && cfg.projectRawBase);
}
