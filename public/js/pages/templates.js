// pages/templates.js — generation templates CRUD + use
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { openModal } from '../components/modal.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { statusBadge, escapeHtml, formModal, confirmDelete, tagList } from '../core/ui.js';

const PROTOCOLS = ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks5', 'http', 'https', 'wireguard'];
let table;

export async function renderTemplates() {
  const page = document.getElementById('page');
  const canWrite = hasPerm('configs.write');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.templates')}</h1><div class="page-sub">${t('common.empty') ? 'Reusable generation parameters' : 'Reusable generation parameters'}</div></div>
      <div class="flex gap-8">
        <button class="btn primary" id="add-tpl" style="${canWrite ? '' : 'display:none'}">${icon('plus', 16)} ${t('action.add')}</button>
      </div>
    </div>
    <div id="tpl-table"></div>`;

  page.querySelector('#add-tpl')?.addEventListener('click', () => openForm());
  const useBtn = canWrite;

  table = new DataTable(page.querySelector('#tpl-table'), {
    columns: [
      { key: 'name', label: 'Name', render: (v) => `<strong>${escapeHtml(v)}</strong>` },
      { key: 'protocol', label: 'Protocol', render: (v) => `<span class="tag">${escapeHtml(v.toUpperCase())}</span>` },
      { key: 'transport', label: 'Transport', render: (v) => escapeHtml(v || 'tcp') },
      { key: 'tls', label: 'TLS', render: (v) => v ? '<span class="badge ok">TLS</span>' : '—' },
      { key: 'tags', label: 'Tags', render: (v) => tagList(v) },
      { key: 'usageCount', label: 'Uses', render: (v) => escapeHtml(String(v || 0)) },
      { key: 'updatedAt', label: 'Updated', render: (v) => escapeHtml(fmtAgo(v)) },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      return api.list(`/templates?${q.toString()}`);
    },
    actions: (useBtn ? [
      { key: 'use', label: '', icon: 'bolt', cls: 'primary', onClick: useTemplate },
      { key: 'edit', label: '', icon: 'edit', cls: 'ghost', onClick: (id, r) => openForm(r) },
      { key: 'duplicate', label: '', icon: 'copy', cls: 'ghost', onClick: duplicateTpl },
      { key: 'delete', label: '', icon: 'trash', cls: 'danger', onClick: deleteTpl },
    ] : [{ key: 'use', label: '', icon: 'bolt', cls: 'primary', onClick: useTemplate }]),
  });
}

function tplSchema(value) {
  const v = value || {};
  return [
    { key: 'name', label: 'Name', required: true, value: v.name },
    { key: 'protocol', label: 'Protocol', type: 'select', required: true, options: PROTOCOLS.map((p) => ({ v: p, l: p.toUpperCase() })), value: v.protocol || 'vless' },
    { key: 'transport', label: 'Transport', type: 'select', options: ['tcp', 'ws', 'grpc', 'quic', 'h2', 'udp'].map((p) => ({ v: p, l: p })), value: v.transport || 'tcp' },
    { key: 'tls', label: 'TLS', type: 'checkbox', value: v.tls },
    { key: 'server', label: 'Server', value: v.server, placeholder: '1.2.3.4' },
    { key: 'domain', label: 'Domain', value: v.domain },
    { key: 'port', label: 'Port', type: 'number', value: v.port },
    { key: 'sni', label: 'SNI', value: v.sni },
    { key: 'host', label: 'Host', value: v.host },
    { key: 'path', label: 'Path', value: v.path },
    { key: 'flow', label: 'Flow', value: v.flow },
    { key: 'method', label: 'Method', value: v.method },
    { key: 'description', label: 'Description', value: v.description },
    { key: 'tags', label: 'Tags (comma)', value: Array.isArray(v.tags) ? v.tags.join(',') : (v.tags || '') },
  ];
}

function openForm(existing) {
  formModal({
    title: (existing ? t('action.edit') : t('action.add')) + ' Template',
    schema: tplSchema(existing),
    submitText: t('action.save'),
    onSubmit: async (data, close) => {
      const payload = {
        name: data.name, protocol: data.protocol, transport: data.transport,
        tls: !!data.tls, server: data.server || null, domain: data.domain || null,
        port: data.port ? Number(data.port) : null, sni: data.sni || null, host: data.host || null,
        path: data.path || null, flow: data.flow || null, method: data.method || null,
        description: data.description || '', tags: String(data.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (existing) await api.put(`/templates/${existing.id}`, payload);
      else await api.post('/templates', payload);
      toast('Template saved', { type: 'ok' }); close(); table.refresh();
    },
  });
}

async function duplicateTpl(id) {
  try { await api.post(`/templates/${id}/duplicate`); toast('Duplicated', { type: 'ok' }); table.refresh(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}

async function deleteTpl(id) {
  const ok = await confirmDelete('Delete this template?');
  if (!ok) return;
  try { await api.del(`/templates/${id}`); toast('Deleted', { type: 'ok' }); table.refresh(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}

async function useTemplate(id) {
  try {
    const tpl = await api.get(`/templates/${id}`);
    window.location.hash = '#/generator';
    window.__nexus_pending_tpl = tpl;
  } catch (e) { toast(e.message, { type: 'error' }); }
}

function fmtAgo(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}
