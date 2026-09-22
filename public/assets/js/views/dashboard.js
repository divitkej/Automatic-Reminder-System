import { h, frag } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { setHeader, setMain, state } from '../shell.js';
import { panel, tiles, dataTable, notice, statusBadge, toast, emptyState } from '../components.js';
import { relative, plural } from '../format.js';

export async function dashboardView() {
  const data = await api.get('/system/dashboard');

  setHeader({
    title: 'Dashboard',
    subtitle: `${state.meta.org.name}. All times shown in each event's own timezone.`,
    actions: frag(
      h('button.btn', {
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            const result = await api.post('/system/scheduler/tick');
            const sent = result.dispatch ? result.dispatch.sent : 0;
            toast(sent > 0
              ? `Scheduler run finished. ${plural(sent, 'message')} sent.`
              : 'Scheduler run finished. Nothing was due.');
            dashboardView();
          } catch (error) {
            toast(error.message, 'error');
            event.currentTarget.disabled = false;
          }
        },
      }, icon('refresh'), 'Run the scheduler now'),
      h('a.btn.btn-primary', { href: '/events/new' }, icon('plus'), 'New event')),
  });

  const attention = data.attention.length
    ? h('div', data.attention.map((item) => notice(item.level, h('div',
      h('p', item.text),
      item.link ? h('p', h('a', { href: item.link }, 'Open')) : null))))
    : null;

  const schedulerNote = !data.scheduler.enabled
    ? notice('warning', 'The background worker is switched off, so nothing will be sent automatically. Set SCHEDULER_ENABLED=true and restart.')
    : !data.scheduler.running
      ? notice('warning', 'The background worker is not running in this process.')
      : null;

  const demoNote = state.meta.demo_data_seeded_at
    ? notice('warning', h('div',
      h('p', h('strong', 'This database holds demonstration data.'),
        ' The students, events, responses and delivery history below were generated on first start so the screens had something to show. None of it is real.'),
      h('p.small', 'Run "npm run reset" to clear it, or set SEED_DEMO_DATA=false before the first start of a fresh database.')))
    : null;

  const dryRunNote = state.meta.dry_run
    ? notice('info', h('div',
      h('p', 'Dry run is on. Every message is composed, scheduled and recorded in full, but nothing leaves the machine.'),
      h('p.small', 'Set DRY_RUN=false in the environment once the SMTP details have been checked against a test event.')))
    : null;

  setMain(
    demoNote,
    dryRunNote,
    schedulerNote,
    attention,

    tiles([
      { label: 'Live events', value: data.counts.events_live, note: `${data.counts.events_draft} in draft`, href: '/events?status=scheduled' },
      { label: 'Next seven days', value: data.counts.events_next_7_days, note: 'events starting' },
      { label: 'Due in 24 hours', value: data.messages.due_24h, note: 'messages scheduled', href: '/messages?status=scheduled' },
      { label: 'Sent in 24 hours', value: data.messages.sent_24h, note: 'messages delivered', href: '/messages?status=sent' },
      { label: 'Students on file', value: data.counts.students_active, note: `${data.counts.students_opted_out} opted out`, href: '/students' },
    ]),

    h('.grid-2',
      panel({
        title: 'Upcoming events',
        hint: 'Live events, soonest first.',
        flush: true,
        body: dataTable([
          {
            label: 'Event',
            render: (row) => frag(
              h('a.row-title', { href: `/events/${row.id}` }, row.name),
              h('span.sub', `${row.type_label} · ${row.date_long}, ${row.time_range}`)),
          },
          { label: 'Starts', render: (row) => h('span.nowrap.small', row.starts_in) },
          {
            label: 'Registered',
            num: true,
            render: (row) => frag(
              h('span.tabular', `${row.registered} / ${row.invited}`),
              h('span.sub', row.invited ? `${Math.round((row.registered / row.invited) * 100)}%` : '')),
          },
        ], data.upcoming, {
          empty: {
            title: 'No live events',
            text: 'Create an event and publish it to start the reminder schedule.',
            action: h('p', h('a.btn.btn-primary', { href: '/events/new' }, icon('plus'), 'New event')),
          },
        }),
      }),

      panel({
        title: 'Going out next',
        hint: 'The next scheduled sends across every event.',
        flush: true,
        body: dataTable([
          {
            label: 'Message',
            render: (row) => frag(
              h('span.row-title', row.label || 'Message'),
              h('span.sub', row.event_name)),
          },
          { label: 'When', render: (row) => h('span.nowrap.small', row.scheduled_relative) },
          { label: 'To', num: true, render: (row) => h('span.tabular', String(row.recipients)) },
        ], data.next_messages, {
          empty: { title: 'Nothing is queued', text: 'Reminders appear here as soon as an event is published.' },
        }),
      })),

    panel({
      title: 'Recent activity',
      hint: 'What the system and the team have done.',
      flush: true,
      body: data.activity.length
        ? h('.panel-body', h('ul.timeline', data.activity.map((row) => h('li',
          h('.timeline-title', describeAction(row)),
          h('.timeline-when', `${relative(row.created_at)} · ${row.actor}`)))))
        : emptyState({ title: 'Nothing has happened yet', text: 'Actions are recorded here as they happen.' }),
    }),
  );
}

const ACTION_WORDS = {
  'event.created': 'Event created',
  'event.updated': 'Event edited',
  'event.published': 'Event published',
  'event.unpublished': 'Event returned to draft',
  'event.cancelled': 'Event cancelled',
  'event.completed': 'Event closed',
  'event.duplicated': 'Event copied',
  'event.deleted': 'Event deleted',
  'audience.added': 'Audience added',
  'audience.removed': 'Audience removed',
  'audience.synced': 'Audience brought up to date',
  'rule.created': 'Reminder added',
  'rule.updated': 'Reminder edited',
  'rule.deleted': 'Reminder removed',
  'rules.preset_applied': 'Default schedule applied',
  'outbox.materialised': 'Outbox updated',
  'outbox.cancelled': 'Pending messages withdrawn',
  'outbox.ad_hoc': 'One-off message queued',
  'registration.registered': 'Student confirmed a place',
  'registration.declined': 'Student declined',
  'registration.promoted': 'Waiting list place promoted',
  'registration.added': 'Student added',
  'registration.removed': 'Student removed',
  'registration.status_set': 'Registration changed',
  'attendance.present': 'Marked present',
  'attendance.absent': 'Marked absent',
  'attendance.bulk': 'Attendance updated',
  'attendance.imported': 'Attendance imported',
  'feedback.received': 'Feedback received',
  'feedback.updated': 'Feedback updated',
};

export function describeAction(row) {
  const words = ACTION_WORDS[row.action] || row.action;
  const where = row.event_name ? ` · ${row.event_name}` : '';
  return `${words}${row.detail ? `: ${row.detail}` : ''}${where}`;
}

export { statusBadge };
