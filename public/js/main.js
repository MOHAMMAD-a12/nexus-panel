// main.js — application bootstrap
import { api } from './core/api.js';
import { getState, setUser, setState, subscribe } from './core/store.js';
import { applyTheme, setLocale, toggleSidebar, showSidebar } from './core/theme.js';
import { register, setNotFound, navigate, startRouter } from './core/router.js';
import { t } from './core/i18n.js';
import { icon } from './core/icons.js';
import { toast } from './components/toast.js';
import { openPalette, initCommandPalette } from './components/commandPalette.js';

import { renderDashboard } from './pages/dashboard.js';
import { renderNodes } from './pages/nodes.js';
import { renderDomains } from './pages/domains.js';
import { renderConfigs } from './pages/configs.js';
import { renderGenerator } from './pages/generator.js';
import { renderProtocols } from './pages/protocols.js';
import { renderTemplates } from './pages/templates.js';
import { renderEndpoints } from './pages/endpoints.js';
import { renderGenerated } from './pages/generated.js';
import { renderCloudflare } from './pages/cloudflare.js';
import { renderAnalytics } from './pages/analytics.js';
import { renderSubscriptions } from './pages/subscriptions.js';
import { renderUsers } from './pages/users.js';
import { renderApiKeys } from './pages/apikeys.js';
import { renderLogs } from './pages/logs.js';
import { renderSettings } from './pages/settings.js';

window.__nexus = { onUnauthenticated: () => showLogin(true) };

const NAV = [
  { section: t('nav.management'), items: [
    { route: 'dashboard', icon: 'dashboard', label: t('nav.dashboard'), perm: 'dashboard.read' },
  ]},
  { section: t('nav.generation'), items: [
    { route: 'generator', icon: 'bolt', label: t('nav.generator'), perm: 'configs.write' },
    { route: 'templates', icon: 'tag', label: t('nav.templates'), perm: 'configs.read' },
    { route: 'endpoints', icon: 'globe', label: t('nav.endpoints'), perm: 'configs.read' },
    { route: 'generated', icon: 'link', label: t('nav.generated'), perm: 'configs.read' },
    { route: 'protocols', icon: 'cpu', label: t('nav.protocols'), perm: 'configs.read' },
    { route: 'cloudflare', icon: 'cloudflare', label: t('nav.cloudflare'), perm: 'cloudflare.read' },
    { route: 'analytics', icon: 'chart', label: t('nav.analytics'), perm: 'dashboard.read' },
  ]},
  { section: t('nav.management'), items: [
    { route: 'nodes', icon: 'nodes', label: t('nav.nodes'), perm: 'nodes.read' },
    { route: 'domains', icon: 'domains', label: t('nav.domains'), perm: 'domains.read' },
    { route: 'configs', icon: 'configs', label: t('nav.configs'), perm: 'configs.read' },
    { route: 'subscriptions', icon: 'subscriptions', label: t('nav.subscriptions'), perm: 'subscriptions.read' },
  ]},
  { section: t('nav.system'), items: [
    { route: 'users', icon: 'users', label: t('nav.users'), perm: 'users.read' },
    { route: 'apikeys', icon: 'apikeys', label: t('nav.apikeys'), perm: 'apikeys.read' },
    { route: 'logs', icon: 'logs', label: t('nav.logs'), perm: 'logs.read' },
    { route: 'settings', icon: 'settings', label: t('nav.settings'), perm: 'settings.read' },
  ]},
];

function hasPerm(p) {
  const perms = getState().permissions;
  if (!perms || !perms.length) return false;
  if (perms.includes('*')) return true;
  if (perms.includes(p)) return true;
  const [cat] = p.split('.');
  return perms.includes(`${cat}.*`) || perms.includes(`${cat}.read`);
}

async function boot() {
  applyTheme();
  initCommandPalette();
  try {
    const me = await api.get('/api/auth/me');
    setUser(me);
    await enterApp();
    // enterApp reuses #boot as the app container; only remove the loader
    // if it still exists (it won't after enterApp clears its id).
    document.getElementById('boot')?.remove();
  } catch (e) {
    // 401 (no session) is expected on first visit → show login.
    // Do NOT remove #boot here: showLogin renders into it.
    showLogin();
  }
}

