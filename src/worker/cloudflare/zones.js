// cloudflare/zones.js — zone/domain operations via CF API (with demo fallback)
import { withFallback } from './cf.js';
import { ExternalError } from '../utils/error.js';

export async function listZones(env, kv, params = {}) {
  return withFallback(env, kv, (client) =>
    client.listZones ? client.listZones(params) : client.request('GET', '/zones', undefined, { params })
  );
}

export async function getZone(env, kv, zoneId) {
  return withFallback(env, kv, (client) => client.request('GET', `/zones/${zoneId}`));
}

export async function verifyZone(env, kv, zoneId) {
  return withFallback(env, kv, (client) =>
    client.verifyZone ? client.verifyZone(zoneId) : client.request('GET', `/zones/${zoneId}/activation_check`)
  );
}

export async function getZoneStatus(env, kv, zoneId) {
  return withFallback(env, kv, (client) =>
    client.getZoneStatus ? client.getZoneStatus(zoneId) : client.request('GET', `/zones/${zoneId}`)
  );
}
