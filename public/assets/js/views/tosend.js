// The handoff queue.
//
// In draft mode the system works out who gets what and when, then stops. This
// is the screen where a member of staff picks up a finished batch and hands it
// to whoever actually sends campus mail.

import { h, frag } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { setHeader, setMain, state } from '../shell.js';
import {
  panel, dataTable, badge, notice, toast, tiles, copyButton,
  confirmModal, modal, emptyState, detailList,
} from '../components.js';
import { plural, relative } from '../format.js';

export async function toSendView() {
  const data = await api.get('/messages/due');

  setHeader({
    title: 'To send',
    subtitle: 'Messages the schedule has produced, waiting to be handed over.',
    actions: h('button.btn', {
      onclick: async (event) => {
        event.currentTarget.disabled = true;
        await api.post('/system/scheduler/tick');
        toast('Queue refreshed.');
        toSendView();
      },
    }, icon('refresh'), 'Check for new ones'),
  });

  if (!state.meta.is_draft_mode) {
    setMain(notice('info', h('div',
      h('p', h('strong', 'This system is sending for itself.'),
        ' Messages are delivered automatically at their scheduled times, so nothing needs handing over.'),
      h('p', h('a', { href: '/messages' }, 'Open the outbox'), ' to see what has gone out.'))));
    return;
  }

  setMain(
    tiles([
      { label: 'Waiting to be sent', value: data.waiting, note: `across ${plural(data.batches.length, 'batch', 'batches')}` },
    ]),

    data.batches.length === 0
      ? panel({
        flush: true,
        body: emptyState({
          title: 'Nothing is waiting',
          text: 'Messages appear here the moment their scheduled time arrives. Until then the schedule is simply running.',
          action: h('p', h('a.btn', { href: '/events' }, 'See upcoming events')),
        }),
      })
      : frag(
        notice('info', h('div',
          h('p', 'Each row is one reminder for one event. Open it to take the message out in whichever form your webmaster needs.'),
          h('p.small', 'Mark a batch as sent once it has actually gone, so the reporting and the follow-up reminders stay correct.'))),

        panel({
          title: 'Ready to hand over',
          hint: 'Oldest first.',
          flush: true,
          body: dataTable([
            {
              label: 'Message',
              render: (row) => frag(
                h('a.row-title', { href: `/to-send/${encodeURIComponent(row.batch_key)}` }, row.label || 'Message'),
                h('span.sub', row.event_name)),
            },
            { label: 'Subject', render: (row) => h('span.small', row.subject || '') },
            { label: 'Channel', render: (row) => h('span.small', channelLabel(row.channel)) },
            {
              label: 'Due',
              render: (row) => frag(
                h('span.nowrap.small', row.scheduled_local),
                h('span.sub.nowrap', row.due_relative)),
            },
            {
              label: 'Recipients',
              num: true,
              render: (row) => frag(
                h('span.tabular', String(row.recipients - row.unreachable)),
                row.unreachable ? h('span.sub', `${row.unreachable} unreachable`) : null),
            },
            {
              label: '',
              render: (row) => h('a.btn.btn-small.btn-primary', {
                href: `/to-send/${encodeURIComponent(row.batch_key)}`,
              }, 'Open'),
            },
          ], data.batches, {
            onRowClick: (row) => navigate(`/to-send/${encodeURIComponent(row.batch_key)}`),
          }),
        })));
}

function channelLabel(channel) {
  return channel === 'email' ? 'Email' : channel === 'sms' ? 'SMS' : 'WhatsApp';
}

