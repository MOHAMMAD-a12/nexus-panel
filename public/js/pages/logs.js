// pages/logs.js — audit log viewer
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { fmtAgo, fmtDate, escapeHtml } from '../core/ui.js';

let table;

export async function renderLogs() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.logs')}</h1><div class="page-sub">Audit trail of all actions</div></div>
      <div class="flex gap-8">
        ${hasPerm('logs.read') ? '<button class="btn ghost" id="export">'+icon('download',16)+' Export</button>' : ''}
      </div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="row">
        <div class="field" style="flex:2"><label>Action</label><input class="input" id="f-action" placeholder="e.g. config_created"></div>
        <div class="field" style="flex:1"><label>Status</label><select class="select" id="f-status"><option value="">All</option><option value="success">success</option><option value="failure">failure</option></select></div>
      </div>
      <div class="row">
        <div class="field" style="flex:1"><label>From (unix ts)</label><input class="input" type="number" id="f-from" placeholder="0"></div>
        <div class="field" style="flex:1"><label>To (unix ts)</label><input class="input" type="number" id="f-to" placeholder="0"></div>
        <div class="field" style="flex:1;align-self:flex-end"><button class="btn" id="f-apply">${icon('search',14)} Apply</button></div>
      </div>
    </div>
    <div id="logs-table"></div>`;

  page.querySelector('#export')?.addEventListener('click', exportLogs);
  const apply = () => table.refresh();
  page.querySelector('#f-apply').addEventListener('click', apply);
  ['f-action', 'f-status', 'f-from', 'f-to'].forEach((id) => page.querySelector('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); }));

  table = new DataTable(page.querySelector('#logs-table'), {
    columns: [
      { key: 'created_at', label: 'Time', render: (v) => `<span class="muted" style="font-size:12px">${escapeHtml(fmtAgo(v))}</span>` },
      { key: 'action', label: 'Action', render: (v) => `<span class="tag">${escapeHtml(v)}</span>` },
      { key: 'username', label: 'User', render: (v) => escapeHtml(v || '—') },
      { key: 'resource', label: 'Resource', render: (v, r) => `${escapeHtml(v || '—')}${r.resourceId ? ` <span class="muted" style="font-size:11px">${escapeHtml(r.resourceId)}</span>` : ''}` },
      { key: 'status', label: 'Status', render: (v) => v === 'success' ? '<span class="badge ok">success</span>' : v === 'failure' ? '<span class="badge danger">failure</span>' : `<span class="badge">${escapeHtml(v)}</span>` },
      { key: 'ip', label: 'IP', render: (v) => `<span class="mono" style="font-size:12px">${escapeHtml(v || '—')}</span>` },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      const action = document.getElementById('f-action').value.trim();
      const status = document.getElementById('f-status').value;
      const from = document.getElementById('f-from').value.trim();
      const to = document.getElementById('f-to').value.trim();
      if (action) q.set('action', action);
      if (status) q.set('status', status);
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      return api.list(`/logs?${q.toString()}`);
    },
  });
}

async function exportLogs() {
  try {
    const rows = await api.get('/logs/export');
    const csv = ['timestamp,action,username,resource,resourceId,status,ip'];
    for (const r of rows) csv.push([r.created_at, r.action, r.username, r.resource, r.resourceId, r.status, r.ip].map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit-logs-${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast('Exported', { type: 'ok' });
  } catch (e) { toast(e.message, { type: 'error' }); }
}
