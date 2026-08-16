// core/theme.js — theme (dark/light/system) + accent + locale application
import { getState, setState } from './store.js';

const RTL_LOCALES = ['fa'];

export function applyTheme() {
  const s = getState();
  const root = document.documentElement;
  let theme = s.theme;
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-accent', s.accent);

  const isRtl = RTL_LOCALES.includes(s.locale);
  root.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
  document.documentElement.lang = s.locale;
}

export function setTheme(theme) {
  localStorage.setItem('nexus_theme', theme);
  setState({ theme });
  applyTheme();
}

export function setAccent(accent) {
  localStorage.setItem('nexus_accent', accent);
  setState({ accent });
  applyTheme();
}

export function setLocale(locale) {
  localStorage.setItem('nexus_locale', locale);
  setState({ locale });
  applyTheme();
  window.dispatchEvent(new CustomEvent('nexus:locale', { detail: locale }));
}

export function toggleSidebar() {
  const collapsed = !getState().sidebarCollapsed;
  localStorage.setItem('nexus_collapsed', collapsed ? '1' : '0');
  setState({ sidebarCollapsed: collapsed });
  document.querySelector('.app')?.classList.toggle('sidebar-collapsed', collapsed);
}

export function showSidebar(show) {
  document.querySelector('.app')?.classList.toggle('sidebar-hidden', !show);
  document.querySelector('.drawer-backdrop')?.classList.toggle('open', show);
}
