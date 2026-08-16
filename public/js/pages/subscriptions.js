// pages/subscriptions.js — subscription manager
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { statusBadge, fmtBytes, relativeExpiry, formModal, confirmDelete, copyToClipboard, escapeHtml, tagList } from '../core/ui.js';

let table;

export async function renderSubscriptions() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.subscriptions')}</h1><div class="page-sub">Client subscription links & usage</div></div>
      <div class="flex gap-8">
        <button class="btn primary" id="add-sub">${icon('plus', 16)} ${t('action.add')}</button>
      </div>
    </div>
    <div id="subs-table"></div>`;

  const canWrite = hasPerm('subscriptions.write');
  if (!canWrite) page.querySelector('#add-sub').style.display = 'none';
  page.querySelector('#add-sub').addEventListener('click', () => openForm());

  table = new DataTable(page.querySelector('#subs-table'), {
    columns: [
      { key: 'name', label: 'Name', render: (v) => `<strong>${escapeHtml(v)}</strong>` },
      { key: 'owner', label: 'Owner', render: (v) => escapeHtml(v || '—') },
      { key: 'status', label: 'Status', render: (v) => statusBadge(v) },
      { key: 'configs', label: 'Configs', render: (v) => Array.isArray(v) ? `${v.length}` : escapeHtml(String(v || 0)) },
      { key: 'expiration', label: 'Expires', render: (v) => { const e = relativeExpiry(v); return e.text === 'never' ? '—' : `<span class="badge ${e.cls}">${escapeHtml(e.text)}</span>`; } },
      { key: 'traffic', label: 'Traffic', render: (v, r) => `<div style="font-size:12px">${fmtBytes(r.trafficUsed)}${r.trafficLimit ? ' / ' + fmtBytes(r.trafficLimit) : ''}</div>`, sortable: false },
      { key: 'devices', label: 'Devices', render: (v, r) => `${r.deviceLimit ? r.deviceLimit : '∞'}` },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      const r = await api.get(`/subscriptions?${q.toString()}`);
      return { data: r.data, meta: r.meta };
    },
    actions: canWrite ? [
      { key: 'link', label: '', icon: 'link', cls: 'ghost', onClick: viewLink },
      { key: 'regen', label: '', icon: 'refresh', cls: 'ghost', onClick: regenerate },
      { key: 'edit', label: '', icon: 'edit', cls: 'ghost', onClick: (id, r) => openForm(r) },
      { key: 'delete', label: '', icon: 'trash', cls: 'danger', onClick: deleteSub },
    ] : [{ key: 'link', label: '', icon: 'link', cls: 'ghost', onClick: viewLink }],
  });
}

function openForm(existing) {
  formModal({
    title: existing ? t('action.edit') + ' Subscription' : t('action.add') + ' Subscription',
    schema: [
      { key: 'name', label: 'Name', required: true },
      { key: 'owner', label: 'Owner (username/email)' },
      { key: 'configs', label: 'Config IDs (comma)', hint: 'comma separated config ids' },
      { key: 'traffic_limit', label: 'Traffic limit (bytes)', type: 'number' },
      { key: 'device_limit', label: 'Device limit', type: 'number' },
      { key: 'expiration', label: 'Expiration (unix ts)', type: 'number', hint: '0 = never' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'disabled', 'expired', 'revoked'].map((x) => ({ v: x, l: x })) },
    ],
    value: existing ? {
      ...existing,
      configs: Array.isArray(existing.configs) ? existing.configs.join(',') : (existing.configs || ''),
      traffic_limit: existing.trafficLimit || 0,
      device_limit: existing.deviceLimit || 0,
      expiration: existing.expiration || 0,
    } : { status: 'active', traffic_limit: 0, device_limit: 0, expiration: 0, configs: '' },
    onSubmit: async (data, close) => {
      const payload = {
        name: data.name,
        owner: data.owner || null,
        configs: String(data.configs || '').split(',').map((s) => s.trim()).filter(Boolean),
        traffic_limit: Number(data.traffic_limit) || 0,
        device_limit: Number(data.device_limit) || 0,
        expiration: data.expiration || null,
        status: data.status,
      };
      if (existing) await api.put(`/subscriptions/${existing.id}`, payload);
      else await api.post('/subscriptions', payload);
      toast('Subscription saved', { type: 'ok' }); close(); table.refresh();
    },
  });
}

async function viewLink(id) {
  const r = await api.post(`/subscriptions/${id}/link`);
  const uri = r.url;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="kv" style="margin-bottom:12px">
      <div class="k">Token</div><div class="v mono">${escapeHtml(r.token || '—')}</div>
    </div>
    <div class="section-title">${icon('link', 16)} Subscription URL</div>
    <div class="field"><textarea class="textarea" readonly id="sub-url">${escapeHtml(uri)}</textarea></div>
    <div class="flex gap-8" style="margin-top:8px">
      <button class="btn sm" id="copy">${icon('copy', 14)} Copy</button>
      <button class="btn sm ghost" id="open">${icon('external', 14)} Open</button>
    </div>
    <div class="muted" style="margin-top:10px;font-size:12px">This URL is served by the public <span class="mono">/s/:token</span> Worker Route — no auth required.</div>`;
  openModal({ title: icon('subscriptions', 18) + ' Subscription Link', body, size: 'lg', onOpen: () => {
    body.querySelector('#copy').addEventListener('click', () => copyToClipboard(uri));
    body.querySelector('#open').addEventListener('click', () => window.open(uri, '_blank'));
  }});
}

async function regenerate(id) {
  if (!(await confirmDelete('regenerate token'))) return;
  try { await api.post(`/subscriptions/${id}/regenerate`); toast('Token regenerated', { type: 'ok' }); table.refresh(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}

async function deleteSub(id) {
  if (!(await confirmDelete('subscription'))) return;
  try { await api.del(`/subscriptions/${id}`); toast('Subscription deleted', { type: 'ok' }); table.refresh(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}
