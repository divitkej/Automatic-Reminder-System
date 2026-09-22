import { h, frag } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { setHeader, setMain } from '../shell.js';
import {
  panel, dataTable, field, badge, notice, toast, formModal, confirmModal,
  modal, csvPicker, downloadLink, emptyState,
} from '../components.js';
import { plural } from '../format.js';

export async function groupsView() {
  const data = await api.get('/groups');
  const facets = await api.get('/students/facets');

  setHeader({
    title: 'Student groups',
    subtitle: 'A group is the usual way to target an event. Make it once, use it every semester.',
    actions: frag(
      h('button.btn', { onclick: () => groupForm({ kind: 'smart', facets, onSaved: groupsView }) }, icon('filter'), 'New smart group'),
      h('button.btn.btn-primary', { onclick: () => groupForm({ kind: 'static', facets, onSaved: groupsView }) }, icon('plus'), 'New group')),
  });

  setMain(
    notice('info', h('div',
      h('p', h('strong', 'Two kinds of group.'), ' A fixed group holds a list of students you choose, which is right for a cohort. A smart group holds a rule, such as final year Computer Science, and is recalculated every time it is used, so it never goes stale.'))),

    panel({
      flush: true,
      body: dataTable([
        {
          label: 'Group',
          render: (row) => frag(
            h('a.row-title', { href: `/groups/${row.id}` }, row.name),
            h('span.sub', row.description || (row.kind === 'smart' ? row.filter_summary : 'Fixed list'))),
        },
        { label: 'Kind', render: (row) => badge(row.kind === 'smart' ? 'Smart' : 'Fixed', 'neutral') },
        { label: 'Students', num: true, render: (row) => h('span.tabular', String(row.member_count)) },
        {
          label: '',
          render: (row) => h('.row-tight',
            h('a.btn.btn-small', { href: `/groups/${row.id}` }, 'Open'),
            h('button.btn.btn-small.btn-danger', {
              onclick: () => confirmModal({
                title: 'Delete this group',
                message: `Delete "${row.name}"? Students are not affected. Events that have already used it keep their student lists.`,
                confirmLabel: 'Delete',
                danger: true,
                onConfirm: async () => {
                  await api.del(`/groups/${row.id}`);
                  toast('Group deleted.');
                  groupsView();
                },
              }),
            }, icon('trash'))),
        },
      ], data.rows, {
        onRowClick: (row) => navigate(`/groups/${row.id}`),
        empty: {
          title: 'No groups yet',
          text: 'Groups are how an event picks its audience. Start with the cohorts you already run.',
          action: h('p', h('button.btn.btn-primary', { onclick: () => groupForm({ kind: 'static', facets, onSaved: groupsView }) }, icon('plus'), 'Create a group')),
        },
      }),
    }));
}

