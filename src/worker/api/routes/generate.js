// api/routes/generate.js — configuration generation (the core of NEXUS PANEL)
import { ok, created } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { randomId, uuid, token } from '../../utils/id.js';
import { nowSec } from '../../database/db.js';
import { insert, query, queryOne, remove, update, count } from '../../database/db.js';
import { generateConfig } from '../../services/configGenerator.js';
import { listProtocols } from '../../services/protocols.js';
import { ValidationError, NotFoundError } from '../../utils/error.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';

const GEN_PERMS = ['configs.write', 'configs.read'];

async function requireGenPerm(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'configs.write') && !hasPermission(ctx.user, 'configs.read')) {
    throw new Error('forbidden');
  }
}

function parseInput(body, protocol) {
  // Merge protocol-specific fields into a single input object.
  return {
    protocol,
    server: body.server || body.domain || null,
    domain: body.domain || null,
    port: body.port ?? null,
    transport: body.transport || 'tcp',
    tls: body.tls === undefined ? undefined : body.tls,
    sni: body.sni || null,
    host: body.host || null,
    path: body.path || null,
    alpn: body.alpn || null,
    fingerprint: body.fingerprint || null,
    flow: body.flow || null,
    fragment: body.fragment || null,
    uuid: body.uuid || null,
    password: body.password || null,
    method: body.method || null,
    username: body.username || null,
    dns: body.dns || null,
    privateKey: body.privateKey || null,
    publicKey: body.publicKey || null,
    address: body.address || null,
    name: body.name || null,
    expiration: body.expiration || null,
    trafficLimit: body.trafficLimit || 0,
  };
}

// POST /api/generate/:protocol
export async function generateByProtocol(ctx) {
  await requireGenPerm(ctx);
  const protocol = ctx.params.protocol;
  const body = await ctx.request.json().catch(() => ({}));
  try {
    const result = generateConfig(parseInput(body, protocol));
    // Optionally persist to generated_configs history when requested.
    if (body.save || body.persist) {
      return created(await persistGenerated(ctx, result, body));
    }
    return ok(result);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(`Generation failed: ${e.message}`, { field: 'protocol' });
  }
}

// POST /api/generate/batch
export async function generateBatch(ctx) {
  await requireGenPerm(ctx);
  const body = await ctx.request.json().catch(() => ({}));
  const {
    count = 1,
    protocol = 'vless',
    transport = 'tcp',
    endpointId,
    namingPattern = 'NEXUS',
    server,
    domain,
  } = body;

  const n = Math.max(1, Math.min(500, Number(count) || 1));
  const endpoints = endpointId
    ? await query(ctx.db, 'SELECT * FROM endpoints WHERE id = ?', [endpointId])
    : [];

  const out = [];
  const errors = [];
  for (let i = 1; i <= n; i++) {
    const idx = String(i).padStart(2, '0');
    const name = `${namingPattern}-${idx}`;
    const ep = endpoints.length ? endpoints[(i - 1) % endpoints.length] : null;
    const target = server || domain || (ep ? (ep.host || ep.domain) : null);
    if (!target) {
      errors.push({ index: i, error: 'No endpoint/server supplied.' });
      continue;
    }
    const input = parseInput(
      {
        ...body,
        protocol,
        transport: body.transport || ep?.transport || 'tcp',
        server: target,
        domain: null,
        name,
        uuid: body.uuid || uuid(),
        password: body.password || token('', 12),
        port: body.port || ep?.port || null,
        sni: body.sni || ep?.host || ep?.domain || null,
      },
      protocol
    );
    try {
      const result = generateConfig(input);
      out.push(result);
    } catch (e) {
      errors.push({ index: i, error: e.message });
    }
  }

  let saved = 0;
  if (body.save || body.persist) {
    for (const r of out) {
      await persistGenerated(ctx, r, {});
      saved++;
    }
  }

  const uris = out.map((r) => r.uri).join('\n');
  return ok({
    count: out.length,
    saved,
    configs: out.map((r) => ({ name: r.name, protocol: r.protocol, uri: r.uri })),
    uris,
    errors,
    // Only standard formats are emitted; no fabrication for unsupported shapes.
    formats: { uri: uris },
  });
}

// Persist a generated config into the generated_configs history table.
async function persistGenerated(ctx, result, body) {
  const id = randomId('gen', 12);
  const ts = nowSec();
  const row = {
    id,
    owner_id: ctx.user?.id || null,
    name: result.name || body.name || `${result.protocol.toUpperCase()}-${result.server}`,
    protocol: result.protocol,
    transport: result.transport,
    security: result.security,
    server: result.server,
    port: result.port,
    tls: result.tls ? 1 : 0,
    sni: result.sni || null,
    host: result.host || null,
    path: result.path || null,
    uuid: result.config?.uuid || body.uuid || null,
    endpoint_id: body.endpointId || null,
    template_id: body.templateId || null,
    uri: result.uri,
    json: result.json,
    expiration: result.expiration || null,
    traffic_limit: result.trafficLimit || 0,
    status: 'active',
    created_at: ts,
    updated_at: ts,
  };
  await insert(ctx.db, 'generated_configs', row);
  await audit(ctx.db, {
    user: ctx.user, action: 'config_generated', resource: 'generated_config', resourceId: id,
    ip: getClientIp(ctx.request), metadata: { protocol: result.protocol, name: row.name },
  });
  return { id, name: row.name, protocol: result.protocol, uri: result.uri, json: result.json };
}

// GET /api/protocols already exists in configs.js; re-expose here for grouping.
export async function listProtocolsRoute(ctx) {
  await requireGenPerm(ctx);
  return ok(listProtocols());
}
