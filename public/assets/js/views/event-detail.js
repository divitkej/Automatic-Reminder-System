import { h, frag, formValues } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { setHeader, setMain, state } from '../shell.js';
import {
  panel, tabs, dataTable, detailList, notice, field, statusBadge, badge,
  toast, formModal, confirmModal, modal, bar, emptyState,
} from '../components.js';
import { offsetLabel, splitOffset, minutesFrom, relative, plural } from '../format.js';
import { renderRegistrations, renderAttendance, renderMessages, renderFeedback, renderActivity } from './event-people.js';

export async function eventDetailView({ id, tab = 'overview' }) {
  const data = await api.get(`/events/${id}`);
  const event = data.event;
  const reload = (nextTab = tab) => eventDetailView({ id, tab: nextTab });

  setHeader({
    title: event.name,
    subtitle: `${event.type_label} · ${event.date_full}, ${event.time_range} ${event.timezone_label}`,
    back: { href: '/events', label: 'All events' },
    actions: headerActions(event, data, reload),
  });

  const tabItems = [
    { href: `/events/${id}`, label: 'Overview' },
    { href: `/events/${id}/audience`, label: 'Audience', count: data.counts.invited },
    { href: `/events/${id}/reminders`, label: 'Reminders', count: data.rules.filter((r) => r.enabled).length },
    { href: `/events/${id}/students`, label: 'Students', count: data.counts.registered },
    { href: `/events/${id}/attendance`, label: 'Attendance', count: data.counts.attended },
    { href: `/events/${id}/messages`, label: 'Outbox' },
    { href: `/events/${id}/feedback`, label: 'Feedback', count: data.counts.feedback_received },
    { href: `/events/${id}/activity`, label: 'Activity' },
  ];
  const currentHref = tab === 'overview' ? `/events/${id}` : `/events/${id}/${tab}`;

  const bodies = {
    overview: () => renderOverview(data, reload),
    audience: () => renderAudience(data, reload),
    reminders: () => renderReminders(data, reload),
    students: () => renderRegistrations(data, reload),
    attendance: () => renderAttendance(data, reload),
    messages: () => renderMessages(data, reload),
    feedback: () => renderFeedback(data, reload),
    activity: () => renderActivity(data, reload),
  };
  const render = bodies[tab] || bodies.overview;

  setMain(
    statusBanner(event, data, reload),
    tabs(tabItems, currentHref),
    await render());
}

// ---------------------------------------------------------------------------
// Header and status
// ---------------------------------------------------------------------------
function headerActions(event, data, reload) {
  const actions = [];

  if (event.status === 'draft') {
    actions.push(h('button.btn.btn-primary', {
      disabled: !data.readiness.ready,
      title: data.readiness.ready ? '' : 'Resolve the blockers below first.',
      onclick: () => publish(event.id, data, reload),
    }, icon('send'), 'Publish and start reminders'));
  }
  if (event.status === 'scheduled') {
    actions.push(h('button.btn', { onclick: () => completeEvent(event, reload) }, icon('check'), 'Close the event'));
  }
  if (event.status !== 'cancelled') {
    actions.push(h('button.btn', { onclick: () => editEvent(event, reload) }, icon('edit'), 'Edit'));
  }
  actions.push(h('button.btn', { onclick: () => duplicateEvent(event) }, icon('copy'), 'Duplicate'));

  if (event.status === 'scheduled' || event.status === 'completed') {
    actions.push(h('button.btn.btn-danger', { onclick: () => cancelEvent(event, reload) }, 'Cancel event'));
  } else if (event.status === 'draft') {
    actions.push(h('button.btn.btn-danger', { onclick: () => deleteEvent(event) }, icon('trash'), 'Delete'));
  }
  return frag(actions);
}

