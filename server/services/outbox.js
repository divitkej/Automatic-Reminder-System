'use strict';

const { getDb, transaction } = require('../db');
const { newId } = require('../lib/ids');
const dt = require('../lib/datetime');
const config = require('../config');
const tpl = require('../lib/template');
const { NotFoundError, ValidationError } = require('../lib/errors');
const csv = require('../lib/csv');
const { buildContext, buildGenericContext } = require('./context');
const channels = require('./channels');
const events = require('./events');
const rules = require('./rules');
const templates = require('./templates');
const activity = require('./activity');

/**
 * The outbox is the single place where a reminder becomes a real message.
 *
 * Materialising writes one row per rule and per student with the exact time it
 * is due. The dedupe key means that running it again, on every scheduler tick,
 * after an edit, or after a restart, never produces a second copy of a
 * reminder. Dispatch then picks up what is due, checks that the student still
 * matches the rule's audience at that moment, renders the template against live
 * event data and hands it to the channel.
 */

/** Recorded on a message withdrawn because its reminder was switched off. */
const SWITCHED_OFF = 'The reminder was switched off';

const AUDIENCE_SQL = {
  all: "r.status <> 'cancelled'",
  registered: "r.status = 'registered'",
  unregistered: "r.status IN ('invited', 'declined', 'waitlisted')",
  attended: 'r.attended = 1',
  absent: "r.attended = 0 AND r.status = 'registered'",
  awaiting_feedback: `r.attended = 1 AND NOT EXISTS (
    SELECT 1 FROM feedback_responses f WHERE f.event_id = r.event_id AND f.student_id = r.student_id
  )`,
};

function recipientsFor(eventId, audienceRule) {
  const clause = AUDIENCE_SQL[audienceRule] || AUDIENCE_SQL.all;
  return getDb().prepare(`
    SELECT r.*, s.name, s.campus_id, s.email, s.phone, s.program, s.discipline,
           s.year_of_study, s.batch, s.opted_out
    FROM registrations r
    JOIN students s ON s.id = r.student_id
    WHERE r.event_id = ? AND s.opted_out = 0 AND ${clause}
    ORDER BY s.name COLLATE NOCASE
  `).all(eventId);
}

function countRecipients(eventId, audienceRule) {
  const clause = AUDIENCE_SQL[audienceRule] || AUDIENCE_SQL.all;
  return getDb().prepare(`
    SELECT COUNT(*) AS n FROM registrations r
    JOIN students s ON s.id = r.student_id
    WHERE r.event_id = ? AND s.opted_out = 0 AND ${clause}
  `).get(eventId).n;
}

function matchesAudience(registrationId, audienceRule) {
  const clause = AUDIENCE_SQL[audienceRule] || AUDIENCE_SQL.all;
  return Boolean(getDb().prepare(`
    SELECT 1 FROM registrations r
    JOIN students s ON s.id = r.student_id
    WHERE r.id = ? AND s.opted_out = 0 AND ${clause}
  `).get(registrationId));
}

function renderMessage({ event, student, registration, template, messageId, at }) {
  const context = buildContext({ event, student, registration, messageId, at });
  return {
    subject: template.subject ? tpl.tidy(tpl.render(template.subject, context)) : null,
    body: tpl.tidy(tpl.render(template.body, context)),
  };
}

/**
 * Write or refresh the outbox rows for one event.
 *
 * Rows already sent are never touched. Rows still waiting are retimed if the
 * event moved, and withdrawn if their rule was disabled or deleted.
 */
