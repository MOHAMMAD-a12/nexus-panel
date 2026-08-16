// pages/generator.js — the NEXUS core: BUILD → VALIDATE → GENERATE → PREVIEW → QR → EXPORT
// 3-section layout: LEFT (protocol + target/endpoint), CENTER (transport-aware smart
// form driven by /api/protocols schema), RIGHT (live preview, validation, multi-format
// output, client-side QR, copy/export/save, randomize, batch).
import { api } from '../core/api.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { qrSvg } from '../components/qrcode.js';
import { escapeHtml, statusBadge } from '../core/ui.js';

const GROUP_TITLES = {
  basic: { en: 'Basics', fa: 'پایه' },
  security: { en: 'Security', fa: 'امنیت' },
  network: { en: 'Transport / Network', fa: 'انتقال / شبکه' },
  advanced: { en: 'Advanced', fa: 'پیشرفته' },
};

const FORMATS = ['uri', 'json', 'raw', 'share'];

let protoList = [];
const state = {
  protocol: 'vless',
  protoDef: null,
  values: {},
  endpointId: '',
  endpoints: [],
  result: null,
  error: null,
  format: 'uri',
};

function lbl(f) {
  const locale = window.__nexus_state?.locale || 'en';
  return locale === 'fa' ? (f.label_fa || f.label_en || f.key) : (f.label_en || f.label_fa || f.key);
}
function getLocale() {
  return window.__nexus_state?.locale || 'en';
}

function debounce(fn, ms = 250) {
  let h;
  return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}

