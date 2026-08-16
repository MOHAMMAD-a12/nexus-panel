// components/toast.js
let wrap = null;
function ensure() {
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  return wrap;
}

export function toast(message, { type = 'info', title, timeout = 4200 } = {}) {
  const icons = { ok: 'check', error: 'warn', warn: 'warn', info: 'info' };
  const w = ensure();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <div style="flex:1">
      ${title ? `<div class="t-title">${escapeHtml(title)}</div>` : ''}
      <div class="t-msg">${escapeHtml(message)}</div>
    </div>
    <div class="x" title="close">✕</div>`;
  el.querySelector('.x').onclick = () => el.remove();
  w.appendChild(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
