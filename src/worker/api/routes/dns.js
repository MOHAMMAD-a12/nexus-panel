// api/routes/dns.js — DNS records for a domain (proxied to Cloudflare)
import { ok, created, paginated } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { queryOne } from '../../database/db.js';
import { validateBody, isString, isIn, isInt, isBool, optional, toBool } from '../../utils/validate.js';
import { NotFoundError, ValidationError } from '../../utils/error.js';
import { audit } from '../../utils/logger.js';
import { getClientIp } from '../../auth/auth.js';
import { listDnsRecords, createDnsRecord, updateDnsRecord, deleteDnsRecord } from '../../cloudflare/dns.js';

const TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];

export async function listDns(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'dns.read')) throw new Error('forbidden');
  const domain = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!domain) throw new NotFoundError('Domain not found');
  const result = await listDnsRecords(ctx.env, ctx.kv, domain.zone_id, { per_page: 100 });
  const records = result.result || result.records || [];
  return ok(records.map(normalize));
}

export async function createDns(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'dns.write')) throw new Error('forbidden');
  const domain = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!domain) throw new NotFoundError('Domain not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    type: (v) => isIn(v, TYPES) || 'invalid',
    name: (v) => isString(v, { min: 1, max: 255 }) || 'invalid',
    content: (v) => isString(v, { min: 1, max: 1000 }) || 'invalid',
    ttl: (v) => optional(v, (x) => isInt(x, { min: 1 }), 1),
    proxied: (v) => optional(v, isBool, false),
  });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const rec = await createDnsRecord(ctx.env, ctx.kv, domain.zone_id, {
    type: clean.type,
    name: clean.name,
    content: clean.content,
    ttl: clean.ttl === 1 ? 1 : clean.ttl,
    proxied: toBool(clean.proxied),
  });
  await audit(ctx.db, { user: ctx.user, action: 'dns_created', resource: 'dns', resourceId: rec.id, ip: getClientIp(ctx.request), metadata: { type: clean.type, name: clean.name } });
  return created(normalize(rec));
}

export async function updateDns(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'dns.write')) throw new Error('forbidden');
  const domain = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!domain) throw new NotFoundError('Domain not found');
  const body = await ctx.request.json().catch(() => ({}));
  const { ok: valid, clean, errors } = validateBody(body, {
    type: (v) => optional(v, (x) => isIn(x, TYPES), undefined),
    name: (v) => optional(v, (x) => isString(x, { min: 1, max: 255 }), undefined),
    content: (v) => optional(v, (x) => isString(x, { min: 1, max: 1000 }), undefined),
    ttl: (v) => optional(v, (x) => isInt(x, { min: 1 }), undefined),
    proxied: (v) => optional(v, isBool, undefined),
  }, { allowUnknown: true });
  if (!valid) throw new ValidationError('Validation failed', errors);
  const data = {};
  for (const k of ['type', 'name', 'content', 'ttl']) if (k in clean) data[k] = clean[k];
  if ('proxied' in clean) data.proxied = toBool(clean.proxied);
  const rec = await updateDnsRecord(ctx.env, ctx.kv, domain.zone_id, ctx.params.recordId, data);
  await audit(ctx.db, { user: ctx.user, action: 'dns_updated', resource: 'dns', resourceId: ctx.params.recordId, ip: getClientIp(ctx.request) });
  return ok(normalize(rec));
}

export async function deleteDns(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'dns.write')) throw new Error('forbidden');
  const domain = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!domain) throw new NotFoundError('Domain not found');
  const res = await deleteDnsRecord(ctx.env, ctx.kv, domain.zone_id, ctx.params.recordId);
  await audit(ctx.db, { user: ctx.user, action: 'dns_deleted', resource: 'dns', resourceId: ctx.params.recordId, ip: getClientIp(ctx.request) });
  return ok({ id: ctx.params.recordId });
}

export async function toggleProxy(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'dns.write')) throw new Error('forbidden');
  const domain = await queryOne(ctx.db, 'SELECT * FROM domains WHERE id = ?', [ctx.params.id]);
  if (!domain) throw new NotFoundError('Domain not found');
  const body = await ctx.request.json().catch(() => ({}));
  const proxied = toBool(body.proxied);
  const rec = await updateDnsRecord(ctx.env, ctx.kv, domain.zone_id, ctx.params.recordId, { proxied });
  await audit(ctx.db, { user: ctx.user, action: 'dns_proxy_toggled', resource: 'dns', resourceId: ctx.params.recordId, ip: getClientIp(ctx.request), metadata: { proxied } });
  return ok(normalize(rec));
}

function normalize(r) {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    proxied: Boolean(r.proxied),
    created_on: r.created_on,
    modified_on: r.modified_on,
  };
}
