import { h, frag, formValues } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { setHeader, setMain, state } from '../shell.js';
import { panel, dataTable, field, badge, notice, toast, confirmModal, formModal } from '../components.js';

export async function templatesView() {
  const data = await api.get('/templates');

  setHeader({
    title: 'Message templates',
    subtitle: 'The wording of every message the system sends. Edit these once and every event picks up the change.',
    actions: h('button.btn.btn-primary', { onclick: () => newTemplate() }, icon('plus'), 'New template'),
  });

  const byCategory = new Map();
  for (const row of data.rows) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }

  setMain(
    notice('info', h('div',
      h('p', 'Templates are written as plain text. Merge fields such as ', h('code', '{{student.first_name}}'), ' are filled in for each student, and ', h('code', '{{#if event.meeting_link}}'), ' sections appear only when that detail exists.'),
      h('p.small', 'The email channel wraps the text in the institutional layout, so there is no markup to write.'))),

    state.meta.message_categories.map((category) => {
      const rows = byCategory.get(category.value) || [];
      if (rows.length === 0) return null;
      return panel({
        title: category.label,
        flush: true,
        body: dataTable([
          {
            label: 'Template',
            render: (row) => frag(
              h('a.row-title', { href: `/templates/${row.id}` }, row.name),
              h('span.sub', row.description || '')),
          },
          { label: 'Channel', render: (row) => badge(row.channel === 'email' ? 'Email' : row.channel === 'sms' ? 'SMS' : 'WhatsApp', 'neutral') },
          { label: 'Event type', render: (row) => row.event_type ? h('span.small', state.meta.event_types.find((t) => t.value === row.event_type)?.label || row.event_type) : h('span.muted.small', 'Any') },
          {
            label: 'Source',
            render: (row) => row.is_system
              ? (row.updated_at !== row.created_at ? badge('Edited here', 'skipped') : badge('Standard', 'neutral'))
              : badge('Yours', 'sent'),
          },
          { label: '', render: (row) => h('a.btn.btn-small', { href: `/templates/${row.id}` }, 'Open') },
        ], rows, { onRowClick: (row) => navigate(`/templates/${row.id}`) }),
      });
    }));
}

function newTemplate() {
  formModal({
    title: 'New template',
    submitLabel: 'Create and open',
    fields: [
      field({ label: 'Name', name: 'name', required: true, span: true, placeholder: 'Reminder, two days before' }),
      field({ label: 'Kind of message', name: 'category', type: 'select', required: true, options: state.meta.message_categories }),
      field({ label: 'Channel', name: 'channel', type: 'select', options: state.meta.channels }),
      field({
        label: 'Only for this event type',
        name: 'event_type',
        type: 'select',
        span: true,
        options: [{ value: '', label: 'Any event type' }, ...state.meta.event_types.map((t) => ({ value: t.value, label: t.label }))],
      }),
    ],
    onSubmit: async (values, { close }) => {
      const created = await api.post('/templates', {
        ...values,
        subject: values.channel === 'email' ? 'Subject line' : null,
        body: 'Dear {{student.first_name}},\n\n\n\nRegards,\n\nCareer Services\n{{org.name}}',
      });
      close();
      navigate(`/templates/${created.id}`);
    },
  });
}

