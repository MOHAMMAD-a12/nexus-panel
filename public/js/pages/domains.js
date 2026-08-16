// pages/domains.js — domain manager + DNS records tab
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { statusBadge, dot, fmtAgo, formModal, confirmDelete, escapeHtml } from '../core/ui.js';

let table;
let currentDomain = null;

const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];

export async function renderDomains() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.domains')}</h1><div class="page-sub">Domains, DNS records, SSL & proxy</div></div>
      <div class="flex gap-8">
        <button class="btn ghost" id="sync-cf">${icon('refresh', 16)} Sync Cloudflare</button>
        <button class="btn primary" id="add-domain">${icon('plus', 16)} ${t('action.add')}</button>
      </div>
    </div>
    <div id="domains-table"></div>
    <div id="domain-detail" style="margin-top:16px"></div>`;

  const canWrite = hasPerm('domains.write');
  const canCf = hasPerm('cloudflare.read');
  page.querySelector('#add-domain').style.display = canWrite ? '' : 'none';
  page.querySelector('#sync-cf').style.display = canCf ? '' : 'none';

  page.querySelector('#add-domain').addEventListener('click', openDomainForm);
  page.querySelector('#sync-cf').addEventListener('click', async () => {
    try { await api.get('/api/domains/sync'); toast('Synced zones from Cloudflare', { type: 'ok' }); table.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });

  table = new DataTable(page.querySelector('#domains-table'), {
    columns: [
      { key: 'name', label: 'Domain', render: (v, r) => `<strong>${escapeHtml(v)}</strong><div class="muted" style="font-size:11px">${escapeHtml(r.zoneId || 'no zone')}</div>` },
      { key: 'status', label: 'Status', render: (v) => statusBadge(v) },
      { key: 'dns', label: 'DNS', render: (v, r) => statusBadge(r.dnsStatus) },
      { key: 'ssl', label: 'SSL', render: (v, r) => statusBadge(r.sslStatus) },
      { key: 'proxy', label: 'Proxy', render: (v, r) => r.proxyStatus ? '<span class="badge ok">ON</span>' : '<span class="badge warn">OFF</span>' },
      { key: 'lastCheck', label: 'Checked', render: (v) => fmtAgo(v) },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      return api.list(`/domains?${q.toString()}`);
    },
    onRow: (id) => openDomainDetail(id),
    actions: canWrite ? [
      { key: 'verify', label: '', icon: 'shield', cls: 'ghost', onClick: verifyDomain },
      { key: 'edit', label: '', icon: 'edit', cls: 'ghost', onClick: (id, r) => openDomainForm(r) },
      { key: 'delete', label: '', icon: 'trash', cls: 'danger', onClick: deleteDomain },
    ] : [],
  });
}

async function openDomainDetail(id) {
  const detail = document.getElementById('domain-detail');
  detail.innerHTML = `<div class="skeleton" style="height:300px;border-radius:16px"></div>`;
  let domain;
  try {
    domain = await api.get(`/domains/${id}`);
  } catch (e) { detail.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; return; }
  currentDomain = domain;

  const canDns = hasPerm('dns.read');
  detail.innerHTML = `
    <div class="card">
      <div class="tab-bar">
        <div class="tab active" data-tab="overview">Overview</div>
        ${canDns ? '<div class="tab" data-tab="dns">DNS Records</div>' : ''}
      </div>
      <div class="tab-content active" data-content="overview">
        <div class="kv">
          <div class="k">Domain</div><div class="v">${escapeHtml(domain.name)}</div>
          <div class="k">Status</div><div class="v">${statusBadge(domain.status)}</div>
          <div class="k">DNS</div><div class="v">${statusBadge(domain.dnsStatus)}</div>
          <div class="k">SSL</div><div class="v">${statusBadge(domain.sslStatus)}</div>
          <div class="k">Zone ID</div><div class="v mono">${escapeHtml(domain.zoneId || '—')}</div>
          <div class="k">Nameservers</div><div class="v">${(domain.nameservers || []).map((n) => `<span class="tag">${escapeHtml(n)}</span>`).join('') || '—'}</div>
          <div class="k">Last check</div><div class="v">${fmtAgo(domain.lastCheck)}</div>
          ${domain.error ? `<div class="k">Error</div><div class="v" style="color:var(--danger)">${escapeHtml(domain.error)}</div>` : ''}
        </div>
      </div>
      ${canDns ? '<div class="tab-content" data-content="dns"><div class="flex gap-8" style="margin-bottom:12px"><button class="btn primary sm" id="add-record">Add Record</button></div><div id="dns-list"></div></div>' : ''}
    </div>`;

  detail.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    detail.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === tab));
    detail.querySelectorAll('.tab-content').forEach((x) => x.classList.toggle('active', x.dataset.content === tab.dataset.tab));
    if (tab.dataset.tab === 'dns') loadDns(id);
  }));
}

async function loadDns(domainId) {
  const list = document.getElementById('dns-list');
  list.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
  let records;
  try {
    records = await api.get(`/domains/${domainId}/dns`);
  } catch (e) { list.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; return; }

  if (!records.length) { list.innerHTML = `<div class="empty"><div class="ico">🌐</div><h4>No DNS records</h4></div>`; return; }
  const canDnsWrite = hasPerm('dns.write');
  list.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th>Name</th><th>Content</th><th>TTL</th><th>Proxy</th><th></th></tr></thead><tbody>
    ${records.map((r) => `<tr data-id="${r.id}">
      <td><span class="tag">${escapeHtml(r.type)}</span></td>
      <td>${escapeHtml(r.name)}</td>
      <td class="mono" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.content)}">${escapeHtml(r.content)}</td>
      <td>${escapeHtml(String(r.ttl))}</td>
      <td>${r.proxied ? '<span class="badge ok">proxied</span>' : '<span class="badge warn">dns only</span>'}</td>
      <td><div class="flex gap-8" style="justify-content:flex-end">
        ${canDnsWrite ? `<button class="btn sm ghost" data-toggle="${r.id}">${r.proxied ? 'Unproxy' : 'Proxy'}</button>` : ''}
        ${canDnsWrite ? `<button class="btn sm danger" data-del="${r.id}">${icon('trash', 14)}</button>` : ''}
      </div></td>
    </tr>`).join('')}
  </tbody></table></div>`;

  if (canDnsWrite) {
    document.getElementById('add-record')?.addEventListener('click', () => openRecordForm(domainId, null));
    list.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.post(`/domains/${domainId}/dns/${b.dataset.toggle}/proxy`, { proxied: !records.find((r) => r.id === b.dataset.toggle)?.proxied }); toast('Proxy updated', { type: 'ok' }); loadDns(domainId); }
      catch (e) { toast(e.message, { type: 'error' }); }
    }));
    list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDelete('DNS record'))) return;
      try { await api.del(`/domains/${domainId}/dns/${b.dataset.del}`); toast('Record deleted', { type: 'ok' }); loadDns(domainId); }
      catch (e) { toast(e.message, { type: 'error' }); }
    }));
  }
}