function showLogin(expired) {
  const root = document.getElementById('boot') || document.body;
  root.id = 'boot';
  // Clear the inline loader styles so the auth-wrap can fill the viewport.
  root.removeAttribute('style');
  root.innerHTML = `
    <div class="auth-wrap" style="position:fixed;inset:0">
      <div class="auth-left">
        <div class="blob b1"></div><div class="blob b2"></div>
        <div style="position:relative;z-index:1">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
            <div class="auth-logo" style="margin:0">N</div>
            <div><div style="font-weight:800;font-size:20px">Nexus Panel</div><div style="opacity:.8;font-size:13px">Network Control Plane</div></div>
          </div>
          <h1 style="font-size:30px;margin:0 0 12px">${t('login.subtitle')}</h1>
          <p style="opacity:.85;max-width:360px">${t('login.demo_hint')}</p>
        </div>
      </div>
      <div class="auth-right">
        <div class="auth-card">
          <div class="auth-logo">N</div>
          <h2 style="margin:0 0 4px">${t('login.title')}</h2>
          ${expired ? `<div class="alert error">${t('common.error')} — session expired.</div>` : ''}
          <form id="login-form">
            <div class="field"><label>${t('login.email')}</label><input class="input" name="email" autocomplete="username" placeholder="admin@nexus.local"></div>
            <div class="field"><label>${t('login.password')}</label><input class="input" name="password" type="password" autocomplete="current-password" placeholder="••••••••"></div>
            <button class="btn primary" type="submit" style="width:100%;margin-top:6px" id="login-btn">${t('login.submit')}</button>
          </form>
          <div style="margin-top:16px;display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text-3)">
            <button class="btn sm ghost" id="locale-toggle">${getState().locale === 'fa' ? 'EN' : 'فا'}</button>
            <span>${getState().locale === 'fa' ? 'زبان' : 'Language'}</span>
          </div>
        </div>
      </div>
    </div>`;
  root.querySelector('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin(new FormData(e.target).get('email'), new FormData(e.target).get('password'));
  });
  root.querySelector('#locale-toggle').addEventListener('click', () => {
    setLocale(getState().locale === 'fa' ? 'en' : 'fa');
    showLogin(expired);
  });
}

async function doLogin(email, password) {
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await api.post('/api/auth/login', { email, password }, { raw: true });
    if (!res.ok) throw new Error(res.error?.message || 'Login failed');
    setUser(res.data);
    // csrf cookie set by server; continue
    await enterApp();
  } catch (e) {
    btn.disabled = false; btn.textContent = t('login.submit');
    toast(e.message || 'Login failed', { type: 'error' });
  }
}

async function enterApp() {
  const existing = document.querySelector('.auth-wrap');
  if (existing) existing.remove();
  const root = document.getElementById('boot') || document.body;
  root.id = '';
  root.innerHTML = `
    <div class="app sidebar-hidden" id="app">
      <aside class="sidebar">
        <div class="brand"><div class="logo">N</div><div><div class="name">Nexus Panel</div><div class="sub">Control Plane</div></div></div>
        <nav class="nav" id="nav"></nav>
        <div class="sidebar-footer"></div>
      </aside>
      <div class="drawer-backdrop" id="drawer"></div>
      <main class="main">
        <header class="header">
          <button class="icon-btn hamburger" id="hamburger">${icon('menu', 20)}</button>
          <div class="search-box" id="hdr-search">${icon('search', 18)}<input placeholder="${t('action.search')}…" readonly><span class="kbd">Ctrl K</span></div>
          <div class="spacer"></div>
          <button class="icon-btn" id="theme-toggle" title="Theme">${icon('sun', 20)}</button>
          <button class="icon-btn" id="notif-btn" title="Notifications">${icon('bell', 20)}<span class="dot" id="notif-dot" style="display:none"></span></button>
          <div class="profile" id="profile">
            <div class="avatar" id="avatar">A</div>
            <div class="meta"><div class="n" id="prof-name">Admin</div><div class="r" id="prof-role">Administrator</div></div>
          </div>
        </header>
        <div class="content"><div class="page" id="page"></div></div>
      </main>
    </div>`;
  renderNav();
  wireHeader();
  startRouter();
  loadNotifications();
  // re-render nav if locale changes
  subscribe(() => {});
  window.addEventListener('nexus:locale', renderNav);
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.innerHTML = NAV.flatMap((g) => {
    const items = g.items.filter((i) => hasPerm(i.perm));
    if (!items.length) return [];
    return [`<div class="nav-group">${escapeHtml(g.section)}</div>`,
      ...items.map((i) => `<div class="nav-item" data-route="${i.route}">${icon(i.icon, 20)}<span class="label">${escapeHtml(i.label)}</span></div>`)];
  }).join('');
  nav.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      navigate(el.dataset.route);
      if (window.matchMedia('(max-width:860px)').matches) showSidebar(false);
    });
  });
}

