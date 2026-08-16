// pages/apikeys.js — API key management
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { statusBadge, fmtAgo, confirmDelete, copyToClipboard, escapeHtml } from '../core/ui.js';

let table;

export async function renderApiKeys() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.apikeys')}</h1><div class="page-sub">Programmatic API credentials (Bearer)</div></div>
      <div class="flex gap-8">
        <button class="btn primary" id="add-key">${icon('plus', 16)} ${t('action.add')}</button>
      </div>
    </div>
    <div id="keys-table"></div>`;

  const canWrite = hasPerm('apikeys.write');
  if (!canWrite) page.querySelector('#add-key').style.display = 'none';
  page.querySelector('#add-key').addEventListener('click', () => openForm());

  table = new DataTable(page.querySelector('#keys-table'), {
    columns: [
      { key: 'name', label: 'Name', render: (v) => `<strong>${escapeHtml(v)}</strong>` },
      { key: 'keyPrefix', label: 'Prefix', render: (v) => `<span class="mono">${escapeHtml(v)}…</span>` },
      { key: 'scopes', label: 'Scopes', render: (v) => Array.isArray(v) ? v.map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join(' ') : '' },
      { key: 'rateLimit', label: 'Rate limit', render: (v) => `${escapeHtml(String(v))}/min` },
      { key: 'status', label: 'Status', render: (v) => statusBadge(v) },
      { key: 'lastUsed', label: 'Last used', render: (v) => fmtAgo(v) },
      { key: 'expiresAt', label: 'Expires', render: (v) => v ? fmtAgo(v) : 'never' },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      return api.list(`/apikeys?${q.toString()}`);
    },
    actions: canWrite ? [
      { key: 'rotate', label: '', icon: 'refresh', cls: 'ghost', onClick: rotateKey },
      { key: 'delete', label: '', icon: 'trash', cls: 'danger', onClick: deleteKey },
    ] : [],
  });
}

function openForm() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>Name</label><input class="input" id="k-name" placeholder="CI token"></div>
    <div class="field"><label>Scopes (comma)</label><input class="input" id="k-scopes" placeholder="nodes.read, configs.read"></div>
    <div class="row">
      <div class="field" style="flex:1"><label>Rate limit (/min)</label><input class="input" type="number" id="k-rate" value="120"></div>
      <div class="field" style="flex:1"><label>Expires (unix ts, 0=never)</label><input class="input" type="number" id="k-exp" value="0"></div>
    </div>
    <div id="k-result" style="display:none" class="alert ok" >
      <div style="font-weight:600;margin-bottom:6px">${icon('key', 16)} Copy your secret now — it won't be shown again</div>
      <div class="field"><textarea class="textarea mono" readonly id="k-secret"></textarea></div>
      <button class="btn sm" id="k-copy">${icon('copy', 14)} Copy</button>
    </div>`;

  const foot = document.createElement('div');
  foot.innerHTML = `<button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" id="k-create">${icon('plus', 14)} Create</button>`;

  openModal({ title: icon('apikeys', 18) + ' New API Key', body, footer: foot, size: 'lg', onOpen: ({ close }) => {
    foot.querySelector('[data-cancel]').onclick = close;
    foot.querySelector('#k-create').onclick = async () => {
      const name = body.querySelector('#k-name').value.trim();
      if (!name) return toast('Name required', { type: 'warn' });
      const scopes = body.querySelector('#k-scopes').value.split(',').map((s) => s.trim()).filter(Boolean);
      const payload = {
        name, scopes: scopes.length ? scopes : ['*'],
        rate_limit: Number(body.querySelector('#k-rate').value) || 120,
        expires_at: Number(body.querySelector('#k-exp').value) || null,
      };
      try {
        const r = await api.post('/apikeys', payload);
        body.querySelector('#k-result').style.display = 'block';
        const box = body.querySelector('#k-secret');
        box.value = r.secret;
        body.querySelector('#k-copy').onclick = () => copyToClipboard(r.secret);
        foot.querySelector('#k-create').disabled = true;
        table.refresh();
      } catch (e) { toast(e.message, { type: 'error' }); }
    };
  }});
}

async function rotateKey(id) {
  if (!(await confirmDelete('rotate this key'))) return;
  try {
    const r = await api.post(`/apikeys/${id}/rotate`);
    toast('Key rotated — copy the new secret', { type: 'ok' });
    // Reveal the new secret in a modal
    const body = document.createElement('div');
    body.innerHTML = `<div class="alert ok"><div style="font-weight:600;margin-bottom:6px">${icon('key', 16)} New secret (shown once)</div>
      <div class="field"><textarea class="textarea mono" readonly id="r-secret">${escapeHtml(r.secret)}</textarea></div>
      <button class="btn sm" id="r-copy">${icon('copy', 14)} Copy</button></div>`;
    openModal({ title: 'Rotated Key', body, size: 'sm', onOpen: () => {
      body.querySelector('#r-copy').onclick = () => copyToClipboard(r.secret);
    }});
    table.refresh();
  } catch (e) { toast(e.message, { type: 'error' }); }
}

async function deleteKey(id) {
  if (!(await confirmDelete('API key'))) return;
  try { await api.del(`/apikeys/${id}`); toast('Key deleted', { type: 'ok' }); table.refresh(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}
