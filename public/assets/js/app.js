// Console entry point: wires routes to views and starts the router.

import { route, setNotFound, startRouter } from './router.js';
import { loadMeta, setHeader, setMain, view, renderNav } from './shell.js';
import { h } from './dom.js';

import { dashboardView } from './views/dashboard.js';
import { eventsView, newEventView } from './views/events.js';
import { eventDetailView } from './views/event-detail.js';
import { studentsView, studentDetailView } from './views/students.js';
import { groupsView, groupDetailView } from './views/groups.js';
import { templatesView, templateDetailView } from './views/templates.js';
import { outboxView } from './views/outbox.js';
import { reportsView } from './views/reports.js';
import { settingsView } from './views/settings.js';

route('/', view(dashboardView));
route('/events', view(eventsView));
route('/events/new', view(newEventView));
route('/events/:id', view(eventDetailView));
route('/events/:id/:tab', view(eventDetailView));
route('/students', view(studentsView));
route('/students/:id', view(studentDetailView));
route('/groups', view(groupsView));
route('/groups/:id', view(groupDetailView));
route('/templates', view(templatesView));
route('/templates/:id', view(templateDetailView));
route('/messages', view(outboxView));
route('/reports', view(reportsView));
route('/settings', view(settingsView));

setNotFound(({ path }) => {
  setHeader({ title: 'Page not found' });
  setMain(h('.notice.notice-warning',
    h('p', `There is nothing at ${path}.`),
    h('p', h('a', { href: '/' }, 'Go to the dashboard'))));
});

async function boot() {
  try {
    await loadMeta();
  } catch (error) {
    setMain(h('.notice.notice-error',
      h('p', 'The console could not reach the server.'),
      h('p.small', error.message)));
    return;
  }
  renderNav();
  await startRouter();
}

boot();
