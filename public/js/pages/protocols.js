// pages/protocols.js — protocol registry viewer (read-only, from /api/protocols)
import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { escapeHtml } from '../core/ui.js';

function getLocale() { return window.__nexus_state?.locale || 'en'; }

export async function renderProtocols() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.protocols')}</h1><div class="page-sub">${getLocale() === 'fa' ? 'موتور پروتکل ماژولار — هر پروتکل یک ورودی واحد' : 'Modular protocol engine — one registry entry per protocol'}</div></div>
    </div>
    <div id="proto-cards"></div>`;

  let list = [];
  try {
    list = await api.get('/api/protocols');
  } catch (e) {
    toast(e.message || 'Failed to load protocols', { type: 'error' });
    return;
  }

  const cols = getLocale() === 'fa' ? { basic: 'پایه', security: 'امنیت', network: 'شبکه', advanced: 'پیشرفته' } : { basic: 'Basics', security: 'Security', network: 'Network', advanced: 'Advanced' };

  page.querySelector('#proto-cards').innerHTML = list.map((p) => {
    const schema = p.schema || {};
    const groups = ['basic', 'security', 'network', 'advanced'].filter((g) => (schema[g] || []).length);
    const fieldHtml = groups.map((g) => `
      <div style="margin-top:10px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3);font-weight:700">${cols[g]}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
          ${(schema[g] || []).map((f) => `<span class="tag">${escapeHtml((getLocale() === 'fa' ? (f.label_fa || f.label_en) : (f.label_en || f.label_fa)) || f.key)}</span>`).join('')}
        </div>
      </div>`).join('');
    return `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="proto-card active" style="width:54px;height:54px;display:grid;place-items:center;border-radius:12px"><div class="pc-label" style="font-size:16px">${escapeHtml(p.label)}</div></div>
            <div>
              <div style="font-weight:800;font-size:16px">${escapeHtml(p.label)}</div>
              <div class="muted" style="font-size:12px">${escapeHtml(p.description || '')}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="tag">${escapeHtml((p.transports || []).join(' · '))}</span>
            <span class="tag">${getLocale() === 'fa' ? 'پورت' : 'Port'}: ${escapeHtml(String(p.defaultPort))}</span>
            ${p.tlsRequired ? `<span class="badge danger">${getLocale() === 'fa' ? 'TLS اجباری' : 'TLS required'}</span>` : ''}
            ${p.tlsDefault ? `<span class="badge ok">${getLocale() === 'fa' ? 'TLS پیش‌فرض' : 'TLS default'}</span>` : ''}
          </div>
        </div>
        ${fieldHtml}
        <div class="flex gap-8" style="margin-top:14px">
          <button class="btn sm primary" data-go="${escapeHtml(p.id)}">${icon('bolt', 14)} ${getLocale() === 'fa' ? 'باز کردن تولیدکننده' : 'Open Generator'}</button>
        </div>
      </div>`;
  }).join('');

  page.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    window.location.hash = '#/generator';
    window.__nexus_pending_proto = b.dataset.go;
  }));
}
