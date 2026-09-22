import { h, frag, formValues } from '../dom.js';
import { api, query } from '../api.js';
import { icon } from '../icons.js';
import { navigate, setQuery } from '../router.js';
import { setHeader, setMain, state } from '../shell.js';
import {
  panel, dataTable, field, badge, notice, toast, formModal, confirmModal,
  modal, csvPicker, downloadLink, detailList, tiles,
} from '../components.js';
import { relative, plural } from '../format.js';
import { messageStatus, showMessage } from './event-people.js';

export async function studentsView({ query: q = {} }) {
  const filters = {
    search: q.search || '',
    programs: q.programs || '',
    disciplines: q.disciplines || '',
    years: q.years || '',
    batches: q.batches || '',
    status: q.status || '',
  };
  const data = await api.get(`/students${query({ ...filters, limit: 300 })}`);

  setHeader({
    title: 'Students',
    subtitle: `${plural(data.total, 'student')} on file. This list is what every audience is drawn from.`,
    actions: frag(
      csvPicker({ label: 'Import CSV', onFile: (text) => importStudents(text, q) }),
      downloadLink(`/api/students/export.csv${query(filters)}`, 'Export CSV'),
      h('button.btn.btn-primary', { onclick: () => studentForm({ onSaved: () => studentsView({ query: q }) }) }, icon('plus'), 'Add a student')),
  });

  const form = h('form.filters', {
    oninput: () => {
      const values = formValues(form);
      setQuery(values);
      studentsView({ query: values });
    },
    onsubmit: (event) => event.preventDefault(),
  },
  field({ label: 'Search', name: 'search', type: 'search', value: filters.search, placeholder: 'Name, campus ID or email' }),
  field({ label: 'Programme', name: 'programs', type: 'select', value: filters.programs, options: [{ value: '', label: 'Any' }, ...data.facets.programs.map((p) => ({ value: p, label: p }))] }),
  field({ label: 'Discipline', name: 'disciplines', type: 'select', value: filters.disciplines, options: [{ value: '', label: 'Any' }, ...data.facets.disciplines.map((d) => ({ value: d, label: d }))] }),
  field({ label: 'Year', name: 'years', type: 'select', value: filters.years, options: [{ value: '', label: 'Any' }, ...data.facets.years.map((y) => ({ value: y, label: `Year ${y}` }))] }),
  field({ label: 'Batch', name: 'batches', type: 'select', value: filters.batches, options: [{ value: '', label: 'Any' }, ...data.facets.batches.map((b) => ({ value: b, label: b }))] }),
  field({
    label: 'Status',
    name: 'status',
    type: 'select',
    value: filters.status,
    options: [{ value: '', label: 'Active' }, { value: 'any', label: 'Any status' }, { value: 'inactive', label: 'Inactive' }, { value: 'graduated', label: 'Graduated' }],
  }));

  setMain(
    h('.panel',
      form,
      dataTable([
        {
          label: 'Student',
          render: (row) => frag(
            h('a.row-title', { href: `/students/${row.id}` }, row.name),
            h('span.sub', row.email)),
        },
        { label: 'Campus ID', render: (row) => h('span.mono', row.campus_id) },
        { label: 'Programme', render: (row) => frag(h('span', row.program || ''), h('span.sub', row.discipline || '')) },
        { label: 'Year', num: true, render: (row) => row.year_of_study || null },
        { label: 'Batch', render: (row) => row.batch },
        { label: 'CGPA', num: true, render: (row) => row.cgpa ? row.cgpa.toFixed(2) : null },
        {
          label: 'State',
          render: (row) => h('.row-tight',
            row.status !== 'active' ? badge(row.status, 'neutral') : null,
            row.opted_out ? badge('Opted out', 'skipped') : null),
        },
      ], data.rows, {
        onRowClick: (row) => navigate(`/students/${row.id}`),
        empty: filters.search
          ? { title: 'No student matches that', text: 'Try a different search.' }
          : {
            title: 'No students on file',
            text: 'Import a CSV exported from the campus system. It needs a campus ID, a name and an email address; every other column is optional.',
          },
      })),
    data.total > data.rows.length ? h('p.small.muted', `Showing ${data.rows.length} of ${data.total}.`) : null);
}

async function importStudents(text, q) {
  const report = await api.postText('/students/import', text).catch((error) => ({ error }));
  if (report.error) {
    modal({ title: 'The file could not be read', body: notice('error', report.error.message) });
    return;
  }
  if (!report.applied) {
    modal({
      title: 'Nothing was imported',
      body: frag(
        notice('error', `${plural(report.errors.length, 'row')} could not be read, so the whole file was rejected. Correct these and upload again.`),
        h('ul', report.errors.slice(0, 40).map((e) => h('li.small', `Line ${e.line}: ${e.message}`)))),
    });
    return;
  }
  toast(`${report.created} students added, ${report.updated} updated.`);
  studentsView({ query: q });
}

