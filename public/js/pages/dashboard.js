// pages/dashboard.js
import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { lineChart, donutChart, barChart } from '../components/charts.js';
import { fmtBytes, fmtInt, fmtAgo, statusBadge, dot, escapeHtml } from '../core/ui.js';

const statCards = [
  { key: 'today', label: 'Generated Today', icon: 'bolt', color: 'var(--accent)' },
  { key: 'total', label: 'Total Generated', icon: 'link', color: '#a855f7' },
  { key: 'vless', label: 'VLESS', icon: 'cpu', color: '#22c55e' },
  { key: 'templates', label: 'Templates', icon: 'tag', color: '#14b8a6' },
];

export async function renderDashboard() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.dashboard')}</h1><div class="page-sub">${getLocale() === 'fa' ? 'مرکز تولید کانفیگ شبکه' : 'Network configuration generation hub'}</div></div>
      <div class="flex gap-8">
        <button class="btn primary" id="go-gen">${icon('bolt', 16)} ${t('nav.generator')}</button>
      </div>
    </div>
    <div class="card-grid grid-4" id="stats"></div>
    <div class="card-grid grid-2" style="margin-top:16px">
      <div class="card"><div class="section-title">${icon('bolt', 18)} ${getLocale() === 'fa' ? 'کانفیگ‌های تولید شده در زمان' : 'Configurations Generated Over Time'}</div><div id="traffic-chart" class="chart"></div></div>
      <div class="card"><div class="section-title">${icon('heart', 18)} Node Health</div><div id="health-chart" class="chart"></div></div>
    </div>
    <div class="card-grid grid-3" style="margin-top:16px">
      <div class="card"><div class="section-title">${icon('bolt', 18)} Requests</div><div id="req-chart" class="chart chart-sm"></div></div>
      <div class="card"><div class="section-title">${icon('cpu', 18)} ${getLocale() === 'fa' ? 'توزیع پروتکل' : 'Protocol Mix'}</div><div id="conf-donut" class="chart chart-sm"></div></div>
      <div class="card"><div class="section-title">${icon('globe', 18)} System</div><div id="system" class="kv"></div></div>
    </div>
    <div class="card-grid grid-2" style="margin-top:16px">
      <div class="card"><div class="section-title">${icon('clock', 18)} Recent Activity</div><div id="activity"></div></div>
      <div class="card"><div class="section-title">${icon('bell', 18)} Notifications</div><div id="notifs"></div></div>
    </div>`;

  page.querySelector('#go-gen')?.addEventListener('click', () => { window.location.hash = '#/generator'; });

  try {
    const data = await api.get('/api/dashboard');
    const s = data.stats;
    const gen = s.generation || {};

    // Generation-focused stats
    document.getElementById('stats').innerHTML = statCards.map((c) => {
      const value = gen[c.key] ?? 0;
      return `<div class="card stat">
        <div class="top"><div class="label">${getLocale() === 'fa' ? (c.label === 'Generated Today' ? 'امروز تولید شده' : c.label === 'Total Generated' ? 'مجموع تولید' : c.label === 'Templates' ? 'الگوها' : c.label) : c.label}</div><div class="icon" style="color:${c.color};background:${c.color}22">${icon(c.icon, 20)}</div></div>
        <div class="value">${fmtInt(value)}</div>
        <div class="muted" style="font-size:12px">${c.key === 'today' ? (getLocale() === 'fa' ? 'در ۲۴ ساعت گذشته' : 'in last 24h') : c.key === 'total' ? `${fmtInt(gen.vless || 0)} VLESS · ${fmtInt(gen.vmess || 0)} VMess` : (getLocale() === 'fa' ? 'آماده استفاده' : 'ready to use')}</div>
      </div>`;
    }).join('');

    // Charts
    const labels = data.series.traffic.map((p) => shortDate(p.t));
    lineChart(document.getElementById('traffic-chart'), { labels, series: [{ data: (data.series.configCreation || data.series.traffic).map((p) => p.v), color: 'var(--accent)' }] });
    lineChart(document.getElementById('health-chart'), { labels, series: [{ data: data.series.nodeHealth.map((p) => p.v), color: '#22c55e' }] });
    lineChart(document.getElementById('req-chart'), { labels, series: [{ data: data.series.requests.map((p) => p.v), color: '#a855f7' }] });

    const conf = s.configs || {};
    donutChart(document.getElementById('conf-donut'), {
      segments: [
        { label: 'VLESS', value: gen.vless || 0, color: '#22c55e' },
        { label: 'VMess', value: gen.vmess || 0, color: '#f97316' },
        { label: 'Trojan', value: gen.trojan || 0, color: '#ef4444' },
        { label: 'Shadowsocks', value: gen.shadowsocks || 0, color: '#3b82f6' },
        { label: 'SOCKS5', value: gen.socks5 || 0, color: '#a855f7' },
        { label: getLocale() === 'fa' ? 'سایر' : 'Other', value: gen.other || 0, color: '#6b7488' },
      ].filter((x) => x.value > 0),
      size: 160, thickness: 22,
    });

    // System
    const sys = data.system;
    document.getElementById('system').innerHTML = `
      <div class="k">Environment</div><div class="v">${escapeHtml(sys.environment)}</div>
      <div class="k">Cloudflare</div><div class="v">${statusBadge(sys.cloudflare === 'configured' ? 'active' : sys.cloudflare === 'demo' ? 'warning' : 'pending').replace('badge ', 'badge info')}</div>
      <div class="k">Worker</div><div class="v">${dot('online')} ${escapeHtml(sys.worker)}</div>
      <div class="k">Traffic</div><div class="v">${fmtBytes(s.traffic?.total || 0)}</div>
      <div class="k">Users</div><div class="v">${fmtInt(s.users)}</div>`;

    // Activity
    document.getElementById('activity').innerHTML = (data.activity || []).slice(0, 10).map((a) => `
      <div style="display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
        <div class="status-dot ${a.status === 'success' ? 'online' : a.status === 'failure' ? 'offline' : 'warning'}"></div>
        <div style="flex:1"><div style="font-weight:600;font-size:13px">${escapeHtml(a.action)}</div><div class="muted" style="font-size:11px">${escapeHtml(a.username || a.resource || '')} · ${fmtAgo(a.created_at)}</div></div>
      </div>`).join('') || emptyMsg();

    // Notifications
    document.getElementById('notifs').innerHTML = (data.notifications || []).slice(0, 8).map((n) => `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <div class="ni-ico ${n.level || 'info'}">${icon(n.level === 'warning' ? 'warn' : 'bell', 18)}</div>
        <div style="flex:1"><div class="nt">${escapeHtml(n.title)}</div><div class="nm">${escapeHtml(n.message || '')}</div></div>
      </div>`).join('') || emptyMsg();
  } catch (e) {
    page.querySelector('.card-grid').innerHTML = `<div class="card error-box">${escapeHtml(e.message)}</div>`;
  }
}

function shortDate(ts) {
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function getLocale() { return window.__nexus_state?.locale || 'en'; }
function fmtAgoServer() { return getLocale() === 'fa' ? 'مرکز کنترل زیرساخت شبکه' : 'Real-time overview of your network infrastructure'; }
function emptyMsg() { return `<div class="muted" style="padding:16px;text-align:center">${t('common.empty')}</div>`; }
