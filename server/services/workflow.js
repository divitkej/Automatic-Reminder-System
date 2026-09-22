'use strict';

const { getDb } = require('../db');
const { nowIso } = require('../lib/datetime');
const { ValidationError, ConflictError } = require('../lib/errors');
const events = require('./events');
const rules = require('./rules');
const audience = require('./audience');
const outbox = require('./outbox');
const registrations = require('./registrations');
const activity = require('./activity');

/**
 * The steps that move an event through its life: publish, keep in step with
 * edits, tell people when something changes, close it down, cancel it.
 *
 * Everything a member of staff does to an event ends in refresh(), which brings
 * the registration list in line with the audience and then brings the outbox in
 * line with the reminder schedule. That single path is what makes the system
 * automatic: there is no separate "now go and schedule the reminders" step to
 * forget.
 */

/** What stops an event from going live, and what is merely worth a warning. */
function readiness(eventId) {
  const event = events.get(eventId);
  const audienceRows = audience.listDecorated(eventId);
  const ruleRows = rules.list(eventId);
  const preview = audience.preview(eventId);

  const blockers = [];
  const warnings = [];

  const crossProblems = events.crossCheck(event);
  blockers.push(...crossProblems);

  if (audienceRows.length === 0) {
    blockers.push('No target students have been selected yet.');
  } else if (preview.total === 0) {
    blockers.push('The selected groups and filters match no students.');
  }

  const enabledRules = ruleRows.filter((r) => r.enabled);
  if (enabledRules.length === 0) {
    blockers.push('The reminder schedule is empty. Apply the default schedule for this event type, or add a reminder.');
  }

  const missingTemplate = ruleRows.filter((r) => r.enabled && !r.template_id);
  if (missingTemplate.length) {
    blockers.push(`${missingTemplate.length} reminder${missingTemplate.length === 1 ? ' has' : 's have'} no message template.`);
  }

  if (new Date(event.starts_at_utc) < new Date()) {
    warnings.push('The event start time is in the past.');
  }
  const futureRules = enabledRules.filter((r) => !r.is_past);
  if (enabledRules.length && futureRules.length === 0) {
    warnings.push('Every reminder in the schedule is already in the past, so nothing will be sent.');
  }
  if (preview.opted_out > 0) {
    warnings.push(`${preview.opted_out} targeted student${preview.opted_out === 1 ? ' has' : 's have'} opted out of Career Services mail and will not be contacted.`);
  }
  if (preview.reachable_by_email < preview.total) {
    warnings.push(`${preview.total - preview.reachable_by_email} student${preview.total - preview.reachable_by_email === 1 ? ' has' : 's have'} no email address on record.`);
  }
  if (event.capacity && preview.total > event.capacity) {
    warnings.push(`The audience is ${preview.total} students but capacity is ${event.capacity}. Confirmations past that point go to a waiting list.`);
  }
  for (const rule of enabledRules) {
    for (const warning of rules.warningsFor(event, rule)) {
      warnings.push(`${rule.label}: ${warning}`);
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings: [...new Set(warnings)],
    audience_count: preview.total,
    rule_count: enabledRules.length,
  };
}

/**
 * Bring registrations and the outbox in line with the current event.
 * Safe to call as often as you like: nothing is duplicated and nothing already
 * sent is touched.
 */
function refresh(eventId, { actor = 'staff' } = {}) {
  const sync = audience.syncRegistrations(eventId, { actor });
  const materialised = outbox.materialise(eventId, { actor });
  return { sync, materialised };
}

function publish(eventId, { actor = 'staff', force = false } = {}) {
  const event = events.get(eventId);
  if (event.status === 'cancelled') throw new ConflictError('A cancelled event cannot be published.');
  if (event.status === 'scheduled') {
    return { event: events.get(eventId), ...refresh(eventId, { actor }), alreadyLive: true };
  }

  audience.syncRegistrations(eventId, { actor });
  const check = readiness(eventId);
  if (!check.ready && !force) {
    throw new ValidationError(check.blockers[0], check.blockers);
  }

  events.setStatus(eventId, 'scheduled');
  const materialised = outbox.materialise(eventId, { actor });
  activity.log({
    eventId,
    actor,
    action: 'event.published',
    detail: `${check.audience_count} students, ${check.rule_count} reminders, ${materialised.created} messages scheduled`,
  });
  return { event: events.get(eventId), materialised, readiness: check, alreadyLive: false };
}

/** Return a live event to draft, withdrawing everything still waiting. */
function unpublish(eventId, { actor = 'staff' } = {}) {
  const event = events.get(eventId);
  if (event.status !== 'scheduled') throw new ConflictError('Only a scheduled event can be returned to draft.');
  const withdrawn = outbox.cancelPending(eventId, 'The event was returned to draft');
  events.setStatus(eventId, 'draft');
  activity.log({ eventId, actor, action: 'event.unpublished', detail: `${withdrawn} pending message${withdrawn === 1 ? '' : 's'} withdrawn` });
  return { event: events.get(eventId), withdrawn };
}

/**
 * Tell the audience that something changed. Called after an edit that students
 * would act on, such as a new venue, a new time or a new joining link.
 */
function notifyChange(eventId, { audienceRule = 'registered', actor = 'staff', templateKey = 'sys_update_email' } = {}) {
  const templates = require('./templates');
  const template = templates.getByKey(templateKey);
  if (!template) throw new ValidationError(`No template with the key ${templateKey}.`);
  return outbox.queueAdHoc(eventId, {
    templateId: template.id,
    channel: template.channel,
    category: 'update',
    audienceRule,
    label: 'Updated details',
    actor,
  });
}

function cancel(eventId, { reason = '', notify = true, actor = 'staff' } = {}) {
  const event = events.get(eventId);
  if (event.status === 'cancelled') return { event, withdrawn: 0, notified: 0 };

  const templates = require('./templates');
  let notified = 0;

  // Queue the cancellation notice before the status change, so the notice is
  // built from an event that still reads as live, then withdraw the rest.
  if (notify) {
    const template = templates.getByKey('sys_cancellation_email');
    const audienceCount = outbox.countRecipients(eventId, 'all');
    if (template && audienceCount > 0) {
      events.setStatus(eventId, 'cancelled', { reason });
      const result = outbox.queueAdHoc(eventId, {
        templateId: template.id,
        channel: template.channel,
        category: 'cancellation',
        audienceRule: 'all',
        label: 'Event cancelled',
        actor,
      });
      notified = result.queued;
    } else {
      events.setStatus(eventId, 'cancelled', { reason });
    }
  } else {
    events.setStatus(eventId, 'cancelled', { reason });
  }

  const withdrawn = getDb().prepare(`
    UPDATE messages SET status = 'cancelled', skip_reason = 'The event was cancelled', updated_at = ?
    WHERE event_id = ? AND status = 'scheduled' AND category <> 'cancellation'
  `).run(nowIso(), eventId).changes;

  activity.log({
    eventId,
    actor,
    action: 'event.cancelled',
    detail: `${withdrawn} pending message${withdrawn === 1 ? '' : 's'} withdrawn, ${notified} cancellation notice${notified === 1 ? '' : 's'} queued. ${reason || ''}`.trim(),
  });
  return { event: events.get(eventId), withdrawn, notified };
}

/**
 * Close an event. Post-event messages stay scheduled, because the thank you and
 * the feedback form are the point of closing it.
 */
function complete(eventId, { actor = 'staff', markRegisteredPresent = false } = {}) {
  const event = events.get(eventId);
  if (event.status === 'cancelled') throw new ConflictError('A cancelled event cannot be completed.');
  if (markRegisteredPresent) registrations.markAllRegisteredPresent(eventId, { actor });
  events.setStatus(eventId, 'completed');
  const materialised = outbox.materialise(eventId, { actor });
  activity.log({ eventId, actor, action: 'event.completed', detail: `${materialised.created} post event message${materialised.created === 1 ? '' : 's'} scheduled` });
  return { event: events.get(eventId), materialised };
}

/**
 * Close events that finished more than an hour ago and were never closed by
 * hand. Without this the post-event and feedback messages of a schedule would
 * wait on a member of staff remembering to press a button.
 */
function autoCompleteFinishedEvents() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = getDb()
    .prepare("SELECT id, name FROM events WHERE status = 'scheduled' AND ends_at_utc < ?")
    .all(cutoff);
  const closed = [];
  for (const row of rows) {
    complete(row.id, { actor: 'system' });
    closed.push(row.name);
  }
  return closed;
}

module.exports = {
  readiness, refresh, publish, unpublish, notifyChange, cancel, complete,
  autoCompleteFinishedEvents,
};
