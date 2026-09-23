import { h, frag } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { setHeader, setMain, state } from '../shell.js';
import { panel, detailList, notice, badge, toast, dataTable } from '../components.js';
import { deliveryLabel } from '../shell.js';
import { relative, plural } from '../format.js';

export async function settingsView() {
  const health = await api.get('/system/health');
  const scheduler = health.scheduler;
  const channels = health.channels;

  setHeader({
    title: 'Settings',
    subtitle: 'How this installation is configured. These values come from the environment and change when the server restarts.',
    actions: h('button.btn', {
      onclick: async (event) => {
        event.currentTarget.disabled = true;
        const result = await api.post('/system/scheduler/tick');
        toast(`Run finished in ${result.duration_ms}ms. ${plural(result.dispatch.sent, 'message')} sent.`);
        settingsView();
      },
    }, icon('refresh'), 'Run the scheduler now'),
  });

  const channelRow = (name, label, info) => ({
    name: label,
    state: info.configured
      ? (info.ok ? badge('Ready', 'sent') : badge('Problem', 'failed'))
      : badge('Not configured', 'skipped'),
    detail: info.reason || (info.configured ? 'Verified.' : 'Messages on this channel are recorded but not sent.'),
  });

  const modeNotice = {
    draft: notice('info', h('div',
      h('p', h('strong', 'This system drafts, it does not send.'),
        ' It decides who gets what and when, renders each message in full, then holds it in the To send queue for a member of staff to hand over.'),
      h('p.small', 'Nothing below needs configuring for this to work. The email and gateway settings only matter if you later switch to DELIVERY_MODE=send.'))),
    preview: notice('warning', h('div',
      h('p', h('strong', 'Dry run is on.'), ' Every message is composed, scheduled, tracked and shown in the outbox, but nothing is delivered and nothing waits to be handed over.'),
      h('p.small', 'This mode is for testing. Use DELIVERY_MODE=draft for normal use, or DELIVERY_MODE=send to deliver directly.'))),
    send: notice('good', 'This system sends for itself. Messages are delivered to students at their scheduled times.'),
  }[state.meta.delivery_mode];

  setMain(
    modeNotice,

    !scheduler.enabled
      ? notice('error', 'The background worker is switched off, so nothing is sent automatically. Set SCHEDULER_ENABLED=true and restart.')
      : !scheduler.running
        ? notice('error', 'The background worker is not running in this process. Restart the server.')
        : null,

    h('.grid-2',
      panel({
        title: 'Background worker',
        hint: state.meta.is_draft_mode
          ? 'Keeps the schedule moving and fills the To send queue.'
          : 'What keeps the system automatic.',
        body: detailList([
          ['Delivery', badge(deliveryLabel(state.meta.delivery_mode), state.meta.delivery_mode === 'send' ? 'sent' : 'neutral')],
          ['State', scheduler.enabled ? (scheduler.running ? badge('Running', 'sent') : badge('Stopped', 'failed')) : badge('Switched off', 'skipped')],
          ['Runs every', `${scheduler.interval_seconds} seconds`],
          ['Messages per run', String(scheduler.batch_size)],
          ['Gives up on a message after', `${scheduler.max_lateness_minutes} minutes late`],
          ['Runs this process', String(scheduler.ticks_this_process)],
          ['Last run', scheduler.last_run_persisted
            ? `${relative(scheduler.last_run_persisted.at)}, ${scheduler.last_run_persisted.sent} sent, ${scheduler.last_run_persisted.duration_ms}ms`
            : 'Not yet'],
          scheduler.last_error && ['Last error', h('span', { style: { color: 'var(--alert-700)' } }, scheduler.last_error.message)],
        ]),
      }),

      panel({
        title: 'Delivery channels',
        hint: state.meta.is_draft_mode
          ? 'Not used while the system is drafting. Shown so you can see what a switch to sending would need.'
          : 'A channel with no provider configured records its messages without sending them.',
        flush: true,
        body: dataTable([
          { label: 'Channel', render: (row) => h('span.row-title', row.name) },
          { label: 'State', render: (row) => row.state },
          { label: 'Detail', render: (row) => h('span.small.muted', row.detail) },
        ], [
          channelRow('email', 'Email', channels.email),
          channelRow('sms', 'SMS', channels.sms),
          channelRow('whatsapp', 'WhatsApp', channels.whatsapp),
        ]),
      })),

    panel({
      title: 'Installation',
      body: detailList([
        ['Organisation', state.meta.org.name],
        ['Reply-to address', state.meta.org.email],
        ['Telephone', state.meta.org.phone],
        ['Default timezone', state.meta.default_timezone],
        ['Public base URL', h('span.mono', state.meta.public_base_url)],
        ['Staff sign in', state.meta.auth_enabled ? badge('Password required', 'sent') : badge('Open', 'skipped')],
        ['Server time', new Date(health.time).toString()],
      ]),
      foot: h('p.small.muted', { style: { margin: 0 } },
        'The public base URL is what goes into every registration and feedback link. If it is wrong, students will click links that do not resolve. Set PUBLIC_BASE_URL in the environment.'),
    }),

    !state.meta.auth_enabled
      ? notice('warning', h('div',
        h('p', 'This console has no password, so anyone who can reach it can see student records and send messages.'),
        h('p.small', 'Set STAFF_PASSWORD in the environment and restart before putting it on a network anyone else can reach.')))
      : h('form', { method: 'post', action: '/sign-out' },
        h('button.btn', { type: 'submit' }, 'Sign out')),

    panel({
      title: 'What this system does not do',
      body: h('ul',
        state.meta.is_draft_mode
          ? h('li', h('strong', 'It does not send. '), 'It decides and drafts. Delivery is done by whoever sends campus mail, and this system records that it happened when you say so.')
          : null,
        h('li', 'It does not read replies. A student who answers a reminder by email reaches the Career Services inbox, not this system.'),
        h('li', 'It does not hold documents. CVs and slide decks live wherever they already live; put the link in the event description.'),
        h('li', 'It does not decide who to invite. That stays with the team, through groups and filters.'),
        h('li', 'It does not remove a student from the mailing list on their own request. Those go to the team, so that nobody is dropped from placement communication by an accidental click.')),
    }));
}
