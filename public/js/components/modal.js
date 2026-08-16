// components/modal.js
import { icon } from '../core/icons.js';
import { escapeHtml } from './toast.js';

export function openModal({ title, body, footer, size = '', onOpen } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal ' + size;
  modal.innerHTML = `
    <div class="modal-head">
      <h3>${escapeHtml(title || '')}</h3>
      <button class="icon-btn" data-close>${icon('close', 18)}</button>
    </div>
    <div class="modal-body"></div>
    ${footer !== false ? '<div class="modal-foot"></div>' : ''}`;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const bodyEl = modal.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.appendChild(document.createElement('div'));

  const footEl = modal.querySelector('.modal-foot');
  if (footEl && footer) {
    if (typeof footer === 'string') footEl.innerHTML = footer;
    else if (footer instanceof Node) footEl.appendChild(footer);
  }

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  modal.querySelector('[data-close]').onclick = close;
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);

  if (onOpen) onOpen({ body: bodyEl, foot: footEl, close });
  return { close, el: modal, body: bodyEl, foot: footEl };
}

// Confirm dialog
export function confirmDialog({ title = 'Confirm', message, danger = true, confirmText = 'Confirm', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: `<p style="margin:0">${escapeHtml(message)}</p>`,
      footer: `<button class="btn ghost" data-cancel>${cancelText}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirmText}</button>`,
    });
    m.body.closest('.modal').querySelector('[data-cancel]').onclick = () => { m.close(); resolve(false); };
    m.body.closest('.modal').querySelector('[data-ok]').onclick = () => { m.close(); resolve(true); };
  });
}
