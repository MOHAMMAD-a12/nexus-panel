# Nexus Deploy Bot

A **standalone Cloudflare Worker** that deploys the Nexus Panel onto a user's *own*
Cloudflare account via Telegram. It lives in this `deploy-bot/` folder and has zero
dependency on the panel source (`src/worker/`).

## How it works

1. A user opens the bot in Telegram and sends `/start`.
2. The bot asks for their **Cloudflare API Token**, then their **Account ID**.
3. The token is encrypted at rest (AES-GCM) in the bot's `BOT_KV` between steps.
4. The bot uses the user's own token to provision, on **their** account:
   - a D1 database
   - a KV namespace
   - a Workers script (the prebuilt panel bundle)
   - the required secrets (incl. admin credentials + their CF token)
   - uploads the dashboard static files into their KV
   - runs the migrations
5. It resolves the `*.workers.dev` subdomain and replies with the live URL + admin login.
6. The user's token is **purged** from `BOT_KV` immediately after the deploy.

## Files

| File | Purpose |
|------|---------|
| `index.js` | Worker entry — Telegram webhook + `/health` + state machine |
| `deploy.js` | Orchestrates the end-to-end deploy (progress + token purge) |
| `cloudflare.js` | Raw CF REST calls (D1/KV/script/secrets/migrations/subdomain) with retry/backoff |
| `assets.js` | Fetches bundle + migrations from GitHub; uploads dashboard into user KV |
| `state.js` | Per-chat session + encrypted token storage |
| `config.js` / `telegram.js` / `messages.js` | Config, TG client, user-facing copy |
| `lib/crypto.js` / `lib/id.js` | Self-contained Web Crypto helpers (no panel dependency) |
| `wrangler.toml` | Bot worker config |

## Build the panel bundle first

The bot fetches `dist/nexus-panel.mjs` + `dist/assets-manifest.json` from the repo's
GitHub raw URL. Those are produced by the project's `npm run bundle` (see repo root
`build/deploy-bundle.mjs`) and must be committed into the repo.

```bash
# from the repository root
npm install
npm run bundle
git add -f dist/nexus-panel.mjs dist/assets-manifest.json
git commit -m "build: deploy artifacts"
```

## Operator setup

```bash
# 1) Create the bot's KV namespace, then paste its id into wrangler.toml (BOT_KV.id)
wrangler kv namespace create BOT_KV --config deploy-bot/wrangler.toml

# 2) Set secrets (never commit them)
wrangler secret put BOT_TOKEN --config deploy-bot/wrangler.toml            # from @BotFather
wrangler secret put BOT_ENCRYPTION_KEY --config deploy-bot/wrangler.toml   # any 32-char string

# 3) Point PROJECT_RAW_BASE at your repo's raw tree (edit deploy-bot/wrangler.toml [vars])
#    e.g. https://raw.githubusercontent.com/OWNER/REPO/main

# 4) Deploy / test
wrangler dev -c deploy-bot/wrangler.toml --port 8788     # local
wrangler deploy --config deploy-bot/wrangler.toml        # production

# 5) Register the Telegram webhook (once)
curl -F "url=https://<your-bot-subdomain>.workers.dev/" \
     https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
```

## Required user token scopes

The API Token the bot collects from each user needs:
- *Account → Workers Scripts → Edit*
- *Account → D1 → Edit*
- *Account → Workers KV Storage → Edit*
- A registered `*.workers.dev` subdomain on their account.

## Security notes

- The user's token is encrypted at rest and **never** returned to chat; only a masked
  preview (`abcd…wxyz`) is shown.
- Secrets are set via Cloudflare's dedicated secrets endpoint — never inline in the
  script upload.
- On success, cancel, or failure the token is deleted from `BOT_KV`.
- Failures are reported with a human-readable step name — never a raw 500.
