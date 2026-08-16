// cloudflare/dns.js — DNS record operations via CF API (with demo fallback)
import { withFallback } from './cf.js';

export async function listDnsRecords(env, kv, zoneId, params = {}) {
  return withFallback(env, kv, (client) =>
    client.listDnsRecords ? client.listDnsRecords(zoneId, params) : client.request('GET', `/zones/${zoneId}/dns_records`, undefined, { params })
  );
}

export async function createDnsRecord(env, kv, zoneId, data) {
  return withFallback(env, kv, (client) =>
    client.createDnsRecord ? client.createDnsRecord(zoneId, data) : client.request('POST', `/zones/${zoneId}/dns_records`, data)
  );
}

export async function updateDnsRecord(env, kv, zoneId, recordId, data) {
  return withFallback(env, kv, (client) =>
    client.updateDnsRecord ? client.updateDnsRecord(zoneId, recordId, data) : client.request('PATCH', `/zones/${zoneId}/dns_records/${recordId}`, data)
  );
}

export async function deleteDnsRecord(env, kv, zoneId, recordId) {
  return withFallback(env, kv, (client) =>
    client.deleteDnsRecord ? client.deleteDnsRecord(zoneId, recordId) : client.request('DELETE', `/zones/${zoneId}/dns_records/${recordId}`)
  );
}
