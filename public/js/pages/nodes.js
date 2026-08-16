// pages/nodes.js
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { dot, fmtBytes, fmtInt, fmtAgo, formModal, confirmDelete, escapeHtml, copyToClipboard } from '../core/ui.js';

let table;

export async function renderNodes() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.nodes')}</h1><div class="page-sub">Proxy / VPN node infrastructure</div></div>
      <div class="flex gap-8">
        <button class="btn primary" id="add-node">${icon('plus', 16)} ${t('action.add')}</button>
      </div>
    </div>
    <div id="nodes-table"></div>`;

  const canWrite = hasPerm('nodes.write');
  if (!canWrite) page.querySelector('#add-node').style.display = 'none';
  page.querySelector('#add-node').addEventListener('click', () => openForm());

  table = new DataTable(page.querySelector('#nodes-table'), {
    columns: [
      { key: 'name', label: 'Name', render: (v, r) => `${dot(r.status)} <strong>${escapeHtml(v)}</strong><div class="muted" style="font-size:11px">${escapeHtml(r.address)}</div>` },
      { key: 'protocol', label: 'Protocol', render: (v) => `<span class="tag">${escapeHtml(v)}</span>` },
      { key: 'region', label: 'Region', render: (v) => escapeHtml(v || '—') },
      { key: 'port', label: 'Port', render: (v) => escapeHtml(String(v)) },
      { key: 'latency', label: 'Latency', render: (v) => v != null ? `${v} ms` : '—' },
      { key: 'traffic', label: 'Traffic', render: (v, r) => `${fmtBytes(r.trafficUp + r.trafficDown)}`, sortable: false },
      { key: 'status', label: 'Status', render: (v) => statusText(v) },
      { key: 'lastSeen', label: 'Last seen', render: (v) => fmtAgo(v) },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      return api.list(`/nodes?${q.toString()}`);
    },
    actions: canWrite ? [
      { key: 'ping', label: '', icon: 'ping', cls: 'ghost', onClick: pingNode },
      { key: 'health', label: '', icon: 'heart', cls: 'ghost', onClick: healthNode },
      { key: 'edit', label: '', icon: 'edit', cls: 'ghost', onClick: (id, r) => openForm(r) },
      { key: 'duplicate', label: '', icon: 'copy', cls: 'ghost', onClick: duplicateNode },
      { key: 'delete', label: '', icon: 'trash', cls: 'danger', onClick: deleteNode },
    ] : [],
  });
}

function statusText(s) {
  const map = { online: ['ok', 'Online'], offline: ['danger', 'Offline'], warning: ['warn', 'Warning'] };
  const [c, l] = map[s] || ['info', s];
  return `<span class="badge ${c}">${l}</span>`;
}

async function openForm(existing) {
  const value = existing ? {
    name: existing.name, address: existing.address, port: existing.port,
    protocol: existing.protocol, region: existing.region, country: existing.country,
    enabled: existing.enabled, notes: existing.notes,
  } : { protocol: 'vless', port: 443, enabled: true };

  formModal({
    title: existing ? t('action.edit') + ' Node' : t('action.add') + ' Node',
    schema: [
      { key: 'name', label: 'Name', required: true },
      { key: 'address', label: 'Address / IP', required: true },
      { key: 'port', label: 'Port', type: 'number', required: true },
      { key: 'protocol', label: 'Protocol', type: 'select', options: ['vless', 'vmess', 'trojan', 'shadowsocks', 'wireguard'].map((p) => ({ v: p, l: p.toUpperCase() })) },
      { key: 'region', label: 'Region' },
      { key: 'country', label: 'Country' },
      { key: 'enabled', label: 'Enabled', type: 'checkbox' },
      { key: 'notes', label: 'Notes' },
    ],
    value,
    submitText: existing ? t('action.save') : t('action.add'),
    onSubmit: async (data, close) => {
      if (existing) await api.put(`/nodes/${existing.id}`, data);
      else await api.post('/nodes', data);
      toast(existing ? 'Node updated' : 'Node created', { type: 'ok' });
      close(); table.refresh();
    },
  });
}

async function pingNode(id) {
  try {
    const r = await api.post(`/nodes/${id}/ping`);
    toast(`Latency: ${r.latency} ms (${r.alive ? 'alive' : 'slow'})`, { type: r.alive ? 'ok' : 'warn' });
  } catch (e) { toast(e.message, { type: 'error' }); }
}
async function healthNode(id) {
  try {
    await api.post(`/nodes/${id}/health`);
    toast('Health check ran', { type: 'ok' }); table.refresh();
  } catch (e) { toast(e.message, { type: 'error' }); }
}
async function duplicateNode(id) {
  try {
    await api.post(`/nodes/${id}/duplicate`);
    toast('Node duplicated', { type: 'ok' }); table.refresh();
  } catch (e) { toast(e.message, { type: 'error' }); }
}
async function deleteNode(id) {
  if (!(await confirmDelete('node'))) return;
  try {
    await api.del(`/nodes/${id}`);
    toast('Node deleted', { type: 'ok' }); table.refresh();
  } catch (e) { toast(e.message, { type: 'error' }); }
}
