// pages/settings.js — settings manager + credential store
import { api } from '../core/api.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { formModal, confirmDelete, copyToClipboard, escapeHtml, fmtAgo } from '../core/ui.js';

const GROUPS = [
  { k: 'general', label: 'General' },
  { k: 'appearance', label: 'Appearance' },
  { k: 'security', label: 'Security' },
  { k: 'api', label: 'API' },
  { k: 'cloudflare', label: 'Cloudflare' },
  { k: 'database', label: 'Database' },
  { k: 'notifications', label: 'Notifications' },
  { k: 'domains', label: 'Domains' },
  { k: 'subscriptions', label: 'Subscriptions' },
  { k: 'system', label: 'System' },
];

const ACCENTS = ['#3b82f6', '#8b5cf6', '#ef4444', '#22c55e', '#f97316'];

let currentGroup = 'general';
let allSettings = {};

export async function renderSettings() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">${t('nav.settings')}</h1><div class="page-sub">Configure the control plane</div></div></div>
    <div class="card" style="display:flex;gap:0;padding:0;overflow:hidden">
      <div class="settings-nav" id="s-nav" style="width:200px;flex:0 0 200px;border-inline-end:1px solid var(--border);padding:10px"></div>
      <div class="settings-body" id="s-body" style="flex:1;padding:18px;min-width:0"></div>
    </div>`;

  const nav = page.querySelector('#s-nav');
  nav.innerHTML = GROUPS.map((g) => `<div class="nav-item ${g.k === currentGroup ? 'active' : ''}" data-g="${g.k}">${icon('gear', 16)}<span class="label">${g.label}</span></div>`).join('');
  nav.querySelectorAll('.nav-item').forEach((el) => el.addEventListener('click', () => {
    currentGroup = el.dataset.g;
    nav.querySelectorAll('.nav-item').forEach((x) => x.classList.toggle('active', x === el));
    renderGroup();
  }));

  if (Object.keys(allSettings).length === 0) {
    try { allSettings = await api.get('/settings') || {}; } catch (e) { toast(e.message, { type: 'error' }); allSettings = {}; }
  }
  renderGroup();
}

function renderGroup() {
  const body = document.getElementById('s-body');
  const group = allSettings[currentGroup] || {};
  const canWrite = hasPerm('settings.write');

  if (currentGroup === 'cloudflare') {
    body.innerHTML = `
      <div class="section-title">${icon('cloudflare', 18)} Cloudflare Credentials</div>
      <div class="muted" style="font-size:12px;margin-bottom:10px">Tokens are encrypted at rest in KV and never exposed to the browser. Add a token here, or set <span class="mono">CLOUDFLARE_API_TOKEN</span> secret in production.</div>
      ${hasPerm('cloudflare.write') ? '<button class="btn primary sm" id="add-cred">'+icon('plus',14)+' Add Token</button>' : ''}
      <div id="cred-list" style="margin-top:12px"></div>`;
    if (hasPerm('cloudflare.write')) body.querySelector('#add-cred').addEventListener('click', openCredForm);
    loadCredentials(body);
    return;
  }

  const fields = groupFields(currentGroup, group);
  body.innerHTML = `
    <div class="section-title">${icon('gear', 18)} ${GROUPS.find((g) => g.k === currentGroup).label}</div>
    <div id="s-form"></div>
    ${canWrite ? '<button class="btn primary mt-12" id="s-save">'+icon('save',14)+' Save</button>' : '<div class="muted mt-12">Read-only (no permission)</div>'}`;

  const form = body.querySelector('#s-form');
  form.innerHTML = fields.map((f) => fieldHtml(f)).join('');
  if (canWrite) body.querySelector('#s-save').addEventListener('click', () => saveGroup(fields, form));
}

function groupFields(group, data) {
  switch (group) {
    case 'general': return [
      { k: 'siteTitle', label: 'Site title', value: data.siteTitle ?? 'Nexus Panel', type: 'text' },
      { k: 'supportEmail', label: 'Support email', value: data.supportEmail ?? '', type: 'email' },
      { k: 'timezone', label: 'Timezone', value: data.timezone ?? 'UTC', type: 'text' },
      { k: 'maintenance', label: 'Maintenance mode', value: !!data.maintenance, type: 'checkbox' },
    ];
    case 'appearance': return [
      { k: 'theme', label: 'Default theme', value: data.theme ?? 'dark', type: 'select', options: [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']] },
      { k: 'accent', label: 'Accent color', value: data.accent ?? ACCENTS[0], type: 'color' },
      { k: 'language', label: 'Default language', value: data.language ?? 'en', type: 'select', options: [['en', 'English'], ['fa', 'فارسی']] },
      { k: 'density', label: 'Density', value: data.density ?? 'comfortable', type: 'select', options: [['comfortable', 'Comfortable'], ['compact', 'Compact']] },
    ];
    case 'security': return [
      { k: 'sessionTtl', label: 'Session TTL (hours)', value: data.sessionTtl ?? 24, type: 'number' },
      { k: 'passwordMin', label: 'Min password length', value: data.passwordMin ?? 8, type: 'number' },
      { k: 'maxLoginAttempts', label: 'Max login attempts', value: data.maxLoginAttempts ?? 5, type: 'number' },
      { k: 'enforceCsrf', label: 'Enforce CSRF', value: data.enforceCsrf ?? true, type: 'checkbox' },
      { k: 'rateLimit', label: 'Global rate limit (/min)', value: data.rateLimit ?? 120, type: 'number' },
    ];
    case 'api': return [
      { k: 'enableApiKeys', label: 'Enable API keys', value: data.enableApiKeys ?? true, type: 'checkbox' },
      { k: 'defaultRateLimit', label: 'Default key rate limit (/min)', value: data.defaultRateLimit ?? 120, type: 'number' },
      { k: 'requireScope', label: 'Require scopes', value: data.requireScope ?? true, type: 'checkbox' },
    ];
    case 'database': return [
      { k: 'backupEnabled', label: 'Scheduled backups', value: data.backupEnabled ?? true, type: 'checkbox' },
      { k: 'backupInterval', label: 'Backup interval (h)', value: data.backupInterval ?? 24, type: 'number' },
      { k: 'retentionDays', label: 'Log retention (days)', value: data.retentionDays ?? 90, type: 'number' },
    ];
    case 'notifications': return [
      { k: 'emailEnabled', label: 'Email notifications', value: data.emailEnabled ?? false, type: 'checkbox' },
      { k: 'slackWebhook', label: 'Slack webhook URL', value: data.slackWebhook ?? '', type: 'text' },
      { k: 'notifyOnError', label: 'Notify on errors', value: data.notifyOnError ?? true, type: 'checkbox' },
      { k: 'notifyOnAudit', label: 'Notify on audit events', value: data.notifyOnAudit ?? false, type: 'checkbox' },
    ];
    case 'domains': return [
      { k: 'autoSync', label: 'Auto-sync Cloudflare zones', value: data.autoSync ?? false, type: 'checkbox' },
      { k: 'syncInterval', label: 'Sync interval (h)', value: data.syncInterval ?? 12, type: 'number' },
      { k: 'defaultProxy', label: 'Default proxy state', value: data.defaultProxy ?? true, type: 'checkbox' },
    ];
    case 'subscriptions': return [
      { k: 'defaultTrafficLimit', label: 'Default traffic limit (bytes)', value: data.defaultTrafficLimit ?? 0, type: 'number' },
      { k: 'defaultDeviceLimit', label: 'Default device limit', value: data.defaultDeviceLimit ?? 5, type: 'number' },
      { k: 'defaultExpiration', label: 'Default expiration (days, 0=never)', value: data.defaultExpiration ?? 30, type: 'number' },
    ];
    case 'system': return [
      { k: 'environment', label: 'Environment', value: data.environment ?? 'production', type: 'text', readonly: true },
      { k: 'debug', label: 'Debug mode', value: data.debug ?? false, type: 'checkbox' },
      { k: 'demoMode', label: 'Demo / mock mode', value: data.demoMode ?? false, type: 'checkbox' },
    ];
    default: return [];
  }
}

function fieldHtml(f) {
  const id = 'sf-' + f.k;
  if (f.type === 'checkbox') {
    return `<label class="check" style="margin:10px 0"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''} ${f.readonly ? 'disabled' : ''}> ${escapeHtml(f.label)}</label>`;
  }
  if (f.type === 'select') {
    return `<div class="field"><label>${escapeHtml(f.label)}</label><select class="select" id="${id}" ${f.readonly ? 'disabled' : ''}>${f.options.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(f.value) === String(v) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></div>`;
  }
  if (f.type === 'color') {
    return `<div class="field"><label>${escapeHtml(f.label)}</label><div class="flex gap-8">${ACCENTS.map((c) => `<button class="accent-swatch" data-c="${c}" style="background:${c};width:28px;height:28px;border-radius:8px;border:2px solid ${String(f.value).toLowerCase() === c ? '#fff' : 'transparent'};cursor:pointer"></button>`).join('')}<input class="input" type="color" id="${id}" value="${escapeHtml(f.value)}" style="width:42px"></div></div>`;
  }
  return `<div class="field"><label>${escapeHtml(f.label)}</label><input class="input" id="${id}" type="${f.type}" value="${escapeHtml(String(f.value))}" ${f.readonly ? 'readonly' : ''}></div>`;
}

async function saveGroup(fields, form) {
  const payload = {};
  for (const f of fields) {
    const el = form.querySelector('#sf-' + f.k);
    if (!el) continue;
    if (f.type === 'checkbox') payload[f.k] = el.checked;
    else if (f.type === 'number') payload[f.k] = Number(el.value);
    else payload[f.k] = el.value;
  }
  try {
    await api.put(`/settings/${currentGroup}`, payload);
    allSettings[currentGroup] = { ...(allSettings[currentGroup] || {}), ...payload };
    toast('Settings saved', { type: 'ok' });
  } catch (e) { toast(e.message, { type: 'error' }); }
}

async function loadCredentials(body) {
  const list = body.querySelector('#cred-list');
  list.innerHTML = `<div class="skeleton" style="height:60px"></div>`;
  let creds = [];
  try { creds = await api.get('/settings/credentials') || []; } catch (e) { list.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; return; }
  if (!creds.length) { list.innerHTML = `<div class="empty"><div class="ico">🔐</div><h4>No credentials stored</h4></div>`; return; }
  const canWrite = hasPerm('cloudflare.write');
  list.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Label</th><th>Account</th><th>Token</th><th>Scope</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
    ${creds.map((c) => `<tr>
      <td><strong>${escapeHtml(c.label)}</strong></td>
      <td class="mono" style="font-size:12px">${escapeHtml(c.account_id || '—')}</td>
      <td class="mono">${escapeHtml(c.masked)}</td>
      <td>${(c.scope || []).map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join(' ') || '—'}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="muted" style="font-size:12px">${fmtAgo(c.updated_at)}</td>
      <td><div class="flex gap-8" style="justify-content:flex-end">
        ${canWrite ? `<button class="btn sm ghost" data-rot="${c.id}">${icon('refresh', 14)}</button>` : ''}
        ${canWrite ? `<button class="btn sm danger" data-del="${c.id}">${icon('trash', 14)}</button>` : ''}
      </div></td>
    </tr>`).join('')}
  </tbody></table></div>`;

  if (canWrite) {
    list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDelete('credential'))) return;
      try { await api.del(`/settings/credentials/${b.dataset.del}`); toast('Credential deleted', { type: 'ok' }); renderGroup(); }
      catch (e) { toast(e.message, { type: 'error' }); }
    }));
    list.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => openCredForm(b.dataset.rot)));
  }
}