function groupForm({ group, kind, facets, onSaved }) {
  const isSmart = group ? group.kind === 'smart' : kind === 'smart';
  const filter = group && group.filter ? group.filter : {};

  const smartFields = [
    field({ label: 'Programme', name: 'programs', type: 'select', value: (filter.programs || [])[0] || '', options: [{ value: '', label: 'Any' }, ...facets.programs.map((p) => ({ value: p, label: p }))] }),
    field({ label: 'Discipline', name: 'disciplines', type: 'select', value: (filter.disciplines || [])[0] || '', options: [{ value: '', label: 'Any' }, ...facets.disciplines.map((d) => ({ value: d, label: d }))] }),
    field({ label: 'Year of study', name: 'years', type: 'select', value: (filter.years || [])[0] || '', options: [{ value: '', label: 'Any' }, ...facets.years.map((y) => ({ value: y, label: `Year ${y}` }))] }),
    field({ label: 'Batch', name: 'batches', type: 'select', value: (filter.batches || [])[0] || '', options: [{ value: '', label: 'Any' }, ...facets.batches.map((b) => ({ value: b, label: b }))] }),
    field({ label: 'Minimum CGPA', name: 'minCgpa', type: 'number', min: 0, max: 10, step: '0.01', value: filter.minCgpa ?? '' }),
  ];

  formModal({
    title: group ? `Edit ${group.name}` : (isSmart ? 'New smart group' : 'New group'),
    wide: isSmart,
    intro: isSmart
      ? 'Membership is worked out from these conditions every time the group is used, so students who become eligible later are picked up automatically.'
      : 'A fixed group holds the students you add to it. Add them by CSV or by search once the group exists.',
    submitLabel: group ? 'Save' : 'Create group',
    fields: [
      field({ label: 'Name', name: 'name', value: group ? group.name : '', required: true, span: true }),
      field({ label: 'Description', name: 'description', value: group ? group.description || '' : '', span: true, hint: 'What this group is for, so the next person knows.' }),
      ...(isSmart ? smartFields : []),
    ],
    onSubmit: async (values, { close }) => {
      const payload = { name: values.name, description: values.description, kind: isSmart ? 'smart' : 'static' };
      if (isSmart) {
        const built = {};
        for (const key of ['programs', 'disciplines', 'years', 'batches']) {
          if (values[key]) built[key] = [values[key]];
        }
        if (values.minCgpa) built.minCgpa = values.minCgpa;
        if (Object.keys(built).length === 0) {
          throw new Error('A smart group needs at least one condition, otherwise it would hold every student.');
        }
        payload.filter = built;
      }
      if (group) await api.patch(`/groups/${group.id}`, payload);
      else await api.post('/groups', payload);
      close();
      toast(group ? 'Group updated.' : 'Group created.');
      onSaved();
    },
  });
}

export async function groupDetailView({ id }) {
  const data = await api.get(`/groups/${id}`);
  const facets = await api.get('/students/facets');
  const group = data.group;
  const reload = () => groupDetailView({ id });

  setHeader({
    title: group.name,
    subtitle: group.kind === 'smart'
      ? `Smart group: ${group.filter_summary}`
      : `Fixed group, ${plural(group.member_count, 'student')}`,
    back: { href: '/groups', label: 'All groups' },
    actions: frag(
      group.kind === 'static' ? csvPicker({
        label: 'Import members',
        onFile: async (text) => {
          const report = await api.postText(`/groups/${id}/members/import`, text);
          toast(`${plural(report.added, 'student')} added. ${report.unmatched.length} campus IDs did not match.`);
          if (report.unmatched.length) {
            modal({
              title: 'Campus IDs that did not match',
              body: frag(
                h('p.small.muted', 'These are not on the student list. Add them under Students first, then import again.'),
                h('ul', report.unmatched.slice(0, 40).map((u) => h('li.mono', `Line ${u.line}: ${u.campus_id}`)))),
            });
          }
          reload();
        },
      }) : null,
      group.kind === 'static' ? h('button.btn', { onclick: () => addMembers(group, facets, reload) }, icon('plus'), 'Add students') : null,
      downloadLink(`/api/groups/${id}/members.csv`, 'Export CSV'),
      h('button.btn', { onclick: () => groupForm({ group, facets, onSaved: reload }) }, icon('edit'), 'Edit')),
  });

  setMain(
    group.kind === 'smart'
      ? notice('info', `This group is a rule, not a list. It currently matches ${plural(group.member_count, 'student')}, and it will match a different set as records change. To edit it, change the conditions.`)
      : null,

    panel({
      title: 'Members',
      hint: group.kind === 'smart' ? 'Worked out from the group conditions just now.' : 'The students in this group.',
      flush: true,
      body: dataTable([
        {
          label: 'Student',
          render: (row) => frag(h('a.row-title', { href: `/students/${row.id}` }, row.name), h('span.sub', row.email)),
        },
        { label: 'Campus ID', render: (row) => h('span.mono', row.campus_id) },
        { label: 'Programme', render: (row) => frag(h('span', row.program || ''), h('span.sub', row.discipline || '')) },
        { label: 'Year', num: true, render: (row) => row.year_of_study },
        { label: 'State', render: (row) => row.opted_out ? badge('Opted out', 'skipped') : null },
        {
          label: '',
          render: (row) => group.kind === 'static'
            ? h('button.btn.btn-small', {
              onclick: async () => {
                await api.del(`/groups/${id}/members`, { student_ids: [row.id] });
                toast(`${row.name} removed from the group.`);
                reload();
              },
            }, 'Remove')
            : null,
        },
      ], data.members, {
        empty: group.kind === 'smart'
          ? { title: 'The conditions match nobody', text: 'Widen the conditions, or check that students have the relevant fields filled in.' }
          : { title: 'No students in this group yet', text: 'Add students by search, or import a CSV of campus IDs.' },
      }),
    }));
}