export async function templateDetailView({ id }) {
  const [data, meta] = await Promise.all([api.get(`/templates/${id}`), api.get('/templates/fields')]);
  const template = data.template;
  const edited = template.is_system && template.updated_at !== template.created_at;

  setHeader({
    title: template.name,
    subtitle: `${template.category.replace('_', ' ')} · ${template.channel === 'email' ? 'Email' : template.channel === 'sms' ? 'SMS' : 'WhatsApp'}${template.event_type ? ` · ${template.event_type.replace(/_/g, ' ')}` : ''}`,
    back: { href: '/templates', label: 'All templates' },
    actions: frag(
      edited ? h('button.btn', {
        onclick: () => confirmModal({
          title: 'Restore the standard wording',
          message: 'This replaces your edits with the wording this template shipped with. It cannot be undone.',
          confirmLabel: 'Restore',
          danger: true,
          onConfirm: async () => {
            await api.post(`/templates/${id}/reset`);
            toast('Standard wording restored.');
            templateDetailView({ id });
          },
        }),
      }, icon('refresh'), 'Restore standard wording') : null,
      !template.is_system ? h('button.btn.btn-danger', {
        onclick: () => confirmModal({
          title: 'Delete this template',
          message: `Delete "${template.name}"? Reminders on live events that use it must be repointed first.`,
          confirmLabel: 'Delete',
          danger: true,
          onConfirm: async () => {
            await api.del(`/templates/${id}`);
            toast('Template deleted.');
            navigate('/templates');
          },
        }),
      }, icon('trash'), 'Delete') : null),
  });

  const previewSubject = h('.preview-subject');
  const previewBody = h('pre');
  const validationBox = h('div');
  const saveNote = h('span.small.muted');

  const subjectInput = h('input', {
    type: 'text',
    name: 'subject',
    value: template.subject || '',
    oninput: schedulePreview,
  });
  const bodyInput = h('textarea.code', {
    name: 'body',
    rows: 24,
    oninput: schedulePreview,
  }, template.body);

  let timer = null;
  function schedulePreview() {
    saveNote.textContent = 'Unsaved changes.';
    clearTimeout(timer);
    timer = setTimeout(runPreview, 250);
  }

  async function runPreview() {
    const result = await api.post('/templates/preview', {
      subject: subjectInput.value,
      body: bodyInput.value,
      channel: template.channel,
    });
    previewSubject.textContent = result.subject || '';
    previewSubject.style.display = result.subject ? '' : 'none';
    previewBody.textContent = result.body;
    validationBox.replaceChildren(result.validation.valid
      ? null
      : notice('error', h('div',
        h('p', 'This template will not save until these are fixed:'),
        h('ul', result.validation.problems.map((p) => h('li', p))))));
  }

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        await api.patch(`/templates/${id}`, {
          subject: subjectInput.value,
          body: bodyInput.value,
        });
        saveNote.textContent = 'Saved.';
        toast('Template saved. Every event using it picks up the change.');
      } catch (error) {
        validationBox.replaceChildren(notice('error', error.message));
      } finally {
        button.disabled = false;
      }
    },
  },
  validationBox,
  template.channel === 'email'
    ? h('label.field', h('span.label', 'Subject line'), subjectInput)
    : null,
  h('label.field', { style: { marginTop: '14px' } },
    h('span.label', 'Message'),
    bodyInput,
    h('span.hint', template.channel === 'sms'
      ? 'Keep SMS short. Long messages are split by the network and billed per part.'
      : 'Plain text. Blank lines become paragraphs and numbered lines become a list.')),
  h('.row', { style: { marginTop: '14px' } },
    h('button.btn.btn-primary', { type: 'submit' }, 'Save template'),
    saveNote));

  const insertField = (name) => {
    const token = `{{${name}}}`;
    const start = bodyInput.selectionStart ?? bodyInput.value.length;
    const end = bodyInput.selectionEnd ?? start;
    bodyInput.value = bodyInput.value.slice(0, start) + token + bodyInput.value.slice(end);
    bodyInput.focus();
    bodyInput.selectionStart = bodyInput.selectionEnd = start + token.length;
    schedulePreview();
  };

  setMain(
    template.is_system && !edited
      ? notice('info', 'This is one of the standard templates. Editing it changes the wording everywhere it is used, and your version is kept through upgrades.')
      : null,
    edited ? notice('warning', 'This standard template has been edited here, so upgrades will not change it.') : null,

    h('.grid-2',
      panel({ title: 'Wording', body: form }),
      frag(
        panel({
          title: 'Preview',
          hint: 'Rendered against a sample student and event.',
          body: h('.message-preview', previewSubject, previewBody),
        }),
        panel({
          title: 'Merge fields',
          hint: 'Click one to insert it at the cursor.',
          body: h('.field-catalogue',
            meta.fields.map((name) => h('button', { type: 'button', onclick: () => insertField(name) }, `{{${name}}}`))),
        }),
        panel({
          title: 'Conditional sections',
          body: frag(
            h('p.small', 'Show a block only when a detail exists:'),
            h('pre.mono', { style: { background: 'var(--surface-muted)', padding: '10px', borderRadius: '3px', whiteSpace: 'pre-wrap' } },
              '{{#if event.meeting_link}}\nJoin here: {{event.meeting_link}}\n{{else}}\nVenue: {{event.venue}}\n{{/if}}'),
            h('p.small.muted', 'Use {{#unless ...}} for the opposite.')),
        }))));

  runPreview();
}
