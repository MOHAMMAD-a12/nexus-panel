// components/table.js — sortable, paginated, searchable table
import { escapeHtml } from './toast.js';
import { icon } from '../core/icons.js';

export class DataTable {
  constructor(container, { columns, fetchData, pageSize = 12, rowKey = 'id', onRow, actions, searchable = true }) {
    this.container = container;
    this.columns = columns;
    this.fetchData = fetchData;
    this.pageSize = pageSize;
    this.rowKey = rowKey;
    this.onRow = onRow;
    this.actions = actions || [];
    this.searchable = searchable;
    this.page = 1;
    this.sortKey = null;
    this.sortDir = 'asc';
    this.search = '';
    this.filterKey = null;
    this.filterValue = '';
    this._build();
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'card pad-0';
    wrap.innerHTML = `
      ${this.searchable ? `
      <div class="toolbar" style="padding:14px 16px 0">
        <div class="search-box" style="max-width:none;flex:1">
          ${icon('search', 18)}<input type="text" placeholder="Search…" data-search>
        </div>
        <div class="spacer"></div>
        <div data-actions></div>
      </div>` : '<div class="toolbar" style="padding:14px 16px 0"><div class="spacer"></div><div data-actions></div></div>'}
      <div class="table-wrap" style="margin-top:12px">
        <table class="data">
          <thead><tr data-head></tr></thead>
          <tbody data-body></tbody>
        </table>
      </div>
      <div class="pagination" data-pager></div>`;
    this.container.innerHTML = '';
    this.container.appendChild(wrap);
    this.el = wrap;
    this.headEl = wrap.querySelector('[data-head]');
    this.bodyEl = wrap.querySelector('[data-body]');
    this.pagerEl = wrap.querySelector('[data-pager]');
    this.actionsEl = wrap.querySelector('[data-actions]');

    if (this.searchable) {
      const input = wrap.querySelector('[data-search]');
      let t;
      input.addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => { this.search = e.target.value; this.page = 1; this.reload(); }, 250);
      });
    }
    // header
    this.headEl.innerHTML = this.columns.map((c) => {
      const sortable = c.sortable !== false;
      return `<th class="${sortable ? 'th-sort' : 'no-sort'}" data-key="${c.key}">${escapeHtml(c.label)}${c.badge ? `<span class="badge" data-badge="${c.key}"></span>` : ''}</th>`;
    }).join('') + (this.actions.length ? `<th class="no-sort"></th>` : '');

    this.headEl.querySelectorAll('.th-sort').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        else { this.sortKey = key; this.sortDir = 'asc'; }
        this.headEl.querySelectorAll('.th-sort').forEach((h) => h.classList.remove('asc', 'desc'));
        th.classList.add(this.sortDir);
        this.reload();
      });
    });
    this.reload();
  }

  setActions(node) {
    this.actionsEl.innerHTML = '';
    this.actionsEl.appendChild(node);
  }

  async reload() {
    this.bodyEl.innerHTML = `<tr><td colspan="${this.columns.length + 1}"><div class="skeleton" style="height:200px"></div></td></tr>`;
    try {
      const params = {
        page: this.page,
        pageSize: this.pageSize,
        search: this.search,
        sort: this.sortKey,
        dir: this.sortDir,
      };
      const res = await this.fetchData(params);
      this.lastData = res;
      this._render(res);
    } catch (e) {
      this.bodyEl.innerHTML = `<tr><td colspan="${this.columns.length + 1}"><div class="error-box">${escapeHtml(e.message || 'Failed to load')}</div></td></tr>`;
    }
  }

  _render(res) {
    const rows = res.data || [];
    if (!rows.length) {
      this.bodyEl.innerHTML = `<tr><td colspan="${this.columns.length + 1}"><div class="empty"><div class="ico">📭</div><h4>No results</h4></div></td></tr>`;
      this.pagerEl.innerHTML = '';
      return;
    }
    this.bodyEl.innerHTML = rows.map((row) => {
      const tds = this.columns.map((c) => {
        let v = c.render ? c.render(row[c.key], row) : escapeHtml(row[c.key]);
        return `<td>${v}</td>`;
      }).join('');
      const actionsTd = this.actions.length ? `<td><div class="flex gap-8" style="justify-content:flex-end">${this.actions.map((a) => `<button class="btn sm ${a.cls || 'ghost'}" data-act="${a.key}" data-id="${row[this.rowKey]}">${a.icon ? icon(a.icon, 15) : escapeHtml(a.label)}</button>`).join('')}</div></td>` : '';
      return `<tr data-id="${row[this.rowKey]}">${tds}${actionsTd}</tr>`;
    }).join('');

    this.bodyEl.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.act;
        const id = btn.dataset.id;
        const a = this.actions.find((x) => x.key === key);
        if (a && a.onClick) a.onClick(id, rows.find((r) => r[this.rowKey] == id));
      });
    });

    if (this.onRow) {
      this.bodyEl.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.addEventListener('click', () => this.onRow(tr.dataset.id, rows.find((r) => r[this.rowKey] == tr.dataset.id)));
      });
    }

    // pagination
    const meta = res.meta || {};
    const total = meta.total || rows.length;
    const pages = meta.pages || 1;
    this.pagerEl.innerHTML = `
      <span class="muted" style="font-size:12px">${total} items</span>
      <button class="btn sm" data-pg="prev" ${this.page <= 1 ? 'disabled' : ''}>‹</button>
      <span style="font-size:12px">${this.page} / ${pages}</span>
      <button class="btn sm" data-pg="next" ${this.page >= pages ? 'disabled' : ''}>›</button>`;
    this.pagerEl.querySelector('[data-pg="prev"]').onclick = () => { if (this.page > 1) { this.page--; this.reload(); } };
    this.pagerEl.querySelector('[data-pg="next"]').onclick = () => { if (this.page < pages) { this.page++; this.reload(); } };
  }

  refresh() { this.reload(); }
}
