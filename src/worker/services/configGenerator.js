// services/configGenerator.js — the deterministic generation pipeline.
//
//   Input → Validation → Protocol Adapter → Transport Adapter → Output Formatter → Final Config
//
// This module is the single source of truth for turning user input into a valid,
// shareable configuration. It NEVER fabricates output for a protocol it doesn't
// support, and it returns clear, human-readable validation errors instead of a
// raw 500.
import { getProtocol, isSupported } from './protocols.js';
import { validateConfigInput } from './validation.js';
import { uuid as genUuid, token as genToken } from '../utils/id.js';
import { ValidationError } from '../utils/error.js';

// Default config-object shape so every protocol yields a comparable JSON view.
function baseConfig(input, built, clean) {
  return {
    protocol: input.protocol,
    transport: built.transport,
    security: built.security,
    tls: clean.tls,
    server: clean.server,
    port: clean.port,
    sni: clean.sni || null,
    host: clean.host || null,
    path: clean.path || null,
    name: clean.name || `${input.protocol.toUpperCase()}-${clean.server}`,
    scheme: built.scheme || input.protocol,
  };
}

// Run the full pipeline for a single config. Throws ValidationError on bad input.
export function generateConfig(input) {
  const { ok, errors, clean } = validateConfigInput(input);
  if (!ok) {
    const first = Object.entries(errors)[0];
    const reason = first ? `${first[1]}` : 'Validation failed';
    const field = first ? first[0] : null;
    throw new ValidationError(`Generation failed: ${reason}`, { field, errors });
  }

  const protocol = input.protocol;
  if (!isSupported(protocol)) {
    throw new ValidationError(`Unsupported protocol: ${protocol}`, { field: 'protocol' });
  }

  const p = getProtocol(protocol);
  const effectivePort = clean.port || p.defaultPort;

  // Fill in secret material defaults (deterministic, never invalid).
  const ctx = {
    server: clean.server,
    port: effectivePort,
    transport: clean.transport,
    tls: clean.tls,
    sni: clean.sni,
    host: clean.host,
    path: clean.path,
    alpn: clean.alpn,
    fingerprint: clean.fingerprint,
    flow: clean.flow,
    fragment: clean.fragment,
    uuid: clean.uuid || genUuid(),
    // trojan/shadowsocks REQUIRE a password; socks5/http/https treat null as "open".
    password: (protocol === 'trojan' || protocol === 'shadowsocks') ? (clean.password || genToken('', 16)) : clean.password,
    method: clean.method,
    username: clean.username,
    dns: input.dns,
    privateKey: input.privateKey,
    publicKey: input.publicKey,
    address: input.address,
    tag: clean.name || `${protocol.toUpperCase()}-${clean.server}`,
  };

  const built = p.build(ctx);
  const config = baseConfig(input, built, { ...clean, port: effectivePort });
  // protocol-specific extras
  if (protocol === 'vless' || protocol === 'vmess') { config.uuid = ctx.uuid; config.flow = ctx.flow; }
  if (protocol === 'trojan' || protocol === 'shadowsocks') { config.password = ctx.password; }
  if (protocol === 'shadowsocks') config.method = ctx.method;
  if (protocol === 'socks5' || protocol === 'http' || protocol === 'https') {
    config.username = ctx.username || null;
  }

  const uri = built.uri;
  return {
    protocol,
    transport: built.transport,
    security: built.security,
    scheme: built.scheme || protocol,
    uri,
    json: JSON.stringify(config, null, 2),
    raw: uri, // Raw === the canonical share link for single-protocol configs
    server: config.server,
    port: effectivePort,
    tls: clean.tls,
    sni: clean.sni || null,
    host: clean.host || null,
    path: clean.path || null,
    expiration: clean.expiration || null,
    trafficLimit: clean.trafficLimit || 0,
    name: config.name,
    config,
  };
}

// Build a generic "Share" payload (used by the share view / subscriptions).
export function buildShareView(configRow, fullUri) {
  return {
    name: configRow.name,
    protocol: configRow.protocol,
    uri: fullUri,
    server: configRow.server,
    port: configRow.port,
    expire: configRow.expiration,
    note: 'Import this link into your client. Keep it private.',
  };
}

// Convert a generation result to a subscription-friendly line.
export function configToUri(result) {
  return result.uri;
}
