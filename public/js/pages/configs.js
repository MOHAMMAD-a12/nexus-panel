// pages/configs.js — config manager + generator + QR
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { statusBadge, fmtBytes, relativeExpiry, formModal, confirmDelete, copyToClipboard, escapeHtml, tagList } from '../core/ui.js';
import { qrSvg } from '../components/qrcode.js';

let table;

const PROTOCOLS = ['vless', 'vmess', 'trojan', 'shadowsocks', 'wireguard'];
const TRANSPORTS = ['tcp', 'ws', 'grpc', 'quic', 'h2', 'udp'];

export async function renderConfigs() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.configs')}</h1><div class="page-sub">Protocol configs with generator, QR & export</div></div>
      <div class="flex gap-8">
        <button class="btn ghost" id="gen">${icon('bolt', 16)} ${t('action.generate')}</button>
        <button class="btn primary" id="add-config">${icon('plus', 16)} ${t('action.add')}</button>
      </div>
    </div>
    <div id="configs-table"></div>`;

  const canWrite = hasPerm('configs.write');
  page.querySelector('#add-config').style.display = canWrite ? '' : 'none';
  page.querySelector('#gen').style.display = canWrite ? '' : 'none';
  page.querySelector('#add-config').addEventListener('click', () => openForm());
  page.querySelector('#gen').addEventListener('click', () => openGenerator());

  table = new DataTable(page.querySelector('#configs-table'), {
    columns: [
      { key: 'name', label: 'Name', render: (v) => `<strong>${escapeHtml(v)}</strong>` },
      { key: 'protocol', label: 'Protocol', render: (v) => `<span class="tag">${escapeHtml(v.toUpperCase())}</span>` },
      { key: 'transport', label: 'Transport', render: (v) => escapeHtml(v || 'tcp') },
      { key: 'server', label: 'Server', render: (v, r) => `<span class="mono">${escapeHtml(v)}:${escapeHtml(String(r.port))}</span>`, sortable: false },
      { key: 'port', label: 'Port', render: (v) => escapeHtml(String(v)) },
      { key: 'status', label: 'Status', render: (v) => statusBadge(v) },
      { key: 'expiration', label: 'Expires', render: (v) => { const e = relativeExpiry(v); return e.text === 'never' ? '—' : `<span class="badge ${e.cls}">${escapeHtml(e.text)}</span>`; } },
      { key: 'traffic', label: 'Traffic', render: (v, r) => `<div style="font-size:12px">${fmtBytes(r.trafficUsed)}${r.trafficLimit ? ' / ' + fmtBytes(r.trafficLimit) : ''}</div>`, sortable: false },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      return api.list(`/configs?${q.toString()}`);
    },
    actions: canWrite ? [
      { key: 'view', label: '', icon: 'link', cls: 'ghost', onClick: viewConfig },
      { key: 'edit', label: '', icon: 'edit', cls: 'ghost', onClick: (id, r) => openForm(r) },
      { key: 'delete', label: '', icon: 'trash', cls: 'danger', onClick: deleteConfig },
    ] : [{ key: 'view', label: '', icon: 'link', cls: 'ghost', onClick: viewConfig }],
  });
}

function openForm(existing) {
  formModal({
    title: existing ? t('action.edit') + ' Config' : t('action.add') + ' Config',
    schema: [
      { key: 'name', label: 'Name', required: true },
      { key: 'protocol', label: 'Protocol', type: 'select', options: PROTOCOLS.map((p) => ({ v: p, l: p.toUpperCase() })), required: true },
      { key: 'transport', label: 'Transport', type: 'select', options: TRANSPORTS.map((p) => ({ v: p, l: p })) },
      { key: 'server', label: 'Server', required: true, placeholder: '1.2.3.4 or host' },
      { key: 'port', label: 'Port', type: 'number', required: true },
      { key: 'uuid', label: 'UUID / Client ID', required: true, placeholder: 'auto-generated if blank' },
      { key: 'tls', label: 'TLS', type: 'checkbox' },
      { key: 'sni', label: 'SNI' },
      { key: 'host', label: 'Host' },
      { key: 'path', label: 'Path' },
      { key: 'expiration', label: 'Expiration (unix ts)', type: 'number', hint: 'Leave 0 for never' },
      { key: 'traffic_limit', label: 'Traffic limit (bytes)', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'disabled', 'expired'].map((x) => ({ v: x, l: x })) },
      { key: 'tags', label: 'Tags (comma)', hint: 'comma separated' },
    ],
    value: existing ? {
      ...existing, tls: existing.tls, expiration: existing.expiration || 0, traffic_limit: existing.trafficLimit || 0,
      tags: Array.isArray(existing.tags) ? existing.tags.join(',') : (existing.tags || ''),
    } : { protocol: 'vless', transport: 'tcp', port: 443, tls: true, status: 'active', expiration: 0, traffic_limit: 0, tags: '' },
    onSubmit: async (data, close) => {
      const payload = {
        name: data.name, protocol: data.protocol, transport: data.transport, server: data.server,
        port: data.port, uuid: data.uuid, tls: data.tls, sni: data.sni, host: data.host, path: data.path,
        expiration: data.expiration || null, traffic_limit: data.traffic_limit || 0, status: data.status,
        tags: String(data.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (existing) await api.put(`/configs/${existing.id}`, payload);
      else await api.post('/configs', payload);
      toast('Config saved', { type: 'ok' }); close(); table.refresh();
    },
  });
}

async function viewConfig(id) {
  const cfg = await api.get(`/configs/${id}`);
  let uri = null;
  try {
    const g = await api.post('/configs/generate', {
      protocol: cfg.protocol, server: cfg.server, port: cfg.port,
      transport: cfg.transport, tls: cfg.tls, sni: cfg.sni, host: cfg.host, path: cfg.path, uuid: cfg.uuid, expiration: cfg.expiration, trafficLimit: cfg.trafficLimit,
    });
    uri = g.uri;
  } catch {}
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="kv" style="margin-bottom:14px">
      <div class="k">Protocol</div><div class="v">${escapeHtml(cfg.protocol.toUpperCase())}</div>
      <div class="k">Server</div><div class="v mono">${escapeHtml(cfg.server)}:${escapeHtml(String(cfg.port))}</div>
      <div class="k">Transport</div><div class="v">${escapeHtml(cfg.transport)}</div>
      <div class="k">TLS</div><div class="v">${cfg.tls ? 'Yes' : 'No'}</div>
      <div class="k">UUID</div><div class="v mono">${escapeHtml(cfg.uuid || '—')}</div>
      <div class="k">Tags</div><div class="v">${tagList(cfg.tags)}</div>
    </div>
    <div class="section-title">${icon('link', 16)} Connection URI</div>
    <div class="field"><textarea class="textarea" readonly id="uri-box">${escapeHtml(uri || '—')}</textarea></div>
    <div class="flex gap-8" style="margin-bottom:14px">
      <button class="btn sm" id="copy-uri">${icon('copy', 14)} Copy</button>
    </div>
    ${uri ? `<div class="section-title">${icon('language', 16)} QR Code</div><div class="qr-box" id="qr"></div>` : ''}`;

  openModal({ title: icon('configs', 18) + ' ' + escapeHtml(cfg.name), body, size: 'lg', onOpen: ({ close }) => {
    body.querySelector('#copy-uri').addEventListener('click', () => copyToClipboard(uri));
    if (uri) body.querySelector('#qr').innerHTML = qrSvg(uri, { size: 220 });
  }});
}

