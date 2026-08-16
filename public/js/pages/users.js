// pages/users.js — user management
import { api } from '../core/api.js';
import { DataTable } from '../components/table.js';
import { hasPerm } from '../core/store.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast } from '../components/toast.js';
import { statusBadge, fmtAgo, formModal, confirmDelete, escapeHtml } from '../core/ui.js';

let table;

const ROLES = ['role_admin', 'role_operator', 'role_viewer'];
const ROLE_LABEL = { role_admin: 'Administrator', role_operator: 'Operator', role_viewer: 'Viewer' };

export async function renderUsers() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">${t('nav.users')}</h1><div class="page-sub">Accounts, roles & permissions</div></div>
      <div class="flex gap-8">
        <button class="btn primary" id="add-user">${icon('plus', 16)} ${t('action.add')}</button>
      </div>
    </div>
    <div id="users-table"></div>`;

  const canWrite = hasPerm('users.write');
  if (!canWrite) page.querySelector('#add-user').style.display = 'none';
  page.querySelector('#add-user').addEventListener('click', () => openForm());

  table = new DataTable(page.querySelector('#users-table'), {
    columns: [
      { key: 'username', label: 'Username', render: (v, r) => `<strong>${escapeHtml(v)}</strong><div class="muted" style="font-size:11px">${escapeHtml(r.displayName || '')}</div>` },
      { key: 'email', label: 'Email', render: (v) => `<span class="mono" style="font-size:12px">${escapeHtml(v)}</span>` },
      { key: 'roleId', label: 'Role', render: (v) => `<span class="tag">${escapeHtml(ROLE_LABEL[v] || v)}</span>` },
      { key: 'status', label: 'Status', render: (v) => statusBadge(v) },
      { key: 'lastLogin', label: 'Last login', render: (v) => fmtAgo(v) },
    ],
    fetchData: async (params) => {
      const q = new URLSearchParams({ page: params.page, pageSize: params.pageSize });
      if (params.search) q.set('search', params.search);
      return api.list(`/users?${q.toString()}`);
    },
    actions: canWrite ? [
      { key: 'edit', label: '', icon: 'edit', cls: 'ghost', onClick: (id, r) => openForm(r) },
      { key: 'delete', label: '', icon: 'trash', cls: 'danger', onClick: deleteUser },
    ] : [],
  });
}

function openForm(existing) {
  formModal({
    title: existing ? t('action.edit') + ' User' : t('action.add') + ' User',
    schema: [
      { key: 'username', label: 'Username', required: true, placeholder: 'min 3 chars' },
      { key: 'email', label: 'Email', required: true, type: 'email' },
      { key: 'display_name', label: 'Display name', placeholder: 'optional' },
      { key: 'role_id', label: 'Role', type: 'select', options: ROLES.map((r) => ({ v: r, l: ROLE_LABEL[r] })), required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'disabled'].map((x) => ({ v: x, l: x })) },
      { key: 'password', label: existing ? 'New password (leave blank to keep)' : 'Password', type: 'password', hint: 'min 8 chars', required: !existing },
    ],
    value: existing ? { ...existing, password: '' } : { role_id: 'role_viewer', status: 'active' },
    onSubmit: async (data, close) => {
      const payload = {
        username: data.username, email: data.email, role_id: data.role_id, status: data.status,
        display_name: data.display_name || null,
      };
      if (data.password) payload.password = data.password;
      if (existing) await api.put(`/users/${existing.id}`, payload);
      else await api.post('/users', payload);
      toast('User saved', { type: 'ok' }); close(); table.refresh();
    },
  });
}

async function deleteUser(id) {
  if (!(await confirmDelete('user'))) return;
  try { await api.del(`/users/${id}`); toast('User deleted', { type: 'ok' }); table.refresh(); }
  catch (e) { toast(e.message, { type: 'error' }); }
}