function openRecordForm(domainId, rec) {
  formModal({
    title: rec ? 'Edit DNS Record' : 'Add DNS Record',
    schema: [
      { key: 'type', label: 'Type', type: 'select', options: DNS_TYPES.map((x) => ({ v: x, l: x })), required: true },
      { key: 'name', label: 'Name', required: true, placeholder: '@ or sub' },
      { key: 'content', label: 'Content', required: true },
      { key: 'ttl', label: 'TTL (1 = auto)', type: 'number' },
      { key: 'proxied', label: 'Proxied (orange cloud)', type: 'checkbox' },
    ],
    value: rec ? { type: rec.type, name: rec.name, content: rec.content, ttl: rec.ttl, proxied: rec.proxied } : { ttl: 1, proxied: false },
    onSubmit: async (data, close) => {
      if (rec) await api.patch(`/domains/${domainId}/dns/${rec.id}`, data);
      else await api.post(`/domains/${domainId}/dns`, data);
      toast('DNS record saved', { type: 'ok' }); close(); loadDns(domainId);
    },
  });
}

function openDomainForm(existing) {
  formModal({
    title: existing ? t('action.edit') + ' Domain' : t('action.add') + ' Domain',
    schema: [
      { key: 'name', label: 'Domain name', required: true, placeholder: 'example.com' },
      { key: 'zone_id', label: 'Cloudflare Zone ID (optional)', placeholder: 'auto from sync' },
      { key: 'status', label: 'Status', type: 'select', options: ['pending', 'verified', 'online', 'offline', 'dns_error', 'ssl_error'].map((x) => ({ v: x, l: x })) },
      { key: 'proxy_status', label: 'Proxy enabled', type: 'checkbox' },
    ],
    value: existing ? { name: existing.name, zone_id: existing.zoneId, status: existing.status, proxy_status: existing.proxyStatus } : { status: 'pending', proxy_status: true },
    onSubmit: async (data, close) => {
      const payload = { name: data.name, zone_id: data.zone_id, status: data.status, proxy_status: data.proxy_status };
      if (existing) await api.put(`/domains/${existing.id}`, payload);
      else await api.post('/api/domains', payload);
      toast('Domain saved', { type: 'ok' }); close(); table.refresh();
    },
  });
}

async function verifyDomain(id) {
  try { await api.post(`/domains/${id}/verify`); toast('Verification ran', { type: 'ok' }); table.refresh(); if (currentDomain && currentDomain.id === id) openDomainDetail(id); }
  catch (e) { toast(e.message, { type: 'error' }); }
}
async function deleteDomain(id) {
  if (!(await confirmDelete('domain'))) return;
  try { await api.del(`/domains/${id}`); toast('Domain deleted', { type: 'ok' }); table.refresh(); document.getElementById('domain-detail').innerHTML = ''; }
  catch (e) { toast(e.message, { type: 'error' }); }
}
