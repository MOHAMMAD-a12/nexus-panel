// core/store.js — reactive-ish global state (synchronous, no framework)
const state = {
  user: null,
  permissions: [],
  theme: localStorage.getItem('nexus_theme') || 'system',
  accent: localStorage.getItem('nexus_accent') || 'blue',
  locale: localStorage.getItem('nexus_locale') || 'en',
  sidebarCollapsed: localStorage.getItem('nexus_collapsed') === '1',
  notifications: { items: [], unread: 0 },
  route: null,
};

const listeners = new Set();

export function getState() { return state; }

// Mirror for non-module consumers (pages read locale via window.__nexus_state.locale).
window.__nexus_state = state;

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setUser(user) {
  state.user = user;
  state.permissions = user?.permissions || [];
}

export function hasPerm(perm) {
  const p = state.permissions;
  if (!p.length) return false;
  if (p.includes('*')) return true;
  if (p.includes(perm)) return true;
  const [cat] = perm.split('.');
  return p.includes(`${cat}.*`);
}

export function can(perm) {
  return hasPerm(perm);
}
