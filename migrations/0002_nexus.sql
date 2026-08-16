-- Nexus Panel — D1 schema
-- Migration 0002: generation-focused tables (templates, endpoints, generated_configs, cloudflare_connections)
-- and cloudflare permissions for operator/viewer roles.

PRAGMA foreign_keys = ON;

-- ───────────────────────── Templates ─────────────────────────
-- Stores ONLY the parameters needed to regenerate a config. Secrets (UUID/password)
-- are regenerated at generation time and are never persisted as plaintext here.
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  protocol    TEXT NOT NULL,               -- vless|vmess|trojan|shadowsocks|socks5|http|https|wireguard
  transport   TEXT NOT NULL DEFAULT 'tcp', -- tcp|ws|grpc|quic|h2|udp
  tls         INTEGER NOT NULL DEFAULT 1,
  server      TEXT,
  domain      TEXT,
  port        INTEGER,
  sni         TEXT,
  host        TEXT,
  path        TEXT,
  alpn        TEXT,                          -- JSON array or string
  fingerprint TEXT,
  flow        TEXT,
  fragment    TEXT,
  method      TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  description TEXT NOT NULL DEFAULT '',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_protocol ON templates(protocol);
CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates(owner_id);

-- ───────────────────────── Endpoints (location builder) ─────────────────────────
-- User-managed locations used as the SERVER for generated configs. These are NOT
-- live servers; the panel never pretends to run a protocol runtime on them.
CREATE TABLE IF NOT EXISTS endpoints (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  host      TEXT,
  domain    TEXT,
  port      INTEGER,
  country   TEXT,                           -- ISO code (DE/FR/NL/TR/SG/US/...)
  city      TEXT,
  provider  TEXT,
  region    TEXT,
  tls       INTEGER NOT NULL DEFAULT 0,
  status    TEXT NOT NULL DEFAULT 'active', -- active|disabled|error
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_endpoints_country ON endpoints(country);
CREATE INDEX IF NOT EXISTS idx_endpoints_status ON endpoints(status);

-- ───────────────────────── Generated Configs (history) ─────────────────────────
CREATE TABLE IF NOT EXISTS generated_configs (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  protocol      TEXT NOT NULL,
  transport     TEXT NOT NULL DEFAULT 'tcp',
  security      TEXT NOT NULL DEFAULT 'none', -- none|tls
  server        TEXT,
  port          INTEGER,
  tls           INTEGER NOT NULL DEFAULT 0,
  sni           TEXT,
  host          TEXT,
  path          TEXT,
  uuid          TEXT,                          -- for vless/vmess (regenerated; not a stored secret)
  endpoint_id   TEXT REFERENCES endpoints(id) ON DELETE SET NULL,
  template_id   TEXT REFERENCES templates(id) ON DELETE SET NULL,
  uri           TEXT NOT NULL,
  json          TEXT NOT NULL,                 -- structured config (JSON string)
  expiration    INTEGER,
  traffic_limit INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generated_protocol ON generated_configs(protocol);
CREATE INDEX IF NOT EXISTS idx_generated_created ON generated_configs(created_at);
CREATE INDEX IF NOT EXISTS idx_generated_owner ON generated_configs(owner_id);

-- ───────────────────────── Cloudflare Connections ─────────────────────────
-- Metadata only. The API token is stored ENCRYPTED in KV (credential manager) and
-- is NEVER returned by any endpoint.
CREATE TABLE IF NOT EXISTS cloudflare_connections (
  id         TEXT PRIMARY KEY,
  account_id TEXT,
  zone       TEXT,
  domain     TEXT,
  status     TEXT NOT NULL DEFAULT 'disconnected', -- connected|disconnected|error
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ───────────────────────── Role permissions upgrade ─────────────────────────
-- Grant cloudflare scopes to operator (read+write) and viewer (read).
UPDATE roles SET permissions =
  '["dashboard.read","domains.read","domains.write","dns.read","dns.write","nodes.read","nodes.write","configs.read","configs.write","subscriptions.read","subscriptions.write","logs.read","settings.read","cloudflare.read","cloudflare.write"]'
  WHERE id = 'role_operator';
UPDATE roles SET permissions =
  '["dashboard.read","domains.read","dns.read","nodes.read","configs.read","subscriptions.read","logs.read","settings.read","cloudflare.read"]'
  WHERE id = 'role_viewer';
