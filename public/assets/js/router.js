// History-based routing. The server serves the console shell for every console
// path, so a deep link such as /events/evt_x/reminders is a real, shareable URL
// rather than a fragment.

const routes = [];
let notFound = null;
let current = null;

/** Register a pattern such as "/events/:id/:tab?". */
export function route(pattern, handler) {
  const keys = [];
  const source = pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const optional = segment.endsWith('?');
      keys.push({ name: segment.slice(1, optional ? -1 : undefined), optional });
      return optional ? '(?:([^/]+))?' : '([^/]+)';
    })
    .join('/');
  routes.push({ regex: new RegExp(`^/${source}/?$`), keys, handler, pattern });
}

export function setNotFound(handler) {
  notFound = handler;
}

function match(path) {
  for (const entry of routes) {
    const result = entry.regex.exec(path);
    if (!result) continue;
    const params = {};
    entry.keys.forEach((key, index) => {
      const value = result[index + 1];
      if (value !== undefined) params[key.name] = decodeURIComponent(value);
    });
    return { entry, params };
  }
  return null;
}

export function navigate(path, { replace = false } = {}) {
  if (path === window.location.pathname + window.location.search) {
    return resolve();
  }
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  return resolve();
}

export async function resolve() {
  const path = window.location.pathname;
  const found = match(path);
  const search = Object.fromEntries(new URLSearchParams(window.location.search));
  current = { path, search, params: found ? found.params : {} };

  if (!found) {
    if (notFound) await notFound({ path });
    return;
  }
  await found.entry.handler({ ...found.params, query: search, path });
}

export function currentRoute() {
  return current;
}

/** Intercept in-app links so they do not reload the page. */
export function startRouter() {
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a');
    if (!anchor) return;
    if (anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.dataset.external) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    if (href.startsWith('/api/') || href.startsWith('/r/') || href.startsWith('/f/') || href.startsWith('/assets/')
        || href === '/privacy' || href === '/terms' || href === '/sign-in') return;
    event.preventDefault();
    navigate(href);
  });

  window.addEventListener('popstate', () => resolve());
  return resolve();
}

/** Replace the query string on the current path without adding history. */
export function setQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  const next = window.location.pathname + (text ? `?${text}` : '');
  window.history.replaceState({}, '', next);
}
