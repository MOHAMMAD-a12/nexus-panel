# NEXUS PANEL

A production-ready **configuration-generation platform** built on Cloudflare Workers.

NEXUS PANEL is a **real Configuration Generator** — its purpose is to **BUILD → VALIDATE → GENERATE → PREVIEW → QR → EXPORT** network configs for a modular set of protocols (VLESS, VMess, Trojan, Shadowsocks, SOCKS5, HTTP, HTTPS, WireGuard). Adding a protocol requires **no rewrite** of the engine: each protocol is a self-describing adapter (fields, transports, validation, builder) registered in a central registry.

> This is an original control plane focused on generation — not a clone of any reference panel. Every feature below is genuinely implemented: real Cloudflare Workers backend, real D1 database, real auth/RBAC, real validation, real Cloudflare API integration (never faked), and a fully dynamic dependency-free Vanilla JS frontend (no framework, no build step, no CDN). Every button either works against the backend or returns a clear, human-readable error — never a raw `500 Internal Server Error`.

---

## ✨ What it does (end-to-end pipeline)

| Stage | Reality |
|---|---|
| **BUILD** | Transport-aware smart form driven by each protocol's schema (`/api/protocols`). Fields appear/hide via `showWhen` (e.g. TLS fields only when TLS is on; WS path only for `ws`). |
| **VALIDATE** | Server-side validation (`validation.js`) returns per-field, human-readable messages (`{ error: { message, fields } }`) — never a raw 500. |
| **GENERATE** | Deterministic engine (`configGenerator.js`) produces canonical URI + JSON + Raw + Share output. Supports single and **batch** generation. |
| **PREVIEW** | Live preview on every keystroke (debounced), with a valid/invalid badge and field-level error hints. |
| **QR** | Client-side SVG QR code (no external library), generated in the browser from the share URI. |
| **EXPORT** | Copy, download `.txt` (URI/JSON/RAW/SHARE), or download the QR as SVG. Save to history (`/api/generated`). |

Plus: **protocol catalog**, **templates** (reusable presets), **endpoints** (location/server builder cards), **Cloudflare connection** (Test/Save/Disconnect/Refresh — token stored backend-only), and a **generation-focused dashboard** with analytics.

---

## 🧩 Modular protocol engine

Adding a protocol is data, not code surgery. Each adapter registered in `src/worker/services/protocols.js` declares:

```js
register('vless', {
  label: 'VLESS', transports: ['tcp','ws','grpc','h2','quic'],
  defaultPort: 443, tlsRequired: false, tlsDefault: true,
  description: '...',
  schema: { basic: [...], security: [...], network: [...], advanced: [...] },
  build(ctx) { return { uri, transport, security, scheme }; }
});
```

Schema field types: `text | password | number | select | checkbox | transport`. Fields support `required`, `options`, `showWhen` (conditional visibility), `default`, `gen` (`uuid`/`token`), `multiple`, `note`/`hint`. The frontend renders the exact same schema — so the UI stays in lockstep with the backend.

Supported protocols (all real): `vless`, `vmess`, `trojan`, `shadowsocks`, `socks5`, `http`, `https`, `wireguard`.

---

## 🔒 Security model (non-negotiable)

These guarantees are enforced in code, not just stated:

