// pages/endpoints.js — location builder cards + CRUD
import { api } from '../core/api.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { escapeHtml, formModal, confirmDelete, statusBadge } from '../core/ui.js';

const COUNTRIES = {
  DE: 'Germany', FR: 'France', NL: 'Netherlands', TR: 'Turkey', SG: 'Singapore', US: 'United States',
  GB: 'United Kingdom', JP: 'Japan', CA: 'Canada', AU: 'Australia', RU: 'Russia', BR: 'Brazil',
};

function getLocale() { return window.__nexus_state?.locale || 'en'; }

export async function renderEndpoints() {
  const page = document.getElementById('page');
  const canWrite = hasPerm('configs.write');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.endpoints')}</h1><div class="page-sub">${getLocale() === 'fa' ? 'موقعیت‌های پیکربندی شده به عنوان سرور کانفیگ' : 'Managed locations used as config servers'}</div></div>
      <div class="flex gap-8">
        <button class="btn primary" id="add-ep" style="${canWrite ? '' : 'display:none'}">${icon('plus', 16)} ${t('action.add')}</button>
      </div>
    </div>
    <div class="field" style="max-width:320px;margin-bottom:14px">
      <select class="select" id="ep-filter"><option value="">${getLocale() === 'fa' ? 'همه کشورها' : 'All countries'}</option>${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}">${k} · ${v}</option>`).join('')}</select>
    </div>
    <div id="ep-grid" class="loc-grid"></div>`;

  page.querySelector('#add-ep')?.addEventListener('click', () => openForm());
  page.querySelector('#ep-filter')?.addEventListener('change', (e) => load(e.target.value));

  await load('');
}

async function load(country) {
  const grid = document.getElementById('ep-grid');
  let data = [];
  try {
    const qs = country ? `?country=${encodeURIComponent(country)}` : '?pageSize=200';
    data = await api.list(`/endpoints${qs}`);
    data = data.data || [];
  } catch (e) { toast(e.message, { type: 'error' }); }

  const canWrite = hasPerm('configs.write');
  grid.innerHTML = data.map((e) => `
    <div class="loc-card">
      <div class="lc-top">
        <div class="lc-flag">${escapeHtml(e.country || '—')}</div>
        <div>
          <div class="lc-name">${escapeHtml(e.name)}</div>
          <div class="lc-sub">${escapeHtml(e.countryName || '')}${e.city ? ' · ' + escapeHtml(e.city) : ''}</div>
        </div>
      </div>
      <div class="lc-meta">
        ${e.host ? `<span class="tag mono">${escapeHtml(e.host)}</span>` : ''}
        ${e.domain ? `<span class="tag mono">${escapeHtml(e.domain)}</span>` : ''}
        ${e.port ? `<span class="tag">:${escapeHtml(String(e.port))}</span>` : ''}
        ${e.provider ? `<span class="tag">${escapeHtml(e.provider)}</span>` : ''}
        ${e.tls ? '<span class="badge ok">TLS</span>' : ''}
        ${statusBadge(e.status)}
      </div>
      <div class="lc-actions">
        ${canWrite ? `<button class="btn sm ghost" data-edit="${e.id}">${icon('edit', 14)}</button>
        <button class="btn sm ghost" data-use="${escapeHtml(e.id)}">${icon('bolt', 14)}</button>
        <button class="btn sm danger" data-del="${e.id}">${icon('trash', 14)}</button>` : `<button class="btn sm ghost" data-use="${escapeHtml(e.id)}">${icon('bolt', 14)} Use</button>`}
      </div>
    </div>`).join('') || `<div class="empty" style="grid-column:1/-1"><div class="ico">📍</div><h4>${getLocale() === 'fa' ? 'موقعیتی نیست' : 'No endpoints'}</h4></div>`;

  grid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(data.find((x) => x.id === b.dataset.edit))));
  grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => del(b.dataset.del)));
  grid.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
    window.location.hash = '#/generator';
    window.__nexus_pending_endpoint = b.dataset.use;
  }));
}

function epSchema(v) {
  v = v || {};
  return [
    { key: 'name', label: 'Name', required: true, value: v.name },
    { key: 'country', label: 'Country', type: 'select', options: Object.keys(COUNTRIES).map((k) => ({ v: k, l: `${k} · ${COUNTRIES[k]}` })), value: v.country },
    { key: 'city', label: 'City', value: v.city },
    { key: 'host', label: 'Host / IP', value: v.host, placeholder: '1.2.3.4' },
    { key: 'domain', label: 'Domain', value: v.domain },
    { key: 'port', label: 'Port', type: 'number', value: v.port },
    { key: 'provider', label: 'Provider', value: v.provider },
    { key: 'region', label: 'Region', value: v.region },
    { key: 'tls', label: 'TLS', type: 'checkbox', value: v.tls },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'disabled', 'error'].map((x) => ({ v: x, l: x })), value: v.status || 'active' },
  ];
}

function openForm(existing) {
  formModal({
    title: (existing ? t('action.edit') : t('action.add')) + ' Endpoint',
    schema: epSchema(existing),
    onSubmit: async (data, close) => {
      const payload = {
        name: data.name, country: data.country || null, city: data.city || null,
        host: data.host || null, domain: data.domain || null, port: data.port ? Number(data.port) : null,
        provider: data.provider || null, region: data.region || null, tls: !!data.tls, status: data.status || 'active',
      };
      try {
        if (existing) await api.put(`/endpoints/${existing.id}`, payload);
        else await api.post('/endpoints', payload);
        toast('Endpoint saved', { type: 'ok' }); close(); load(document.getElementById('ep-filter')?.value || '');
      } catch (e) { toast(e.message, { type: 'error' }); }
    },
  });
}

async function del(id) {
  if (!(await confirmDelete('Delete this endpoint?'))) return;
  try { await api.del(`/endpoints/${id}`); toast('Deleted', { type: 'ok' }); load(document.getElementById('ep-filter')?.value || ''); }
  catch (e) { toast(e.message, { type: 'error' }); }
}
