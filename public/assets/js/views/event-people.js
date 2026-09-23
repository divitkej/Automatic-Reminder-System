// The event tabs that deal with individual students: registrations,
// attendance, the outbox, feedback and the audit trail.

import { h, frag } from '../dom.js';
import { api, query } from '../api.js';
import { icon } from '../icons.js';
import {
  panel, dataTable, badge, statusBadge, notice, field, toast, modal,
  confirmModal, formModal, csvPicker, downloadLink, emptyState, bar, tiles,
} from '../components.js';
import { relative, plural, percent } from '../format.js';
import { describeAction } from './dashboard.js';
import { state } from '../shell.js';

// ---------------------------------------------------------------------------
// Students and their responses
// ---------------------------------------------------------------------------
export async function renderRegistrations(data, reload) {
  const { event, counts } = data;
  const result = await api.get(`/events/${event.id}/registrations`);

  const addStudent = () => {
    const results = h('div');
    const search = h('input', {
      type: 'search',
      placeholder: 'Search by name, campus ID or email',
      oninput: async (searchEvent) => {
        const term = searchEvent.target.value.trim();
        if (term.length < 2) { results.replaceChildren(h('p.small.muted', 'Type at least two characters.')); return; }
        const found = await api.get(`/students?search=${encodeURIComponent(term)}&limit=12`);
        results.replaceChildren(found.rows.length
          ? h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } }, found.rows.map((student) => h('li', { style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
            h('.spread',
              h('div', h('strong', student.name), h('span.small.muted', ` ${student.campus_id}`)),
              h('button.btn.btn-small', {
                type: 'button',
                onclick: async (clickEvent) => {
                  clickEvent.currentTarget.disabled = true;
                  await api.post(`/events/${event.id}/registrations`, { student_id: student.id, status: 'registered' });
                  toast(`${student.name} added with a confirmed place.`);
                  close();
                  reload('students');
                },
              }, 'Add as registered')))))
          : h('p.small.muted', 'No student matches that.'));
      },
    });
    const { close } = modal({
      title: 'Add a student to this event',
      body: frag(
        h('p.small.muted', 'Use this for a student who asked in person, outside the audience rules.'),
        h('label.field', h('span.label', 'Find a student'), search),
        results),
    });
  };

  return frag(
    tiles([
      { label: 'Invited', value: counts.invited },
      { label: 'Registered', value: counts.registered, note: `${percent(counts.registration_rate)} of invited` },
      { label: 'Declined', value: counts.declined },
      { label: 'No response', value: counts.no_response },
      counts.waitlisted ? { label: 'Waiting list', value: counts.waitlisted } : null,
    ].filter(Boolean)),

    panel({
      title: 'Students on this event',
      hint: 'Each row carries the personal registration link used in every message to that student.',
      actions: frag(
        event.status !== 'cancelled' ? h('button.btn.btn-small', { onclick: addStudent }, icon('plus'), 'Add a student') : null,
        downloadLink(`/api/events/${event.id}/registrations.csv`, 'Export CSV')),
      flush: true,
      body: dataTable([
        {
          label: 'Student',
          render: (row) => frag(
            h('a.row-title', { href: `/students/${row.student_id}` }, row.name),
            h('span.sub', `${row.campus_id} · ${row.email}`)),
        },
        { label: 'Programme', render: (row) => frag(h('span.small', row.discipline || ''), row.year_of_study ? h('span.sub', `Year ${row.year_of_study}`) : null) },
        {
          label: 'Response',
          render: (row) => frag(
            registrationBadge(row.status),
            row.responded_at ? h('span.sub.nowrap', relative(row.responded_at)) : null),
        },
        { label: 'Attended', render: (row) => row.attended ? badge('Present', 'sent') : (event.is_past ? badge('No record', 'neutral') : h('span.muted.small', 'Not yet')) },
        { label: 'Messages', num: true, render: (row) => h('span.tabular', String(row.messages_sent)) },
        { label: 'Feedback', render: (row) => row.has_feedback ? badge('Received', 'sent') : null },
        {
          label: '',
          render: (row) => h('.row-tight',
            h('button.btn.btn-small', { onclick: () => studentActions(event, row, reload) }, 'Change'),
            h('a.btn.btn-small', { href: `/r/${row.token}`, target: '_blank', rel: 'noopener', 'data-external': 'true' }, icon('eye'))),
        },
      ], result.rows, {
        empty: {
          title: 'No students yet',
          text: 'Add a group or a filter on the audience tab, and the student list fills itself in.',
        },
      }),
    }));
}