- **The Cloudflare API token is never present in HTML, client JS, `localStorage`, the URL, the console, or git history.** It is read **only** from `env.CLOUDFLARE_API_TOKEN` (secret) or from the AES-GCM-encrypted KV credential store. The connection endpoint returns only `tokenPreview: '••••'` — never the raw token.
- **No secret is ever stored as plaintext.** CF tokens are AES-GCM encrypted at rest; API-key secrets are HMAC-hashed before storage. Only prefixes/masks are returned to the client.
- **Sessions** use an `httpOnly`, `SameSite=Strict` cookie + a separate CSRF cookie validated on every state-changing request (CSRF disabled only in `development`).
- **RBAC** on every handler: `hasPermission(user, perm)` supports `*` and `category.*` wildcards. Writes require the matching `*.write` scope.
- **Web Crypto only** (PBKDF2-SHA256, AES-GCM, HMAC-SHA256, SHA-256); HS256 JWT.
- **Rate limiting** on login, health, and all API routes (per-client key in KV).
- **No fake functionality.** The panel does **not** simulate any protocol runtime on the Worker and does **not** claim to create a protocol-specific Worker. If an operation is not supported by the Cloudflare API, it is **not faked** — it returns a clear error or is simply not offered.
- **Readable errors only.** All errors are wrapped as `{ ok:false, error:{ message, fields } }`. A raw `500` is never leaked to the client.

---

## 🏗️ Architecture

```
   Browser (Vanilla JS, hash-router, no build step)
        │  HTTPS
        ▼
   Cloudflare Worker (single ES module)
     fetch(request, env, ctx)
       • CORS preflight
       • /s/:token  (public subscription, optional)
       • /api/auth/login · /health
       • API-key (Bearer) auth
       • Session (cookie) auth
       • rate limit · CSRF · scope mapping
       • router → handlers
       • ASSETS.fetch (static assets)
            │
            ├── D1  (SQLite)         KV (settings, cache, credentials)
            │                         (CF token encrypted here)
            ▼
       Cloudflare API (zones, DNS) — only when REAL credentials are configured
```

**Tech stack**
- **Backend:** Cloudflare Workers (ES modules), D1 (SQLite), KV, Secrets, Cron triggers. Zero npm runtime deps in the Worker bundle.
- **Frontend:** HTML5 + CSS3 + **Vanilla JS / ES Modules only** (no React/Vue/Angular/TypeScript). RTL+LTR, Persian+English, responsive/mobile-first, dark/light, controlled glassmorphism, collapsible sidebar, Command Palette, toasts, modals, sortable/filterable/searchable tables, SVG charts, loading skeletons, empty/error states.

---

## 📦 Project layout

```
nexus-panel/
├── wrangler.toml            # Worker + bindings + vars + secrets + assets
├── package.json
├── migrations/
│   ├── 0001_init.sql        # D1 schema (roles,users,domains,nodes,configs,
│   │                        #   subscriptions,api_keys,audit_logs,settings)
│   └── 0002_nexus.sql       # generation layer: templates, endpoints,
│                            #   generated_configs, cloudflare_connections,
│                            #   + role permissions for configs/cloudflare
├── src/worker/
│   ├── index.js             # Worker entry: fetch, scheduled, middleware chain
│   ├── api/
│   │   ├── index.js         # Router (buildRouter)
│   │   └── routes/          # auth, dashboard, domains, dns, nodes, configs,
│   │                        #   generate, templates, generated, endpoints,
│   │                        #   cloudflare, subscriptions, users, apikeys,
│   │                        #   logs, settings, notifications, health
│   ├── auth/                # session, apikey, RBAC, permissions, credentials
│   ├── services/            # protocols (registry), configGenerator,
│   │                        #   validation, cloudflareConnection, seed, …
│   ├── middleware/          # rate limit
│   ├── database/            # db (D1 helpers), kv
│   ├── utils/               # response, error, crypto, validate, logger, config
│   └── scheduler.js         # cron jobs
└── public/
    ├── index.html
    ├── css/styles.css
    └── js/
        ├── main.js          # bootstrap, login, app shell, router, nav
        ├── core/            # api, store, i18n, theme, router, icons, ui
        ├── components/      # table, charts, modal, toast, commandPalette, qrcode
        └── pages/           # generator, protocols, templates, endpoints,
                             #   generated, cloudflare, analytics, dashboard,
                             #   nodes, domains, configs, subscriptions,
                             #   users, apikeys, logs, settings
```

---

## 🛠️ Installation

