// components/commandPalette.js — Ctrl+K global search
import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import { escapeHtml } from './toast.js';
import { navigate } from '../core/router.js';

const SOURCES = [
  { key: 'nodes', label: 'Nodes', route: '#/nodes', search: (q) => api.get(`/nodes?search=${encodeURIComponent(q)}&pageSize=6`).then(r => (r.data || []).map(n => ({ id: n.id, title: n.name, sub: n.address, meta: n.status }))) },
  { key: 'domains', label: 'Domains', route: '#/domains', search: (q) => api.get(`/domains?search=${encodeURIComponent(q)}&pageSize=6`).then(r => (r.data || []).map(d => ({ id: d.id, title: d.domain, sub: d.status, meta: d.ssl_status }))) },
  { key: 'configs', label: 'Configs', route: '#/configs', search: (q) => api.get(`/configs?search=${encodeURIComponent(q)}&pageSize=6`).then(r => (r.data || []).map(c => ({ id: c.id, title: c.name, sub: c.protocol, meta: c.status }))) },
  { key: 'subscriptions', label: 'Subscriptions', route: '#/subscriptions', search: (q) => api.get(`/subscriptions?search=${encodeURIComponent(q)}&pageSize=6`).then(r => (r.data || []).map(s => ({ id: s.id, title: s.name, sub: s.owner, meta: s.status }))) },
  { key: 'users', label: 'Users', route: '#/users', search: (q) => api.get(`/users?search=${encodeURIComponent(q)}&pageSize=6`).then(r => (r.data || []).map(u => ({ id: u.id, title: u.email, sub: u.role_name, meta: u.status }))) },
  { key: 'logs', label: 'Logs', route: '#/logs', search: (q) => api.get(`/logs?search=${encodeURIComponent(q)}&pageSize=6`).then(r => (r.data || []).map(l => ({ id: l.id, title: l.action, sub: `${l.user_email || ''} · ${l.resource}`, meta: l.status }))) },
];

let paletteEl = null;
let inputEl = null;
let resultsEl = null;
let activeSource = 'all';
let lastQuery = '';
let flat = [];

function ensureDom() {
  if (paletteEl) return;
  paletteEl = document.createElement('div');
  paletteEl.className = 'cmd-backdrop';
  paletteEl.style.display = 'none';
  paletteEl.innerHTML = `
    <div class="cmd">
      <div class="cmd-input-wrap">
        ${icon('search', 20)}
        <input class="cmd-input" type="text" placeholder="Search nodes, domains, configs, users, logs…">
        <kbd class="cmd-kbd">ESC</kbd>
      </div>
      <div class="cmd-tabs">
        ${['all', ...SOURCES.map(s => s.key)].map(k => `<button class="cmd-tab${k === 'all' ? ' active' : ''}" data-src="${k}">${k === 'all' ? 'All' : SOURCES.find(s => s.key === k).label}</button>`).join('')}
      </div>
      <div class="cmd-results" data-results></div>
      <div class="cmd-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>`;
  document.body.appendChild(paletteEl);
  inputEl = paletteEl.querySelector('.cmd-input');
  resultsEl = paletteEl.querySelector('[data-results]');

  paletteEl.addEventListener('click', (e) => { if (e.target === paletteEl) close(); });
  inputEl.addEventListener('input', () => runSearch(inputEl.value));
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); openActive(); }
    else if (e.key === 'Escape') { close(); }
  });
  paletteEl.querySelectorAll('.cmd-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      paletteEl.querySelectorAll('.cmd-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeSource = tab.dataset.src;
      runSearch(lastQuery);
    });
  });
}

async function runSearch(q) {
  lastQuery = q || '';
  const query = (q || '').trim();
  resultsEl.innerHTML = `<div class="cmd-loading">Searching…</div>`;
  try {
    let groups = SOURCES;
    if (activeSource !== 'all') groups = SOURCES.filter(s => s.key === activeSource);
    const results = await Promise.all(groups.map(async (s) => {
      if (!query) return { source: s, items: [] };
      try { return { source: s, items: await s.search(query) }; }
      catch { return { source: s, items: [] }; }
    }));
    flat = [];
    let html = '';
    results.forEach(({ source, items }) => {
      if (!items.length) return;
      html += `<div class="cmd-group">${escapeHtml(source.label)}</div>`;
      items.forEach((it) => {
        const idx = flat.length;
        flat.push({ source, it });
        html += `<div class="cmd-item" data-idx="${idx}">
          <div class="cmd-ico">${icon(source.key === 'logs' ? 'logs' : source.key === 'users' ? 'users' : source.key === 'domains' ? 'domains' : 'nodes', 16)}</div>
          <div class="cmd-text"><div class="cmd-title">${escapeHtml(it.title)}</div><div class="cmd-sub">${escapeHtml(it.sub || '')}</div></div>
          <div class="cmd-meta">${escapeHtml(String(it.meta || ''))}</div>
        </div>`;
      });
    });
    resultsEl.innerHTML = html || `<div class="cmd-empty">No results for “${escapeHtml(query)}”</div>`;
    resultsEl.querySelectorAll('.cmd-item').forEach((node) => {
      node.addEventListener('click', () => openIndex(+node.dataset.idx));
      node.addEventListener('mousemove', () => setActive(+node.dataset.idx));
    });
    setActive(0);
  } catch (e) {
    resultsEl.innerHTML = `<div class="cmd-empty">${escapeHtml(e.message || 'Search failed')}</div>`;
  }
}

function move(dir) {
  if (!flat.length) return;
  const cur = flat.findIndex(f => f._active);
  let next = cur + dir;
  if (next < 0) next = 0;
  if (next >= flat.length) next = flat.length - 1;
  setActive(next);
}
function setActive(idx) {
  flat.forEach((f, i) => { f._active = i === idx; });
  resultsEl.querySelectorAll('.cmd-item').forEach((n, i) => n.classList.toggle('active', i === idx));
  const active = resultsEl.querySelector('.cmd-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}
function openActive() { openIndex(flat.findIndex(f => f._active)); }
function openIndex(idx) {
  const entry = flat[idx];
  if (!entry) return;
  const src = entry.source;
  if (src.key === 'logs') navigate(src.route);
  else navigate(`${src.route}/${entry.it.id}`);
  close();
}

export function openPalette() {
  ensureDom();
  paletteEl.style.display = 'flex';
  inputEl.value = '';
  lastQuery = '';
  activeSource = 'all';
  paletteEl.querySelectorAll('.cmd-tab').forEach(t => t.classList.toggle('active', t.dataset.src === 'all'));
  runSearch('');
  setTimeout(() => inputEl.focus(), 20);
}
export function closePalette() { close(); }
function close() { if (paletteEl) paletteEl.style.display = 'none'; }

export function initCommandPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
  });
}
