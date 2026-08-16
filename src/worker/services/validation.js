// services/validation.js — shared config validation with user-friendly messages.
// Used by every generation path (single + batch) so the same rules apply
// everywhere and clients get clear, actionable errors (never a raw 500).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_NAME_RE = /^[A-Za-z0-9_./-]{1,200}$/;

// Respect each protocol's sensible TLS default instead of forcing TLS on for
// plaintext protocols like http/socks5. wireguard is never TLS.
function defaultTlsFor(protocol) {
  switch (protocol) {
    case 'http':
    case 'socks5':
    case 'wireguard':
    case 'shadowsocks':
      return false;
    default:
      return true; // vless/vmess/trojan/https default to TLS
  }
}

export function isValidUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}

export function isValidPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// A hostname, IPv4, or IPv6 (loose) — not a full URL.
export function isValidHost(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  const s = v.trim();
  if (s.length > 253) return false;
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) {
    return s.split('.').every((p) => Number(p) >= 0 && Number(p) <= 255);
  }
  // IPv6 (loose bracket check)
  if (s.startsWith('[') && s.endsWith(']')) return true;
  // hostname
  return /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(s);
}

export function isValidServiceName(v) {
  return typeof v === 'string' && v.trim().length > 0 && SERVICE_NAME_RE.test(v.trim());
}

export function isValidPath(v) {
  if (v === undefined || v === null || v === '') return true; // empty allowed
  return typeof v === 'string' && v.startsWith('/') && v.length <= 1024;
}

export function isValidSni(v) {
  if (v === undefined || v === null || v === '') return true;
  return isValidHost(v);
}

export function isValidAlpn(v) {
  if (v === undefined || v === null || v === '') return true;
  if (typeof v === 'string') v = v.split(',').map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) return false;
  return v.every((a) => ['h2', 'http/1.1', 'h3'].includes(a));
}

export function isValidFingerprint(v) {
  const OK = ['', 'chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random'];
  return OK.includes(v);
}

export function isValidMethod(v, family) {
  const SS = ['aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305', 'aes-256-cfb', 'aes-128-cfb', 'chacha20', 'chacha20-ietf'];
  if (family === 'shadowsocks') return SS.includes(v);
  return typeof v === 'string' && v.length > 0;
}

// Validate a full config-generation input. Returns { ok, errors, clean }.
// `errors` is a map of field → human-readable message (en).
export function validateConfigInput(input) {
  const errors = {};
  const clean = {};

  const protocol = input.protocol;
  clean.protocol = protocol;

  const server = (input.server || input.domain || '').toString().trim();
  if (!server) {
    errors.server = 'Server address or domain is required.';
  } else if (!isValidHost(server)) {
    errors.server = 'Enter a valid hostname, IPv4, or IPv6 address.';
  } else {
    clean.server = server;
  }

  const port = input.port === '' || input.port === undefined || input.port === null ? null : Number(input.port);
  if (port === null) {
    clean.port = null; // caller fills default
  } else if (!isValidPort(port)) {
    errors.port = 'Port must be a number between 1 and 65535.';
  } else {
    clean.port = port;
  }

  clean.transport = input.transport || 'tcp';
  const tls = input.tls === undefined ? defaultTlsFor(protocol) : (input.tls === true || input.tls === 'true' || input.tls === 1 || input.tls === '1');
  clean.tls = tls;

  // TLS-dependent fields
  if (tls) {
    if (input.sni && !isValidSni(input.sni)) errors.sni = 'SNI must be a valid hostname.';
    else clean.sni = input.sni || null;
    if (input.alpn && !isValidAlpn(input.alpn)) errors.alpn = 'ALPN must be h2, http/1.1, or h3 (comma-separated allowed).';
    else clean.alpn = input.alpn || null;
    if (input.fingerprint && !isValidFingerprint(input.fingerprint)) errors.fingerprint = 'Fingerprint must be chrome, firefox, safari, ios, android, edge, random, or empty.';
    else clean.fingerprint = input.fingerprint || null;
  } else {
    clean.sni = null;
    clean.alpn = null;
    clean.fingerprint = null;
  }

  // Transport-dependent fields
  if (clean.transport === 'ws') {
    if (input.path && !isValidPath(input.path)) errors.path = 'WebSocket path must start with "/" (e.g. /ws).';
    else clean.path = input.path || '/';
    clean.host = input.host || null; // ws host header (optional)
  } else if (clean.transport === 'grpc') {
    if (!input.path || !isValidServiceName(input.path)) errors.path = 'gRPC requires a valid Service Name (e.g. "grpc-service").';
    else clean.path = input.path;
    clean.host = input.host || null; // authority (optional)
  } else if (clean.transport === 'h2') {
    if (input.path && !isValidPath(input.path)) errors.path = 'HTTP/2 path must start with "/" (e.g. /).';
    else clean.path = input.path || '/';
    clean.host = input.host || null;
  } else if (clean.transport === 'quic') {
    clean.path = input.path || null;
    clean.host = input.host || null;
  } else {
    clean.path = input.path || null;
    clean.host = input.host || null;
  }

  // Protocol-specific secret material
  switch (protocol) {
    case 'vless':
    case 'vmess':
      if (!input.uuid) errors.uuid = 'A UUID is required for ' + protocol.toUpperCase() + '.';
      else if (!isValidUuid(input.uuid)) errors.uuid = 'Invalid UUID format (e.g. 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d).';
      else clean.uuid = input.uuid.trim();
      if (input.flow && !['', 'xtls-rprx-vision', 'xtls-rprx-vision-udp443'].includes(input.flow)) {
        errors.flow = 'Flow must be empty, xtls-rprx-vision, or xtls-rprx-vision-udp443.';
      } else clean.flow = input.flow || '';
      if (input.fragment && !SERVICE_NAME_RE.test(input.fragment)) errors.fragment = 'Fragment value looks invalid.';
      else clean.fragment = input.fragment || '';
      break;
    case 'trojan':
      if (!input.password) errors.password = 'A password is required for Trojan.';
      else if (String(input.password).length < 6) errors.password = 'Trojan password must be at least 6 characters.';
      else clean.password = String(input.password);
      break;
    case 'shadowsocks':
      if (!input.password) errors.password = 'A password is required for Shadowsocks.';
      else if (String(input.password).length < 4) errors.password = 'Shadowsocks password must be at least 4 characters.';
      else clean.password = String(input.password);
      if (!isValidMethod(input.method, 'shadowsocks')) errors.method = 'Invalid Shadowsocks method.';
      else clean.method = input.method || 'aes-256-gcm';
      break;
    case 'socks5':
      clean.username = input.username || null;
      clean.password = input.password || null;
      break;
    case 'http':
    case 'https':
      clean.username = input.username || null;
      clean.password = input.password || null;
      clean.pathHttp = isValidPath(input.path) ? (input.path || '/') : '/';
      break;
    default:
      break;
  }

  // Name (optional)
  clean.name = (input.name && String(input.name).trim()) || null;

  // Numeric extras
  clean.expiration = input.expiration ? Number(input.expiration) : null;
  clean.trafficLimit = input.trafficLimit ? Number(input.trafficLimit) : 0;

  return { ok: Object.keys(errors).length === 0, errors, clean };
}
