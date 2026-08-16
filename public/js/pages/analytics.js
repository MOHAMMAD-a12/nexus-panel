// pages/analytics.js — generation-focused analytics (from /api/dashboard)
import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { lineChart, donutChart, barChart } from '../components/charts.js';
import { fmtInt, escapeHtml } from '../core/ui.js';

function getLocale() { return window.__nexus_state?.locale || 'en'; }

export async function renderAnalytics() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.analytics')}</h1><div class="page-sub">${getLocale() === 'fa' ? 'تحلیل تولید کانفیگ' : 'Config-generation analytics'}</div></div>
    </div>
    <div id="gen-stats" class="gen-stats"></div>
    <div class="card-grid grid-2" style="margin-top:16px">
      <div class="card"><div class="section-title">${icon('bolt', 18)} ${getLocale() === 'fa' ? 'کانفیگ‌های تولید شده در زمان' : 'Configurations Generated Over Time'}</div><div id="gen-chart" class="chart"></div></div>
      <div class="card"><div class="section-title">${icon('cpu', 18)} ${getLocale() === 'fa' ? 'توزیع پروتکل' : 'Protocol Distribution'}</div><div id="proto-donut" class="chart chart-sm"></div></div>
    </div>
    <div class="card-grid grid-3" style="margin-top:16px">
      <div class="card"><div class="section-title">${icon('chart', 18)} ${getLocale() === 'fa' ? 'درخواست‌ها' : 'Requests'}</div><div id="req-chart" class="chart chart-sm"></div></div>
      <div class="card"><div class="section-title">${icon('heart', 18)} ${getLocale() === 'fa' ? 'سلامت نود' : 'Node Health'}</div><div id="health-chart" class="chart chart-sm"></div></div>
      <div class="card"><div class="section-title">${icon('clock', 18)} ${getLocale() === 'fa' ? 'انقضا' : 'Expirations'}</div><div id="exp-chart" class="chart chart-sm"></div></div>
    </div>`;

  let data;
  try { data = await api.get('/api/dashboard'); }
  catch (e) { toast(e.message, { type: 'error' }); return; }

  const gen = data.stats.generation || {};
  const cards = [
    { label: getLocale() === 'fa' ? 'امروز' : 'Today', v: gen.today, color: 'var(--accent)' },
    { label: getLocale() === 'fa' ? 'مجموع' : 'Total', v: gen.total, color: '#a855f7' },
    { label: 'VLESS', v: gen.vless, color: '#22c55e' },
    { label: 'VMess', v: gen.vmess, color: '#f97316' },
    { label: 'Trojan', v: gen.trojan, color: '#ef4444' },
    { label: 'Shadowsocks', v: gen.shadowsocks, color: '#3b82f6' },
    { label: getLocale() === 'fa' ? 'سایر' : 'Other', v: gen.other, color: '#6b7488' },
    { label: getLocale() === 'fa' ? 'الگوها' : 'Templates', v: gen.templates, color: '#14b8a6' },
  ];
  document.getElementById('gen-stats').innerHTML = cards.map((c) => `
    <div class="gen-stat">
      <div class="gs-label">${escapeHtml(c.label)}</div>
      <div class="gs-value" style="color:${c.color}">${fmtInt(c.v || 0)}</div>
    </div>`).join('');

  const labels = data.series.traffic.map((p) => shortDate(p.t));
  lineChart(document.getElementById('gen-chart'), { labels, series: [{ data: (data.series.configCreation || data.series.traffic).map((p) => p.v), color: 'var(--accent)' }] });
  donutChart(document.getElementById('proto-donut'), {
    segments: [
      { label: 'VLESS', value: gen.vless || 0, color: '#22c55e' },
      { label: 'VMess', value: gen.vmess || 0, color: '#f97316' },
      { label: 'Trojan', value: gen.trojan || 0, color: '#ef4444' },
      { label: 'Shadowsocks', value: gen.shadowsocks || 0, color: '#3b82f6' },
      { label: 'SOCKS5', value: gen.socks5 || 0, color: '#a855f7' },
      { label: getLocale() === 'fa' ? 'سایر' : 'Other', value: gen.other || 0, color: '#6b7488' },
    ].filter((s) => s.value > 0),
    size: 180, thickness: 24,
  });
  lineChart(document.getElementById('req-chart'), { labels, series: [{ data: data.series.requests.map((p) => p.v), color: '#a855f7' }] });
  lineChart(document.getElementById('health-chart'), { labels, series: [{ data: data.series.nodeHealth.map((p) => p.v), color: '#22c55e' }] });
  lineChart(document.getElementById('exp-chart'), { labels, series: [{ data: data.series.expiration.map((p) => p.v), color: '#f59e0b' }] });
}

function shortDate(ts) {
  const d = new Date((typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