function statusBanner(event, data, reload) {
  if (event.status === 'cancelled') {
    return notice('error', h('div',
      h('p', h('strong', 'This event is cancelled.'),
        event.cancellation_reason ? ` ${event.cancellation_reason}` : ''),
      h('p.small', 'Every pending message has been withdrawn.')));
  }

  if (event.status === 'draft') {
    const readiness = data.readiness;
    return notice(readiness.ready ? 'info' : 'warning', h('div',
      h('p', h('strong', 'This event is a draft.'), ' Nothing is sent to students until it is published.'),
      readiness.blockers.length
        ? frag(h('p.small', 'Before it can be published:'), h('ul', readiness.blockers.map((b) => h('li', b))))
        : h('p.small', `Ready to publish: ${plural(readiness.audience_count, 'student')}, ${plural(readiness.rule_count, 'reminder')}.`),
      readiness.warnings.length
        ? frag(h('p.small', { style: { marginTop: '8px' } }, 'Worth checking:'), h('ul', readiness.warnings.map((w) => h('li', w))))
        : null));
  }

  if (event.status === 'completed') {
    return notice('info', h('p',
      h('strong', 'This event is closed.'),
      ' Post event messages and the feedback chase still run on their schedule.'));
  }

  const pending = data.schedule.reduce((sum, row) => sum + (row.pending || 0), 0);
  return notice('good', h('div',
    h('p', h('strong', 'Reminders are live.'), ` ${plural(pending, 'message')} still to go out.`),
    data.readiness.warnings.length
      ? h('ul.small', data.readiness.warnings.map((w) => h('li', w)))
      : null));
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function renderOverview(data, reload) {
  const { event, counts } = data;
  const registrationBar = h('div',
    h('.row-tight.small', h('span', `${counts.registered} of ${counts.invited} invited`), h('span.muted', `${counts.registration_rate}%`)),
    bar(counts.registered, counts.invited || 1));

  return frag(
    h('.grid-2',
      panel({
        title: 'Event details',
        actions: event.status !== 'cancelled'
          ? h('button.btn.btn-small', { onclick: () => editEvent(event, reload) }, icon('edit'), 'Edit')
          : null,
        body: detailList([
          ['Status', statusBadge(event.status)],
          ['Type', event.type_label],
          event.company && ['Organisation', event.company],
          event.speaker && ['Speaker', event.speaker_title ? `${event.speaker}, ${event.speaker_title}` : event.speaker],
          ['Date', event.date_full],
          ['Time', `${event.time_range} (${event.timezone_label})`],
          ['Mode', event.mode === 'in_person' ? 'In person' : event.mode === 'online' ? 'Online' : 'Hybrid'],
          event.venue && ['Venue', event.venue],
          event.meeting_link && ['Meeting link', h('a', { href: event.meeting_link, target: '_blank', rel: 'noopener' }, event.meeting_link)],
          ['Capacity', event.capacity ? `${event.capacity} seats, ${data.seats_remaining} left` : 'No limit'],
          event.dress_code && ['Dress code', event.dress_code],
          ['Feedback', event.feedback_mode === 'builtin' ? 'Built in form'
            : event.feedback_mode === 'external' ? h('a', { href: event.feedback_form_url, target: '_blank', rel: 'noopener' }, 'External form')
              : 'Not collected'],
          event.description && ['Description', h('div.small', event.description)],
          event.preparation_notes && ['Preparation', h('div.small', event.preparation_notes)],
        ]),
      }),

      panel({
        title: 'Where things stand',
        body: frag(
          h('.tiles', { style: { marginBottom: '16px' } },
            h('.tile', h('.tile-label', 'Invited'), h('.tile-value', String(counts.invited))),
            h('.tile', h('.tile-label', 'Registered'), h('.tile-value', String(counts.registered)), h('.tile-note', `${counts.registration_rate}% of invited`)),
            h('.tile', h('.tile-label', 'Attended'), h('.tile-value', String(counts.attended)), h('.tile-note', counts.registered ? `${counts.attendance_rate}% of registered` : '')),
            h('.tile', h('.tile-label', 'Feedback'), h('.tile-value', String(counts.feedback_received)), h('.tile-note', counts.attended ? `${counts.feedback_rate}% of attendees` : ''))),
          registrationBar,
          h('hr.rule'),
          h('h3', 'Responses'),
          detailList([
            ['Confirmed', String(counts.registered)],
            ['Declined', String(counts.declined)],
            ['No response yet', String(counts.no_response)],
            counts.waitlisted > 0 && ['On the waiting list', String(counts.waitlisted)],
          ]),
          h('p', { style: { marginTop: '12px' } },
            h('a.btn.btn-small', { href: `/events/${event.id}/students` }, 'Open the student list'))),
      })),

    panel({
      title: 'Message schedule',
      hint: 'Every message this event will send, and what has happened to it.',
      actions: h('a.btn.btn-small', { href: `/events/${event.id}/reminders` }, 'Edit the schedule'),
      flush: true,
      body: scheduleTimeline(data),
    }));
}

function scheduleTimeline(data) {
  if (data.schedule.length === 0) {
    return emptyState({
      title: 'Nothing has been scheduled yet',
      text: data.event.status === 'draft'
        ? 'Messages are created when the event is published.'
        : 'Add a reminder, or apply the default schedule for this event type.',
    });
  }
  return dataTable([
    {
      label: 'Message',
      render: (row) => frag(
        h('span.row-title', row.label || 'Message'),
        h('span.sub', row.category.replace('_', ' '))),
    },
    { label: 'When', render: (row) => frag(h('span.nowrap', row.scheduled_local), h('span.sub.nowrap', row.scheduled_relative)) },
    { label: 'Recipients', num: true, render: (row) => h('span.tabular', String(row.total)) },
    {
      label: 'Outcome',
      render: (row) => h('.row-tight',
        row.sent ? badge(`${row.sent} sent`, 'sent') : null,
        row.pending ? badge(`${row.pending} waiting`, 'neutral') : null,
        row.failed ? badge(`${row.failed} failed`, 'failed') : null,
        row.skipped ? badge(`${row.skipped} skipped`, 'skipped') : null,
        row.cancelled ? badge(`${row.cancelled} withdrawn`, 'neutral') : null),
    },
    {
      label: 'Opened',
      num: true,
      render: (row) => row.sent
        ? frag(h('span.tabular', `${row.opened}`), h('span.sub', `${Math.round((row.opened / row.sent) * 100)}%`))
        : null,
    },
  ], data.schedule);
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------
async function renderAudience(data, reload) {
  const { event } = data;
  const groups = await api.get('/groups');
  const facets = await api.get('/students/facets');

  const addGroup = () => formModal({
    title: 'Add a student group',
    submitLabel: 'Add to the audience',
    fields: [field({
      label: 'Group',
      name: 'ref_id',
      type: 'select',
      span: true,
      required: true,
      options: groups.rows.map((g) => ({ value: g.id, label: `${g.name} (${g.member_count} students)` })),
    })],
    onSubmit: async (values, { close }) => {
      const result = await api.post(`/events/${event.id}/audience`, { kind: 'group', ref_id: values.ref_id });
      close();
      toast(`Audience updated. ${plural(result.sync.added, 'student')} added.`);
      reload('audience');
    },
  });

  const addFilter = () => formModal({
    title: 'Add students by filter',
    intro: 'A filter is recalculated every time the audience is resolved, so students who become eligible later are picked up automatically.',
    submitLabel: 'Add to the audience',
    fields: [
      field({ label: 'Programme', name: 'programs', type: 'select', options: [{ value: '', label: 'Any' }, ...facets.programs.map((p) => ({ value: p, label: p }))] }),
      field({ label: 'Discipline', name: 'disciplines', type: 'select', options: [{ value: '', label: 'Any' }, ...facets.disciplines.map((d) => ({ value: d, label: d }))] }),
      field({ label: 'Year of study', name: 'years', type: 'select', options: [{ value: '', label: 'Any' }, ...facets.years.map((y) => ({ value: y, label: `Year ${y}` }))] }),
      field({ label: 'Batch', name: 'batches', type: 'select', options: [{ value: '', label: 'Any' }, ...facets.batches.map((b) => ({ value: b, label: b }))] }),
      field({ label: 'Minimum CGPA', name: 'minCgpa', type: 'number', min: 0, max: 10, step: '0.01' }),
    ],
    onSubmit: async (values, { close }) => {
      const filter = {};
      for (const key of ['programs', 'disciplines', 'years', 'batches']) {
        if (values[key]) filter[key] = [values[key]];
      }
      if (values.minCgpa) filter.minCgpa = values.minCgpa;
      if (Object.keys(filter).length === 0) throw new Error('Choose at least one condition, otherwise this would add every student.');
      const result = await api.post(`/events/${event.id}/audience`, { kind: 'filter', filter });
      close();
      toast(`Audience updated. ${plural(result.sync.added, 'student')} added.`);
      reload('audience');
    },
  });

  const addStudent = () => {
    const results = h('div');
    const search = h('input', {
      type: 'search',
      placeholder: 'Search by name, campus ID or email',
      oninput: async (event2) => {
        const term = event2.target.value.trim();
        if (term.length < 2) { results.replaceChildren(h('p.small.muted', 'Type at least two characters.')); return; }
        const found = await api.get(`/students?search=${encodeURIComponent(term)}&limit=12`);
        results.replaceChildren(found.rows.length
          ? h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } }, found.rows.map((student) => h('li', { style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
            h('.spread',
              h('div', h('strong', student.name), h('span.sub.small.muted', ` ${student.campus_id}`)),
              h('button.btn.btn-small', {
                type: 'button',
                onclick: async (clickEvent) => {
                  clickEvent.currentTarget.disabled = true;
                  await api.post(`/events/${event.id}/audience`, { kind: 'student', ref_id: student.id });
                  toast(`${student.name} added to the audience.`);
                  close();
                  reload('audience');
                },
              }, 'Add')))))
          : h('p.small.muted', 'No student matches that.'));
      },
    });
    const { close } = modal({
      title: 'Add one student',
      body: frag(h('label.field', h('span.label', 'Find a student'), search), results),
    });
  };

  return frag(
    panel({
      title: 'Who this event targets',
      hint: 'Groups, filters and individual students are combined. A student in more than one row is only counted once.',
      actions: event.status !== 'cancelled' ? frag(
        h('button.btn.btn-small', { onclick: addGroup, disabled: groups.rows.length === 0 }, icon('plus'), 'Add a group'),
        h('button.btn.btn-small', { onclick: addFilter }, icon('filter'), 'Add a filter'),
        h('button.btn.btn-small', { onclick: addStudent }, icon('plus'), 'Add one student'),
      ) : null,
      flush: true,
      body: dataTable([
        { label: 'Source', render: (row) => frag(h('span.row-title', row.label), h('span.sub', row.detail)) },
        { label: 'Kind', render: (row) => badge(row.kind === 'group' ? 'Group' : row.kind === 'filter' ? 'Filter' : 'Student', 'neutral') },
        { label: 'Students', num: true, render: (row) => h('span.tabular', String(row.student_count)) },
        {
          label: '',
          render: (row) => event.status === 'cancelled' ? null : h('button.btn.btn-small.btn-danger', {
            onclick: () => confirmModal({
              title: 'Remove from the audience',
              message: `Remove ${row.label} from this event's audience? Students who have already been written to, or who have replied, keep their place.`,
              confirmLabel: 'Remove',
              danger: true,
              onConfirm: async () => {
                const result = await api.del(`/events/${event.id}/audience/${row.id}`);
                toast(`${plural(result.sync.withdrawn, 'invitation')} withdrawn.`);
                reload('audience');
              },
            }),
          }, 'Remove'),
        },
      ], data.audience, {
        empty: {
          title: 'No target students yet',
          text: 'Add a group, a filter or individual students. This is what decides who receives every message.',
        },
      }),
    }),

    panel({
      title: 'Resolved audience',
      hint: `${plural(data.audience_preview.total, 'student')} after combining every row and removing anyone who has opted out.`,
      body: frag(
        data.audience_preview.opted_out > 0
          ? notice('warning', `${plural(data.audience_preview.opted_out, 'targeted student')} ${data.audience_preview.opted_out === 1 ? 'has' : 'have'} opted out of Career Services mail and will not be contacted.`)
          : null,
        data.audience_preview.reachable_by_email < data.audience_preview.total
          ? notice('warning', `${data.audience_preview.total - data.audience_preview.reachable_by_email} students have no email address on record.`)
          : null,
        data.audience_preview.total
          ? frag(
            h('p.small.muted', `First ${Math.min(25, data.audience_preview.students.length)} shown.`),
            h('.row-tight', data.audience_preview.students.map((s) => badge(`${s.name} · ${s.campus_id}`, 'neutral'))))
          : h('p.muted', 'Nothing yet.')),
    }));
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
async function renderReminders(data, reload) {
  const { event } = data;
  const detail = await api.get(`/events/${event.id}/rules`);
  const templates = await api.get('/templates');

  const applyPreset = () => confirmModal({
    title: 'Apply the default schedule',
    message: `This adds the standard ${event.type_label.toLowerCase()} schedule. Reminders whose send time has already passed are left out. Existing reminders are kept.`,
    confirmLabel: 'Apply',
    onConfirm: async () => {
      const result = await api.post(`/events/${event.id}/rules/apply-preset`, { replace: false });
      toast(`${plural(result.created, 'reminder')} added${result.dropped.length ? `, ${result.dropped.length} skipped as already past` : ''}.`);
      reload('reminders');
    },
  });

  return frag(
    panel({
      title: 'Reminder schedule',
      hint: 'Timings are relative to the event, so moving the event moves every reminder with it.',
      actions: event.status !== 'cancelled' ? frag(
        h('button.btn.btn-small', { onclick: applyPreset }, 'Apply the default schedule'),
        h('button.btn.btn-small.btn-primary', { onclick: () => ruleModal({ event, templates: templates.rows, reload }) }, icon('plus'), 'Add a reminder'),
      ) : null,
      flush: true,
      body: dataTable([
        {
          label: 'Message',
          render: (rule) => frag(
            h('span.row-title', rule.label),
            h('span.sub', `${rule.category_label}${rule.template ? ` · ${rule.template.name}` : ' · no template'}`),
            rule.warnings.length ? h('span.sub', { style: { color: 'var(--warn-700)' } }, rule.warnings.join(' ')) : null),
        },
        {
          label: 'Sends',
          render: (rule) => frag(
            h('span.nowrap', rule.send_at_local),
            h('span.sub.nowrap', `${offsetLabel(rule.offset_minutes)} ${rule.anchor === 'end' ? 'the end' : rule.anchor === 'registration_close' ? 'the deadline' : 'the start'}`)),
        },
        { label: 'Goes to', render: (rule) => frag(h('span.small', rule.audience_label), h('span.sub', `${rule.recipients} now`)) },
        { label: 'Channel', render: (rule) => h('span.small', rule.channel_label) },
        {
          label: 'State',
          render: (rule) => rule.enabled
            ? (rule.is_past ? badge('Passed', 'neutral') : badge('On', 'sent'))
            : badge('Off', 'skipped'),
        },
        {
          label: '',
          render: (rule) => h('.row-tight',
            h('button.btn.btn-small', { onclick: () => previewRule(event, rule) }, icon('eye'), 'Preview'),
            event.status !== 'cancelled' ? frag(
              h('button.btn.btn-small', { onclick: () => ruleModal({ event, rule, templates: templates.rows, reload }) }, 'Edit'),
              h('button.btn.btn-small', {
                onclick: async () => {
                  await api.patch(`/events/${event.id}/rules/${rule.id}`, { enabled: !rule.enabled });
                  toast(rule.enabled ? 'Reminder switched off and pending copies withdrawn.' : 'Reminder switched on.');
                  reload('reminders');
                },
              }, rule.enabled ? 'Turn off' : 'Turn on'),
              h('button.btn.btn-small.btn-danger', {
                onclick: () => confirmModal({
                  title: 'Delete this reminder',
                  message: `Delete "${rule.label}"? Any copy still waiting to be sent is withdrawn. Messages already sent are kept in the outbox.`,
                  confirmLabel: 'Delete',
                  danger: true,
                  onConfirm: async () => {
                    await api.del(`/events/${event.id}/rules/${rule.id}`);
                    toast('Reminder deleted.');
                    reload('reminders');
                  },
                }),
              }, icon('trash'))) : null),
        },
      ], detail.rules, {
        empty: {
          title: 'No reminders yet',
          text: 'Apply the default schedule for this event type, or add reminders one at a time.',
          action: h('p', h('button.btn.btn-primary', { onclick: applyPreset }, 'Apply the default schedule')),
        },
      }),
    }));
}

function ruleModal({ event, rule, templates, reload }) {
  const editing = Boolean(rule);
  const split = splitOffset(rule ? rule.offset_minutes : -1440);
  const templateOptions = (channel, category) => [
    { value: '', label: 'Choose the best match automatically' },
    ...templates
      .filter((t) => t.channel === channel && (!category || t.category === category))
      .filter((t) => !t.event_type || t.event_type === event.type)
      .map((t) => ({ value: t.id, label: t.name })),
  ];

  const { form } = formModal({
    title: editing ? 'Edit reminder' : 'Add a reminder',
    submitLabel: editing ? 'Save' : 'Add reminder',
    wide: true,
    fields: [
      field({ label: 'Label', name: 'label', value: rule ? rule.label : '', required: true, span: true, hint: 'How this message appears in the schedule. Students never see it.' }),
      field({
        label: 'Kind of message',
        name: 'category',
        type: 'select',
        required: true,
        value: rule ? rule.category : 'reminder',
        options: state.meta.message_categories,
        attrs: { onchange: onShapeChange },
      }),
      field({
        label: 'Channel',
        name: 'channel',
        type: 'select',
        value: rule ? rule.channel : 'email',
        options: state.meta.channels,
        attrs: { onchange: onShapeChange },
      }),
      field({
        label: 'Goes to',
        name: 'audience_rule',
        type: 'select',
        value: rule ? rule.audience_rule : 'registered',
        options: state.meta.audience_rules,
        span: true,
        hint: 'Checked again at the moment of sending, so a student who registers late still gets the day-before reminder.',
      }),
      h('.field.span-2',
        h('span.label', 'Timing'),
        h('.row',
          h('input', { type: 'number', name: 'amount', value: String(split.amount), min: 0, step: 1, style: { width: '90px' } }),
          h('select', { name: 'unit', style: { width: 'auto' } },
            ['minute', 'hour', 'day', 'week'].map((u) => h('option', { value: u, selected: u === split.unit }, `${u}s`))),
          h('select', { name: 'direction', style: { width: 'auto' } },
            h('option', { value: 'before', selected: split.direction === 'before' }, 'before'),
            h('option', { value: 'after', selected: split.direction === 'after' }, 'after')),
          h('select', { name: 'anchor', style: { width: 'auto' } },
            state.meta.anchors.map((a) => h('option', { value: a.value, selected: rule ? a.value === rule.anchor : a.value === 'start' }, a.label.toLowerCase())))),
        h('span.hint', 'For example: 1 day before event start, or 2 hours after event end.')),
      field({
        label: 'Message template',
        name: 'template_id',
        type: 'select',
        span: true,
        value: rule && rule.template ? rule.template.id : '',
        options: templateOptions(rule ? rule.channel : 'email', rule ? rule.category : 'reminder'),
      }),
    ],
    onSubmit: async (values, { close }) => {
      const payload = {
        label: values.label,
        category: values.category,
        channel: values.channel,
        anchor: values.anchor,
        audience_rule: values.audience_rule,
        offset_minutes: minutesFrom(values.amount, values.unit, values.direction),
        template_id: values.template_id || undefined,
      };
      if (editing) {
        if (!values.template_id) delete payload.template_id;
        await api.patch(`/events/${event.id}/rules/${rule.id}`, payload);
      } else {
        await api.post(`/events/${event.id}/rules`, payload);
      }
      close();
      toast(editing ? 'Reminder updated.' : 'Reminder added.');
      reload('reminders');
    },
  });

  function onShapeChange() {
    const values = formValues(form);
    const select = form.elements.template_id;
    const previous = select.value;
    select.replaceChildren(...templateOptions(values.channel, values.category)
      .map((option) => h('option', { value: option.value }, option.label)));
    select.value = [...select.options].some((o) => o.value === previous) ? previous : '';
  }
}

async function previewRule(event, rule) {
  const preview = await api.get(`/events/${event.id}/rules/${rule.id}/preview`);
  modal({
    title: `Preview: ${rule.label}`,
    wide: true,
    body: preview.recipients === 0
      ? notice('info', preview.note)
      : frag(
        h('p.small.muted', `As ${preview.sample_student.name} (${preview.sample_student.campus_id}) would receive it. ${plural(preview.recipients, 'student')} match this reminder right now.`),
        h('.message-preview',
          preview.subject ? h('.preview-subject', preview.subject) : null,
          h('pre', preview.body)),
        h('p.small.muted', { style: { marginTop: '12px' } },
          `Template: ${preview.template.name}. Edit it under `,
          h('a', { href: `/templates/${preview.template.id}` }, 'Templates'), '.')),
  });
}

// ---------------------------------------------------------------------------
// Workflow actions
// ---------------------------------------------------------------------------
async function publish(id, data, reload) {
  confirmModal({
    title: 'Publish this event',
    message: frag(
      h('p', `This starts the reminder schedule for ${plural(data.readiness.audience_count, 'student')}.`),
      data.readiness.warnings.length
        ? frag(h('p.small', 'Before you do:'), h('ul.small', data.readiness.warnings.map((w) => h('li', w))))
        : null,
      state.meta.dry_run
        ? h('p.small', h('strong', 'Dry run is on,'), ' so messages will be scheduled and recorded but not actually sent.')
        : h('p.small', 'Messages will be sent to students at the times in the schedule.')),
    confirmLabel: 'Publish',
    onConfirm: async () => {
      const result = await api.post(`/events/${id}/publish`);
      toast(`Published. ${plural(result.result.materialised.created, 'message')} scheduled.`);
      reload('overview');
    },
  });
}

function completeEvent(event, reload) {
  const check = h('input', { type: 'checkbox', checked: true });
  confirmModal({
    title: 'Close this event',
    message: frag(
      h('p', 'Closing the event releases the thank you and feedback messages in the schedule.'),
      h('label.checkbox', check, h('span', 'Mark every registered student as present. You can correct the exceptions on the attendance tab afterwards.'))),
    confirmLabel: 'Close the event',
    onConfirm: async () => {
      await api.post(`/events/${event.id}/complete`, { mark_registered_present: check.checked });
      toast('Event closed.');
      reload('overview');
    },
  });
}

function cancelEvent(event, reload) {
  formModal({
    title: 'Cancel this event',
    intro: 'Every pending message is withdrawn. A cancellation notice can be sent to everyone in the audience.',
    submitLabel: 'Cancel the event',
    fields: [
      field({
        label: 'Reason, included in the notice',
        name: 'reason',
        type: 'textarea',
        span: true,
        rows: 3,
        placeholder: 'The speaker is no longer able to travel. We are working on a new date.',
      }),
      field({ label: 'Send a cancellation notice to the audience', name: 'notify', type: 'checkbox', value: true, span: true }),
    ],
    onSubmit: async (values, { close }) => {
      const result = await api.post(`/events/${event.id}/cancel`, { reason: values.reason, notify: values.notify });
      close();
      toast(`Event cancelled. ${plural(result.result.withdrawn, 'pending message')} withdrawn, ${plural(result.result.notified, 'notice')} queued.`);
      reload('overview');
    },
  });
}

function deleteEvent(event) {
  confirmModal({
    title: 'Delete this draft',
    message: `Delete "${event.name}"? This cannot be undone. Its audience and reminder schedule go with it.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: async () => {
      await api.del(`/events/${event.id}`);
      toast('Draft deleted.');
      navigate('/events');
    },
  });
}

function duplicateEvent(event) {
  formModal({
    title: 'Duplicate this event',
    intro: 'The copy keeps the audience and the reminder schedule, and starts as a draft.',
    submitLabel: 'Create the copy',
    fields: [
      field({ label: 'Name', name: 'name', value: `${event.name} (copy)`, required: true, span: true }),
      field({ label: 'Date', name: 'event_date', type: 'date', value: event.event_date, required: true }),
      field({ label: 'Start time', name: 'start_time', type: 'time', value: event.start_time, required: true }),
      field({ label: 'End time', name: 'end_time', type: 'time', value: event.end_time, required: true }),
    ],
    onSubmit: async (values, { close }) => {
      const copy = await api.post(`/events/${event.id}/duplicate`, values);
      close();
      toast('Copy created as a draft.');
      navigate(`/events/${copy.event.id}`);
    },
  });
}

function editEvent(event, reload) {
  formModal({
    title: 'Edit event',
    wide: true,
    submitLabel: 'Save changes',
    fields: [
      field({ label: 'Event name', name: 'name', value: event.name, required: true, span: true }),
      field({ label: 'Type', name: 'type', type: 'select', value: event.type, options: state.meta.event_types.map((t) => ({ value: t.value, label: t.label })) }),
      field({ label: 'Company or organisation', name: 'company', value: event.company || '' }),
      field({ label: 'Speaker', name: 'speaker', value: event.speaker || '' }),
      field({ label: 'Speaker title', name: 'speaker_title', value: event.speaker_title || '' }),
      field({ label: 'Date', name: 'event_date', type: 'date', value: event.event_date, required: true }),
      field({ label: 'Start time', name: 'start_time', type: 'time', value: event.start_time, required: true }),
      field({ label: 'End time', name: 'end_time', type: 'time', value: event.end_time, required: true }),
      field({ label: 'Mode', name: 'mode', type: 'select', value: event.mode, options: state.meta.event_modes }),
      field({ label: 'Venue', name: 'venue', value: event.venue || '' }),
      field({ label: 'Meeting link', name: 'meeting_link', type: 'url', value: event.meeting_link || '', span: true }),
      field({ label: 'Capacity', name: 'capacity', type: 'number', min: 1, value: event.capacity || '' }),
      field({ label: 'Dress code', name: 'dress_code', value: event.dress_code || '' }),
      field({ label: 'Description', name: 'description', type: 'textarea', value: event.description || '', span: true, rows: 4 }),
      field({ label: 'What students should bring or prepare', name: 'preparation_notes', type: 'textarea', value: event.preparation_notes || '', span: true, rows: 3 }),
    ],
    onSubmit: async (values, { close }) => {
      const result = await api.patch(`/events/${event.id}`, values);
      close();
      if (result.notifiable_change && event.status === 'scheduled') {
        confirmModal({
          title: 'Tell students about the change',
          message: 'The date, time, mode, venue or joining link changed. Students holding an invitation should be told. Every pending reminder has already been retimed.',
          confirmLabel: 'Send an update notice',
          onConfirm: async () => {
            const sent = await api.post(`/events/${event.id}/notify-change`, { audience_rule: 'registered' });
            toast(`${plural(sent.queued, 'update notice')} queued.`);
            reload('overview');
          },
        });
      } else {
        toast('Event updated.');
        reload('overview');
      }
    },
  });
}
