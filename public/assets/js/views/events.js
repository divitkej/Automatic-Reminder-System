import { h, frag, formValues } from '../dom.js';
import { api, query } from '../api.js';
import { icon } from '../icons.js';
import { navigate, setQuery } from '../router.js';
import { setHeader, setMain, state } from '../shell.js';
import { panel, dataTable, field, statusBadge, notice, toast } from '../components.js';
import { offsetLabel, todayIso } from '../format.js';

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------
export async function eventsView({ query: q = {} }) {
  const filters = { status: q.status || '', type: q.type || '', when: q.when || 'upcoming', search: q.search || '' };
  const data = await api.get(`/events${query({ ...filters, limit: 200 })}`);

  setHeader({
    title: 'Events',
    subtitle: 'Create an event once, then let the schedule handle the rest.',
    actions: h('a.btn.btn-primary', { href: '/events/new' }, icon('plus'), 'New event'),
  });

  const form = h('form.filters', {
    oninput: () => {
      const values = formValues(form);
      setQuery(values);
      eventsView({ query: values });
    },
    onsubmit: (event) => event.preventDefault(),
  },
  field({ label: 'Search', name: 'search', type: 'search', value: filters.search, placeholder: 'Name, company or speaker', span: false }),
  field({
    label: 'When',
    name: 'when',
    type: 'select',
    value: filters.when,
    options: [{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'all', label: 'All' }],
  }),
  field({
    label: 'Status',
    name: 'status',
    type: 'select',
    value: filters.status,
    options: [{ value: '', label: 'Any status' }, ...state.meta.event_statuses.map((s) => ({ value: s.value, label: s.label }))],
  }),
  field({
    label: 'Type',
    name: 'type',
    type: 'select',
    value: filters.type,
    options: [{ value: '', label: 'Any type' }, ...state.meta.event_types.map((t) => ({ value: t.value, label: t.label }))],
  }));

  setMain(
    h('.panel',
      form,
      dataTable([
        {
          label: 'Event',
          render: (row) => frag(
            h('a.row-title', { href: `/events/${row.id}` }, row.name),
            h('span.sub', [row.type_label, row.company].filter(Boolean).join(' · '))),
        },
        {
          label: 'When',
          render: (row) => frag(
            h('span.nowrap', row.date_long),
            h('span.sub.nowrap', `${row.time_range} ${row.timezone_label}`)),
        },
        {
          label: 'Where',
          render: (row) => row.mode === 'online'
            ? 'Online'
            : frag(h('span', row.venue || (row.mode === 'hybrid' ? 'Hybrid' : 'In person')),
              row.mode === 'hybrid' ? h('span.sub', 'Hybrid') : null),
        },
        { label: 'Status', render: (row) => statusBadge(row.status) },
        { label: 'Starts', render: (row) => h('span.small.nowrap.muted', row.is_past ? 'Finished' : row.starts_in) },
      ], data.rows, {
        onRowClick: (row) => navigate(`/events/${row.id}`),
        empty: filters.search || filters.status || filters.type
          ? { title: 'No event matches those filters', text: 'Try widening the search.' }
          : {
            title: 'No events yet',
            text: 'An event holds the date, the audience and the reminder schedule in one place.',
            action: h('p', h('a.btn.btn-primary', { href: '/events/new' }, icon('plus'), 'Create the first event')),
          },
      })),
    data.total > data.rows.length ? h('p.small.muted', `Showing ${data.rows.length} of ${data.total}.`) : null);
}