### Prerequisites
- [Node.js](https://nodejs.org) ≥ 18
- A Cloudflare account with Workers, D1, and KV enabled
- `wrangler` (installed via the dev dependency)

```bash
git clone <your-repo> nexus-panel
cd nexus-panel
npm install
```

---

## 🔐 Environment variables & secrets

### Non-secret vars (`wrangler.toml` → `[vars]`)
Do **not** place secrets here.

| Var | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `production` | `production` / `development` (dev disables CSRF for local testing) |
| `DEMO_MODE` | `false` | When `true`, seeds demo data on first run. **All mocks OFF in production.** |
| `APP_NAME` | `Nexus Panel` | Display name |
| `SESSION_TTL` | `86400` | Session lifetime in seconds |
| `RATE_LIMIT` | `120` | Requests/min per client |
| `ALLOWED_ORIGINS` | `*` | CORS allow-list (set to your domain in prod) |

### Secrets — set with `wrangler secret put` (never committed)
```bash
wrangler secret put JWT_SECRET            # random 32+ byte string (session signing)
wrangler secret put ENCRYPTION_KEY       # random 32+ byte string (AES-GCM/HMAC)
wrangler secret put ADMIN_EMAIL           # first-run admin email
wrangler secret put ADMIN_PASSWORD        # first-run admin password (min 8)
wrangler secret put CLOUDFLARE_API_TOKEN # real CF token (prod) — server-side only
wrangler secret put CLOUDFLARE_ACCOUNT_ID# your CF account id
```

> **Cloudflare token safety:** In production set `CLOUDFLARE_API_TOKEN` as a secret (read only from `env`). In the UI you can also add/manage a token via **Cloudflare → Save** — it is encrypted in KV and resolved server-side only. The raw token never reaches the browser; the UI only sees `tokenPreview: '••••'`.

---

## ☁️ Cloudflare setup

### 1. D1 database
```bash
wrangler d1 create nexus-panel-db
# copy the returned database_id into wrangler.toml [[d1_databases]].database_id
wrangler d1 migrations apply nexus-panel-db --remote
# local dev:
wrangler d1 migrations apply nexus-panel-db --local
```
Both `0001_init.sql` and `0002_nexus.sql` are applied in order.

### 2. KV namespace
```bash
wrangler kv namespace create KV
# copy the returned id into wrangler.toml [[kv_namespaces]].id
```

### 3. Cron triggers
Defined in `wrangler.toml [triggers].crons`:
- `*/5 * * * *` — node health checks & ping
- `0 * * * *` — subscription expiry sweep
- `0 0 * * *` — daily notifications / digest

### 4. (Optional) Custom domain
Uncomment and edit the `routes` block in `wrangler.toml`.

---

## 💻 Local development

```bash
# 1. Set up local secrets (prompts interactively)
wrangler secret put JWT_SECRET
wrangler secret put ENCRYPTION_KEY
wrangler secret put ADMIN_EMAIL
wrangler secret put ADMIN_PASSWORD

# 2. Run with D1/KV/local assets
npm run dev
# → opens http://localhost:8787
```

On first request the worker auto-creates the admin user (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Login, then change the admin password in **Users**.

---

## 🚀 Deployment

```bash
# Validate the bundle (no upload)
npx wrangler deploy --dry-run

# Deploy
wrangler deploy
```

After deploy, open `https://<your-subdomain>.workers.dev`, log in with the admin credentials, and:
1. Go to **Cloudflare → Save** to add your API token (or rely on the `CLOUDFLARE_API_TOKEN` secret). The token stays server-side.
2. Optionally sync zones from **Domains → Sync Cloudflare**.
3. Open **Generator** to build your first config.

---

## 🔌 API documentation

Base URL: `https://<worker>/api`. All responses are `{ ok, data, meta? }` (success) or `{ ok:false, error:{ message, fields } }` (failure). Paginated endpoints return `{ ok:true, data: [...], meta:{ page, pageSize, total, pages } }`.

### Authentication
- **Session:** login returns an `httpOnly` session cookie + CSRF cookie. Include `x-csrf-token` header (read from `nexus_csrf` cookie) on all non-`GET` requests.
- **API key:** `Authorization: Bearer <key>` with a scope matching `category.read`/`category.write` for the path.

### Generation core (NEXUS)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/protocols` | session | Protocol registry/schema (drives the smart form) |
| POST | `/api/generate/:protocol` | session (`configs.read` or `configs.write`) | Generate config for a protocol; pass `save:true` to persist to history |
| POST | `/api/generate/batch` | session (`configs.write`) | Batch-generate N configs (optional `save`) |

**`POST /api/generate/:protocol` request body example**
```json
{
  "protocol": "vless",
  "server": "1.2.3.4",
  "port": 443,
  "transport": "ws",
  "tls": true,
  "sni": "example.com",
  "host": "example.com",
  "path": "/ws",
  "uuid": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "name": "My VLESS",
  "save": false
}
```
**Response** (success)
```json
{
  "ok": true,
  "data": {
    "protocol": "vless", "transport": "ws", "security": "tls", "scheme": "vless",
    "uri": "vless://9b1deb4d-...@1.2.3.4:443?type=ws&security=tls&sni=example.com&path=%2Fws#My%20VLESS",
    "json": "{ ... }", "raw": "vless://...",
    "server": "1.2.3.4", "port": 443, "tls": true, "sni": "example.com",
    "host": "example.com", "path": "/ws", "name": "My VLESS", "config": { }
  }
}
```
On validation failure the response is `400` with `{ ok:false, error:{ message, fields:{ server:"..." } } }` — never a raw 500.

### Templates / Endpoints / Generated history
| Method | Path | Auth | Description |
|---|---|---|---|
| GET/POST | `/api/templates` | configs.read / configs.write | List / create template |
| GET/PUT/DELETE | `/api/templates/:id` | configs.read / configs.write | Template detail/update/delete |
| POST | `/api/templates/:id/duplicate` | configs.write | Duplicate template |
| GET/POST | `/api/endpoints` | configs.read / configs.write | List / create endpoint (location) |
| GET/PUT/DELETE | `/api/endpoints/:id` | configs.read / configs.write | Endpoint detail/update/delete |
| GET/DELETE | `/api/generated` `/api/generated/:id` | configs.read / configs.write | Generated-config history |

### Cloudflare connection (token never returned)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/cloudflare/connection` | cloudflare.read | Status (returns `tokenPreview:'••••'`, never the token) |
| POST | `/api/cloudflare/test` | cloudflare.write | Test `{ accountId, tokenValue, zone?, domain? }` |
| POST | `/api/cloudflare/save` | cloudflare.write | Validate + encrypt token in KV |
| POST | `/api/cloudflare/disconnect` | cloudflare.write | Delete stored credentials |
| POST | `/api/cloudflare/refresh` | cloudflare.read | Re-read connection status |

### Auth / Dashboard / Management (existing)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | none (rate-limited) | Login; sets cookies |
| POST | `/api/auth/logout` | session | Clear session |
| GET | `/api/auth/me` | session | Current user + permissions |
| GET | `/api/health` | none | Health check |
| GET | `/api/dashboard` | session | Aggregated stats + generation series |
| GET/POST | `/api/domains` | session | List / create domain |
| GET/PUT/DELETE | `/api/domains/:id` | session | Domain detail/update/delete |
| POST | `/api/domains/:id/verify` | session | Run verification |
| POST | `/api/domains/sync` | session | Sync Cloudflare zones |
| GET/POST | `/api/domains/:id/dns` | session | List / create DNS record |
| PATCH/DELETE | `/api/domains/:id/dns/:rid` | session | Update / delete record |
| GET/POST | `/api/nodes` | session | List / create node |
| GET/PUT/DELETE | `/api/nodes/:id` | session | Node detail/update/delete |
| POST | `/api/nodes/:id/duplicate` | session | Duplicate node |
| POST | `/api/nodes/:id/health` | session | Health check |
| POST | `/api/nodes/:id/ping` | session | Ping / latency |
| GET/POST | `/api/configs` | session | List / create config |
| GET/PUT/DELETE | `/api/configs/:id` | session | Config detail/update/delete |
| GET/POST | `/api/subscriptions` | session | List / create subscription |
| GET/PUT/DELETE | `/api/subscriptions/:id` | session | Detail/update/delete |
| POST | `/api/subscriptions/:id/regenerate` | session | Rotate token |
| POST | `/api/subscriptions/:id/link` | session | Get public link |
| GET/POST | `/api/users` | users.* | List / create user |
| GET/PUT/DELETE | `/api/users/:id` | users.* | Detail/update/delete |
| GET/POST | `/api/apikeys` | apikeys.* | List / create key (secret shown once) |
| DELETE | `/api/apikeys/:id` | apikeys.write | Delete key |
| POST | `/api/apikeys/:id/rotate` | apikeys.write | Rotate key (secret shown once) |
| GET | `/api/logs` | logs.read | Audit log (search/filter/date) |
| GET | `/api/logs/export` | logs.read | CSV export (≤5000 rows) |
| GET | `/api/settings` | session | All settings |
| GET/PUT | `/api/settings/:group` | settings.* | Group get/update |
| GET/POST | `/api/credentials` | cloudflare.read / cloudflare.write | List (masked) / add credential |
| POST/DELETE | `/api/credentials/:id/rotate` `/:id` | cloudflare.write | Rotate / delete credential |
| GET | `/api/notifications` | session | List (limit/unread) |
| POST | `/api/notifications/:id/read` | session | Mark read |
| POST | `/api/notifications/read-all` | session | Mark all read |

### Public subscription endpoint
`GET /s/:token` → returns the client subscription file (no auth). Tokens are opaque and revocable.

---

## 🔒 Security notes

- **No token leakage:** `CLOUDFLARE_API_TOKEN` is read only from `env` (secret) or from the AES-GCM-encrypted KV credential store. The frontend only ever receives `tokenPreview:'••••'`.
- **Transport:** all traffic is HTTPS (Workers TLS).
- **Cookies:** session cookie is `HttpOnly`, `SameSite=Strict`, `Secure`; a separate `nexus_csrf` cookie is read by client JS and echoed as `x-csrf-token`. CSRF is enforced on every non-`GET` request (disabled only in `development`).
- **Encryption at rest:** API-key secrets are HMAC-hashed before storage; CF tokens are AES-GCM encrypted with `ENCRYPTION_KEY`. Only prefixes/masks are returned.
- **RBAC:** every handler checks `hasPermission(user, perm)`. API keys carry scopes checked against the requested path.
- **Input validation:** all bodies validated server-side; SQL is parameterized via D1 prepared statements (no string interpolation).
- **Rate limiting:** login, health, and all API routes are throttled per client key in KV.
- **Audit:** every mutating action writes to `audit_logs`.
- **CORS:** controlled by `ALLOWED_ORIGINS`; defaults to `*` only for convenience — set to your domain in production.
- **No fakes:** the panel does not simulate protocol runtimes or fabricate Cloudflare operations it cannot perform.
- **Secrets in repo:** none. All real secrets are supplied via `wrangler secret put` and exist only in Cloudflare's encrypted store.

---

## 🧪 Validation & audit checklist

Run before any deploy:
```bash
npx wrangler deploy --dry-run   # must succeed with the bundle size printed
```

Manual security checklist:
- [x] Session cookie HttpOnly + SameSite=Strict; CSRF on all writes
- [x] Cloudflare API token never reaches the client; masked in UI (`tokenPreview`)
- [x] RBAC enforced server-side on every route
- [x] Parameterized SQL (no injection)
- [x] Rate limiting on auth + API
- [x] Input validation on all bodies (readable errors, never raw 500)
- [x] Secrets via `wrangler secret put` only
- [x] Audit log on all mutations
- [x] No real secrets committed to the repository
- [x] No fake protocol runtime / no fabricated Cloudflare operations

---

## 🤖 Telegram Deploy Bot (self-serve install on a user's own Cloudflare)

NEXUS PANEL ships with a **separate Cloudflare Worker** (`nexus-deploy-bot`) that lets anyone deploy
their own fully-working panel onto **their own** Cloudflare account by chatting with a Telegram bot.
The user pastes their Cloudflare **API Token** + **Account ID**, and the bot provisions D1, KV, the
Worker script, secrets, dashboard assets, and migrations — then returns a live `*.workers.dev` URL
with a generated admin login.

> The bot uses the **Cloudflare REST API directly** (no `wrangler` CLI — it can't run on a Worker).
> The panel is pre-built into a single ESM bundle (`dist/nexus-panel.mjs`) by `npm run bundle` and
> fetched from the project's GitHub raw URL at deploy time. User tokens are **encrypted at rest** in
> the bot's KV and **deleted** after the deploy finishes.

### How a user deploys via the bot
1. Start the bot: `/start`
2. Paste their Cloudflare **API Token** (needs *Account → Workers Scripts → Edit*, *Account → D1 → Edit*, *Account → Workers KV Storage → Edit*).
3. Paste their **Account ID**.
4. Watch progress messages; receive the live URL + a one-time admin email/password.

### Operator setup (you, the bot owner)
```bash
# 1) Build the bundle the bot fetches from GitHub (also done automatically by CI on push)
npm install
npm run bundle

# 2) Create the bot's KV namespace, paste its id into deploy-bot/wrangler.toml
wrangler kv namespace create BOT_KV --config deploy-bot/wrangler.toml

# 3) Set the bot's secrets (from @BotFather + a 32-char encryption key)
wrangler secret put BOT_TOKEN --config deploy-bot/wrangler.toml
wrangler secret put BOT_ENCRYPTION_KEY --config deploy-bot/wrangler.toml

# 4) Point PROJECT_RAW_BASE at your repo's raw tree (edit deploy-bot/wrangler.toml [vars]):
#    PROJECT_RAW_BASE = "https://raw.githubusercontent.com/<owner>/<repo>/<branch>"

# 5) Deploy the bot worker
wrangler deploy --config deploy-bot/wrangler.toml

# 6) Register the Telegram webhook (replace with your bot worker URL)
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://nexus-deploy-bot.<sub>.workers.dev/"
```

### Files
| Path | Role |
|---|---|
| `deploy-bot/index.js` | Telegram webhook + `/health` + `/cancel` + state machine (self-contained folder) |
| `deploy-bot/deploy.js` | Orchestrates the end-to-end deploy (progress + token purge) |
| `deploy-bot/cloudflare.js` | Raw CF REST calls (D1/KV/script/secrets/migrations/subdomain) with retry/backoff |
| `deploy-bot/assets.js` | Fetches bundle + migrations from GitHub; uploads dashboard into user KV |
| `deploy-bot/state.js` | Per-chat session + encrypted token storage |
| `deploy-bot/{config,telegram,messages}.js` | Config, TG client, copy |
| `deploy-bot/lib/{crypto,id}.js` | Self-contained Web Crypto helpers (no dependency on the panel) |
| `deploy-bot/wrangler.toml` | Bot worker config |
| `build/deploy-bundle.mjs` | esbuild bundle + assets manifest generator |
| `dist/nexus-panel.mjs`, `dist/assets-manifest.json` | Prebuilt, tracked artifacts the bot fetches |

> The deployed panel has **no `ASSETS` binding** (fragile via raw API); instead it serves
> `public/` from its own KV via a backward-compatible fallback in `src/worker/index.js`
> (`serveKvAsset`). Normal `wrangler deploy` of the panel is unchanged.

---

## 📄 License

MIT — use freely, but ship it securely.
