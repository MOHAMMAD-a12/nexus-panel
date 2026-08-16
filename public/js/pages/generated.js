// pages/generated.js — generated configs history
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { escapeHtml, statusBadge, confirmDelete, tagList } from '../core/ui.js';
import { qrSvg } from '../components/qrcode.js';

const PROTOCOLS = ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks5', 'http', 'https', 'wireguard'];
let table;

export async function renderGenerated() {
  const page = document.getElementById('page');
  const canWrite = hasPerm('configs.write');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.generated')}</h1><div class="page-sub">${t('common.empty') ? 'History of generated configs' : 'History of generated configs'}</div></div>
      <div class="flex gap-8"></div>
    </div>
    <div class="field" style="max-width:240px;margin-bottom:14px">
      <select class="select" id="g-filter">
        <option value="">${t('common.all')} protocols</option>
        ${PROTOCOLS.map((p) => `<option value="${p}">${p.toUpperCase()}</option>`).join('')}
      </select>
    </div>
    <div id="g-table"></div>`;

  page.querySelector('#g-filter')?.addEventListener('change', (e) => load(e.target.value));

  await load('');
}

async function load(protocol) {
  const el = document.getElementById('g-table');
  const canWrite = hasPerm('configs.write');
  table = new DataTable(el, {
    columns: [
      { key: 'name', label: 'Name', render: (v) => `<strong>${escapeHtml(v)}</strong>` },
      { key: 'protocol', label: 'Protocol', render: (v) => `<span class="tag">${escapeHtml(v.toUpperCase())}</span>` },
      { key: 'transport', label: 'Transport', render: (v) => escapeHtml(v || 'tcp') },
      { key: 'server', label: 'Server', render: (v, r) => `<span class="mono">${escapeHtml(v)}:${escapeHtml(String(r.port))}</span>` },
      { key: 'security', label: 'Security', render: (v) => v === 'tls' ? '<span class="badge ok">TLS</span>' : 'none' },
      { key: 'status', label: 'Status', render: (v) => statusBadge(v) },
      { key: 'createdAt', label: 'Created', render: (v) => escapeHtml(fmtAgo(v)) },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      if (protocol) q.set('protocol', protocol);
      return api.list(`/generated?${q.toString()}`);
    },
    actions: (canWrite ? [
      { key: 'view', label: '', icon: 'link', cls: 'ghost', onClick: viewGen },
      { key: 'delete', label: '', icon: 'trash', cls: 'danger', onClick: deleteGen },
    ] : [{ key: 'view', label: '', icon: 'link', cls: 'ghost', onClick: viewGen }]),
  });
}

async function viewGen(id) {
  let cfg;
  try { cfg = await api.get(`/generated/${id}`); }
  catch (e) { toast(e.message, { type: 'error' }); return; }
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="kv" style="margin-bottom:12px">
      <div class="k">Protocol</div><div class="v">${escapeHtml((cfg.protocol || '').toUpperCase())}</div>
      <div class="k">Server</div><div class="v mono">${escapeHtml(cfg.server || '')}:${escapeHtml(String(cfg.port || ''))}</div>
      <div class="k">Transport</div><div class="v">${escapeHtml(cfg.transport || 'tcp')}</div>
      <div class="k">Security</div><div class="v">${escapeHtml(cfg.security || 'none')}</div>
      <div class="k">Template</div><div class="v mono">${cfg.templateId ? escapeHtml(cfg.templateId) : '—'}</div>
      <div class="k">Endpoint</div><div class="v mono">${cfg.endpointId ? escapeHtml(cfg.endpointId) : '—'}</div>
    </div>
    <div class="section-title">${icon('link', 16)} URI</div>
    <div class="field"><textarea class="textarea mono" readonly id="uri-box">${escapeHtml(cfg.uri || '')}</textarea></div>
    <div class="flex gap-8" style="margin-bottom:12px">
      <button class="btn sm" id="copy-uri">${icon('copy', 14)} Copy</button>
      <div class="qr-box" id="qv" style="padding:8px"></div>
    </div>
    <details><summary class="muted" style="cursor:pointer">${getLocale() === 'fa' ? 'نمایش JSON' : 'Show JSON'}</summary>
      <pre class="textarea mono" style="margin-top:8px;max-height:240px;overflow:auto">${escapeHtml(cfg.json || '')}</pre></details>`;

  openModal({ title: icon('link', 18) + ' ' + escapeHtml(cfg.name || 'Config'), body, size: 'lg' });
  try { body.querySelector('#qv').innerHTML = qrSvg(cfg.uri, { ecLevel: 'M', size: 120, margin: 2 }); } catch {}
  body.querySelector('#copy-uri')?.addEventListener('click', () => {
    const txt = cfg.uri;
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Copied', { type: 'ok' }));
  });
}

async function deleteGen(id) {
  if (!(await confirmDelete('Delete this generated config?'))) return;
  try { await api.del(`/generated/${id}`); toast('Deleted', { type: 'ok' }); table.refresh(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}

function getLocale() { return window.__nexus_state?.locale || 'en'; }
function fmtAgo(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}