function openCredForm(existingId) {
  formModal({
    title: existingId ? 'Rotate Token' : 'Add Cloudflare Token',
    schema: [
      { key: 'label', label: 'Label', value: 'Cloudflare Token' },
      { key: 'accountId', label: 'Account ID', placeholder: 'optional' },
      { key: 'tokenValue', label: 'API Token', type: 'password', required: true, hint: existingId ? 'enter new token' : 'min 10 chars' },
      { key: 'scope', label: 'Scopes (comma)', hint: 'e.g. zone:read,dns:edit' },
    ],
    onSubmit: async (data, close) => {
      const payload = { label: data.label, accountId: data.accountId, tokenValue: data.tokenValue, scope: String(data.scope || '').split(',').map((s) => s.trim()).filter(Boolean) };
      try {
        if (existingId) await api.post(`/settings/credentials/${existingId}/rotate`, { tokenValue: data.tokenValue });
        else await api.post('/settings/credentials', payload);
        toast('Credential saved', { type: 'ok' }); close(); renderGroup();
      } catch (e) { toast(e.message, { type: 'error' }); }
    },
  });
}

function statusBadge(s) {
  const map = { active: ['ok', 'active'], valid: ['ok', 'valid'], invalid: ['danger', 'invalid'], unknown: ['info', 'unknown'], error: ['danger', 'error'] };
  const [c, l] = map[s] || ['info', s || 'unknown'];
  return `<span class="badge ${c}">${l}</span>`;
}
