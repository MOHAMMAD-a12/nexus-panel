// core/router.js — hash-based router (no SPA server config needed)
const routes = new Map();
let notFoundHandler = null;
let current = null;

export function register(route, handler) {
  routes.set(route, handler);
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

function resolve(hash) {
  const path = (hash || '#/').replace(/^#/, '');
  const parts = path.split('/').filter(Boolean);
  const name = parts[0] || 'dashboard';
  return { name, params: parts.slice(1), raw: path };
}

export function navigate(route) {
  if (!location.hash || location.hash !== '#/' + route) {
    location.hash = '#/' + route;
  } else {
    // same route → force re-render
    dispatch();
  }
}

export function onRouteChange(fn) {
  window.addEventListener('hashchange', () => {
    const r = resolve(location.hash);
    fn(r);
  });
}

export function getCurrent() {
  return current;
}

export async function dispatch() {
  const r = resolve(location.hash);
  current = r;
  const handler = routes.get(r.name) || notFoundHandler;
  if (handler) {
    try {
      await handler(r);
    } catch (e) {
      console.error('[router]', e);
    }
  }
  // update active nav
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === r.name);
  });
}

export function startRouter() {
  if (!location.hash) location.hash = '#/dashboard';
  window.addEventListener('hashchange', dispatch);
  return dispatch();
}
