// pages/cloudflare.js — Cloudflare connection UI.
// SECURITY: the API token is submitted directly to the backend and NEVER echoed back
// to the client. The UI only shows status + a masked placeholder. The token is stored
// encrypted in the backend credential store (KV). It is never placed in HTML/JS/storage.
import { api } from '../core/api.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { escapeHtml } from '../core/ui.js';

function getLocale() { return window.__nexus_state?.locale || 'en'; }

export async function renderCloudflare() {
  const page = document.getElementById('page');
  const canWrite = hasPerm('cloudflare.write');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.cloudflare')}</h1><div class="page-sub">${getLocale() === 'fa' ? 'اتصال به کلادفلر (توکن فقط در سرور)' : 'Cloudflare connection (token stored backend-only)'}</div></div>
      <div class="flex gap-8">
        ${canWrite ? `<button class="btn ghost" id="btn-refresh">${icon('refresh', 16)} ${getLocale() === 'fa' ? 'بروزرسانی' : 'Refresh'}</button>` : ''}
        ${canWrite ? `<button class="btn primary" id="btn-test">${icon('shield', 16)} ${getLocale() === 'fa' ? 'تست اتصال' : 'Test'}</button>` : ''}
      </div>
    </div>
    <div class="card" id="cf-status"></div>
    ${canWrite ? `<div class="card" style="margin-top:16px"><div class="section-title">${icon('key', 16)} ${getLocale() === 'fa' ? 'تنظیمات اتصال' : 'Connection Settings'}</div><div id="cf-form"></div></div>` : ''}
    <div class="card" style="margin-top:16px">
      <div class="section-title">${icon('info', 16)} ${getLocale() === 'fa' ? 'یادداشت امنیتی' : 'Security note'}</div>
      <p class="muted" style="font-size:13px;line-height:1.7">${getLocale() === 'fa' ? 'توکن API کلادفلر هرگز به مرورگر ارسال نمی‌شود و فقط رمزنگاری‌شده در سرور نگهداری می‌گردد. پنل هیچ Runtime پروتکل را روی ورکر شبیه‌سازی نمی‌کند و فقط عملیات پشتیبانی‌شده توسط API کلادفلر را انجام می‌دهد.' : 'The Cloudflare API token is never sent to the browser and is stored encrypted server-side only. This panel does not simulate any protocol runtime on the Worker and only performs operations supported by the Cloudflare API.'}</p>
    </div>`;

  page.querySelector('#btn-refresh')?.addEventListener('click', refreshStatus);
  page.querySelector('#btn-test')?.addEventListener('click', testConnection);
  await refreshStatus();
  if (canWrite) renderForm();
}

async function refreshStatus() {
  const el = document.getElementById('cf-status');
  try {
    const conn = await api.get('/api/cloudflare/connection');
    const masked = conn.tokenPreview ? `<span class="mono">${escapeHtml(conn.tokenPreview)}</span>` : `<span class="muted">${getLocale() === 'fa' ? 'تنظیم نشده' : 'not set'}</span>`;
    const statusBadge = conn.connected ? '<span class="badge ok">connected</span>' : (conn.status ? `<span class="badge warn">${escapeHtml(conn.status)}</span>` : '<span class="badge warn">disconnected</span>');
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="lc-flag" style="width:40px;height:40px;background:var(--accent-soft);color:var(--accent)">${icon('cloudflare', 22)}</div>
        <div>
          <div style="font-weight:700">${getLocale() === 'fa' ? 'وضعیت اتصال' : 'Connection status'}</div>
          <div class="muted" style="font-size:12px">${statusBadge} · ${getLocale() === 'fa' ? 'توکن' : 'Token'}: ${masked}</div>
        </div>
      </div>
      ${conn.accountId ? `<div class="field" style="margin-top:12px"><label>Account</label><div class="mono">${escapeHtml(conn.accountId)}</div></div>` : ''}
      ${conn.zone ? `<div class="field"><label>Zone</label><div class="mono">${escapeHtml(conn.zone)}</div></div>` : ''}
      ${conn.domain ? `<div class="field"><label>Domain</label><div class="mono">${escapeHtml(conn.domain)}</div></div>` : ''}`;
  } catch (e) {
    el.innerHTML = `<div class="err-box">${escapeHtml(e.message || 'Failed to load status')}</div>`;
  }
}

function renderForm() {
  const wrap = document.getElementById('cf-form');
  wrap.innerHTML = `
    <div class="field"><label>Account ID</label><input class="input" id="cf-account" placeholder="Cloudflare account ID"></div>
    <div class="field"><label>API Token</label><input class="input" id="cf-token" type="password" placeholder="•••••••• (sent to server only, never returned)"></div>
    <div class="field"><label>Zone ID (optional)</label><input class="input" id="cf-zone" placeholder="optional"></div>
    <div class="field"><label>Domain (optional)</label><input class="input" id="cf-domain" placeholder="example.com"></div>
    <div class="flex gap-8" style="margin-top:8px">
      <button class="btn primary" id="cf-save">${icon('save', 14)} ${getLocale() === 'fa' ? 'ذخیره و تست' : 'Save & Test'}</button>
      <button class="btn ghost danger" id="cf-disconnect">${icon('power', 14)} ${getLocale() === 'fa' ? 'قطع اتصال' : 'Disconnect'}</button>
    </div>`;
  wrap.querySelector('#cf-save').addEventListener('click', saveConnection);
  wrap.querySelector('#cf-disconnect').addEventListener('click', disconnect);
}

async function testConnection() {
  const accountId = document.getElementById('cf-account')?.value?.trim();
  const token = document.getElementById('cf-token')?.value;
  const zone = document.getElementById('cf-zone')?.value?.trim() || null;
  const domain = document.getElementById('cf-domain')?.value?.trim() || null;
  if (!accountId || !token) {
    toast(getLocale() === 'fa' ? 'برای تست، Account ID و توکن را وارد کنید' : 'Enter Account ID and token to test', { type: 'error' });
    return;
  }
  try {
    const res = await api.post('/api/cloudflare/test', { accountId, tokenValue: token, zone, domain });
    toast(res.message || (getLocale() === 'fa' ? 'اتصال موفق' : 'Connection OK'), { type: 'ok' });
    refreshStatus();
  } catch (e) { toast(e.message || 'Test failed', { type: 'error' }); }
}

async function saveConnection() {
  const accountId = document.getElementById('cf-account')?.value?.trim();
  const token = document.getElementById('cf-token')?.value;
  const zone = document.getElementById('cf-zone')?.value?.trim() || null;
  const domain = document.getElementById('cf-domain')?.value?.trim() || null;
  if (!accountId || !token) { toast(getLocale() === 'fa' ? 'Account ID و توکن الزامی‌اند' : 'Account ID and token are required', { type: 'error' }); return; }
  try {
    await api.post('/api/cloudflare/save', { accountId, tokenValue: token, zone, domain });
    toast(getLocale() === 'fa' ? 'ذخیره شد' : 'Saved', { type: 'ok' });
    // clear token field to avoid lingering in DOM
    document.getElementById('cf-token').value = '';
    await refreshStatus();
  } catch (e) { toast(e.message || 'Save failed', { type: 'error' }); }
}

async function disconnect() {
  try {
    await api.post('/api/cloudflare/disconnect', {});
    toast(getLocale() === 'fa' ? 'اتصال قطع شد' : 'Disconnected', { type: 'ok' });
    await refreshStatus();
    const tk = document.getElementById('cf-token'); if (tk) tk.value = '';
  } catch (e) { toast(e.message, { type: 'error' }); }
}
