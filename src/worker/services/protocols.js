// services/protocols.js — modular protocol registry.
// Adding a new protocol = add ONE entry here. No hard-coded protocol logic elsewhere.
//
// Each entry knows how to build its share URI + structured config, AND declares a
// declarative `schema` that the frontend uses to render a dynamic "smart form"
// (fields appear/hide based on transport & TLS selection). The same registry is
// used by the generator, the batch generator, the public subscription builder, and
// the frontend Protocols page.

const REGISTRY = {};

function register(name, def) {
  REGISTRY[name] = def;
}

export function listProtocols() {
  return Object.keys(REGISTRY).map((key) => ({
    id: key,
    label: REGISTRY[key].label,
    transports: REGISTRY[key].transports,
    defaultPort: REGISTRY[key].defaultPort,
    tlsRequired: REGISTRY[key].tlsRequired,
    tlsDefault: REGISTRY[key].tlsDefault,
    schema: REGISTRY[key].schema,
    description: REGISTRY[key].description || '',
  }));
}

export function getProtocol(id) {
  return REGISTRY[id] || null;
}

export function isSupported(id) {
  return Boolean(REGISTRY[id]);
}

// ───────────────── encoding helpers ─────────────────
function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64url(str) {
  return b64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function encodeVmess(obj) {
  return 'vmess://' + b64(JSON.stringify(obj));
}
function b64uAuth(user, pass) {
  // socks5/http userinfo: base64(user:pass)
  return b64(`${user || ''}:${pass || ''}`);
}

// Common schema fragments reused across protocols.
const TLS_SCHEMA = {
  key: 'tls', type: 'checkbox', group: 'security', label_en: 'TLS', label_fa: 'TLS', default: true,
};
const SNI_SCHEMA = {
  key: 'sni', type: 'text', group: 'security', label_en: 'SNI', label_fa: 'SNI',
  placeholder: 'example.com', showWhen: { tls: true },
};
const ALPN_SCHEMA = {
  key: 'alpn', type: 'select', group: 'security', label_en: 'ALPN', label_fa: 'ALPN', multiple: true,
  options: [
    { value: 'h2', label: 'h2' }, { value: 'http/1.1', label: 'http/1.1' }, { value: 'h3', label: 'h3' },
  ],
  showWhen: { tls: true },
};
const FP_SCHEMA = {
  key: 'fingerprint', type: 'select', group: 'security', label_en: 'Fingerprint', label_fa: 'Fingerprint',
  options: [
    { value: '', label: 'none' }, { value: 'chrome', label: 'chrome' }, { value: 'firefox', label: 'firefox' },
    { value: 'safari', label: 'safari' }, { value: 'ios', label: 'ios' }, { value: 'android', label: 'android' },
    { value: 'edge', label: 'edge' }, { value: 'random', label: 'random' },
  ],
  showWhen: { tls: true },
};
const SERVICE_NAME_SCHEMA = {
  key: 'serviceName', type: 'text', group: 'network', label_en: 'gRPC Service Name', label_fa: 'نام سرویس gRPC',
  required: true, placeholder: 'grpc-service', showWhen: { transport: ['grpc'] },
  note: 'VLESS + gRPC requires a valid Service Name.',
};
const WS_PATH_SCHEMA = {
  key: 'path', type: 'text', group: 'network', label_en: 'WS Path', label_fa: 'مسیر WS',
  placeholder: '/', showWhen: { transport: ['ws', 'h2'] },
};
const WS_HOST_SCHEMA = {
  key: 'host', type: 'text', group: 'network', label_en: 'WS Host / Authority', label_fa: 'میزبان',
  placeholder: 'example.com', showWhen: { transport: ['ws', 'grpc'] },
};

// ───────────────── VLESS ─────────────────
register('vless', {
  label: 'VLESS',
  transports: ['tcp', 'ws', 'grpc', 'quic', 'h2'],
  defaultPort: 443,
  tlsRequired: false,
  tlsDefault: true,
  description: 'Lightweight, modern protocol. Pair with TLS for production.',
  schema: {
    basic: [
      { key: 'uuid', type: 'text', group: 'basic', label_en: 'UUID', label_fa: 'UUID', required: true, placeholder: 'auto-generated', gen: 'uuid' },
      { key: 'name', type: 'text', group: 'basic', label_en: 'Name', label_fa: 'نام', placeholder: 'NEXUS-01' },
    ],
    security: [TLS_SCHEMA, SNI_SCHEMA, ALPN_SCHEMA, FP_SCHEMA],
    network: [
      { key: 'transport', type: 'transport', group: 'network', label_en: 'Transport', label_fa: 'انتقال', required: true },
      WS_PATH_SCHEMA, WS_HOST_SCHEMA, SERVICE_NAME_SCHEMA,
      { key: 'path', type: 'text', group: 'network', label_en: 'QUIC / Extra', label_fa: 'QUIC', placeholder: 'optional', showWhen: { transport: ['quic'] } },
    ],
    advanced: [
      { key: 'flow', type: 'select', group: 'advanced', label_en: 'Flow', label_fa: 'Flow', showWhen: { tls: true },
        options: [
          { value: '', label: 'none' }, { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
          { value: 'xtls-rprx-vision-udp443', label: 'xtls-rprx-vision-udp443' },
        ] },
      { key: 'fragment', type: 'text', group: 'advanced', label_en: 'Fragment', label_fa: 'Fragment', placeholder: 'e.g. 20-30' },
    ],
  },
  build({ server, port, uuid, sni, host, path, transport, tls, tag = 'Nexus', flow = '', fragment = '' }) {
    const sec = tls ? 'tls' : 'none';
    const params = new URLSearchParams();
    params.set('type', transport || 'tcp');
    if (tls) {
      params.set('security', 'tls');
      if (sni) params.set('sni', sni);
      if (host) params.set('host', host);
      if (flow) params.set('flow', flow);
    } else {
      params.set('security', 'none');
    }
    if (transport === 'ws') {
      if (path) params.set('path', path);
      if (host) params.set('host', host);
    } else if (transport === 'grpc') {
      if (path) params.set('serviceName', path);
    } else if (transport === 'quic') {
      if (path) params.set('quicSecurity', path);
    } else if (transport === 'h2') {
      if (path) params.set('path', path);
    }
    if (fragment) params.set('fragment', fragment);
    const uri = `vless://${uuid}@${server}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
    return { uri, transport: transport || 'tcp', security: sec, scheme: tls ? 'vless+tls' : 'vless' };
  },
});

// ───────────────── VMess ─────────────────
register('vmess', {
  label: 'VMess',
  transports: ['tcp', 'ws', 'grpc'],
  defaultPort: 443,
  tlsRequired: false,
  tlsDefault: true,
  description: 'Mature, widely-compatible protocol with obfuscation.',
  schema: {
    basic: [
      { key: 'uuid', type: 'text', group: 'basic', label_en: 'UUID', label_fa: 'UUID', required: true, placeholder: 'auto-generated', gen: 'uuid' },
      { key: 'name', type: 'text', group: 'basic', label_en: 'Name', label_fa: 'نام', placeholder: 'NEXUS-01' },
    ],
    security: [TLS_SCHEMA, SNI_SCHEMA],
    network: [
      { key: 'transport', type: 'transport', group: 'network', label_en: 'Transport', label_fa: 'انتقال', required: true },
      WS_PATH_SCHEMA, WS_HOST_SCHEMA, SERVICE_NAME_SCHEMA,
    ],
    advanced: [
      { key: 'scy', type: 'select', group: 'advanced', label_en: 'Security (scy)', label_fa: 'رمزنگاری',
        options: [{ value: 'auto', label: 'auto' }, { value: 'aes-128-gcm', label: 'aes-128-gcm' }, { value: 'chacha20-poly1305', label: 'chacha20-poly1305' }, { value: 'none', label: 'none' }] },
    ],
  },
  build({ server, port, uuid, sni, host, path, transport, tls, tag = 'Nexus', scy = 'auto' }) {
    const net = transport === 'ws' ? 'ws' : transport === 'grpc' ? 'grpc' : 'tcp';
    const obj = {
      v: '2', ps: tag, add: server, port: String(port), id: uuid, aid: '0', scy: scy || 'auto',
      net, type: 'none', sni: sni || host || '', host: host || '', path: path || '', tls: tls ? 'tls' : '',
    };
    return { uri: encodeVmess(obj), transport: net, security: tls ? 'tls' : 'none', scheme: tls ? 'vmess+tls' : 'vmess' };
  },
});

// ───────────────── Trojan ─────────────────
register('trojan', {
  label: 'Trojan',
  transports: ['tcp', 'ws'],
  defaultPort: 443,
  tlsRequired: true,
  tlsDefault: true,
  description: 'TLS-tunneled protocol disguised as HTTPS traffic.',
  schema: {
    basic: [
      { key: 'password', type: 'password', group: 'basic', label_en: 'Password', label_fa: 'رمز عبور', required: true, placeholder: 'min 6 chars', gen: 'token' },
      { key: 'name', type: 'text', group: 'basic', label_en: 'Name', label_fa: 'نام', placeholder: 'NEXUS-01' },
    ],
    security: [SNI_SCHEMA, ALPN_SCHEMA, FP_SCHEMA],
    network: [
      { key: 'transport', type: 'transport', group: 'network', label_en: 'Transport', label_fa: 'انتقال', required: true },
      WS_PATH_SCHEMA, WS_HOST_SCHEMA,
    ],
    advanced: [],
  },
  build({ server, port, password, sni, host, path, transport, tag = 'Nexus' }) {
    const params = new URLSearchParams();
    if (transport === 'ws') {
      params.set('type', 'ws');
      if (path) params.set('path', path);
      if (host) params.set('host', host);
    }
    if (sni) params.set('sni', sni);
    const query = params.toString();
    const uri = `trojan://${encodeURIComponent(password || '')}@${server}:${port}${query ? '?' + query : ''}#${encodeURIComponent(tag)}`;
    return { uri, transport: transport || 'tcp', security: 'tls', scheme: 'trojan+tls' };
  },
});

// ───────────────── Shadowsocks ─────────────────
register('shadowsocks', {
  label: 'Shadowsocks',
  transports: ['tcp'],
  defaultPort: 8388,
  tlsRequired: false,
  tlsDefault: false,
  description: 'Fast, lightweight SOCKS5-based proxy.',
  schema: {
    basic: [
      { key: 'password', type: 'password', group: 'basic', label_en: 'Password', label_fa: 'رمز عبور', required: true, placeholder: 'min 4 chars', gen: 'token' },
      { key: 'method', type: 'select', group: 'basic', label_en: 'Method', label_fa: 'متد', required: true,
        options: [
          { value: 'aes-256-gcm', label: 'aes-256-gcm' }, { value: 'aes-128-gcm', label: 'aes-128-gcm' },
          { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305' }, { value: 'xchacha20-ietf-poly1305', label: 'xchacha20-ietf-poly1305' },
          { value: 'aes-256-cfb', label: 'aes-256-cfb' }, { value: 'chacha20-ietf', label: 'chacha20-ietf' },
        ] },
      { key: 'name', type: 'text', group: 'basic', label_en: 'Name', label_fa: 'نام', placeholder: 'NEXUS-01' },
    ],
    security: [],
    network: [
      { key: 'transport', type: 'transport', group: 'network', label_en: 'Transport', label_fa: 'انتقال', required: true },
    ],
    advanced: [],
  },
  build({ server, port, password, method = 'aes-256-gcm', tag = 'Nexus' }) {
    const user = b64(`${method}:${password || ''}`);
    const uri = `ss://${user}@${server}:${port}#${encodeURIComponent(tag)}`;
    return { uri, transport: 'tcp', security: 'none', scheme: 'ss' };
  },
});

// ───────────────── SOCKS5 ─────────────────
register('socks5', {
  label: 'SOCKS5',
  transports: ['tcp'],
  defaultPort: 1080,
  tlsRequired: false,
  tlsDefault: false,
  description: 'Standard SOCKS5 proxy. TLS variant (socks5+tls) where supported.',
  schema: {
    basic: [
      { key: 'username', type: 'text', group: 'basic', label_en: 'Username', label_fa: 'نام کاربری', placeholder: 'optional' },
      { key: 'password', type: 'password', group: 'basic', label_en: 'Password', label_fa: 'رمز عبور', placeholder: 'optional' },
      { key: 'name', type: 'text', group: 'basic', label_en: 'Name', label_fa: 'نام', placeholder: 'NEXUS-01' },
    ],
    security: [
      { key: 'tls', type: 'checkbox', group: 'security', label_en: 'TLS (socks5+tls)', label_fa: 'TLS', default: false },
    ],
    network: [
      { key: 'transport', type: 'transport', group: 'network', label_en: 'Transport', label_fa: 'انتقال', required: true },
      { key: 'dns', type: 'text', group: 'network', label_en: 'DNS (for remote resolve)', label_fa: 'DNS', placeholder: 'e.g. 1.1.1.1' },
    ],
    advanced: [],
  },
  build({ server, port, username, password, tls, dns, tag = 'Nexus' }) {
    const scheme = tls ? 'socks5+tls' : 'socks5';
    const auth = username || password ? `${encodeURIComponent(username || '')}:${encodeURIComponent(password || '')}@` : '';
    const params = new URLSearchParams();
    if (dns) params.set('dns', dns);
    const query = params.toString();
    const uri = `${scheme}://${auth}${server}:${port}${query ? '?' + query : ''}#${encodeURIComponent(tag)}`;
    return { uri, transport: 'tcp', security: tls ? 'tls' : 'none', scheme };
  },
});

// ───────────────── HTTP ─────────────────
register('http', {
  label: 'HTTP',
  transports: ['tcp'],
  defaultPort: 8080,
  tlsRequired: false,
  tlsDefault: false,
  description: 'Plain HTTP proxy. Use HTTPS variant for encryption.',
  schema: {
    basic: [
      { key: 'username', type: 'text', group: 'basic', label_en: 'Username', label_fa: 'نام کاربری', placeholder: 'optional' },
      { key: 'password', type: 'password', group: 'basic', label_en: 'Password', label_fa: 'رمز عبور', placeholder: 'optional' },
      { key: 'name', type: 'text', group: 'basic', label_en: 'Name', label_fa: 'نام', placeholder: 'NEXUS-01' },
    ],
    security: [
      { key: 'tls', type: 'checkbox', group: 'security', label_en: 'TLS (HTTPS)', label_fa: 'TLS', default: false },
    ],
    network: [
      { key: 'transport', type: 'transport', group: 'network', label_en: 'Transport', label_fa: 'انتقال', required: true },
      { key: 'path', type: 'text', group: 'network', label_en: 'Path', label_fa: 'مسیر', placeholder: '/', showWhen: { tls: true } },
    ],
    advanced: [],
  },
  build({ server, port, username, password, tls, path, tag = 'Nexus' }) {
    const scheme = tls ? 'https' : 'http';
    const auth = username || password ? `${encodeURIComponent(username || '')}:${encodeURIComponent(password || '')}@` : '';
    const p = path && path !== '/' ? path : '';
    const uri = `${scheme}://${auth}${server}:${port}${p}#${encodeURIComponent(tag)}`;
    return { uri, transport: 'tcp', security: tls ? 'tls' : 'none', scheme };
  },
});

// ───────────────── HTTPS (alias handled as http with tls default true) ─────────────────
register('https', {
  label: 'HTTPS',
  transports: ['tcp'],
  defaultPort: 8443,
  tlsRequired: true,
  tlsDefault: true,
  description: 'TLS-encrypted HTTP proxy. Always encrypted.',
  schema: {
    basic: [
      { key: 'username', type: 'text', group: 'basic', label_en: 'Username', label_fa: 'نام کاربری', placeholder: 'optional' },
      { key: 'password', type: 'password', group: 'basic', label_en: 'Password', label_fa: 'رمز عبور', placeholder: 'optional' },
      { key: 'name', type: 'text', group: 'basic', label_en: 'Name', label_fa: 'نام', placeholder: 'NEXUS-01' },
    ],
    security: [],
    network: [
      { key: 'transport', type: 'transport', group: 'network', label_en: 'Transport', label_fa: 'انتقال', required: true },
      { key: 'path', type: 'text', group: 'network', label_en: 'Path', label_fa: 'مسیر', placeholder: '/', showWhen: { tls: true } },
    ],
    advanced: [],
  },
  build({ server, port, username, password, path, tag = 'Nexus' }) {
    const auth = username || password ? `${encodeURIComponent(username || '')}:${encodeURIComponent(password || '')}@` : '';
    const p = path && path !== '/' ? path : '';
    const uri = `https://${auth}${server}:${port}${p}#${encodeURIComponent(tag)}`;
    return { uri, transport: 'tcp', security: 'tls', scheme: 'https' };
  },
});

// ───────────────── WireGuard ─────────────────
register('wireguard', {
  label: 'WireGuard',
  transports: ['udp'],
  defaultPort: 51820,
  tlsRequired: false,
  tlsDefault: false,
  description: 'VPN tunnel protocol (key-based).',
  schema: {
    basic: [
      { key: 'privateKey', type: 'password', group: 'basic', label_en: 'Private Key', label_fa: 'کلید خصوصی', required: true, placeholder: 'base64 key', gen: 'token' },
      { key: 'publicKey', type: 'text', group: 'basic', label_en: 'Public Key', label_fa: 'کلید عمومی', required: true, placeholder: 'base64 key' },
      { key: 'address', type: 'text', group: 'basic', label_en: 'Address', label_fa: 'آدرس', placeholder: '10.0.0.2/24' },
      { key: 'name', type: 'text', group: 'basic', label_en: 'Name', label_fa: 'نام', placeholder: 'NEXUS-01' },
    ],
    security: [],
    network: [{ key: 'transport', type: 'transport', group: 'network', label_en: 'Transport', label_fa: 'انتقال', required: true }],
    advanced: [],
  },
  build({ server, port, privateKey, publicKey, address = '10.0.0.2/24', tag = 'Nexus' }) {
    const params = new URLSearchParams();
    params.set('publickey', publicKey || '');
    params.set('address', address);
    const uri = `wireguard://${privateKey || ''}@${server}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
    return { uri, transport: 'udp', security: 'none', scheme: 'wireguard' };
  },
});

export default REGISTRY;
