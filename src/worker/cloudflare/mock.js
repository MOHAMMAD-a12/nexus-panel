// cloudflare/mock.js — in-memory mock for DEMO_MODE (no real Cloudflare calls)
// Used only when DEMO_MODE=true and no real token is configured.

function delay(ms = 200) {
  return new Promise((r) => setTimeout(r, ms));
}

function fakeId() {
  return 'zone_' + Math.random().toString(36).slice(2, 12);
}

export const DEMO_MOCK = {
  // List zones (domains) in the account
  async listZones(params = {}) {
    await delay();
    const perPage = Math.min(parseInt(params.per_page || 20, 10), 100);
    const names = ['example.com', 'my-vpn.net', 'secure-cdn.io', 'proxy-domain.org'];
    const zones = names.map((name, i) => ({
      id: fakeId(),
      name,
      status: i % 3 === 0 ? 'pending' : 'active',
      paused: false,
      name_servers: [`ns${i + 1}.cloudflare.com`, `ns${i + 2}.cloudflare.com`],
      original_name_servers: [`ns${i + 1}.cloudflare.com`],
      created_on: new Date(Date.now() - i * 86400000).toISOString(),
      modified_on: new Date().toISOString(),
    }));
    return { zones: zones.slice(0, perPage), total: zones.length };
  },

  async getZone(zoneId) {
    await delay();
    return {
      id: zoneId,
      name: 'example.com',
      status: 'active',
      name_servers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
      paused: false,
    };
  },

  async verifyZone(zoneId) {
    await delay();
    return { id: zoneId, status: 'active', verified: true };
  },

  async listDnsRecords(zoneId, params = {}) {
    await delay();
    const types = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'];
    const records = Array.from({ length: 8 }).map((_, i) => ({
      id: fakeId(),
      zone_id: zoneId,
      name: ['@', 'www', 'api', 'cdn', 'node1', 'node2', 'mail', 'vpn'][i % 8] + '.example.com',
      type: types[i % types.length],
      content: i % 3 === 0 ? '192.0.2.' + (i + 1) : '2606:4700:4700::' + (i + 1),
      ttl: i % 4 === 0 ? 1 : 3600,
      proxied: i % 2 === 0,
      created_on: new Date().toISOString(),
      modified_on: new Date().toISOString(),
    }));
    return { result: records, success: true };
  },

  async createDnsRecord(zoneId, data) {
    await delay();
    return {
      id: fakeId(),
      zone_id: zoneId,
      ...data,
      created_on: new Date().toISOString(),
      modified_on: new Date().toISOString(),
    };
  },

  async updateDnsRecord(zoneId, recordId, data) {
    await delay();
    return { id: recordId, zone_id: zoneId, ...data, modified_on: new Date().toISOString() };
  },

  async deleteDnsRecord(zoneId, recordId) {
    await delay();
    return { id: recordId, deleted: true };
  },

  async getZoneStatus(zoneId) {
    await delay();
    return {
      zone_id: zoneId,
      dns: { status: 'active', https: { status: 'active' } },
      ssl: { status: 'active' },
    };
  },

  async getAccount() {
    return { id: 'demo-account', name: 'Demo Account', settings: {} };
  },
};

export default DEMO_MOCK;