export async function renderGenerator() {
  const page = document.getElementById('page');
  const canWrite = hasPerm('configs.write');

  page.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">${t('nav.generator')}</h1>
        <div class="page-sub">${getLocale() === 'fa' ? 'تولیدکننده کانفیگ شبکه — ساخت، اعتبارسنجی، پیش‌نمایش، QR و خروجی' : 'Build, validate, preview, QR & export network configs'}</div>
      </div>
      <div class="flex gap-8">
        <button class="btn ghost" id="btn-random">${icon('refresh', 16)} ${t('action.generate') === 'Generate' ? 'Randomize' : 'تصادفی'}</button>
        <button class="btn ghost" id="btn-batch">${icon('bolt', 16)} Batch</button>
        <button class="btn primary" id="btn-save" style="${canWrite ? '' : 'display:none'}">${icon('save', 16)} Save</button>
      </div>
    </div>
    <div class="generator-grid">
      <aside class="gen-left card">
        <div class="section-title">${icon('cpu', 16)} ${getLocale() === 'fa' ? 'پروتکل' : 'Protocol'}</div>
        <div class="proto-grid" id="proto-grid"></div>

        <div class="section-title" style="margin-top:16px">${icon('globe', 16)} ${getLocale() === 'fa' ? 'مقصد / سرور' : 'Target / Server'}</div>
        <div class="field">
          <label>${getLocale() === 'fa' ? 'اندپوینت (موقعیت)' : 'Endpoint (location)'}</label>
          <select class="select" id="ep-select"><option value="">${getLocale() === 'fa' ? 'دستی' : 'Manual entry'}</option></select>
        </div>
        <div class="field"><label>Server / IP</label><input class="input" id="f-server" placeholder="1.2.3.4"></div>
        <div class="field"><label>Domain</label><input class="input" id="f-domain" placeholder="example.com"></div>
        <div class="field"><label>Port</label><input class="input" id="f-port" type="number" placeholder="443"></div>
        <div class="muted" style="font-size:12px;margin-top:4px">${getLocale() === 'fa' ? 'اگر اندپوینت انتخاب شود، سرور/دامنه/پورت از آن پر می‌شود.' : 'Selecting an endpoint auto-fills server/domain/port.'}</div>
      </aside>

      <section class="gen-center card" id="gen-center"></section>

      <aside class="gen-right card">
        <div class="section-title">${icon('link', 16)} ${getLocale() === 'fa' ? 'پیش‌نمایش زنده' : 'Live Preview'}</div>
        <div id="gen-status"></div>
        <div class="qr-box" id="qr-box"></div>
        <div class="tab-bar" id="fmt-tabs"></div>
        <div class="field"><textarea class="textarea mono" id="out-box" readonly rows="6" style="min-height:120px"></textarea></div>
        <div class="flex gap-8 wrap" style="margin-top:8px">
          <button class="btn sm" id="btn-copy">${icon('copy', 14)} Copy</button>
          <button class="btn sm ghost" id="btn-dl">${icon('download', 14)} .txt</button>
          <button class="btn sm ghost" id="btn-qr-dl">${icon('download', 14)} QR</button>
        </div>
      </aside>
    </div>`;

  page.querySelector('#btn-random').addEventListener('click', randomize);
  page.querySelector('#btn-batch').addEventListener('click', openBatch);
  page.querySelector('#btn-save').addEventListener('click', () => saveConfig(false));
  page.querySelector('#btn-copy').addEventListener('click', copyOutput);
  page.querySelector('#btn-dl').addEventListener('click', downloadTxt);
  page.querySelector('#btn-qr-dl').addEventListener('click', downloadQr);

  // Target field listeners
  const onTarget = debounce(() => { readTarget(); generatePreview(); }, 200);
  ['f-server', 'f-domain', 'f-port'].forEach((id) => {
    const el = page.querySelector('#' + id);
    el.addEventListener('input', onTarget);
  });
  page.querySelector('#ep-select').addEventListener('change', (e) => {
    state.endpointId = e.target.value;
    applyEndpoint();
    generatePreview();
  });

  await Promise.all([loadProtocols(), loadEndpoints()]);
  if (window.__nexus_pending_proto && protoList.some((p) => p.id === window.__nexus_pending_proto)) {
    state.protocol = window.__nexus_pending_proto;
    window.__nexus_pending_proto = null;
  }
  selectProtocol(state.protocol);
  await applyPending();
}

// Apply a template or endpoint passed from another page (Templates/Endpoints).
async function applyPending() {
  if (window.__nexus_pending_endpoint) {
    const id = window.__nexus_pending_endpoint;
    window.__nexus_pending_endpoint = null;
    state.endpointId = id;
    const sel = document.getElementById('ep-select');
    if (sel) sel.value = id;
    applyEndpoint();
    generatePreview();
  }
  if (window.__nexus_pending_tpl) {
    const tpl = window.__nexus_pending_tpl;
    window.__nexus_pending_tpl = null;
    if (tpl.protocol && tpl.protocol !== state.protocol && protoList.some((p) => p.id === tpl.protocol)) {
      state.protocol = tpl.protocol;
      state.protoDef = protoList.find((p) => p.id === tpl.protocol);
      initValues();
      renderProtoGrid();
      buildCenter();
    }
    // Map template params onto form values.
    const map = { server: 'server', domain: 'domain', port: 'port', sni: 'sni', host: 'host', path: 'path', flow: 'flow', method: 'method', uuid: 'uuid', password: 'password' };
    for (const [k, fk] of Object.entries(map)) {
      if (tpl[k] != null) state.values[fk] = tpl[k];
    }
    if (tpl.tls !== undefined) state.values.tls = !!tpl.tls;
    if (tpl.transport) state.values.transport = tpl.transport;
    // reflect target fields
    if (tpl.server) { const s = document.getElementById('f-server'); if (s) s.value = tpl.server; }
    if (tpl.domain) { const d = document.getElementById('f-domain'); if (d) d.value = tpl.domain; }
    if (tpl.port) { const p = document.getElementById('f-port'); if (p) p.value = tpl.port; }
    buildCenter();
    generatePreview();
  }
}

// ───────────────── data loading ─────────────────
async function loadProtocols() {
  try {
    protoList = await api.get('/api/protocols');
  } catch (e) {
    protoList = [];
    toast(e.message || 'Failed to load protocols', { type: 'error' });
  }
  renderProtoGrid();
}
async function loadEndpoints() {
  try {
    const data = await api.list('/api/endpoints?pageSize=200');
    state.endpoints = data.data || [];
  } catch { state.endpoints = []; }
  const sel = document.getElementById('ep-select');
  if (sel) {
    sel.innerHTML = '<option value="">' + (getLocale() === 'fa' ? 'دستی' : 'Manual entry') + '</option>' +
      state.endpoints.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} ${e.countryName ? '· ' + escapeHtml(e.countryName) : ''}</option>`).join('');
  }
}

