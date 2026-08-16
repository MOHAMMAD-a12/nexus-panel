// core/ui.js — shared rendering helpers for pages
import { icon } from './icons.js';
import { escapeHtml } from '../components/toast.js';
import { t } from './i18n.js';
import { openModal, confirmDialog } from '../components/modal.js';

export function statusBadge(status) {
  if (!status) return '';
  const map = {
    online: ['ok', '🟢'], offline: ['danger', '🔴'], warning: ['warn', '🟡'],
    active: ['ok', '✓'], disabled: ['warn', '⏸'], expired: ['danger', '⌛'],
    pending: ['info', '…'], verified: ['ok', '✓'], revoked: ['danger', '✕'],
    dns_error: ['danger', 'DNS'], ssl_error: ['danger', 'SSL'],
  };
  const [cls, ico] = map[status] || ['info', '●'];
  return `<span class="badge ${cls}">${ico} ${escapeHtml(status.replace(/_/g, ' '))}</span>`;
}

export function dot(status) {
  const s = (status || '').replace(/_/g, '');
  const cls = ['online', 'ok', 'active', 'verified'].includes(s) ? 'online'
    : ['offline', 'danger', 'expired', 'revoked', 'dns_error', 'ssl_error'].includes(s) ? 'offline'
    : ['warning', 'warn', 'disabled', 'pending'].includes(s) ? 'warning' : 'pending';
  return `<span class="status-dot ${cls}"></span>`;
}

export function fmtBytes(n) {
  if (n == null) return '—';
  n = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
}

export function fmtInt(n) { return (Number(n) || 0).toLocaleString(); }

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  if (isNaN(d)) return '—';
  return d.toLocaleString();
}

export function fmtAgo(ts) {
  if (!ts) return 'never';
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

export function relativeExpiry(ts) {
  if (!ts) return { text: 'never', cls: '' };
  const d = new Date(ts * 1000);
  const diff = (d - Date.now()) / 1000;
  if (diff < 0) return { text: 'expired', cls: 'danger' };
  if (diff < 86400 * 7) return { text: Math.floor(diff / 86400) + 'd left', cls: 'warn' };
  return { text: Math.floor(diff / 86400) + 'd left', cls: 'ok' };
}

export function tagList(tags) {
  if (!tags || !tags.length) return '<span class="muted">—</span>';
  const arr = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',') : []);
  return arr.map((x) => `<span class="tag">${escapeHtml(String(x))}</span>`).join('');
}

export function permName(role) {
  return { role_admin: t('role.admin'), role_operator: t('role.operator'), role_viewer: t('role.viewer') }[role] || role;
}

export function copyToClipboard(text, msg = 'Copied to clipboard') {
  const { toast } = window.__nexus || {};
  const done = () => { if (toast) toast(msg, { type: 'ok' }); };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch {}
  document.body.removeChild(ta);
}

// Build a form modal from a schema: [{key,label,type,required,options,placeholder,value,hint}]
export function formModal({ title, schema, value = {}, submitText = t('action.save'), onSubmit }) {
  const body = document.createElement('div');
  body.innerHTML = schema.map((f) => {
    const v = value[f.key] != null ? value[f.key] : (f.value != null ? f.value : '');
    if (f.type === 'select') {
      const opts = f.options.map((o) => `<option value="${escapeHtml(String(o.v ?? o))}" ${String(v) === String(o.v ?? o) ? 'selected' : ''}>${escapeHtml(o.l ?? o)}</option>`).join('');
      return `<div class="field"><label>${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><select class="select" data-field="${f.key}">${opts}</select>${f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : ''}</div>`;
    }
    if (f.type === 'checkbox') {
      return `<div class="field"><label class="check"><input type="checkbox" data-field="${f.key}" ${v ? 'checked' : ''}> ${escapeHtml(f.label)}</label></div>`;
    }
    const type = f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text';
    const step = f.type === 'number' ? 'step="any"' : '';
    return `<div class="field"><label>${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><input class="input" type="${type}" data-field="${f.key}" value="${escapeHtml(String(v))}" placeholder="${escapeHtml(f.placeholder || '')}" ${step}>${f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : ''}</div>`;
  }).join('');

  const foot = document.createElement('div');
  foot.innerHTML = `<button class="btn ghost" data-cancel>${t('action.cancel')}</button><button class="btn primary" data-submit>${submitText}</button>`;

  const m = openModal({ title: icon('edit', 18) + ' ' + title, body, footer: foot, size: 'lg', onOpen: ({ close }) => {
    foot.querySelector('[data-cancel]').onclick = close;
    foot.querySelector('[data-submit]').onclick = () => {
      const data = {};
      let ok = true;
      body.querySelectorAll('[data-field]').forEach((el) => {
        const k = el.dataset.field;
        if (el.type === 'checkbox') data[k] = el.checked;
        else if (el.type === 'number') data[k] = el.value === '' ? null : Number(el.value);
        else data[k] = el.value;
      });
      // required check
      for (const f of schema) {
        if (f.required && !data[f.key] && data[f.key] !== 0 && data[f.key] !== false) {
          const el = body.querySelector(`[data-field="${f.key}"]`);
          if (el) { el.classList.add('invalid'); }
          ok = false;
        }
      }
      if (!ok) return;
      Promise.resolve(onSubmit(data, close)).catch((e) => {
        toast(e.message || 'Error', { type: 'error' });
      });
    };
  }});
  return m;
}

export function confirmDelete(name) {
  return confirmDialog({
    title: t('action.delete') + '?',
    message: t('common.confirm_delete') + (name ? `\n\n“${name}”` : ''),
    danger: true,
    confirmText: t('action.delete'),
  });
}

export { icon, escapeHtml, t };
