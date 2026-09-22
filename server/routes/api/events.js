'use strict';

const express = require('express');
const { asyncHandler, ValidationError } = require('../../lib/errors');
const events = require('../../services/events');
const audience = require('../../services/audience');
const rules = require('../../services/rules');
const registrations = require('../../services/registrations');
const outbox = require('../../services/outbox');
const workflow = require('../../services/workflow');
const feedback = require('../../services/feedback');
const stats = require('../../services/stats');
const activity = require('../../services/activity');
const templates = require('../../services/templates');
const { readBody } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { status, type, search, when, limit, offset } = req.query;
  res.json(events.list({ status, type, search, when, limit, offset }));
}));

router.post('/', asyncHandler(async (req, res) => {
  const event = events.create(req.body);

  if (req.body.audience) {
    for (const row of [].concat(req.body.audience)) {
      audience.add(event.id, { kind: row.kind, refId: row.ref_id || row.refId, filter: row.filter });
    }
  }
  if (req.body.apply_preset !== false) {
    rules.applyPreset(event.id);
  }
  audience.syncRegistrations(event.id, { actor: req.actor });

  res.status(201).json(full(event.id));
}));

/** Everything the event screen needs, in one response. */
function full(eventId) {
  const event = events.decorate(events.get(eventId));
  return {
    event,
    audience: audience.listDecorated(eventId),
    audience_preview: (() => {
      const preview = audience.preview(eventId);
      return { ...preview, students: preview.students.slice(0, 25) };
    })(),
    rules: rules.list(eventId),
    counts: registrations.counts(eventId),
    schedule: outbox.scheduleSummary(eventId),
    readiness: workflow.readiness(eventId),
    seats_remaining: registrations.seatsRemaining(event),
    activity: activity.forEvent(eventId, 25),
  };
}

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(full(req.params.id));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const result = events.update(req.params.id, req.body);
  if (req.body.type !== undefined) rules.realignTemplates(req.params.id);
  if (result.event.status !== 'draft') {
    outbox.materialise(req.params.id, { actor: req.actor });
  }
  res.json({ ...full(req.params.id), changed: result.changed, notifiable_change: result.notifiableChange });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  events.remove(req.params.id);
  res.json({ deleted: true });
}));

router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const copy = events.duplicate(req.params.id, req.body || {});
  audience.syncRegistrations(copy.id, { actor: req.actor });
  res.status(201).json(full(copy.id));
}));

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------
router.get('/:id/readiness', asyncHandler(async (req, res) => {
  res.json(workflow.readiness(req.params.id));
}));

router.post('/:id/publish', asyncHandler(async (req, res) => {
  const result = workflow.publish(req.params.id, { actor: req.actor, force: req.body?.force === true });
  res.json({ ...full(req.params.id), result });
}));

router.post('/:id/unpublish', asyncHandler(async (req, res) => {
  const result = workflow.unpublish(req.params.id, { actor: req.actor });
  res.json({ ...full(req.params.id), result });
}));

router.post('/:id/refresh', asyncHandler(async (req, res) => {
  const result = workflow.refresh(req.params.id, { actor: req.actor });
  res.json({ ...full(req.params.id), result });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const result = workflow.cancel(req.params.id, {
    reason: req.body?.reason || '',
    notify: req.body?.notify !== false,
    actor: req.actor,
  });
  res.json({ ...full(req.params.id), result });
}));

router.post('/:id/complete', asyncHandler(async (req, res) => {
  const result = workflow.complete(req.params.id, {
    actor: req.actor,
    markRegisteredPresent: req.body?.mark_registered_present === true,
  });
  res.json({ ...full(req.params.id), result });
}));

router.post('/:id/notify-change', asyncHandler(async (req, res) => {
  const result = workflow.notifyChange(req.params.id, {
    audienceRule: req.body?.audience_rule || 'registered',
    actor: req.actor,
  });
  res.json(result);
}));

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------
router.get('/:id/audience', asyncHandler(async (req, res) => {
  res.json({
    rows: audience.listDecorated(req.params.id),
    preview: audience.preview(req.params.id),
  });
}));

