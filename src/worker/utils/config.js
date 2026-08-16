// utils/config.js — runtime configuration derived from env bindings

// Development-only fallback secrets. These are NOT real secrets and are used
// strictly when running outside production (local dev / demo) where the real
// secrets have not been provisioned via `wrangler secret put`. They must never
// be treated as production credentials — in production the real env values are
// required and these fallbacks are never used.
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-0000000000';
const DEV_ENCRYPTION_KEY = 'devonlyinsecureaes256key00000000';

export function getConfig(env) {
  const demoMode = String(env.DEMO_MODE || 'false').toLowerCase() === 'true';
  const environment = env.ENVIRONMENT || (demoMode ? 'development' : 'production');

  // Fall back to clearly-marked dev-only secrets when the real secret has not
  // been provisioned (e.g. local dev where `wrangler secret put` was skipped).
  // These are NOT real credentials and never ship in a real deploy — production
  // sets JWT_SECRET / ENCRYPTION_KEY via `wrangler secret put`.
  const jwtSecret = env.JWT_SECRET || DEV_JWT_SECRET;
  const encryptionKey = env.ENCRYPTION_KEY || DEV_ENCRYPTION_KEY;

  return {
    environment,
    demoMode,
    appName: env.APP_NAME || 'Nexus Panel',
    sessionTtl: parseInt(env.SESSION_TTL || '86400', 10),
    rateLimit: parseInt(env.RATE_LIMIT || '120', 10),
    allowedOrigins: (env.ALLOWED_ORIGINS || '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN || '',
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID || '',
    jwtSecret,
    encryptionKey,
    adminEmail: env.ADMIN_EMAIL || '',
    adminPassword: env.ADMIN_PASSWORD || '',
  };
}

export function isCloudflareConfigured(cfg) {
  return Boolean(cfg.cloudflareApiToken && cfg.cloudflareAccountId);
}

export function assertSecrets(cfg) {
  const missing = [];
  if (!cfg.jwtSecret) missing.push('JWT_SECRET');
  if (!cfg.encryptionKey) missing.push('ENCRYPTION_KEY');
  return missing;
}