function registrationBadge(status) {
  const kinds = { registered: 'sent', declined: 'failed', waitlisted: 'skipped', invited: 'neutral', cancelled: 'neutral' };
  const labels = { registered: 'Confirmed', declined: 'Declined', waitlisted: 'Waiting list', invited: 'No response', cancelled: 'Withdrawn' };
  return badge(labels[status] || status, kinds[status] || 'neutral');
}

function studentActions(event, row, reload) {
  formModal({
    title: row.name,
    intro: `${row.campus_id}. Changing a response here is recorded against Career Services rather than the student.`,
    submitLabel: 'Save',
    fields: [
      field({
        label: 'Response',
        name: 'status',
        type: 'select',
        value: row.status,
        span: true,
        options: state.meta.registration_statuses,
      }),
      field({ label: 'Attended', name: 'attended', type: 'checkbox', value: row.attended, span: true }),
    ],
    onSubmit: async (values, { close }) => {
      await api.patch(`/events/${event.id}/registrations/${row.id}`, {
        status: values.status,
        attended: values.attended,
      });
      close();
      toast('Student updated.');
      reload('students');
    },
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
export async function renderAttendance(data, reload) {
  const { event, counts } = data;
  const result = await api.get(`/events/${event.id}/registrations?status=registered`);
  const selected = new Set();

  const selectAll = h('input', {
    type: 'checkbox',
    onchange: (checkEvent) => {
      const on = checkEvent.target.checked;
      for (const box of table.querySelectorAll('input[data-reg]')) {
        box.checked = on;
        if (on) selected.add(box.dataset.reg);
        else selected.delete(box.dataset.reg);
      }
      updateBulk();
    },
  });

  const bulkNote = h('span.small.muted', 'Nothing selected.');
  const markPresent = h('button.btn.btn-small', { disabled: true, onclick: () => bulk(true) }, icon('check'), 'Mark present');
  const markAbsent = h('button.btn.btn-small', { disabled: true, onclick: () => bulk(false) }, 'Mark absent');

  function updateBulk() {
    const count = selected.size;
    bulkNote.textContent = count ? `${plural(count, 'student')} selected.` : 'Nothing selected.';
    markPresent.disabled = count === 0;
    markAbsent.disabled = count === 0;
  }

  async function bulk(attended) {
    const ids = [...selected];
    await api.post(`/events/${event.id}/attendance/bulk`, { registration_ids: ids, attended });
    toast(`${plural(ids.length, 'student')} marked ${attended ? 'present' : 'absent'}.`);
    reload('attendance');
  }

  const table = dataTable([
    {
      label: h('label', selectAll),
      render: (row) => h('input', {
        type: 'checkbox',
        'data-reg': row.id,
        checked: selected.has(row.id),
        onchange: (checkEvent) => {
          if (checkEvent.target.checked) selected.add(row.id);
          else selected.delete(row.id);
          updateBulk();
        },
      }),
    },
    {
      label: 'Student',
      render: (row) => frag(h('span.row-title', row.name), h('span.sub', `${row.campus_id} · ${row.discipline || ''}`)),
    },
    { label: 'Checked in', render: (row) => row.checked_in_at ? h('span.small', relative(row.checked_in_at)) : null },
    {
      label: 'Attendance',
      render: (row) => h('.row-tight',
        h('button.btn.btn-small', {
          class: row.attended ? 'btn-primary' : '',
          onclick: async () => {
            await api.patch(`/events/${event.id}/registrations/${row.id}`, { attended: !row.attended });
            reload('attendance');
          },
        }, row.attended ? frag(icon('check'), 'Present') : 'Mark present')),
    },
  ], result.rows, {
    empty: {
      title: 'Nobody has a confirmed place yet',
      text: 'Attendance is marked against students who registered. Walk-ins can be added by importing an attendance sheet.',
    },
  });

  return frag(
    tiles([
      { label: 'Registered', value: counts.registered },
      { label: 'Marked present', value: counts.attended, note: counts.registered ? `${percent(counts.attendance_rate)} of registered` : '' },
      { label: 'Not marked', value: Math.max(0, counts.registered - counts.attended) },
    ]),

    counts.attended === 0 && event.is_past
      ? notice('warning', 'Attendance has not been marked. The thank you, absence and feedback messages have nobody to go to until it is.')
      : null,

    panel({
      title: 'Mark attendance',
      hint: 'Marking attendance is what releases the thank you, absence and feedback messages.',
      actions: frag(
        h('button.btn.btn-small', {
          onclick: () => confirmModal({
            title: 'Mark everyone present',
            message: `Mark all ${counts.registered} registered students as present? You can then correct the exceptions.`,
            confirmLabel: 'Mark all present',
            onConfirm: async () => {
              const changed = await api.post(`/events/${event.id}/attendance/all-registered`);
              toast(`${plural(changed.changed, 'student')} marked present.`);
              reload('attendance');
            },
          }),
        }, 'Mark everyone present'),
        csvPicker({
          label: 'Import an attendance sheet',
          onFile: async (text) => {
            const report = await api.postText(`/events/${event.id}/attendance/import`, text);
            toast(`${plural(report.marked, 'row')} applied, ${report.walk_ins} walk-ins added, ${report.unknown.length} unmatched.`);
            if (report.unknown.length) {
              modal({
                title: 'Rows that did not match',
                body: frag(
                  h('p.small.muted', 'These campus IDs are not on the student list. Add them under Students, then import again.'),
                  h('ul', report.unknown.slice(0, 40).map((u) => h('li.mono', `Line ${u.line}: ${u.campus_id}`)))),
              });
            }
            reload('attendance');
          },
        })),
      flush: true,
      body: frag(
        h('.filters', bulkNote, markPresent, markAbsent),
        table),
    }));
}

// ---------------------------------------------------------------------------
// Outbox for one event
// ---------------------------------------------------------------------------
export async function renderMessages(data, reload) {
  const { event } = data;
  const result = await api.get(`/events/${event.id}/messages${query({ limit: 300 })}`);

  const adHoc = () => formModal({
    title: 'Send a one-off message',
    wide: true,
    intro: 'For anything the schedule does not cover: a room change, an extra instruction, a note to the students who have not replied.',
    submitLabel: 'Queue the message',
    fields: [
      field({ label: 'Internal label', name: 'label', value: 'Message from Career Services', required: true, span: true }),
      field({ label: 'Goes to', name: 'audience_rule', type: 'select', value: 'registered', options: state.meta.audience_rules }),
      field({ label: 'Channel', name: 'channel', type: 'select', value: 'email', options: state.meta.channels }),
      field({ label: 'Subject', name: 'subject', span: true, required: true }),
      field({
        label: 'Message',
        name: 'body',
        type: 'textarea',
        span: true,
        rows: 10,
        hint: 'Merge fields work here too, for example {{student.first_name}} and {{event.venue}}.',
        value: 'Dear {{student.first_name}},\n\n\n\nRegards,\n\nCareer Services\n{{org.name}}',
      }),
    ],
    onSubmit: async (values, { close }) => {
      const queued = await api.post(`/events/${event.id}/messages/ad-hoc`, values);
      close();
      toast(`${plural(queued.queued, 'message')} queued${queued.skipped ? `, ${queued.skipped} unreachable` : ''}.`);
      reload('messages');
    },
  });

  return frag(
    panel({
      title: 'Outbox',
      hint: 'Every message this event has sent, is waiting to send, or decided not to send.',
      actions: event.status !== 'cancelled'
        ? h('button.btn.btn-small', { onclick: adHoc }, icon('send'), 'Send a one-off message')
        : null,
      flush: true,
      body: dataTable([
        {
          label: 'Message',
          render: (row) => frag(h('span.row-title', row.label || row.subject || 'Message'), h('span.sub', row.subject || '')),
        },
        { label: 'To', render: (row) => frag(h('span', row.student_name), h('span.sub', row.to_address || 'No address')) },
        { label: 'Channel', render: (row) => h('span.small', row.channel === 'email' ? 'Email' : row.channel === 'sms' ? 'SMS' : 'WhatsApp') },
        { label: 'Scheduled', render: (row) => frag(h('span.nowrap.small', row.scheduled_local), h('span.sub.nowrap', row.scheduled_relative)) },
        { label: 'Status', render: (row) => messageStatus(row) },
        {
          label: 'Engagement',
          render: (row) => row.status === 'sent'
            ? h('.row-tight', row.opened_at ? badge('Opened', 'sent') : null, row.clicked_at ? badge('Clicked', 'sent') : null)
            : null,
        },
        { label: '', render: (row) => h('button.btn.btn-small', { onclick: () => showMessage(row.id, reload) }, icon('eye')) },
      ], result.rows, {
        empty: {
          title: 'Nothing in the outbox',
          text: event.status === 'draft'
            ? 'Messages are created when the event is published.'
            : 'Add a reminder to the schedule to fill the outbox.',
        },
      }),
    }),
    result.total > result.rows.length ? h('p.small.muted', `Showing ${result.rows.length} of ${result.total}.`) : null);
}

export function messageStatus(row) {
  const labels = {
    sent: ['Sent', 'sent'],
    scheduled: ['Waiting', 'neutral'],
    sending: ['Sending', 'neutral'],
    failed: ['Failed', 'failed'],
    skipped: ['Skipped', 'skipped'],
    cancelled: ['Withdrawn', 'neutral'],
  };
  const [label, kind] = labels[row.status] || [row.status, 'neutral'];
  return frag(
    badge(label, kind),
    row.skip_reason ? h('span.sub', row.skip_reason) : null,
    row.last_error ? h('span.sub', { style: { color: 'var(--alert-700)' } }, row.last_error) : null);
}

export async function showMessage(id, reload) {
  const message = await api.get(`/messages/${id}`);
  const actions = [];
  if (message.status === 'scheduled' && !state.meta.is_draft_mode) {
    actions.push(h('button.btn', {
      onclick: async (clickEvent) => {
        clickEvent.currentTarget.disabled = true;
        await api.post(`/messages/${id}/send-now`);
        toast('Message sent.');
        if (reload) reload();
      },
    }, icon('send'), 'Send now'));
  }
  if (message.status === 'scheduled') {
    actions.push(h('button.btn.btn-danger', {
      onclick: async (clickEvent) => {
        clickEvent.currentTarget.disabled = true;
        await api.post(`/messages/${id}/cancel`);
        toast('Message withdrawn.');
        if (reload) reload();
      },
    }, 'Withdraw'));
  }

  modal({
    title: message.label || 'Message',
    wide: true,
    body: frag(
      h('.detail-row', h('dt', 'To'), h('dd', `${message.student_name} (${message.campus_id}), ${message.to_address || 'no address'}`)),
      h('.detail-row', h('dt', 'Scheduled'), h('dd', `${message.scheduled_local} (${message.scheduled_relative})`)),
      h('.detail-row', h('dt', 'Status'), h('dd', messageStatus(message))),
      message.sent_at ? h('.detail-row', h('dt', 'Sent'), h('dd', `${relative(message.sent_at)} via ${message.provider || 'unknown'}`)) : null,
      message.opened_at ? h('.detail-row', h('dt', 'Opened'), h('dd', relative(message.opened_at))) : null,
      message.clicked_at ? h('.detail-row', h('dt', 'Link followed'), h('dd', relative(message.clicked_at))) : null,
      h('.message-preview', { style: { marginTop: '16px' } },
        message.subject ? h('.preview-subject', message.subject) : null,
        h('pre', message.body || ''))),
    actions: actions.length ? frag(actions) : null,
  });
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
export async function renderFeedback(data) {
  const { event } = data;
  if (event.feedback_mode === 'none') {
    return panel({ title: 'Feedback', body: h('p.muted', 'Feedback collection is switched off for this event.') });
  }
  if (event.feedback_mode === 'external') {
    return panel({
      title: 'Feedback',
      body: frag(
        h('p', 'This event uses an external feedback form, so responses are not recorded here.'),
        h('p', h('a', { href: event.feedback_form_url, target: '_blank', rel: 'noopener' }, event.feedback_form_url))),
    });
  }

  const result = await api.get(`/events/${event.id}/feedback`);
  const summary = result.summary;

  if (summary.responses === 0) {
    return panel({
      title: 'Feedback',
      flush: true,
      body: emptyState({
        title: 'No responses yet',
        text: 'The feedback form goes out after the event, to the students marked present.',
      }),
    });
  }

  const labels = {
    overall_rating: 'Overall',
    content_rating: 'Content',
    speaker_rating: 'Speaker',
    organisation_rating: 'Organisation',
  };

  return frag(
    tiles([
      { label: 'Responses', value: summary.responses, note: `${percent(data.counts.feedback_rate)} of attendees` },
      { label: 'Overall rating', value: summary.averages.overall_rating ?? 'None yet', note: 'out of 5' },
      { label: 'Would recommend', value: summary.recommend_rate === null ? 'None yet' : `${summary.recommend_rate}%` },
    ]),

    h('.grid-2',
      panel({
        title: 'Ratings',
        body: frag(
          Object.entries(labels).map(([key, label]) => summary.averages[key] === null || summary.averages[key] === undefined
            ? null
            : h('div', { style: { marginBottom: '12px' } },
              h('.spread.small', h('span', label), h('span.tabular', `${summary.averages[key]} / 5`)),
              bar(summary.averages[key], 5, { good: summary.averages[key] >= 4 }))),
          h('hr.rule'),
          h('h3', 'Overall rating spread'),
          h('.dist', summary.distribution.map((count, index) => h('.dist-row',
            h('span.tabular', String(index + 1)),
            bar(count, summary.responses),
            h('span.tabular.muted', String(count)))).reverse())),
      }),

      panel({
        title: 'What students wrote',
        actions: downloadLink(`/api/events/${event.id}/feedback.csv`, 'Export CSV'),
        body: summary.comments.length
          ? h('div', summary.comments.slice(0, 20).map((comment) => h('div', { style: { paddingBottom: '12px', marginBottom: '12px', borderBottom: '1px solid var(--line)' } },
            h('.small.muted', `Rated ${comment.overall_rating} out of 5, ${relative(comment.submitted_at)}`),
            comment.most_useful ? h('p.small', h('strong', 'Most useful: '), comment.most_useful) : null,
            comment.improvements ? h('p.small', h('strong', 'Would change: '), comment.improvements) : null,
            comment.future_topics ? h('p.small', h('strong', 'Wants next: '), comment.future_topics) : null)))
          : h('p.muted', 'No written comments yet.'),
      })));
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
export async function renderActivity(data) {
  const result = await api.get(`/events/${data.event.id}/activity?limit=200`);
  return panel({
    title: 'Activity',
    hint: 'Everything the system and the team have done to this event.',
    body: result.rows.length
      ? h('ul.timeline', result.rows.map((row) => h('li',
        h('.timeline-title', describeAction(row)),
        h('.timeline-when', `${relative(row.created_at)} · ${row.actor}`))))
      : h('p.muted', 'Nothing recorded yet.'),
  });
}