function renderProtoGrid() {
  const grid = document.getElementById('proto-grid');
  if (!grid) return;
  grid.innerHTML = protoList.map((p) => `
    <button class="proto-card ${p.id === state.protocol ? 'active' : ''}" data-proto="${escapeHtml(p.id)}">
      <div class="pc-label">${escapeHtml(p.label)}</div>
      <div class="pc-meta">${escapeHtml((p.transports || []).join(' · '))}</div>
    </button>`).join('');
  grid.querySelectorAll('.proto-card').forEach((b) => {
    b.addEventListener('click', () => selectProtocol(b.dataset.proto));
  });
}

function selectProtocol(id) {
  const def = protoList.find((p) => p.id === id);
  if (!def) return;
  state.protocol = id;
  state.protoDef = def;
  initValues();
  renderProtoGrid();
  buildCenter();
  readTarget();
  generatePreview();
}

function initValues() {
  const v = {};
  for (const g of ['basic', 'security', 'network', 'advanced']) {
    for (const f of (state.protoDef.schema?.[g] || [])) {
      if (f.default !== undefined) v[f.key] = f.default;
      else if (f.type === 'checkbox') v[f.key] = false;
      else if (f.type === 'select' && f.options && f.options.length && !f.multiple) v[f.key] = f.options[0].value;
      else if (f.type === 'transport') v[f.key] = (state.protoDef.transports || ['tcp'])[0];
      else v[f.key] = '';
    }
  }
  v.transport = (state.protoDef.transports || ['tcp'])[0] || 'tcp';
  v.tls = !!(state.protoDef.tlsDefault || state.protoDef.tlsRequired);
  // expose to window.__nexus_state for lbl() locale lookup
  state.values = v;
}

// ───────────────── smart form (CENTER) ─────────────────
function shouldShow(f) {
  if (!f.showWhen) return true;
  for (const k in f.showWhen) {
    const want = f.showWhen[k];
    const cur = state.values[k];
    if (Array.isArray(want)) {
      if (!want.includes(cur)) return false;
    } else if (cur !== want) return false;
  }
  return true;
}