router.post('/:id/audience', asyncHandler(async (req, res) => {
  const row = audience.add(req.params.id, {
    kind: req.body.kind,
    refId: req.body.ref_id || req.body.refId || null,
    filter: req.body.filter || null,
  });
  const sync = audience.syncRegistrations(req.params.id, { actor: req.actor });
  if (events.get(req.params.id).status === 'scheduled') {
    outbox.materialise(req.params.id, { actor: req.actor });
  }
  res.status(201).json({ row, sync, audience: audience.listDecorated(req.params.id), counts: registrations.counts(req.params.id) });
}));

router.delete('/:id/audience/:audienceId', asyncHandler(async (req, res) => {
  audience.remove(req.params.id, req.params.audienceId);
  const sync = audience.syncRegistrations(req.params.id, { actor: req.actor });
  res.json({ sync, audience: audience.listDecorated(req.params.id), counts: registrations.counts(req.params.id) });
}));

// ---------------------------------------------------------------------------
// Reminder schedule
// ---------------------------------------------------------------------------
router.get('/:id/rules', asyncHandler(async (req, res) => {
  const event = events.get(req.params.id);
  const list = rules.list(req.params.id);
  res.json({
    rules: list.map((rule) => ({
      ...rule,
      recipients: outbox.countRecipients(req.params.id, rule.audience_rule),
      warnings: rules.warningsFor(event, rule),
    })),
  });
}));

router.post('/:id/rules', asyncHandler(async (req, res) => {
  const rule = rules.create(req.params.id, req.body);
  outbox.materialise(req.params.id, { actor: req.actor });
  res.status(201).json(rule);
}));

router.post('/:id/rules/apply-preset', asyncHandler(async (req, res) => {
  const result = rules.applyPreset(req.params.id, { replace: req.body?.replace === true });
  outbox.materialise(req.params.id, { actor: req.actor });
  res.json(result);
}));

router.patch('/:id/rules/:ruleId', asyncHandler(async (req, res) => {
  const rule = rules.update(req.params.id, req.params.ruleId, req.body);
  outbox.materialise(req.params.id, { actor: req.actor });
  res.json(rule);
}));

router.delete('/:id/rules/:ruleId', asyncHandler(async (req, res) => {
  rules.remove(req.params.id, req.params.ruleId);
  res.json({ deleted: true, rules: rules.list(req.params.id) });
}));

/** Render a rule's message as one named student would receive it. */
router.get('/:id/rules/:ruleId/preview', asyncHandler(async (req, res) => {
  const event = events.get(req.params.id);
  const rule = rules.get(req.params.id, req.params.ruleId);
  const template = rule.template_id ? templates.get(rule.template_id) : null;
  if (!template) throw new ValidationError('This reminder has no message template to preview.');

  const recipients = outbox.recipientsFor(req.params.id, rule.audience_rule);
  const chosen = req.query.registration_id
    ? recipients.find((r) => r.id === req.query.registration_id) || recipients[0]
    : recipients[0];

  if (!chosen) {
    res.json({
      recipients: 0,
      note: 'No student currently matches this reminder’s audience, so there is nobody to preview it for.',
      template: { id: template.id, name: template.name, key: template.key },
    });
    return;
  }

  const rendered = outbox.renderMessage({
    event,
    student: chosen,
    registration: chosen,
    template,
    messageId: null,
    at: rules.sendTimeFor(event, rule).getTime(),
  });
  res.json({
    recipients: recipients.length,
    sample_student: { name: chosen.name, campus_id: chosen.campus_id, email: chosen.email, phone: chosen.phone },
    channel: rule.channel,
    template: { id: template.id, name: template.name, key: template.key },
    ...rendered,
  });
}));

// ---------------------------------------------------------------------------
// Registrations and attendance
// ---------------------------------------------------------------------------
router.get('/:id/registrations', asyncHandler(async (req, res) => {
  const attended = req.query.attended === undefined ? undefined : req.query.attended === 'true';
  res.json({
    rows: registrations.listForEvent(req.params.id, { status: req.query.status, attended, search: req.query.search }),
    counts: registrations.counts(req.params.id),
  });
}));

