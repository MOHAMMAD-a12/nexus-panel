-- Nexus Panel — D1 schema
-- Migration 0001: core tables

PRAGMA foreign_keys = ON;

-- ───────────────────────── Roles & Permissions ─────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',   -- JSON array of permission strings
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  display_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | disabled
  last_login    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ───────────────────────── Domains ─────────────────────────
CREATE TABLE IF NOT EXISTS domains (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  zone_id       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|verified|online|offline|dns_error|ssl_error
  dns_status    TEXT NOT NULL DEFAULT 'unknown',
  ssl_status    TEXT NOT NULL DEFAULT 'unknown',
  proxy_status  INTEGER NOT NULL DEFAULT 1,
  nameservers   TEXT NOT NULL DEFAULT '[]',      -- JSON array
  verified_at   INTEGER,
  last_check    INTEGER,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ───────────────────────── Nodes ─────────────────────────
CREATE TABLE IF NOT EXISTS nodes (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  address      TEXT NOT NULL,
  domain_id    TEXT REFERENCES domains(id) ON DELETE SET NULL,
  port         INTEGER NOT NULL,
  protocol     TEXT NOT NULL DEFAULT 'vless',
  status       TEXT NOT NULL DEFAULT 'offline',  -- online|warning|offline
  region       TEXT,
  country      TEXT,
  latency      INTEGER,
  uptime       REAL NOT NULL DEFAULT 0,
  traffic_up   INTEGER NOT NULL DEFAULT 0,
  traffic_down INTEGER NOT NULL DEFAULT 0,
  last_seen    INTEGER,
  enabled      INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_domain ON nodes(domain_id);

-- ───────────────────────── Configs ─────────────────────────
CREATE TABLE IF NOT EXISTS configs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  node_id       TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  domain_id     TEXT REFERENCES domains(id) ON DELETE SET NULL,
  client_id     TEXT,
  uuid          TEXT NOT NULL,
  protocol      TEXT NOT NULL,         -- vless|vmess|trojan|shadowsocks|wireguard|...
  transport    TEXT NOT NULL DEFAULT 'tcp', -- tcp|ws|grpc|quic|h2
  tls          INTEGER NOT NULL DEFAULT 1,
  sni           TEXT,
  host          TEXT,
  path          TEXT,
  port          INTEGER NOT NULL,
  server        TEXT,
  expiration    INTEGER,
  traffic_limit INTEGER NOT NULL DEFAULT 0, -- bytes, 0 = unlimited
  traffic_used  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active', -- active|disabled|expired
  notes         TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',      -- JSON array
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_configs_status ON configs(status);
CREATE INDEX IF NOT EXISTS idx_configs_protocol ON configs(protocol);
CREATE INDEX IF NOT EXISTS idx_configs_node ON configs(node_id);
CREATE INDEX IF NOT EXISTS idx_configs_expiration ON configs(expiration);

-- ───────────────────────── Subscriptions ─────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  owner           TEXT,
  token           TEXT NOT NULL UNIQUE,
  configs         TEXT NOT NULL DEFAULT '[]',   -- JSON array of config ids
  traffic_limit   INTEGER NOT NULL DEFAULT 0,
  traffic_used    INTEGER NOT NULL DEFAULT 0,
  device_limit    INTEGER NOT NULL DEFAULT 0,
  expiration      INTEGER,
  status          TEXT NOT NULL DEFAULT 'active', -- active|disabled|expired|revoked
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subs_token ON subscriptions(token);

-- ───────────────────────── API Keys ─────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  owner_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT '[]',
  rate_limit   INTEGER NOT NULL DEFAULT 120,
  last_used    INTEGER,
  expires_at   INTEGER,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apikeys_owner ON api_keys(owner_id);

-- ───────────────────────── Audit Logs ─────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  username   TEXT,
  action     TEXT NOT NULL,
  resource   TEXT,
  resource_id TEXT,
  ip         TEXT,
  status     TEXT NOT NULL DEFAULT 'success', -- success|failure
  metadata   TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ───────────────────────── Notifications ─────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,   -- node_offline|domain_error|ssl_error|config_expiring|subscription_expiring|api_error|high_traffic|worker_error
  severity   TEXT NOT NULL DEFAULT 'info', -- info|warning|critical
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  resource   TEXT,
  resource_id TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at);

-- ───────────────────────── Settings ─────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Seed default roles
INSERT OR IGNORE INTO roles (id, name, label, permissions, created_at, updated_at) VALUES
  ('role_admin', 'admin', 'Administrator', '["*"]', 0, 0),
  ('role_operator', 'operator', 'Operator',
   '["dashboard.read","domains.read","domains.write","dns.read","dns.write","nodes.read","nodes.write","configs.read","configs.write","subscriptions.read","subscriptions.write","logs.read","settings.read"]',
   0, 0),
  ('role_viewer', 'viewer', 'Viewer',
   '["dashboard.read","domains.read","dns.read","nodes.read","configs.read","subscriptions.read","logs.read","settings.read"]',
   0, 0);