// ---------------------------------------------------------------------------
// One batch
// ---------------------------------------------------------------------------
export async function batchView({ key }) {
  const encoded = encodeURIComponent(key);
  const [batch, generic] = await Promise.all([
    api.get(`/messages/batches/${encoded}`),
    api.get(`/messages/batches/${encoded}/generic`),
  ]);
  const sample = batch.messages.find((m) => m.to_address) || batch.messages[0];
  const done = batch.sendable === 0 && batch.already_handled > 0;

  setHeader({
    title: batch.label || 'Message',
    subtitle: `${batch.event_name} · ${plural(batch.sendable, 'recipient')} · ${channelLabel(batch.channel)}`,
    back: { href: '/to-send', label: 'To send' },
    actions: done
      ? h('button.btn', {
        onclick: () => confirmModal({
          title: 'Put this batch back',
          message: 'Use this if the handoff did not actually happen. The batch returns to the queue and the messages stop counting as sent.',
          confirmLabel: 'Put it back',
          onConfirm: async () => {
            await api.post(`/messages/batches/${encoded}/reopen`);
            toast('Batch returned to the queue.');
            batchView({ key });
          },
        }),
      }, 'Put it back in the queue')
      : h('button.btn.btn-primary', {
        onclick: () => markSent(batch, encoded, key),
      }, icon('check'), 'Mark as sent'),
  });

  setMain(
    done
      ? notice('good', h('div',
        h('p', h('strong', 'This batch has been sent.'),
          ` ${plural(batch.already_handled, 'message')} marked as handed over${batch.messages[0].handed_off_by ? ` by ${batch.messages[0].handed_off_by}` : ''}${batch.messages[0].handed_off_at ? `, ${relative(batch.messages[0].handed_off_at)}` : ''}.`),
        h('p.small', 'Follow-up reminders that depend on this one will now run as scheduled.')))
      : null,

    batch.unreachable > 0
      ? notice('warning', `${plural(batch.unreachable, 'student')} in this batch ${batch.unreachable === 1 ? 'has' : 'have'} no ${batch.channel === 'email' ? 'email address' : 'phone number'} on record and ${batch.unreachable === 1 ? 'is' : 'are'} left out of every file below.`)
      : null,

    h('.grid-2',
      panel({
        title: 'Take it out',
        hint: 'Whichever form suits how campus mail actually gets sent.',
        body: frag(
          h('h3', 'Mail merge file'),
          h('p.small.muted', 'One row per student, carrying that student’s own subject, body and personal links. This is the one to use if your webmaster can run a mail merge, because every student keeps a working registration link and their replies are still tracked automatically.'),
          h('.row-tight', { style: { marginBottom: '18px' } },
            h('a.btn.btn-primary', { href: `/api/messages/batches/${encoded}/mail-merge.csv`, download: '' },
              icon('download'), 'Download CSV'),
            h('a.btn', { href: `/api/messages/batches/${encoded}/messages.eml`, download: '' },
              icon('download'), 'Download as .eml')),

          h('hr.rule'),

          h('h3', 'One message to everyone'),
          h('p.small.muted', 'Copy the addresses into BCC and the text into the body. Quicker, but every student receives the same words.'),
          h('.row-tight', { style: { marginBottom: '10px' } },
            copyButton(`Copy ${plural(batch.sendable, 'address', 'addresses')}`, async () => {
              const response = await fetch(`/api/messages/batches/${encoded}/recipients.txt`);
              return response.text();
            }, { small: false }),
            generic.subject ? copyButton('Copy subject', generic.subject, { small: false }) : null,
            copyButton('Copy message', generic.body, { small: false }),
            h('button.btn', {
              type: 'button',
              onclick: () => modal({
                title: 'The message everyone would receive',
                wide: true,
                body: frag(
                  h('p.small.muted', 'Rendered once, with no individual in it. This is exactly what the copy buttons give you.'),
                  h('.message-preview',
                    generic.subject ? h('.preview-subject', generic.subject) : null,
                    h('pre', generic.body))),
              }),
            }, icon('eye'), 'See it')),
          notice('info', h('div',
            h('p.small', h('strong', 'This version is written for a group.'),
              ' It greets the reader as "student" rather than by name, and every link points at the event’s public page instead of a personal one.'),
            h('p.small', 'On that page a student gives their campus ID and campus email, then confirms or declines exactly as they would from a personal link, so the reply is still recorded here.'),
            h('p.small',
              h('a', { href: `/e/${batch.event_id}`, target: '_blank', rel: 'noopener', 'data-external': 'true' },
                'Open the public page'), ' to see what they would see.')))),
      }),

      panel({
        title: 'What it says',
        hint: sample ? `As ${sample.student_name} receives it.` : null,
        body: sample
          ? h('.message-preview',
            sample.subject ? h('.preview-subject', sample.subject) : null,
            h('pre', sample.body || ''))
          : h('p.muted', 'Nothing to preview.'),
      })),

    panel({
      title: 'Who it goes to',
      actions: h('a.btn.btn-small', { href: `/events/${batch.event_id}` }, 'Open the event'),
      flush: true,
      body: dataTable([
        {
          label: 'Student',
          render: (row) => frag(
            h('a.row-title', { href: `/students/${row.student_id}` }, row.student_name),
            h('span.sub', row.campus_id)),
        },
        { label: 'Address', render: (row) => row.to_address || h('span.muted', 'None on record') },
        {
          label: 'State',
          render: (row) => row.status === 'sent'
            ? badge('Sent', 'sent')
            : row.to_address ? badge('Ready', 'neutral') : badge('Unreachable', 'skipped'),
        },
        {
          label: '',
          render: (row) => h('button.btn.btn-small', {
            onclick: () => modal({
              title: row.student_name,
              wide: true,
              body: frag(
                detailList([
                  ['To', row.to_address || 'No address on record'],
                  ['Campus ID', row.campus_id],
                ]),
                h('.message-preview', { style: { marginTop: '14px' } },
                  row.subject ? h('.preview-subject', row.subject) : null,
                  h('pre', row.body || ''))),
            }),
          }, icon('eye')),
        },
      ], batch.messages),
    }));
}

function markSent(batch, encoded, key) {
  confirmModal({
    title: 'Mark this batch as sent',
    message: frag(
      h('p', `This records ${plural(batch.sendable, 'message')} as delivered.`),
      h('p.small', 'The system did not send them, so this is your word rather than something it observed. Only press it once the messages have actually gone.'),
      h('p.small', 'It matters because the reminders that follow, such as the chase to students who have not replied, are timed from here.')),
    confirmLabel: 'They have been sent',
    onConfirm: async () => {
      const result = await api.post(`/messages/batches/${encoded}/mark-sent`);
      toast(`${plural(result.changed, 'message')} marked as sent.`);
      navigate('/to-send');
    },
  });
}