function buildCenter() {
  const center = document.getElementById('gen-center');
  if (!center) return;
  const groups = ['basic', 'security', 'network', 'advanced'];
  let html = `<div class="section-title">${icon('edit', 16)} ${escapeHtml(state.protoDef.label)} <span class="muted" style="font-weight:400;font-size:12px">${escapeHtml(state.protoDef.description || '')}</span></div>`;
  for (const g of groups) {
    const fields = (state.protoDef.schema?.[g] || []).filter(shouldShow);
    if (!fields.length) continue;
    html += `<div class="form-group" data-group="${g}"><div class="group-title">${escapeHtml(GROUP_TITLES[g]?.[getLocale()] || g)}</div>`;
    html += fields.map(renderField).join('');
    html += `</div>`;
  }
  center.innerHTML = html;

  // delegated listeners (attach once; innerHTML swaps only children, not this node)
  if (!center._bound) {
    center._bound = true;
    center.addEventListener('input', (e) => {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    captureValue(el);
    if (el.dataset.field === 'transport' || el.dataset.field === 'tls') {
      buildCenter(); // re-evaluate showWhen
    }
    debouncedPreview();
  });
  center.addEventListener('change', (e) => {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    captureValue(el);
    if (el.dataset.field === 'transport' || el.dataset.field === 'tls') buildCenter();
    debouncedPreview();
  });
  }

function renderField(f) {
  const val = state.values[f.key];
  const req = f.required ? ' *' : '';
  if (f.type === 'transport') {
    const opts = (state.protoDef.transports || []).map((tr) => `<option value="${escapeHtml(tr)}" ${tr === val ? 'selected' : ''}>${escapeHtml(tr)}</option>`).join('');
    return `<div class="field"><label>${escapeHtml(lbl(f))}${req}</label><select class="select" data-field="${f.key}">${opts}</select>${hint(f)}</div>`;
  }
  if (f.type === 'select') {
    if (f.multiple) {
      const sel = Array.isArray(val) ? val : [];
      const opts = f.options.map((o) => `<option value="${escapeHtml(o.value)}" ${sel.includes(o.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
      return `<div class="field"><label>${escapeHtml(lbl(f))}${req}</label><select class="select" data-field="${f.key}" multiple>${opts}</select>${hint(f)}</div>`;
    }
    const opts = f.options.map((o) => `<option value="${escapeHtml(o.value)}" ${String(val) === String(o.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    return `<div class="field"><label>${escapeHtml(lbl(f))}${req}</label><select class="select" data-field="${f.key}">${opts}</select>${hint(f)}</div>`;
  }
  if (f.type === 'checkbox') {
    return `<div class="field"><label class="check"><input type="checkbox" data-field="${f.key}" ${val ? 'checked' : ''}> ${escapeHtml(lbl(f))}</label>${hint(f)}</div>`;
  }
  const type = f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text';
  const step = f.type === 'number' ? 'step="any"' : '';
  const ph = escapeHtml(f.placeholder || '');
  return `<div class="field"><label>${escapeHtml(lbl(f))}${req}</label><input class="${f.type === 'password' ? 'input' : 'input'} mono" type="${type}" data-field="${f.key}" value="${escapeHtml(String(val ?? ''))}" placeholder="${ph}" ${step}>${hint(f)}</div>`;
}
function hint(f) {
  if (f.note) return `<div class="hint">${escapeHtml(f.note)}</div>`;
  if (f.hint) return `<div class="hint">${escapeHtml(f.hint)}</div>`;
  return '';
}

function captureValue(el) {
  const k = el.dataset.field;
  if (el.type === 'checkbox') state.values[k] = el.checked;
  else if (el.multiple) state.values[k] = Array.from(el.selectedOptions).map((o) => o.value);
  else if (el.dataset.field && el.type === 'number') state.values[k] = el.value === '' ? null : Number(el.value);
  else state.values[k] = el.value;
}

// ───────────────── target / endpoint ─────────────────
function readTarget() {
  state.values.server = document.getElementById('f-server')?.value?.trim() || null;
  state.values.domain = document.getElementById('f-domain')?.value?.trim() || null;
  const p = document.getElementById('f-port')?.value;
  state.values.port = p ? Number(p) : null;
}
function applyEndpoint() {
  const ep = state.endpoints.find((e) => e.id === state.endpointId);
  const s = document.getElementById('f-server');
  const d = document.getElementById('f-domain');
  const p = document.getElementById('f-port');
  if (ep) {
    if (s) s.value = ep.host || '';
    if (d) d.value = ep.domain || '';
    if (p) p.value = ep.port || '';
  }
  readTarget();
}

// ───────────────── generation ─────────────────
function buildBody(save) {
  const body = { protocol: state.protocol, endpointId: state.endpointId || null };
  for (const g of ['basic', 'security', 'network', 'advanced']) {
    for (const f of (state.protoDef.schema?.[g] || [])) {
      if (f.key in state.values) body[f.key] = state.values[f.key];
    }
  }
  // target overrides
  body.server = state.values.server || null;
  body.domain = state.values.domain || null;
  body.port = state.values.port || null;
  body.transport = state.values.transport;
  body.tls = state.values.tls;
  if (save) body.save = true;
  return body;
}

const debouncedPreview = debounce(() => generatePreview(), 250);

async function generatePreview() {
  const statusEl = document.getElementById('gen-status');
  if (!statusEl) return;
  try {
    const res = await api.post(`/api/generate/${state.protocol}`, buildBody(false));
    state.result = res;
    state.error = null;
    statusEl.innerHTML = `<div class="badge ok">${icon('check', 14)} ${getLocale() === 'fa' ? 'معتبر' : 'Valid'}</div>`;
    renderOutput();
  } catch (e) {
    state.result = null;
    state.error = e.message || 'Generation failed';
    const fieldHints = e.fields ? Object.entries(e.fields).map(([k, v]) => `<div class="err-row">${escapeHtml(k)}: ${escapeHtml(v)}</div>`).join('') : '';
    statusEl.innerHTML = `<div class="badge danger">${icon('close', 14)} ${getLocale() === 'fa' ? 'نامعتبر' : 'Invalid'}</div><div class="err-box">${escapeHtml(state.error)}${fieldHints}</div>`;
    renderOutput();
  }
}

function renderOutput() {
  const box = document.getElementById('out-box');
  const qr = document.getElementById('qr-box');
  const tabs = document.getElementById('fmt-tabs');
  if (!box) return;

  // format tabs (only when valid)
  if (state.result) {
    tabs.innerHTML = FORMATS.map((f) => `<button class="tab ${f === state.format ? 'active' : ''}" data-fmt="${f}">${f.toUpperCase()}</button>`).join('');
    tabs.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { state.format = b.dataset.fmt; renderOutput(); }));
  } else {
    tabs.innerHTML = '';
  }

  let text = '';
  if (state.result) {
    if (state.format === 'uri') text = state.result.uri;
    else if (state.format === 'json') text = state.result.json;
    else if (state.format === 'raw') text = state.result.raw || state.result.uri;
    else if (state.format === 'share') text = shareText(state.result);
  } else {
    text = '';
  }
  box.value = text;

  // QR (URI only)
  if (state.result && state.result.uri) {
    try { qr.innerHTML = qrSvg(state.result.uri, { ecLevel: 'M', size: 168, margin: 2 }); }
    catch { qr.innerHTML = `<div class="muted" style="font-size:12px">${getLocale() === 'fa' ? 'بیش از حد طولانی' : 'Too long'}</div>`; }
  } else {
    qr.innerHTML = `<div class="muted" style="font-size:12px">${getLocale() === 'fa' ? 'خطا در تولید' : 'No output'}</div>`;
  }
}

function shareText(r) {
  const lines = [
    `Name: ${r.name || ''}`,
    `Protocol: ${r.protocol}`,
    `Server: ${r.server}:${r.port}`,
    `TLS: ${r.tls ? 'yes' : 'no'}`,
    `Transport: ${r.transport}`,
    ``,
    `URI: ${r.uri}`,
    ``,
    `Import this link into your client. Keep it private.`,
  ];
  return lines.join('\n');
}

function copyOutput() {
  const box = document.getElementById('out-box');
  if (!box || !box.value) return;
  const done = () => toast('Copied to clipboard', { type: 'ok' });
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(box.value).then(done).catch(() => fallback(box.value, done));
  else fallback(box.value, done);
}
function fallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch {}
  document.body.removeChild(ta);
}
function downloadTxt() {
  if (!state.result) return;
  const content = [
    '=== URI ===', state.result.uri,
    '', '=== JSON ===', state.result.json,
    '', '=== RAW ===', state.result.raw || state.result.uri,
    '', '=== SHARE ===', shareText(state.result),
  ].join('\n');
  triggerDownload(`${state.result.name || 'nexus'}.txt`, content, 'text/plain');
}
function downloadQr() {
  if (!state.result) return;
  const svg = qrSvg(state.result.uri, { ecLevel: 'M', size: 320, margin: 2 });
  triggerDownload(`${state.result.name || 'nexus'}-qr.svg`, svg, 'image/svg+xml');
}
function triggerDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveConfig() {
  if (!state.protoDef) return;
  try {
    const res = await api.post(`/api/generate/${state.protocol}`, buildBody(true));
    toast(getLocale() === 'fa' ? 'کانفیگ ذخیره شد' : 'Config saved to history', { type: 'ok' });
    state.result = { ...state.result, ...res, id: res.id };
  } catch (e) {
    toast(e.message || 'Save failed', { type: 'error' });
  }
}

// ───────────────── randomize ─────────────────
function randomToken(len = 16) {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function randomUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function randomize() {
  const v = state.values;
  for (const g of ['basic', 'security', 'network', 'advanced']) {
    for (const f of (state.protoDef.schema?.[g] || [])) {
      if (f.gen === 'uuid') v[f.key] = randomUuid();
      else if (f.gen === 'token') v[f.key] = randomToken(16);
      else if (f.key === 'name') v[f.key] = 'NEXUS-' + randomToken(4).toUpperCase();
    }
  }
  buildCenter();
  generatePreview();
}

// ───────────────── batch ─────────────────
function openBatch() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>${getLocale() === 'fa' ? 'تعداد' : 'Count'}</label><input class="input" id="b-count" type="number" value="5" min="1" max="500"></div>
    <div class="field"><label>Protocol</label><select class="select" id="b-proto">${protoList.map((p) => `<option value="${p.id}" ${p.id === state.protocol ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}</select></div>
    <div class="field"><label>${getLocale() === 'fa' ? 'اندپوینت' : 'Endpoint'}</label><select class="select" id="b-ep"><option value="">${getLocale() === 'fa' ? 'بدون (سرور دستی)' : 'None (manual server)'}</option>${state.endpoints.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Server (if no endpoint)</label><input class="input" id="b-server" placeholder="1.2.3.4"></div>
    <div class="field"><label>${getLocale() === 'fa' ? 'الگوی نام' : 'Naming pattern'}</label><input class="input" id="b-name" value="NEXUS"></div>
    <label class="check"><input type="checkbox" id="b-save"> ${getLocale() === 'fa' ? 'ذخیره در تاریخچه' : 'Save to history'}</label>
    <div id="b-result" style="margin-top:12px"></div>`;

  const foot = document.createElement('div');
  foot.innerHTML = `<button class="btn ghost" data-cancel>${t('action.cancel')}</button><button class="btn primary" data-go>${getLocale() === 'fa' ? 'تولید' : 'Generate'}</button>`;

  const m = openModal({ title: icon('bolt', 18) + ' ' + (getLocale() === 'fa' ? 'تولید انبوه' : 'Batch Generate'), body, footer: foot, size: 'lg', onOpen: ({ close }) => {
    foot.querySelector('[data-cancel]').onclick = close;
    foot.querySelector('[data-go]').onclick = async () => {
      const payload = {
        count: Number(body.querySelector('#b-count').value) || 1,
        protocol: body.querySelector('#b-proto').value,
        endpointId: body.querySelector('#b-ep').value || null,
        server: body.querySelector('#b-server').value.trim() || null,
        namingPattern: body.querySelector('#b-name').value || 'NEXUS',
        save: body.querySelector('#b-save').checked,
      };
      const resEl = body.querySelector('#b-result');
      resEl.innerHTML = `<div class="muted">${getLocale() === 'fa' ? 'در حال تولید…' : 'Generating…'}</div>`;
      try {
        const res = await api.post('/api/generate/batch', payload);
        const lines = (res.configs || []).map((c) => `${c.name}\t${c.uri}`).join('\n');
        resEl.innerHTML = `
          <div class="badge ok">${res.count} ${getLocale() === 'fa' ? 'ساخته شد' : 'generated'}${res.saved ? ' · ' + res.saved + ' saved' : ''}</div>
          ${res.errors && res.errors.length ? `<div class="err-box">${escapeHtml(JSON.stringify(res.errors, null, 2))}</div>` : ''}
          <textarea class="textarea mono" readonly rows="8" style="margin-top:8px;min-height:140px">${escapeHtml(lines)}</textarea>
          <button class="btn sm" id="b-copy" style="margin-top:6px">${icon('copy', 14)} ${getLocale() === 'fa' ? 'کپی همه' : 'Copy all'}</button>`;
        resEl.querySelector('#b-copy').onclick = () => {
          if (navigator.clipboard) navigator.clipboard.writeText(lines).then(() => toast('Copied', { type: 'ok' }));
        };
      } catch (e) {
        resEl.innerHTML = `<div class="err-box">${escapeHtml(e.message || 'Batch failed')}</div>`;
      }
    };
  }});
}
