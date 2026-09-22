'use strict';

const express = require('express');
const config = require('../config');
const { asyncHandler } = require('../lib/errors');
const { page, escapeHtml, eventFacts } = require('../lib/render');
const { buildEventIcs } = require('../lib/ics');
const dt = require('../lib/datetime');
const events = require('../services/events');
const registrations = require('../services/registrations');
const feedback = require('../services/feedback');
const outbox = require('../services/outbox');
const { eventTypeLabel } = require('../lib/constants');

const router = express.Router();

// A 1x1 transparent PNG, used for the email open pixel.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function notFoundPage(res, { heading, message }) {
  res.status(404).type('html').send(page({
    title: heading,
    heading,
    body: `<p>${escapeHtml(message)}</p>
      <p class="muted">If you reached this page from an email, the link may have been truncated by your mail client. Copy the whole address into your browser, or write to
      <a href="mailto:${escapeHtml(config.org.email)}">${escapeHtml(config.org.email)}</a>.</p>`,
  }));
}

function recordClick(req) {
  const messageId = req.query.m;
  if (messageId) {
    try {
      outbox.recordClick(String(messageId));
    } catch {
      // Tracking must never stop a student from reaching the page.
    }
  }
}

// ---------------------------------------------------------------------------
// Email open tracking
// ---------------------------------------------------------------------------
router.get('/t/:messageId.png', (req, res) => {
  try {
    outbox.recordOpen(req.params.messageId);
  } catch {
    // Ignore: the pixel must always return an image.
  }
  res.setHeader('content-type', 'image/png');
  res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, private');
  res.send(PIXEL);
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function statusNote(registration, event, seatsRemaining) {
  if (event.status === 'cancelled') {
    return { tone: 'alert', text: 'This event has been cancelled. No action is needed.' };
  }
  if (registration.status === 'registered') {
    return { tone: 'good', text: 'Your place is confirmed.' };
  }
  if (registration.status === 'waitlisted') {
    return { tone: 'notice', text: 'You are on the waiting list. We will write to you if a place opens.' };
  }
  if (registration.status === 'declined') {
    return { tone: 'notice', text: 'You have told us you cannot attend.' };
  }
  if (event.registration_closes_at && new Date(event.registration_closes_at) < new Date()) {
    return { tone: 'alert', text: 'Registration for this event has closed.' };
  }
  if (seatsRemaining === 0) {
    return { tone: 'notice', text: 'This event is full. You can still respond, and you will be added to the waiting list.' };
  }
  if (seatsRemaining !== null && seatsRemaining <= 10) {
    return { tone: 'notice', text: `${seatsRemaining} place${seatsRemaining === 1 ? '' : 's'} left.` };
  }
  return null;
}

function registrationPage(registration, event, { flash = null, intent = null } = {}) {
  const seatsRemaining = registrations.seatsRemaining(event);
  const note = statusNote(registration, event, seatsRemaining);
  const isOver = new Date(event.ends_at_utc) < new Date();
  const closed = event.status === 'cancelled' || isOver;

  const joining = [];
  if (event.meeting_link && registration.status === 'registered' && !closed) {
    joining.push(`<p><a class="button button-quiet" href="${escapeHtml(event.meeting_link)}">Open the meeting link</a></p>`);
  }

  const actions = closed ? '' : `
    <form method="post" action="/r/${escapeHtml(registration.token)}/respond" class="choice-form">
      <div class="choice-actions">
        <button type="submit" name="action" value="confirm" class="button${intent === 'confirm' ? ' button-primary' : ''}">
          ${registration.status === 'registered' ? 'Keep my place' : 'Confirm my place'}
        </button>
        <button type="submit" name="action" value="decline" class="button button-quiet${intent === 'decline' ? ' button-primary' : ''}">
          I cannot attend
        </button>
      </div>
      <p class="muted small">Your answer is recorded against ${escapeHtml(registration.campus_id)}. You can change it on this page at any time before the event.</p>
    </form>`;

  const body = `
    ${flash ? `<p class="flash flash-${escapeHtml(flash.tone)}">${escapeHtml(flash.text)}</p>` : ''}
    ${note ? `<p class="status status-${escapeHtml(note.tone)}">${escapeHtml(note.text)}</p>` : ''}
    <p class="eyebrow">${escapeHtml(eventTypeLabel(event.type))}</p>
    ${eventFacts(event)}
    ${event.description ? `<div class="prose"><p>${escapeHtml(event.description).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br />')}</p></div>` : ''}
    ${event.preparation_notes ? `<div class="callout"><h2>Before you attend</h2><p>${escapeHtml(event.preparation_notes).replace(/\n/g, '<br />')}</p></div>` : ''}
    ${event.dress_code ? `<p class="muted"><strong>Dress code:</strong> ${escapeHtml(event.dress_code)}</p>` : ''}
    ${joining.join('')}
    ${actions}
    ${closed ? '' : `<p class="muted small"><a href="/r/${escapeHtml(registration.token)}/calendar.ics">Add to your calendar</a></p>`}
  `;

  return page({
    title: event.name,
    heading: event.name,
    subheading: `${dt.formatFullDate(event.event_date)}, ${dt.formatTimeRange(event.start_time, event.end_time)}`,
    body,
    footerNote: `You are receiving this because you are on a Career Services list for ${escapeHtml(config.org.name)}.`,
  });
}

router.get('/r/:token', asyncHandler(async (req, res) => {
  recordClick(req);
  const registration = registrations.findByToken(req.params.token);
  if (!registration) {
    return notFoundPage(res, {
      heading: 'This link is not recognised',
      message: 'The link may have expired, or the event may have been removed.',
    });
  }
  const event = events.get(registration.event_id);
  const intent = ['confirm', 'decline'].includes(req.query.a) ? req.query.a : null;
  const flash = intent
    ? {
      tone: 'notice',
      text: intent === 'confirm'
        ? 'Press the confirm button below to record your place. Nothing has been saved yet.'
        : 'Press the button below to tell us you cannot attend. Nothing has been saved yet.',
    }
    : null;
  res.type('html').send(registrationPage(registration, event, { flash, intent }));
}));

router.post('/r/:token/respond', asyncHandler(async (req, res) => {
  const registration = registrations.findByToken(req.params.token);
  if (!registration) {
    return notFoundPage(res, {
      heading: 'This link is not recognised',
      message: 'The link may have expired, or the event may have been removed.',
    });
  }
  const action = req.body && req.body.action === 'decline' ? 'decline' : 'confirm';
  let flash;
  try {
    const result = registrations.respond(registration.id, action, { actor: 'student' });

    if (result.promoted) {
      // Releasing a place moved the first waiting student up. They only know
      // that if we tell them, so the confirmation goes out to them too.
      outbox.queueTransactional(result.promoted, 'sys_confirmation_email', {
        label: 'Promoted from the waiting list',
      });
    }

    if (result.status === 'registered') {
      outbox.queueTransactional(registration.id, 'sys_confirmation_email', { label: 'Registration confirmed' });
      flash = {
        tone: 'good',
        text: 'Your place is confirmed. A confirmation has been sent to your campus email address.',
      };
    } else if (result.status === 'waitlisted') {
      flash = {
        tone: 'notice',
        text: 'This event is full, so you have been added to the waiting list. We will write to you if a place opens.',
      };
    } else {
      flash = { tone: 'notice', text: 'Thank you for telling us. Your place has been released.' };
    }
  } catch (error) {
    flash = { tone: 'alert', text: error.message };
  }
  const fresh = registrations.findByToken(req.params.token);
  const event = events.get(fresh.event_id);
  res.type('html').send(registrationPage(fresh, event, { flash }));
}));

router.get('/r/:token/calendar.ics', asyncHandler(async (req, res) => {
  const registration = registrations.findByToken(req.params.token);
  if (!registration) return res.status(404).type('text').send('This link is not recognised.');
  const event = events.get(registration.event_id);
  const ics = buildEventIcs({
    uid: `${event.id}@career-services.dubai.bits-pilani.ac.in`,
    summary: event.name,
    description: [event.description, event.meeting_link ? `Joining link: ${event.meeting_link}` : '']
      .filter(Boolean).join('\n\n'),
    location: event.venue || (event.mode === 'online' ? 'Online' : ''),
    url: event.meeting_link || `${config.publicBaseUrl}/r/${registration.token}`,
    startsAtUtc: event.starts_at_utc,
    endsAtUtc: event.ends_at_utc,
    organiserName: event.organiser_name || config.org.shortName,
    organiserEmail: event.organiser_email || config.org.email,
    status: event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
  });
  res.setHeader('content-type', 'text/calendar; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="event.ics"');
  res.send(ics);
}));

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
function ratingField(name, label, required = false) {
  // Marking every radio in the group required is what makes a radio group
  // required in HTML: the browser accepts the group once any one is chosen.
  const options = [1, 2, 3, 4, 5].map((value) => `
    <label class="rating-option">
      <input type="radio" name="${escapeHtml(name)}" value="${value}"${required ? ' required' : ''} />
      <span>${value}</span>
    </label>`).join('');
  return `
    <fieldset class="rating">
      <legend>${escapeHtml(label)}${required ? ' <span class="required">required</span>' : ''}</legend>
      <div class="rating-scale">
        <span class="rating-anchor">Poor</span>
        ${options}
        <span class="rating-anchor">Excellent</span>
      </div>
    </fieldset>`;
}

function feedbackPage(registration, event, { flash = null, existing = null } = {}) {
  if (existing && !flash) {
    return page({
      title: 'Feedback received',
      heading: 'Your feedback is already with us',
      subheading: event.name,
      body: `<p class="status status-good">You answered this form on ${escapeHtml(dt.formatLongDate(existing.submitted_at.slice(0, 10)))}. Thank you.</p>
        <p>If you would like to change your answers, fill the form in again and the new answers replace the old ones.</p>
        <p><a class="button button-quiet" href="/f/${escapeHtml(registration.token)}?again=1">Answer again</a></p>`,
    });
  }

  const body = `
    ${flash ? `<p class="flash flash-${escapeHtml(flash.tone)}">${escapeHtml(flash.text)}</p>` : ''}
    <p>Four ratings and three short questions. It takes about two minutes, and it decides what Career Services runs next semester.</p>
    <form method="post" action="/f/${escapeHtml(registration.token)}" class="feedback-form">
      ${ratingField('overall_rating', 'Overall, how would you rate this session?', true)}
      ${ratingField('content_rating', 'How useful was the content?')}
      ${event.speaker ? ratingField('speaker_rating', `How would you rate ${event.speaker}?`) : ''}
      ${ratingField('organisation_rating', 'How well was the session organised?')}

      <fieldset class="choice">
        <legend>Would you recommend this session to another student?</legend>
        <label class="inline-option"><input type="radio" name="would_recommend" value="1" /> <span>Yes</span></label>
        <label class="inline-option"><input type="radio" name="would_recommend" value="0" /> <span>No</span></label>
      </fieldset>

      <label class="field">
        <span>What was most useful?</span>
        <textarea name="most_useful" rows="3" maxlength="2000"></textarea>
      </label>
      <label class="field">
        <span>What would you change?</span>
        <textarea name="improvements" rows="3" maxlength="2000"></textarea>
      </label>
      <label class="field">
        <span>What should Career Services run next?</span>
        <textarea name="future_topics" rows="3" maxlength="2000"></textarea>
      </label>

      <button type="submit" class="button button-primary">Send my feedback</button>
      <p class="muted small">Your answers are read by the Career Services team. They are reported to speakers and partner organisations only as averages and unattributed comments.</p>
    </form>`;

  return page({
    title: `Feedback on ${event.name}`,
    heading: 'How was the session?',
    subheading: `${event.name}, ${dt.formatLongDate(event.event_date)}`,
    body,
  });
}

router.get('/f/:token', asyncHandler(async (req, res) => {
  recordClick(req);
  const registration = registrations.findByToken(req.params.token);
  if (!registration) {
    return notFoundPage(res, {
      heading: 'This link is not recognised',
      message: 'The feedback link may have expired, or the event may have been removed.',
    });
  }
  const event = events.get(registration.event_id);
  if (event.feedback_mode === 'external' && event.feedback_form_url) {
    return res.redirect(302, event.feedback_form_url);
  }
  if (event.feedback_mode === 'none') {
    return notFoundPage(res, {
      heading: 'No feedback is being collected',
      message: 'Career Services is not collecting feedback for this event.',
    });
  }
  const existing = req.query.again ? null : feedback.findForStudentEvent(event.id, registration.student_id);
  res.type('html').send(feedbackPage(registration, event, { existing }));
}));

router.post('/f/:token', asyncHandler(async (req, res) => {
  const registration = registrations.findByToken(req.params.token);
  if (!registration) {
    return notFoundPage(res, {
      heading: 'This link is not recognised',
      message: 'The feedback link may have expired.',
    });
  }
  const event = events.get(registration.event_id);
  try {
    feedback.submit(registration, req.body || {});
  } catch (error) {
    return res.status(422).type('html').send(feedbackPage(registration, event, {
      flash: { tone: 'alert', text: error.message },
    }));
  }
  res.type('html').send(page({
    title: 'Thank you',
    heading: 'Thank you',
    subheading: event.name,
    body: `<p class="status status-good">Your feedback has been recorded.</p>
      <p>Career Services reads every response. If you raised something that needs a reply, write to
      <a href="mailto:${escapeHtml(config.org.email)}">${escapeHtml(config.org.email)}</a>.</p>`,
  }));
}));

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------
router.get('/u/:token', asyncHandler(async (req, res) => {
  const registration = registrations.findByToken(req.params.token);
  if (!registration) {
    return notFoundPage(res, { heading: 'This link is not recognised', message: 'The link may have expired.' });
  }
  res.type('html').send(page({
    title: 'Career Services mail',
    heading: 'Career Services mail',
    body: `<p>You are on the Career Services mailing list as ${escapeHtml(registration.name)} (${escapeHtml(registration.campus_id)}).</p>
      <p>Event invitations, reminders and feedback requests are part of how Career Services runs placements and readiness sessions, so students are not removed from the list automatically.</p>
      <p>If you want to stop receiving them, write to <a href="mailto:${escapeHtml(config.org.email)}">${escapeHtml(config.org.email)}</a> from your campus address and the team will action it.</p>`,
  }));
}));

module.exports = router;