async function openGenerator() {
  let protocols = [];
  try { protocols = await api.get('/protocols'); } catch {}
  const protoOpts = (protocols.length ? protocols : PROTOCOLS).map((p) => ({ v: p.name || p, l: (p.name || p).toUpperCase() }));

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="row">
      <div class="field" style="flex:2"><label>Protocol</label><select class="select" id="g-proto">${protoOpts.map((o) => `<option value="${escapeHtml(o.v)}">${escapeHtml(o.l)}</option>`).join('')}</select></div>
      <div class="field" style="flex:1"><label>Transport</label><select class="select" id="g-trans">${TRANSPORTS.map((p) => `<option value="${p}">${p}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <div class="field" style="flex:1"><label>Server / Domain</label><input class="input" id="g-server" placeholder="server.com"></div>
      <div class="field" style="flex:1"><label>Port</label><input class="input" type="number" id="g-port" value="443"></div>
    </div>
    <div class="row">
      <div class="field" style="flex:1"><label>UUID / Client ID</label><input class="input" id="g-uuid" placeholder="optional (auto)"></div>
      <div class="field" style="flex:1"><label>SNI / Host</label><input class="input" id="g-sni" placeholder="example.com"></div>
    </div>
    <div class="row">
      <div class="field" style="flex:1"><label>Path</label><input class="input" id="g-path" placeholder="/"></div>
      <div class="field" style="flex:1"><label>Traffic limit (bytes)</label><input class="input" type="number" id="g-traffic" value="0"></div>
    </div>
    <label class="check" style="margin-bottom:10px"><input type="checkbox" id="g-tls" checked> TLS enabled</label>
    <div class="field"><label>Result URI</label><textarea class="textarea" readonly id="g-result" placeholder="Generated config will appear here…"></textarea></div>
    <div id="g-qr" style="display:flex;justify-content:center;margin:10px 0"></div>`;

  const foot = document.createElement('div');
  foot.innerHTML = `<button class="btn ghost" data-cancel>Close</button>
    <button class="btn" id="g-copy">${icon('copy', 14)} Copy</button>
    <button class="btn primary" id="g-save">${icon('plus', 14)} Save as config</button>`;

  openModal({ title: icon('bolt', 18) + ' Config Generator', body, footer: foot, size: 'lg', onOpen: ({ close }) => {
    foot.querySelector('[data-cancel]').onclick = close;
    const generate = async () => {
      const payload = {
        protocol: body.querySelector('#g-proto').value,
        transport: body.querySelector('#g-trans').value,
        server: body.querySelector('#g-server').value || null,
        domain: body.querySelector('#g-server').value || null,
        port: Number(body.querySelector('#g-port').value) || 443,
        uuid: body.querySelector('#g-uuid').value || null,
        sni: body.querySelector('#g-sni').value || null,
        path: body.querySelector('#g-path').value || null,
        tls: body.querySelector('#g-tls').checked,
        trafficLimit: Number(body.querySelector('#g-traffic').value) || 0,
      };
      try {
        const g = await api.post('/configs/generate', payload);
        body.querySelector('#g-result').value = g.uri;
        body.querySelector('#g-qr').innerHTML = qrSvg(g.uri, { size: 180 });
      } catch (e) { toast(e.message, { type: 'error' }); }
    };
    ['g-proto', 'g-trans', 'g-server', 'g-port', 'g-uuid', 'g-sni', 'g-path', 'g-tls', 'g-traffic'].forEach((id) =>
      body.querySelector('#' + id).addEventListener('change', generate));
    body.querySelector('#g-server').addEventListener('input', generate);
    generate();

    foot.querySelector('#g-copy').onclick = () => {
      const v = body.querySelector('#g-result').value;
      if (v) copyToClipboard(v);
    };
    foot.querySelector('#g-save').onclick = () => {
      const result = body.querySelector('#g-result').value;
      if (!result) return toast('Generate first', { type: 'warn' });
      openForm({
        name: `${body.querySelector('#g-proto').value}-${body.querySelector('#g-server').value}`,
        protocol: body.querySelector('#g-proto').value,
        transport: body.querySelector('#g-trans').value,
        server: body.querySelector('#g-server').value,
        port: Number(body.querySelector('#g-port').value),
        uuid: body.querySelector('#g-uuid').value || crypto.randomUUID(),
        tls: body.querySelector('#g-tls').checked,
        sni: body.querySelector('#g-sni').value,
        path: body.querySelector('#g-path').value,
        traffic_limit: Number(body.querySelector('#g-traffic').value) || 0,
      });
    };
  }});
}

async function deleteConfig(id) {
  if (!(await confirmDelete('config'))) return;
  try { await api.del(`/configs/${id}`); toast('Config deleted', { type: 'ok' }); table.refresh(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}