function addMembers(group, facets, reload) {
  const chosen = new Map();
  const chosenBox = h('.row-tight');
  const results = h('div');

  const redrawChosen = () => {
    chosenBox.replaceChildren(...[...chosen.values()].map((student) => h('button.btn.btn-small', {
      type: 'button',
      onclick: () => { chosen.delete(student.id); redrawChosen(); },
    }, student.name, ' ', icon('close', { size: 11 }))));
  };

  const search = h('input', {
    type: 'search',
    placeholder: 'Search by name, campus ID or email',
    oninput: async (event) => {
      const term = event.target.value.trim();
      if (term.length < 2) { results.replaceChildren(h('p.small.muted', 'Type at least two characters.')); return; }
      const found = await api.get(`/students?search=${encodeURIComponent(term)}&limit=15`);
      results.replaceChildren(found.rows.length
        ? h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } }, found.rows.map((student) => h('li', { style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
          h('.spread',
            h('div', h('strong', student.name), h('span.small.muted', ` ${student.campus_id}`)),
            h('button.btn.btn-small', {
              type: 'button',
              onclick: () => { chosen.set(student.id, student); redrawChosen(); },
            }, 'Add')))))
        : h('p.small.muted', 'No student matches that.'));
    },
  });

  const byFilter = h('button.btn', {
    type: 'button',
    onclick: () => confirmModal({
      title: 'Replace the members from a filter',
      message: 'This clears the group and refills it with every student matching the filter you choose next. Useful when a cohort list changes wholesale.',
      confirmLabel: 'Choose a filter',
      onConfirm: () => {
        close();
        formModal({
          title: 'Fill the group from a filter',
          submitLabel: 'Replace members',
          fields: [
            field({ label: 'Programme', name: 'programs', type: 'select', options: [{ value: '', label: 'Any' }, ...facets.programs.map((p) => ({ value: p, label: p }))] }),
            field({ label: 'Discipline', name: 'disciplines', type: 'select', options: [{ value: '', label: 'Any' }, ...facets.disciplines.map((d) => ({ value: d, label: d }))] }),
            field({ label: 'Year of study', name: 'years', type: 'select', options: [{ value: '', label: 'Any' }, ...facets.years.map((y) => ({ value: y, label: `Year ${y}` }))] }),
            field({ label: 'Batch', name: 'batches', type: 'select', options: [{ value: '', label: 'Any' }, ...facets.batches.map((b) => ({ value: b, label: b }))] }),
          ],
          onSubmit: async (values, { close: closeInner }) => {
            const filter = {};
            for (const key of ['programs', 'disciplines', 'years', 'batches']) {
              if (values[key]) filter[key] = [values[key]];
            }
            if (Object.keys(filter).length === 0) throw new Error('Choose at least one condition.');
            const result = await api.post(`/groups/${group.id}/members/from-filter`, { filter });
            closeInner();
            toast(`Group now holds ${plural(result.members, 'student')}.`);
            reload();
          },
        });
      },
    }),
  }, 'Replace from a filter');

  const { close } = modal({
    title: `Add students to ${group.name}`,
    wide: true,
    body: frag(
      h('label.field', h('span.label', 'Find students'), search),
      chosenBox,
      results,
      h('hr.rule'),
      h('p.small.muted', 'Or set the whole membership at once:'),
      byFilter),
    actions: h('button.btn.btn-primary', {
      onclick: async (event) => {
        if (chosen.size === 0) { toast('Nothing selected.', 'error'); return; }
        event.currentTarget.disabled = true;
        const result = await api.post(`/groups/${group.id}/members`, { student_ids: [...chosen.keys()] });
        close();
        toast(`${plural(result.added, 'student')} added.`);
        reload();
      },
    }, 'Add the selected students'),
  });
}
