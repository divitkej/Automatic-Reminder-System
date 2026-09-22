// The console frame: navigation, page header, and the page-level helpers every
// view uses to put itself on screen.

import { h, mount, frag } from './dom.js';
import { icon } from './icons.js';
import { api } from './api.js';

export const state = {
  meta: null,
  counts: { events: null, messages: null },
};

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/events', label: 'Events', icon: 'calendar' },
  { href: '/students', label: 'Students', icon: 'people' },
  { href: '/groups', label: 'Groups', icon: 'group' },
  { href: '/templates', label: 'Templates', icon: 'document' },
  { href: '/messages', label: 'Outbox', icon: 'send' },
  { href: '/reports', label: 'Reports', icon: 'chart' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export async function loadMeta() {
  if (!state.meta) state.meta = await api.get('/system/meta');
  return state.meta;
}

export function renderNav() {
  const path = window.location.pathname;
  const list = document.getElementById('nav');
  mount(list, NAV.map((item) => {
    const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
    return h('li', h('a', { href: item.href, 'aria-current': active ? 'page' : null },
      icon(item.icon), h('span', item.label)));
  }));

  mount(document.getElementById('sidebar-foot'),
    state.meta && state.meta.dry_run
      ? h('p', h('span.dry-run-flag', 'Dry run'))
      : null,
    h('p', state.meta ? state.meta.org.short_name : ''),
    h('p', h('a', { href: '/privacy' }, 'Privacy'), ' ', h('a', { href: '/terms' }, 'Terms')));
}

/** Set the page header. Actions are buttons or links on the right. */
export function setHeader({ title, subtitle, actions, back }) {
  mount(document.getElementById('topbar'),
    h('.topbar-text',
      back ? h('p.small', h('a', { href: back.href }, icon('back', { size: 12 }), ' ', back.label)) : null,
      h('h1', title),
      subtitle ? h('p.topbar-sub', subtitle) : null),
    actions ? h('.topbar-actions', actions) : null);
  document.title = `${title} | Career Services Console`;
}

export function setMain(...children) {
  const main = document.getElementById('main');
  mount(main, ...children);
  renderNav();
  return main;
}

export function showLoading(message = 'Loading.') {
  mount(document.getElementById('main'), h('p.loading', message));
}

export function showError(error) {
  setHeader({ title: 'Something went wrong' });
  setMain(h('.notice.notice-error',
    h('p', error && error.message ? error.message : 'The console could not load this page.'),
    h('p.small', 'Try reloading. If it keeps happening, check the server log.')));
}

/** Wrap a view so that a failed load never leaves a blank page. */
export function view(handler) {
  return async (params) => {
    showLoading();
    try {
      await handler(params);
    } catch (error) {
      showError(error);
    }
    window.scrollTo(0, 0);
  };
}

export function pageActions(...actions) {
  return frag(actions.filter(Boolean));
}
