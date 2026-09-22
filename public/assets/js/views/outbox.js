import { h, frag, formValues } from '../dom.js';
import { api, query } from '../api.js';
import { icon } from '../icons.js';
import { setQuery } from '../router.js';
import { setHeader, setMain, state } from '../shell.js';
import { panel, dataTable, field, toast, tiles, notice } from '../components.js';
import { messageStatus, showMessage } from './event-people.js';
import { plural } from '../format.js';

export async function outboxView({ query: q = {} }) {
  const filters = {
    status: q.status || '',
    channel: q.channel || '',
    category: q.category || '',
    search: q.search || '',
  };
  const [data, dashboard] = await Promise.all([
    api.get(`/messages${query({ ...filters, limit: 300 })}`),
    api.get('/system/dashboard'),
  ]);

  const reload = () => outboxView({ query: filters });

  setHeader({
    title: 'Outbox',
    subtitle: 'Every message across every event: what has gone, what is waiting, and what the system decided not to send.',
    actions: h('button.btn', {
      onclick: async (event) => {
        event.currentTarget.disabled = true;
        const result = await api.post('/system/scheduler/tick');
        toast(result.dispatch.sent > 0
          ? `${plural(result.dispatch.sent, 'message')} sent.`
          : 'Nothing was due.');
        reload();
      },
    }, icon('refresh'), 'Run the scheduler now'),
  });

  const form = h('form.filters', {
    oninput: () => {
      const values = formValues(form);
      setQuery(values);
      outboxView({ query: values });
    },
    onsubmit: (event) => event.preventDefault(),
  },
  field({ label: 'Search', name: 'search', type: 'search', value: filters.search, placeholder: 'Student, subject or address' }),
  field({
    label: 'Status',
    name: 'status',
    type: 'select',
    value: filters.status,
    options: [
      { value: '', label: 'Any status' },
      { value: 'scheduled', label: 'Waiting' },
      { value: 'sent', label: 'Sent' },
      { value: 'failed', label: 'Failed' },
      { value: 'skipped', label: 'Skipped' },
      { value: 'cancelled', label: 'Withdrawn' },
    ],
  }),
  field({ label: 'Channel', name: 'channel', type: 'select', value: filters.channel, options: [{ value: '', label: 'Any channel' }, ...state.meta.channels] }),
  field({ label: 'Kind', name: 'category', type: 'select', value: filters.category, options: [{ value: '', label: 'Any kind' }, ...state.meta.message_categories] }));

  setMain(
    state.meta.dry_run
      ? notice('info', 'Dry run is on. Messages here were composed and recorded in full, but nothing was actually delivered.')
      : null,

    tiles([
      { label: 'Waiting', value: dashboard.messages.pending_total, href: '/messages?status=scheduled' },
      { label: 'Due in 24 hours', value: dashboard.messages.due_24h },
      { label: 'Sent in 24 hours', value: dashboard.messages.sent_24h, href: '/messages?status=sent' },
      { label: 'Failed this week', value: dashboard.messages.failed_7d, href: '/messages?status=failed' },
      { label: 'Skipped this week', value: dashboard.messages.skipped_7d, href: '/messages?status=skipped' },
    ]),

    dashboard.messages.failed_7d > 0 && filters.status !== 'failed'
      ? notice('error', h('div',
        h('p', `${plural(dashboard.messages.failed_7d, 'message')} failed to send in the last seven days.`),
        h('p', h('a', { href: '/messages?status=failed' }, 'Show them'))))
      : null,

    h('.panel',
      form,
      dataTable([
        {
          label: 'Message',
          render: (row) => frag(
            h('span.row-title', row.label || row.subject || 'Message'),
            h('span.sub', row.subject || '')),
        },
        {
          label: 'Event',
          render: (row) => h('a', { href: `/events/${row.event_id}` }, row.event_name),
        },
        { label: 'To', render: (row) => frag(h('span', row.student_name), h('span.sub', row.to_address || 'No address')) },
        { label: 'Channel', render: (row) => h('span.small', row.channel === 'email' ? 'Email' : row.channel === 'sms' ? 'SMS' : 'WhatsApp') },
        { label: 'Scheduled', render: (row) => frag(h('span.small.nowrap', row.scheduled_local), h('span.sub.nowrap', row.scheduled_relative)) },
        { label: 'Status', render: (row) => messageStatus(row) },
        { label: '', render: (row) => h('button.btn.btn-small', { onclick: () => showMessage(row.id, reload) }, icon('eye')) },
      ], data.rows, {
        empty: filters.status || filters.search || filters.channel || filters.category
          ? { title: 'No message matches those filters' }
          : { title: 'The outbox is empty', text: 'Publish an event and its reminders appear here.' },
      })),

    data.total > data.rows.length ? h('p.small.muted', `Showing ${data.rows.length} of ${data.total}.`) : null);
}
