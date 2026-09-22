import { h, frag, formValues } from '../dom.js';
import { api, query } from '../api.js';
import { setQuery } from '../router.js';
import { setHeader, setMain } from '../shell.js';
import { panel, dataTable, field, tiles, notice, bar, emptyState } from '../components.js';
import { longDate, todayIso, percent } from '../format.js';

export async function reportsView({ query: q = {} }) {
  const from = q.from || todayIso(-180);
  const to = q.to || todayIso(1);
  const data = await api.get(`/system/overview${query({ from, to })}`);

  setHeader({
    title: 'Reports',
    subtitle: 'Figures for the department, counted from the record rather than estimated.',
  });

  const form = h('form.filters', {
    onchange: () => {
      const values = formValues(form);
      setQuery(values);
      reportsView({ query: values });
    },
    onsubmit: (event) => event.preventDefault(),
  },
  field({ label: 'From', name: 'from', type: 'date', value: from }),
  field({ label: 'To', name: 'to', type: 'date', value: to }));

  const totalInvited = data.by_type.reduce((sum, row) => sum + row.invited, 0);
  const totalRegistered = data.by_type.reduce((sum, row) => sum + row.registered, 0);
  const totalAttended = data.by_type.reduce((sum, row) => sum + row.attended, 0);

  setMain(
    h('.panel', form,
      h('.panel-body',
        h('p.small.muted', `${longDate(data.from)} to ${longDate(data.to)}. Cancelled events are left out.`))),

    tiles([
      { label: 'Events run', value: data.events },
      { label: 'Invitations issued', value: totalInvited },
      { label: 'Places taken', value: totalRegistered, note: totalInvited ? `${percent((totalRegistered / totalInvited) * 100)} of invitations` : '' },
      { label: 'Attended', value: totalAttended, note: totalRegistered ? `${percent((totalAttended / totalRegistered) * 100)} of places` : '' },
      { label: 'Messages sent', value: data.messages_sent },
      { label: 'Feedback rating', value: data.feedback_average ?? 'None yet', note: data.feedback_responses ? `from ${data.feedback_responses} responses` : 'no responses' },
    ]),

    panel({
      title: 'By event type',
      hint: 'Where the audience turns up, and where it does not.',
      flush: true,
      body: data.by_type.length
        ? dataTable([
          { label: 'Event type', render: (row) => h('span.row-title', row.type_label) },
          { label: 'Events', num: true, render: (row) => h('span.tabular', String(row.events)) },
          { label: 'Invited', num: true, render: (row) => h('span.tabular', String(row.invited)) },
          { label: 'Registered', num: true, render: (row) => h('span.tabular', String(row.registered)) },
          {
            label: 'Registration rate',
            render: (row) => frag(
              h('.spread.small', h('span'), h('span.tabular', `${row.registration_rate}%`)),
              bar(row.registration_rate, 100)),
          },
          { label: 'Attended', num: true, render: (row) => h('span.tabular', String(row.attended)) },
          {
            label: 'Attendance rate',
            render: (row) => frag(
              h('.spread.small', h('span'), h('span.tabular', `${row.attendance_rate}%`)),
              bar(row.attendance_rate, 100, { good: row.attendance_rate >= 75 })),
          },
        ], data.by_type)
        : emptyState({
          title: 'No events in this period',
          text: 'Widen the date range, or run an event first.',
        }),
    }),

    notice('info', h('div',
      h('p', h('strong', 'How these are counted.'), ' Registration rate is confirmed places divided by invitations issued. Attendance rate is students marked present divided by confirmed places, so it only means anything once attendance has been marked.'),
      h('p.small', 'A rate of zero is a real zero. Nothing here is estimated or filled in.'))));
}