function wireHeader() {
  const u = getState().user;
  document.getElementById('avatar').textContent = (u?.displayName || u?.username || 'A')[0]?.toUpperCase();
  document.getElementById('prof-name').textContent = u?.displayName || u?.username || 'Admin';
  const roleMap = { role_admin: 'Administrator', role_operator: 'Operator', role_viewer: 'Viewer' };
  document.getElementById('prof-role').textContent = roleMap[u?.roleId] || u?.roleId || '';

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = getState().theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark';
    applyTheme();
    // simpler: cycle via store
    cycleTheme();
  });
  document.getElementById('hamburger').addEventListener('click', () => {
    const app = document.getElementById('app');
    const hidden = app.classList.toggle('sidebar-hidden');
    document.getElementById('drawer').classList.toggle('open', !hidden);
  });
  document.getElementById('drawer').addEventListener('click', () => showSidebar(false));
  document.getElementById('hdr-search').addEventListener('click', () => openPalette());
  document.getElementById('notif-btn').addEventListener('click', openNotifications);
  document.getElementById('profile').addEventListener('click', () => navigate('settings'));
}

function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const cur = getState().theme;
  const next = order[(order.indexOf(cur) + 1) % order.length];
  localStorage.setItem('nexus_theme', next);
  setState({ theme: next });
  applyTheme();
  const ico = next === 'dark' ? 'moon' : next === 'light' ? 'sun' : 'sun';
  document.getElementById('theme-toggle').innerHTML = icon(ico, 20);
}

async function loadNotifications() {
  try {
    const data = await api.get('/api/notifications?limit=20');
    const dot = document.getElementById('notif-dot');
    if (dot) dot.style.display = data.unread > 0 ? 'block' : 'none';
    setState({ notifications: { items: data.items, unread: data.unread } });
  } catch {}
}

function openNotifications() {
  const data = getState().notifications;
  const items = data.items || [];
  const body = document.createElement('div');
  if (!items.length) body.innerHTML = `<div class="empty"><div class="ico">🔔</div><h4>No notifications</h4></div>`;
  else body.innerHTML = items.map((n) => `
    <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
      <div class="ni-ico ${n.level || 'info'}">${icon(n.level === 'warning' ? 'warn' : n.level === 'critical' ? 'close' : 'bell', 18)}</div>
      <div style="flex:1"><div class="nt">${escapeHtml(n.title)}</div><div class="nm">${escapeHtml(n.message || '')} · ${fmtTime(n.created_at)}</div></div>
      <div class="nx" data-read="${n.id}" title="Mark read">✕</div>
    </div>`).join('') + `<div style="text-align:center;margin-top:8px"><button class="btn sm ghost" id="notif-readall">Mark all read</button></div>`;

  const m = openModal({ title: icon('bell', 18) + ' Notifications', body, size: 'lg', onOpen: ({ close }) => {
    body.querySelectorAll('[data-read]').forEach((el) => el.addEventListener('click', async () => {
      try { await api.post(`/api/notifications/${el.dataset.read}/read`); loadNotifications(); el.closest('.notif-item')?.classList.remove('unread'); }
      catch (e) { toast(e.message, { type: 'error' }); }
    }));
    body.querySelector('#notif-readall')?.addEventListener('click', async () => {
      try { await api.post('/api/notifications/read-all'); loadNotifications(); m.close(); } catch (e) { toast(e.message, { type: 'error' }); }
    });
  }});
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleString();
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Routes
register('dashboard', renderDashboard);
register('generator', renderGenerator);
register('protocols', renderProtocols);
register('templates', renderTemplates);
register('endpoints', renderEndpoints);
register('generated', renderGenerated);
register('cloudflare', renderCloudflare);
register('analytics', renderAnalytics);
register('nodes', renderNodes);
register('domains', renderDomains);
register('configs', renderConfigs);
register('subscriptions', renderSubscriptions);
register('users', renderUsers);
register('apikeys', renderApiKeys);
register('logs', renderLogs);
register('settings', renderSettings);
setNotFound((r) => {
  document.getElementById('page').innerHTML = `<div class="card"><div class="empty"><div class="ico">🧭</div><h4>Page not found</h4><p class="muted">${escapeHtml(r.raw)}</p></div></div>`;
});

boot();