router.post('/:id/registrations', asyncHandler(async (req, res) => {
  const row = registrations.addStudent(req.params.id, req.body.student_id, {
    status: req.body.status || 'registered',
    actor: req.actor,
  });
  if (events.get(req.params.id).status !== 'draft') outbox.materialise(req.params.id, { actor: req.actor });
  res.status(201).json(row);
}));

router.patch('/:id/registrations/:registrationId', asyncHandler(async (req, res) => {
  let row;
  if (req.body.attended !== undefined) {
    row = registrations.setAttendance(req.params.registrationId, Boolean(req.body.attended), { actor: req.actor });
  }
  if (req.body.status !== undefined) {
    row = registrations.setStatus(req.params.registrationId, req.body.status, { actor: req.actor });
  }
  outbox.materialise(req.params.id, { actor: req.actor });
  res.json({ row: row || registrations.get(req.params.registrationId), counts: registrations.counts(req.params.id) });
}));

router.delete('/:id/registrations/:registrationId', asyncHandler(async (req, res) => {
  registrations.removeStudent(req.params.id, req.params.registrationId, { actor: req.actor });
  res.json({ deleted: true, counts: registrations.counts(req.params.id) });
}));

router.post('/:id/attendance/bulk', asyncHandler(async (req, res) => {
  const changed = registrations.setAttendanceBulk(
    req.params.id,
    [].concat(req.body.registration_ids || []),
    Boolean(req.body.attended),
    { actor: req.actor },
  );
  outbox.materialise(req.params.id, { actor: req.actor });
  res.json({ changed, counts: registrations.counts(req.params.id) });
}));

router.post('/:id/attendance/all-registered', asyncHandler(async (req, res) => {
  const changed = registrations.markAllRegisteredPresent(req.params.id, { actor: req.actor });
  outbox.materialise(req.params.id, { actor: req.actor });
  res.json({ changed, counts: registrations.counts(req.params.id) });
}));

router.post('/:id/attendance/import', express.text({ type: '*/*', limit: '5mb' }), asyncHandler(async (req, res) => {
  const text = readBody(req);
  const report = registrations.importAttendanceCsv(req.params.id, text, { actor: req.actor });
  outbox.materialise(req.params.id, { actor: req.actor });
  res.json({ ...report, counts: registrations.counts(req.params.id) });
}));

router.get('/:id/registrations.csv', asyncHandler(async (req, res) => {
  const event = events.get(req.params.id);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${slug(event.name)}-registrations.csv"`);
  res.send(registrations.exportCsv(req.params.id));
}));

// ---------------------------------------------------------------------------
// Messages, feedback, reporting
// ---------------------------------------------------------------------------
router.get('/:id/messages', asyncHandler(async (req, res) => {
  res.json(outbox.listMessages({
    eventId: req.params.id,
    status: req.query.status,
    channel: req.query.channel,
    category: req.query.category,
    search: req.query.search,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
}));

router.post('/:id/messages/ad-hoc', asyncHandler(async (req, res) => {
  const result = outbox.queueAdHoc(req.params.id, {
    templateId: req.body.template_id || null,
    subject: req.body.subject,
    body: req.body.body,
    channel: req.body.channel || 'email',
    audienceRule: req.body.audience_rule || 'all',
    category: req.body.category || 'update',
    label: req.body.label || 'Message from Career Services',
    sendAt: req.body.send_at || null,
    actor: req.actor,
  });
  res.status(201).json(result);
}));

router.get('/:id/feedback', asyncHandler(async (req, res) => {
  res.json({ summary: feedback.summary(req.params.id), responses: feedback.forEvent(req.params.id) });
}));

router.get('/:id/feedback.csv', asyncHandler(async (req, res) => {
  const event = events.get(req.params.id);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${slug(event.name)}-feedback.csv"`);
  res.send(feedback.exportCsv(req.params.id));
}));

router.get('/:id/report', asyncHandler(async (req, res) => {
  res.json({ event: events.decorate(events.get(req.params.id)), ...stats.eventReport(req.params.id) });
}));

router.get('/:id/activity', asyncHandler(async (req, res) => {
  res.json({ rows: activity.forEvent(req.params.id, Number(req.query.limit) || 100) });
}));

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
}

module.exports = router;