// ---------------------------------------------------------------------------
// The create form
// ---------------------------------------------------------------------------
export async function newEventView() {
  const [groups, presetHolder] = await Promise.all([
    api.get('/groups'),
    Promise.resolve({ rules: [] }),
  ]);

  setHeader({
    title: 'New event',
    subtitle: 'Step one of the workflow. The reminder schedule is filled in for you from the event type.',
    back: { href: '/events', label: 'All events' },
  });

  const errorBox = h('div');
  const presetBox = h('.panel-body');
  const typeHelp = h('p.hint');

  const form = h('form', { onsubmit: submit });

  const defaultType = state.meta.event_types[0].value;

  const basics = h('.form-grid',
    field({ label: 'Event name', name: 'name', required: true, span: true, placeholder: 'Career Readiness Workshop, Cohort 3' }),
    field({
      label: 'Event type',
      name: 'type',
      type: 'select',
      required: true,
      value: defaultType,
      options: state.meta.event_types.map((t) => ({ value: t.value, label: t.label })),
      attrs: { onchange: onTypeChange },
    }),
    field({ label: 'Company or organisation', name: 'company', placeholder: 'Gulf Technology Partners', hint: 'Leave blank for an internal session.' }),
    field({ label: 'Speaker', name: 'speaker', placeholder: 'Ms Reema Fernandes' }),
    field({ label: 'Speaker title', name: 'speaker_title', placeholder: 'Head of Talent Acquisition' }));

  const timing = h('.form-grid',
    field({ label: 'Date', name: 'event_date', type: 'date', required: true, value: todayIso(14) }),
    field({ label: 'Start time', name: 'start_time', type: 'time', required: true, value: '17:00' }),
    field({ label: 'End time', name: 'end_time', type: 'time', required: true, value: '18:30' }),
    field({
      label: 'Timezone',
      name: 'timezone',
      type: 'select',
      value: state.meta.default_timezone,
      options: timezoneOptions(state.meta.default_timezone),
      hint: 'All reminder times are worked out in this zone.',
    }));

  const venueField = field({ label: 'Venue', name: 'venue', placeholder: 'Auditorium, Academic Block B' });
  const linkField = field({ label: 'Meeting link', name: 'meeting_link', type: 'url', placeholder: 'https://' });

  const place = h('.form-grid',
    field({
      label: 'Mode',
      name: 'mode',
      type: 'select',
      value: 'in_person',
      options: state.meta.event_modes,
      attrs: { onchange: onModeChange },
    }),
    venueField,
    linkField);

  const details = h('.form-grid',
    field({ label: 'Description', name: 'description', type: 'textarea', span: true, rows: 4, hint: 'Shown on the registration page and in the invitation.' }),
    field({ label: 'What students should bring or prepare', name: 'preparation_notes', type: 'textarea', span: true, rows: 3 }),
    field({ label: 'Dress code', name: 'dress_code', placeholder: 'Business formal' }),
    field({ label: 'Capacity', name: 'capacity', type: 'number', min: 1, hint: 'Leave blank for no limit. Confirmations past the limit join a waiting list.' }),
    field({ label: 'Organiser name', name: 'organiser_name', value: state.meta.org.short_name }),
    field({ label: 'Organiser email', name: 'organiser_email', type: 'email', value: state.meta.org.email }));

  const audienceSelect = h('select', { name: 'group_ids', multiple: true, size: Math.min(8, Math.max(3, groups.rows.length)) },
    groups.rows.map((g) => h('option', { value: g.id }, `${g.name} (${g.member_count})`)));

  const audience = groups.rows.length
    ? h('.form-grid',
      h('label.field.span-2',
        h('span.label', 'Target student groups'),
        audienceSelect,
        h('span.hint', 'Hold Control, or Command on a Mac, to pick more than one. You can add individual students and filters after the event is created.')))
    : notice('warning', h('div',
      h('p', 'There are no student groups yet, so this event will be created without an audience.'),
      h('p', h('a', { href: '/groups' }, 'Create a group'), ' first, or add the audience on the event page afterwards.')));

  const options = h('.form-grid',
    field({ label: 'Students must register for a place', name: 'registration_required', type: 'checkbox', value: true, span: true }),
    field({
      label: 'Feedback',
      name: 'feedback_mode',
      type: 'select',
      value: 'builtin',
      options: [
        { value: 'builtin', label: 'Use the built in feedback form' },
        { value: 'external', label: 'Link to an external form' },
        { value: 'none', label: 'Do not collect feedback' },
      ],
    }),
    field({ label: 'External feedback form link', name: 'feedback_form_url', type: 'url', placeholder: 'https://' }),
    field({ label: 'Fill in the default reminder schedule for this event type', name: 'apply_preset', type: 'checkbox', value: true, span: true }));

  form.append(
    errorBox,
    panel({ title: 'Basic information', body: frag(basics, typeHelp) }),
    panel({ title: 'Date and time', body: timing }),
    panel({ title: 'Where it happens', body: place }),
    panel({ title: 'Details for students', body: details }),
    panel({ title: 'Target students', hint: 'Step two. This decides who gets every message.', body: audience }),
    panel({ title: 'Registration and feedback', body: options }),
    panel({
      title: 'Reminder schedule',
      hint: 'Step three. This is what will be created, and you can change all of it afterwards.',
      flush: true,
      body: presetBox,
    }),
    h('.row', { style: { marginBottom: '40px' } },
      h('button.btn.btn-primary', { type: 'submit' }, 'Create event as a draft'),
      h('a.btn', { href: '/events' }, 'Cancel'),
      h('span.small.muted', 'Nothing is sent until you publish it.')));

  setMain(form);
  onModeChange();
  await onTypeChange();

  function onModeChange() {
    const mode = form.elements.mode.value;
    venueField.style.display = mode === 'online' ? 'none' : '';
    linkField.style.display = mode === 'in_person' ? 'none' : '';
    venueField.querySelector('input').required = mode !== 'online';
    linkField.querySelector('input').required = mode !== 'in_person';
  }

  async function onTypeChange() {
    const type = form.elements.type.value;
    const info = state.meta.event_types.find((t) => t.value === type);
    if (info) {
      typeHelp.textContent = info.description;
      if (form.elements.mode.value !== info.defaultMode) {
        form.elements.mode.value = info.defaultMode;
        onModeChange();
      }
    }
    presetBox.replaceChildren(h('p.muted.small', 'Loading the default schedule.'));
    const preset = await api.get(`/system/presets/${type}`);
    presetHolder.rules = preset.rules;
    presetBox.replaceChildren(dataTable([
      { label: 'Message', render: (row) => frag(h('span.row-title', row.label), h('span.sub', row.category_label)) },
      { label: 'Timing', render: (row) => h('span.nowrap.small', `${offsetLabel(row.offsetMinutes)} ${row.anchor === 'end' ? 'the end' : 'the start'}`) },
      { label: 'Goes to', render: (row) => h('span.small', row.audience_label) },
      { label: 'Channel', render: (row) => h('span.small', row.channel === 'email' ? 'Email' : row.channel === 'sms' ? 'SMS' : 'WhatsApp') },
    ], preset.rules, { empty: { title: 'No default schedule for this type' } }));
  }

  async function submit(event) {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    errorBox.replaceChildren();

    const values = formValues(form);
    const groupIds = [...audienceSelect.selectedOptions || []].map((o) => o.value);
    const payload = {
      ...values,
      apply_preset: values.apply_preset !== false,
      audience: groupIds.map((id) => ({ kind: 'group', ref_id: id })),
    };
    delete payload.group_ids;

    try {
      const created = await api.post('/events', payload);
      toast('Event created as a draft.');
      navigate(`/events/${created.event.id}`);
    } catch (error) {
      errorBox.replaceChildren(notice('error', h('div',
        h('p', error.message),
        error.details && error.details.length > 1 ? h('ul', error.details.slice(1).map((d) => h('li', d))) : null)));
      window.scrollTo(0, 0);
      button.disabled = false;
    }
  }
}

function timezoneOptions(preferred) {
  const zones = ['Asia/Dubai', 'Asia/Kolkata', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'UTC'];
  if (!zones.includes(preferred)) zones.unshift(preferred);
  return zones.map((zone) => ({ value: zone, label: zone.replace('_', ' ') }));
}