function studentForm({ student, onSaved }) {
  formModal({
    title: student ? `Edit ${student.name}` : 'Add a student',
    wide: true,
    submitLabel: student ? 'Save' : 'Add student',
    fields: [
      field({ label: 'Campus ID', name: 'campus_id', value: student ? student.campus_id : '', required: true, placeholder: '2023A7PS0142U' }),
      field({ label: 'Full name', name: 'name', value: student ? student.name : '', required: true }),
      field({ label: 'Campus email', name: 'email', type: 'email', value: student ? student.email : '', required: true, span: true }),
      field({ label: 'Mobile', name: 'phone', value: student ? student.phone || '' : '', hint: 'Needed for SMS and WhatsApp reminders.' }),
      field({ label: 'Programme', name: 'program', value: student ? student.program || '' : '', placeholder: 'B.E.' }),
      field({ label: 'Discipline', name: 'discipline', value: student ? student.discipline || '' : '', placeholder: 'Computer Science' }),
      field({ label: 'Year of study', name: 'year_of_study', type: 'number', min: 1, max: 7, value: student ? student.year_of_study || '' : '' }),
      field({ label: 'Batch', name: 'batch', value: student ? student.batch || '' : '', placeholder: '2023' }),
      field({ label: 'CGPA', name: 'cgpa', type: 'number', min: 0, max: 10, step: '0.01', value: student ? student.cgpa ?? '' : '' }),
      field({
        label: 'Status',
        name: 'status',
        type: 'select',
        value: student ? student.status : 'active',
        options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'graduated', label: 'Graduated' }],
      }),
      field({
        label: 'Opted out of Career Services mail',
        name: 'opted_out',
        type: 'checkbox',
        value: student ? Boolean(student.opted_out) : false,
        span: true,
        hint: 'An opted out student is left out of every audience and never receives a message.',
      }),
    ],
    onSubmit: async (values, { close }) => {
      if (student) await api.patch(`/students/${student.id}`, values);
      else await api.post('/students', values);
      close();
      toast(student ? 'Student updated.' : 'Student added.');
      onSaved();
    },
  });
}

export async function studentDetailView({ id }) {
  const data = await api.get(`/students/${id}`);
  const student = data.student;

  setHeader({
    title: student.name,
    subtitle: `${student.campus_id} · ${student.email}`,
    back: { href: '/students', label: 'All students' },
    actions: frag(
      h('button.btn', { onclick: () => studentForm({ student, onSaved: () => studentDetailView({ id }) }) }, icon('edit'), 'Edit'),
      h('button.btn.btn-danger', {
        onclick: () => confirmModal({
          title: 'Delete this student',
          message: `Delete ${student.name}? Their event history, responses and feedback go with them. This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
          onConfirm: async () => {
            await api.del(`/students/${id}`);
            toast('Student deleted.');
            navigate('/students');
          },
        }),
      }, icon('trash'), 'Delete')),
  });

  const attended = data.registrations.filter((r) => r.attended).length;
  const registered = data.registrations.filter((r) => r.status === 'registered').length;

  setMain(
    student.opted_out
      ? notice('warning', 'This student has opted out of Career Services mail. They are left out of every audience and receive nothing.')
      : null,

    tiles([
      { label: 'Events invited to', value: data.registrations.length },
      { label: 'Places taken', value: registered },
      { label: 'Attended', value: attended },
      { label: 'Messages received', value: data.messages.filter((m) => m.status === 'sent').length },
    ]),

    h('.grid-2',
      panel({
        title: 'Record',
        body: detailList([
          ['Campus ID', h('span.mono', student.campus_id)],
          ['Email', student.email],
          ['Mobile', student.phone],
          ['Programme', student.program],
          ['Discipline', student.discipline],
          ['Year of study', student.year_of_study],
          ['Batch', student.batch],
          ['CGPA', student.cgpa],
          ['Status', badge(student.status, 'neutral')],
          ['Added', relative(student.created_at)],
        ]),
      }),

      panel({
        title: 'Events',
        flush: true,
        body: dataTable([
          {
            label: 'Event',
            render: (row) => frag(
              h('a.row-title', { href: `/events/${row.event_id}` }, row.event_name),
              h('span.sub', row.event_date)),
          },
          { label: 'Response', render: (row) => badge(row.status, row.status === 'registered' ? 'sent' : 'neutral') },
          { label: 'Attended', render: (row) => row.attended ? badge('Present', 'sent') : null },
        ], data.registrations, { empty: { title: 'Not on any event yet' } }),
      })),

    panel({
      title: 'Messages sent to this student',
      flush: true,
      body: dataTable([
        { label: 'Message', render: (row) => frag(h('span.row-title', row.label || row.subject), h('span.sub', row.event_name)) },
        { label: 'Scheduled', render: (row) => h('span.small.nowrap', row.scheduled_local) },
        { label: 'Status', render: (row) => messageStatus(row) },
        { label: '', render: (row) => h('button.btn.btn-small', { onclick: () => showMessage(row.id) }, icon('eye')) },
      ], data.messages, { empty: { title: 'No messages yet' } }),
    }));
}