function materialise(eventId, { actor = 'system' } = {}) {
  const event = events.get(eventId);
  const report = { created: 0, retimed: 0, cancelled: 0, restored: 0, skipped: 0 };

  if (event.status === 'draft') {
    return { ...report, reason: 'The event is still a draft, so nothing is scheduled.' };
  }
  if (event.status === 'cancelled') {
    return { ...report, reason: 'The event is cancelled.' };
  }

  const ruleRows = getDb().prepare('SELECT * FROM reminder_rules WHERE event_id = ?').all(eventId);
  const activeRuleIds = new Set(ruleRows.filter((r) => r.enabled).map((r) => r.id));
  const at = dt.nowIso();

  transaction(() => {
    // Withdraw anything still waiting whose rule is gone or switched off.
    const orphaned = getDb().prepare(`
      SELECT m.id, m.rule_id FROM messages m
      WHERE m.event_id = ? AND m.status = 'scheduled' AND m.rule_id IS NOT NULL
    `).all(eventId);
    for (const row of orphaned) {
      if (activeRuleIds.has(row.rule_id)) continue;
      getDb().prepare('UPDATE messages SET status = \'cancelled\', skip_reason = ?, updated_at = ? WHERE id = ?')
        .run(SWITCHED_OFF, at, row.id);
      report.cancelled += 1;
    }

    for (const rule of ruleRows) {
      if (!rule.enabled) continue;
      const template = rule.template_id
        ? getDb().prepare('SELECT * FROM templates WHERE id = ?').get(rule.template_id)
        : null;
      if (!template) {
        report.skipped += 1;
        continue;
      }
      const sendAt = rules.sendTimeFor(event, rule).toISOString();
      const recipients = recipientsFor(eventId, rule.audience_rule);

      for (const recipient of recipients) {
        const dedupeKey = `${rule.id}:${recipient.id}`;
        const existing = getDb().prepare('SELECT * FROM messages WHERE dedupe_key = ?').get(dedupeKey);

        if (existing) {
          if (existing.status === 'scheduled' && existing.scheduled_for !== sendAt) {
            getDb().prepare('UPDATE messages SET scheduled_for = ?, updated_at = ? WHERE id = ?')
              .run(sendAt, at, existing.id);
            report.retimed += 1;
          } else if (existing.status === 'cancelled' && existing.skip_reason === SWITCHED_OFF
                     && new Date(sendAt).getTime() > Date.now()) {
            // The reminder was switched off and has been switched back on, and
            // its moment has not passed. Restore it rather than leaving the
            // student with a gap the interface says nothing about.
            getDb().prepare(`UPDATE messages SET status = 'scheduled', skip_reason = NULL,
                             scheduled_for = ?, updated_at = ? WHERE id = ?`)
              .run(sendAt, at, existing.id);
            report.restored += 1;
          }
          continue;
        }

        const messageId = newId('msg');
        const address = channels.addressFor(rule.channel, recipient);
        const rendered = renderMessage({
          event,
          student: recipient,
          registration: recipient,
          template,
          messageId,
          at: new Date(sendAt).getTime(),
        });

        getDb().prepare(`
          INSERT INTO messages (id, dedupe_key, event_id, rule_id, registration_id, student_id,
                                category, channel, label, to_address, subject, body,
                                scheduled_for, status, skip_reason, batch_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(messageId, dedupeKey, eventId, rule.id, recipient.id, recipient.student_id,
          rule.category, rule.channel, rule.label, address,
          rendered.subject, rendered.body, sendAt,
          address ? 'scheduled' : 'skipped',
          address ? null : channels.reasonUnreachable(rule.channel),
          `${rule.id}@${sendAt}`, at, at);
        report.created += 1;
      }
    }
  });

  if (report.created || report.retimed || report.cancelled || report.restored) {
    activity.log({
      eventId,
      actor,
      action: 'outbox.materialised',
      detail: `${report.created} scheduled, ${report.retimed} retimed, ${report.restored} restored, ${report.cancelled} withdrawn`,
    });
  }
  return report;
}

/** Materialise every event whose schedule could still produce a message. */
function materialiseAll() {
  // Both bounds are ISO instants, matching the column format exactly. SQLite's
  // own datetime() renders "YYYY-MM-DD HH:MM:SS", which does not compare
  // correctly against "YYYY-MM-DDTHH:MM:SS.sssZ" as a string.
  const horizon = new Date(Date.now() + 30 * dt.DAY).toISOString();
  const floor = new Date(Date.now() - 30 * dt.DAY).toISOString();
  const rows = getDb().prepare(`
    SELECT id FROM events
    WHERE status IN ('scheduled', 'completed')
      AND ends_at_utc >= ?
      AND starts_at_utc <= ?
  `).all(floor, horizon);
  const totals = { events: rows.length, created: 0, retimed: 0, cancelled: 0 };
  for (const row of rows) {
    const report = materialise(row.id);
    totals.created += report.created;
    totals.retimed += report.retimed;
    totals.cancelled += report.cancelled;
  }
  return totals;
}

/** Withdraw everything still waiting for an event. */
function cancelPending(eventId, reason = 'The event was cancelled') {
  const changed = getDb().prepare(`
    UPDATE messages SET status = 'cancelled', skip_reason = ?, updated_at = ?
    WHERE event_id = ? AND status = 'scheduled'
  `).run(reason, dt.nowIso(), eventId).changes;
  if (changed) activity.log({ eventId, action: 'outbox.cancelled', detail: `${changed} pending message${changed === 1 ? '' : 's'} withdrawn` });
  return changed;
}

function dueMessages(limit) {
  const now = new Date().toISOString();
  const floor = new Date(Date.now() - config.scheduler.maxLatenessMinutes * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT * FROM messages
    WHERE status = 'scheduled' AND scheduled_for <= ? AND scheduled_for >= ?
    ORDER BY scheduled_for LIMIT ?
  `).all(now, floor, limit);
}

/**
 * Drop anything that fell too far behind to be worth sending.
 *
 * This only applies when the system sends for itself. In draft mode a message
 * sits in the queue until a person deals with it, and expiring it after three
 * hours would quietly delete the work they were meant to do.
 */
function expireStale() {
  if (config.isDraftMode) return 0;
  const floor = new Date(Date.now() - config.scheduler.maxLatenessMinutes * 60 * 1000).toISOString();
  return getDb().prepare(`
    UPDATE messages SET status = 'skipped',
      skip_reason = 'Too late to send. The scheduler was not running when this was due.',
      updated_at = ?
    WHERE status = 'scheduled' AND scheduled_for < ?
  `).run(dt.nowIso(), floor).changes;
}

// ---------------------------------------------------------------------------
// Draft mode: handing messages over instead of sending them
// ---------------------------------------------------------------------------

/**
 * Messages that have come due, grouped the way they will be handed over: one
 * batch per reminder per moment. A batch is what a member of staff actually
 * deals with, because "the day before reminder for this event" is one action
 * even though it is twenty-four separate personalised emails.
 */
function dueBatches({ limit = 100 } = {}) {
  const now = new Date().toISOString();
  return getDb().prepare(`
    SELECT m.batch_key, m.event_id, m.rule_id, m.label, m.category, m.channel,
           m.scheduled_for, e.name AS event_name, e.timezone, e.event_date,
           COUNT(*) AS recipients,
           SUM(CASE WHEN m.to_address IS NULL THEN 1 ELSE 0 END) AS unreachable,
           MIN(m.subject) AS subject
    FROM messages m
    JOIN events e ON e.id = m.event_id
    WHERE m.status = 'scheduled' AND m.scheduled_for <= ? AND m.batch_key IS NOT NULL
    GROUP BY m.batch_key
    ORDER BY m.scheduled_for
    LIMIT ?
  `).all(now, limit).map((row) => ({
    ...row,
    scheduled_local: (() => {
      const local = dt.utcToZoned(row.scheduled_for, row.timezone || config.defaultTimezone);
      return `${dt.formatLongDate(local.date)}, ${dt.formatTime12(local.time)}`;
    })(),
    due_relative: dt.relativeToNow(row.scheduled_for),
  }));
}

/** How many messages are sitting in the queue waiting for a person. */
function dueCount() {
  return getDb()
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'scheduled' AND scheduled_for <= ?")
    .get(new Date().toISOString()).n;
}

function batchMessages(batchKey) {
  return getDb().prepare(`
    SELECT m.*, s.name AS student_name, s.campus_id, s.email, s.phone,
           e.name AS event_name, e.timezone
    FROM messages m
    JOIN students s ON s.id = m.student_id
    JOIN events e ON e.id = m.event_id
    WHERE m.batch_key = ?
    ORDER BY s.name COLLATE NOCASE
  `).all(batchKey);
}

function getBatch(batchKey) {
  const messages = batchMessages(batchKey);
  if (messages.length === 0) throw new NotFoundError('Batch');
  const first = messages[0];
  const sendable = messages.filter((m) => m.status === 'scheduled' && m.to_address);
  return {
    batch_key: batchKey,
    event_id: first.event_id,
    event_name: first.event_name,
    rule_id: first.rule_id,
    label: first.label,
    category: first.category,
    channel: first.channel,
    scheduled_for: first.scheduled_for,
    recipients: messages.length,
    sendable: sendable.length,
    unreachable: messages.filter((m) => !m.to_address).length,
    already_handled: messages.filter((m) => m.status !== 'scheduled').length,
    messages,
  };
}

/**
 * Record that a batch has been handed over and actually sent.
 *
 * Nothing about the delivery happened here, so this is a statement by a member
 * of staff rather than a fact the system observed. It is recorded as such: the
 * provider is "handed off" and the person who said so is kept against every
 * message in the batch.
 */
function markBatchSent(batchKey, { actor = 'staff', note = null } = {}) {
  const batch = getBatch(batchKey);
  const at = dt.nowIso();
  const changed = getDb().prepare(`
    UPDATE messages
    SET status = 'sent', provider = 'handed_off', sent_at = ?,
        handed_off_at = ?, handed_off_by = ?, updated_at = ?
    WHERE batch_key = ? AND status = 'scheduled' AND to_address IS NOT NULL
  `).run(at, at, actor, at, batchKey).changes;

  activity.log({
    eventId: batch.event_id,
    actor,
    action: 'outbox.handed_off',
    detail: `${batch.label || 'Message'}: ${changed} recipient${changed === 1 ? '' : 's'} marked as sent${note ? `. ${note}` : ''}`,
  });
  return { changed, batch: getBatch(batchKey) };
}

/** Put a batch back in the queue, for a handoff that did not happen. */
function reopenBatch(batchKey, { actor = 'staff' } = {}) {
  const batch = getBatch(batchKey);
  const changed = getDb().prepare(`
    UPDATE messages
    SET status = 'scheduled', provider = NULL, sent_at = NULL,
        handed_off_at = NULL, handed_off_by = NULL, updated_at = ?
    WHERE batch_key = ? AND provider = 'handed_off'
  `).run(dt.nowIso(), batchKey).changes;

  activity.log({
    eventId: batch.event_id,
    actor,
    action: 'outbox.reopened',
    detail: `${batch.label || 'Message'}: ${changed} recipient${changed === 1 ? '' : 's'} put back in the queue`,
  });
  return { changed, batch: getBatch(batchKey) };
}

/**
 * A batch as a mail merge file: one row per student, carrying that student's
 * own subject, body and personal links. This is the format that keeps
 * everything working, because each student still gets their own registration
 * and feedback links and so their replies are still tracked.
 */
function batchAsCsv(batchKey) {
  const batch = getBatch(batchKey);
  return csv.stringify([
    { key: 'email', label: 'Email' },
    { key: 'student_name', label: 'Name' },
    { key: 'campus_id', label: 'Campus ID' },
    { key: 'phone', label: 'Phone' },
    { key: 'subject', label: 'Subject' },
    { key: 'body', label: 'Body' },
  ], batch.messages.filter((m) => m.to_address).map((m) => ({ ...m, email: m.to_address })));
}

/**
 * A batch rendered once, for sending to everyone at the same time.
 *
 * Not simply the first student's copy: that would put their private
 * registration token in front of the whole group. The message is re-rendered
 * with no individual in it, so the links point at the event's public page
 * instead, where a student identifies themselves before replying.
 */
function batchGeneric(batchKey) {
  const batch = getBatch(batchKey);
  const event = events.get(batch.event_id);
  const rule = batch.rule_id
    ? getDb().prepare('SELECT * FROM reminder_rules WHERE id = ?').get(batch.rule_id)
    : null;
  const template = rule && rule.template_id
    ? getDb().prepare('SELECT * FROM templates WHERE id = ?').get(rule.template_id)
    : null;

  const context = buildGenericContext({ event, at: new Date(batch.scheduled_for).getTime() });

  if (template) {
    return {
      subject: template.subject ? tpl.tidy(tpl.render(template.subject, context)) : null,
      body: tpl.tidy(tpl.render(template.body, context)),
      personalised: false,
    };
  }

  // An ad hoc message has no template to re-render, so the stored copy is
  // stripped of anything that identifies one student.
  const first = batch.messages[0];
  return {
    subject: first ? first.subject : null,
    body: stripPersonalLinks(first ? first.body : '', event),
    personalised: false,
  };
}

/** Replace any personal token link with the event's public page. */
function stripPersonalLinks(body, event) {
  const base = config.publicBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const publicPage = `${config.publicBaseUrl}/e/${event.id}`;
  return String(body || '')
    .replace(new RegExp(`${base}/r/[^\\s)]+`, 'g'), publicPage)
    .replace(new RegExp(`${base}/f/[^\\s)]+`, 'g'), `${publicPage}/feedback`);
}

/** The address list, for a batch that will be sent as one message. */
function batchRecipients(batchKey, { separator = ', ' } = {}) {
  return getBatch(batchKey).messages
    .filter((m) => m.to_address)
    .map((m) => m.to_address)
    .join(separator);
}

/**
 * A batch as RFC 5322 messages, for a mail client or relay that takes .eml
 * files. Personalisation survives, one file per student, concatenated in the
 * mbox style so the whole batch is a single download.
 */
function batchAsEml(batchKey) {
  const batch = getBatch(batchKey);
  const parts = [];
  for (const message of batch.messages) {
    if (!message.to_address) continue;
    const html = message.channel === 'email'
      ? channels.email.textToHtml(message.body, { title: message.subject })
      : null;
    const boundary = `----career-services-${message.id}`;
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${message.to_address}`,
      `Subject: ${encodeHeader(message.subject || '')}`,
      `Date: ${new Date(message.scheduled_for).toUTCString()}`,
      `Message-ID: <${message.id}@career-services.dubai.bits-pilani.ac.in>`,
      'MIME-Version: 1.0',
    ];
    if (config.mail.replyTo) headers.push(`Reply-To: ${config.mail.replyTo}`);

    if (html) {
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      parts.push([
        `From ${config.org.email} ${new Date(message.scheduled_for).toUTCString()}`,
        headers.join('\r\n'),
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        message.body,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        html,
        '',
        `--${boundary}--`,
        '',
      ].join('\r\n'));
    } else {
      headers.push('Content-Type: text/plain; charset=utf-8');
      parts.push([
        `From ${config.org.email} ${new Date(message.scheduled_for).toUTCString()}`,
        headers.join('\r\n'),
        '',
        message.body,
        '',
      ].join('\r\n'));
    }
  }
  return parts.join('\r\n');
}

/** RFC 2047 encoding, so a subject with non-ASCII characters survives. */
function encodeHeader(value) {
  const text = String(value || '');
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

async function sendOne(message) {
  const db = getDb();
  const at = dt.nowIso();

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(message.event_id);
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(message.student_id);
  const registration = message.registration_id
    ? db.prepare('SELECT * FROM registrations WHERE id = ?').get(message.registration_id)
    : null;

  const abandon = (reason) => {
    db.prepare("UPDATE messages SET status = 'skipped', skip_reason = ?, updated_at = ? WHERE id = ?")
      .run(reason, at, message.id);
    return { status: 'skipped', reason };
  };

  if (!event) return abandon('The event no longer exists.');
  if (!student) return abandon('The student record no longer exists.');
  if (event.status === 'cancelled' && message.category !== 'cancellation') {
    return abandon('The event was cancelled.');
  }
  if (student.opted_out) return abandon('The student has opted out of Career Services mail.');

  const rule = message.rule_id ? db.prepare('SELECT * FROM reminder_rules WHERE id = ?').get(message.rule_id) : null;
  if (rule && !rule.enabled) return abandon('The reminder was switched off before this was due.');
  if (rule && message.registration_id && !matchesAudience(message.registration_id, rule.audience_rule)) {
    return abandon(`No longer in this reminder's audience (${rule.audience_rule}).`);
  }

  const address = channels.addressFor(message.channel, student);
  if (!address) return abandon(channels.reasonUnreachable(message.channel));

  // Re-render against current event details, so a venue change that landed
  // after materialising is reflected in what actually goes out.
  const template = rule && rule.template_id
    ? db.prepare('SELECT * FROM templates WHERE id = ?').get(rule.template_id)
    : null;
  let subject = message.subject;
  let body = message.body;
  if (template) {
    const rendered = renderMessage({
      event,
      student,
      registration,
      template,
      messageId: message.id,
      at: Date.now(),
    });
    subject = rendered.subject;
    body = rendered.body;
  }

  db.prepare("UPDATE messages SET status = 'sending', attempts = attempts + 1, to_address = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?")
    .run(address, subject, body, at, message.id);

  try {
    const result = await channels.deliver(message.channel, {
      to: address,
      subject,
      text: body,
      html: message.channel === 'email'
        ? channels.email.textToHtml(body, {
          title: subject,
          openPixelUrl: `${config.publicBaseUrl}/t/${message.id}.png`,
        })
        : undefined,
      messageId: message.id,
      event,
      student,
    });
    getDb().prepare(`UPDATE messages SET status = 'sent', sent_at = ?, provider = ?, provider_ref = ?,
                     last_error = NULL, updated_at = ? WHERE id = ?`)
      .run(dt.nowIso(), result.provider, result.providerRef || null, dt.nowIso(), message.id);
    return { status: 'sent', provider: result.provider };
  } catch (error) {
    const attempts = message.attempts + 1;
    const giveUp = attempts >= config.scheduler.maxAttempts;
    getDb().prepare(`UPDATE messages SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(giveUp ? 'failed' : 'scheduled', String(error.message).slice(0, 500), dt.nowIso(), message.id);
    return { status: giveUp ? 'failed' : 'retry', error: error.message };
  }
}

/**
 * One pass of the dispatcher.
 *
 * In draft mode nothing is delivered: due messages simply stay where they are
 * and are reported as waiting for a person. Everything upstream of this point,
 * the schedule, the audience, the rendering, is identical either way, so
 * switching the mode later changes nothing about what students receive.
 */
async function dispatch({ limit = config.scheduler.batchSize } = {}) {
  if (config.isDraftMode) {
    const waiting = dueCount();
    return {
      mode: 'draft',
      considered: waiting,
      waiting_for_handoff: waiting,
      batches: dueBatches({ limit: 200 }).length,
      sent: 0,
      failed: 0,
      skipped: 0,
      retry: 0,
      expired: 0,
    };
  }

  const expired = expireStale();
  const batch = dueMessages(limit);
  const result = { mode: config.deliveryMode, considered: batch.length, sent: 0, failed: 0, skipped: 0, retry: 0, expired };
  for (const message of batch) {
    const outcome = await sendOne(message);
    if (outcome.status === 'sent') result.sent += 1;
    else if (outcome.status === 'failed') result.failed += 1;
    else if (outcome.status === 'skipped') result.skipped += 1;
    else result.retry += 1;
  }
  return result;
}

/** Send one message immediately, whatever its scheduled time. */
async function sendNow(messageId) {
  if (config.isDraftMode) {
    throw new ValidationError('This system is in draft mode, so it does not send. Hand the message over from the To send queue and mark it as sent.');
  }
  const message = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) throw new NotFoundError('Message');
  if (message.status === 'sent') throw new ValidationError('That message has already been sent.');
  getDb().prepare("UPDATE messages SET status = 'scheduled', scheduled_for = ?, updated_at = ? WHERE id = ?")
    .run(dt.nowIso(), dt.nowIso(), messageId);
  return sendOne(getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId));
}

/**
 * Compose and queue a one-off message to part of an event's audience, used for
 * a change of venue, a cancellation, or anything the schedule does not cover.
 */
function queueAdHoc(eventId, { templateId, subject, body, channel = 'email', audienceRule = 'all', category = 'update', label = 'Ad hoc message', sendAt = null, actor = 'staff' }) {
  const event = events.get(eventId);
  const template = templateId ? templates.get(templateId) : null;
  const useSubject = template ? template.subject : subject;
  const useBody = template ? template.body : body;
  if (!String(useBody || '').trim()) throw new ValidationError('The message body is empty.');
  if (channel === 'email' && !String(useSubject || '').trim()) throw new ValidationError('An email needs a subject line.');

  const recipients = recipientsFor(eventId, audienceRule);
  if (recipients.length === 0) {
    throw new ValidationError('No student matches that audience, so there is nothing to send.');
  }

  const when = sendAt ? new Date(sendAt).toISOString() : dt.nowIso();
  const at = dt.nowIso();
  const batchId = newId('bat');
  let queued = 0;
  let skipped = 0;

  transaction(() => {
    for (const recipient of recipients) {
      const messageId = newId('msg');
      const address = channels.addressFor(channel, recipient);
      const context = buildContext({
        event,
        student: recipient,
        registration: recipient,
        messageId,
        at: new Date(when).getTime(),
      });
      getDb().prepare(`
        INSERT INTO messages (id, dedupe_key, event_id, rule_id, registration_id, student_id,
                              category, channel, label, to_address, subject, body,
                              scheduled_for, status, skip_reason, batch_key, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(messageId, `${batchId}:${recipient.id}`, eventId, recipient.id, recipient.student_id,
        category, channel, label, address,
        useSubject ? tpl.tidy(tpl.render(useSubject, context)) : null,
        tpl.tidy(tpl.render(useBody, context)),
        when, address ? 'scheduled' : 'skipped',
        address ? null : channels.reasonUnreachable(channel), batchId, at, at);
      if (address) queued += 1;
      else skipped += 1;
    }
  });

  activity.log({
    eventId,
    actor,
    action: 'outbox.ad_hoc',
    detail: `${label}: ${queued} queued${skipped ? `, ${skipped} unreachable` : ''}`,
  });
  return { queued, skipped, batchId, total: recipients.length };
}

/** Queue a single message to one student, used for registration confirmations. */
function queueTransactional(registrationId, templateKey, { label, category, actor = 'system' } = {}) {
  const db = getDb();
  const registration = db.prepare(`
    SELECT r.*, s.name, s.campus_id, s.email, s.phone, s.program, s.discipline, s.year_of_study, s.batch, s.opted_out
    FROM registrations r JOIN students s ON s.id = r.student_id WHERE r.id = ?
  `).get(registrationId);
  if (!registration) throw new NotFoundError('Registration');
  if (registration.opted_out) return { queued: 0, reason: 'The student has opted out.' };

  const event = events.get(registration.event_id);
  const template = templates.getByKey(templateKey);
  if (!template) return { queued: 0, reason: `No template with the key ${templateKey}.` };

  const address = channels.addressFor(template.channel, registration);
  if (!address) return { queued: 0, reason: channels.reasonUnreachable(template.channel) };

  const messageId = newId('msg');
  const at = dt.nowIso();
  const context = buildContext({ event, student: registration, registration, messageId, at: Date.now() });

  // The response time is part of the key, so a student who declines and later
  // confirms again receives a fresh confirmation, while submitting the same
  // answer twice does not produce a second copy.
  const dedupeKey = `${templateKey}:${registrationId}:${registration.responded_at || 'initial'}`;

  db.prepare(`
    INSERT INTO messages (id, dedupe_key, event_id, rule_id, registration_id, student_id,
                          category, channel, label, to_address, subject, body,
                          scheduled_for, status, batch_key, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)
    ON CONFLICT (dedupe_key) DO NOTHING
  `).run(messageId, dedupeKey, event.id, registration.id, registration.student_id,
    category || template.category, template.channel, label || template.name, address,
    template.subject ? tpl.tidy(tpl.render(template.subject, context)) : null,
    tpl.tidy(tpl.render(template.body, context)), at, dedupeKey, at, at);

  return { queued: 1, messageId };
}

// ---------------------------------------------------------------------------
// Reading the outbox
// ---------------------------------------------------------------------------

const MESSAGE_JOIN = `
  SELECT m.*, s.name AS student_name, s.campus_id, e.name AS event_name, e.event_date, e.timezone
  FROM messages m
  JOIN students s ON s.id = m.student_id
  JOIN events e ON e.id = m.event_id
`;

function decorateMessage(row) {
  if (!row) return row;
  const local = dt.utcToZoned(row.scheduled_for, row.timezone || config.defaultTimezone);
  return {
    ...row,
    scheduled_local: `${dt.formatLongDate(local.date)}, ${dt.formatTime12(local.time)}`,
    scheduled_relative: dt.relativeToNow(row.scheduled_for),
    sent_relative: row.sent_at ? dt.relativeToNow(row.sent_at) : null,
  };
}

function listMessages({ eventId, status, channel, category, studentId, search, limit = 100, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (eventId) { clauses.push('m.event_id = ?'); params.push(eventId); }
  if (status) { clauses.push('m.status = ?'); params.push(status); }
  if (channel) { clauses.push('m.channel = ?'); params.push(channel); }
  if (category) { clauses.push('m.category = ?'); params.push(category); }
  if (studentId) { clauses.push('m.student_id = ?'); params.push(studentId); }
  if (search) {
    clauses.push('(s.name LIKE ? OR s.campus_id LIKE ? OR m.subject LIKE ? OR m.to_address LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`${MESSAGE_JOIN} ${where} ORDER BY m.scheduled_for DESC, m.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Math.min(Number(limit) || 100, 1000), Number(offset) || 0)
    .map(decorateMessage);
  const total = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM messages m JOIN students s ON s.id = m.student_id ${where}`)
    .get(...params).n;
  return { rows, total };
}

function getMessage(id) {
  const row = getDb().prepare(`${MESSAGE_JOIN} WHERE m.id = ?`).get(id);
  if (!row) throw new NotFoundError('Message');
  return decorateMessage(row);
}

function cancelMessage(id) {
  const message = getMessage(id);
  if (message.status !== 'scheduled') throw new ValidationError('Only a message that is still waiting can be withdrawn.');
  getDb().prepare("UPDATE messages SET status = 'cancelled', skip_reason = 'Withdrawn by Career Services', updated_at = ? WHERE id = ?")
    .run(dt.nowIso(), id);
  return getMessage(id);
}

/** Group an event's outbox by rule, which is how the schedule screen reads it. */
function scheduleSummary(eventId) {
  return getDb().prepare(`
    SELECT rule_id, label, category, channel, scheduled_for,
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'sent'      THEN 1 ELSE 0 END) AS sent,
           SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status = 'skipped'   THEN 1 ELSE 0 END) AS skipped,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
           SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
    FROM messages WHERE event_id = ?
    GROUP BY rule_id, label, scheduled_for
    ORDER BY scheduled_for
  `).all(eventId).map(decorateMessage);
}

function recordOpen(messageId) {
  return getDb()
    .prepare("UPDATE messages SET opened_at = COALESCE(opened_at, ?) WHERE id = ? AND status = 'sent'")
    .run(dt.nowIso(), messageId).changes;
}

function recordClick(messageId) {
  return getDb()
    .prepare('UPDATE messages SET clicked_at = COALESCE(clicked_at, ?), opened_at = COALESCE(opened_at, ?) WHERE id = ?')
    .run(dt.nowIso(), dt.nowIso(), messageId).changes;
}

module.exports = {
  materialise, materialiseAll, cancelPending, dispatch, sendNow, sendOne,
  queueAdHoc, queueTransactional, listMessages, getMessage, cancelMessage,
  scheduleSummary, recordOpen, recordClick, recipientsFor, countRecipients,
  matchesAudience, renderMessage, decorateMessage, dueMessages, expireStale,
  dueBatches, dueCount, getBatch, batchMessages, markBatchSent, reopenBatch,
  batchAsCsv, batchRecipients, batchAsEml, batchGeneric, stripPersonalLinks,
  AUDIENCE_SQL,
};
