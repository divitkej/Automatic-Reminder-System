'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers').useTemporaryDatabase();

const { migrate, getDb } = require('../server/db');
const templates = require('../server/services/templates');
const students = require('../server/services/students');
const groups = require('../server/services/groups');
const events = require('../server/services/events');
const audience = require('../server/services/audience');
const rules = require('../server/services/rules');
const registrations = require('../server/services/registrations');
const outbox = require('../server/services/outbox');
const workflow = require('../server/services/workflow');
const feedback = require('../server/services/feedback');
const dt = require('../server/lib/datetime');

migrate();
templates.installSystemTemplates();

const DAY = 24 * 60 * 60 * 1000;

function dateIn(days) {
  return dt.utcToZoned(new Date(Date.now() + days * DAY), 'Asia/Dubai').date;
}

function makeCohort(count, prefix) {
  const made = [];
  for (let i = 0; i < count; i += 1) {
    made.push(students.create({
      campus_id: `${prefix}${String(i).padStart(4, '0')}U`,
      name: `Student ${prefix}${i}`,
      email: `${prefix.toLowerCase()}${i}@dubai.bits-pilani.ac.in`,
      phone: `+9715000000${String(i).padStart(2, '0')}`,
      program: 'B.E.',
      discipline: i % 2 ? 'Computer Science' : 'Mechanical Engineering',
      year_of_study: 4,
      batch: '2023',
    }));
  }
  return made;
}

function buildEvent({ days = 20, type = 'career_readiness_workshop', prefix }) {
  const cohort = makeCohort(6, prefix);
  const group = groups.create({ name: `Group ${prefix}`, kind: 'static' });
  groups.addMembers(group.id, cohort.map((s) => s.id));

  const event = events.create({
    name: `Test event ${prefix}`,
    type,
    event_date: dateIn(days),
    start_time: '17:00',
    end_time: '18:30',
    timezone: 'Asia/Dubai',
    mode: 'online',
    meeting_link: 'https://meet.example.org/test',
    registration_required: true,
  });
  audience.add(event.id, { kind: 'group', refId: group.id });
  rules.applyPreset(event.id);
  audience.syncRegistrations(event.id);
  return { event, cohort, group };
}

// ---------------------------------------------------------------------------

test('an event starts as a draft and sends nothing', () => {
  const { event } = buildEvent({ prefix: 'A2023A' });
  assert.equal(event.status, 'draft');
  const report = outbox.materialise(event.id);
  assert.equal(report.created, 0);
  assert.match(report.reason, /still a draft/);
});

test('readiness blocks a publish that would reach nobody', () => {
  const empty = events.create({
    name: 'No audience',
    type: 'workshop',
    event_date: dateIn(20),
    start_time: '10:00',
    end_time: '11:00',
    timezone: 'Asia/Dubai',
    mode: 'online',
    meeting_link: 'https://meet.example.org/x',
  });
  const check = workflow.readiness(empty.id);
  assert.equal(check.ready, false);
  assert.ok(check.blockers.some((b) => /target students/i.test(b)));
  assert.throws(() => workflow.publish(empty.id), /target students/i);
});

test('publishing schedules one message per rule and per matching student', () => {
  const { event, cohort } = buildEvent({ prefix: 'B2023B' });
  const result = workflow.publish(event.id);
  assert.equal(result.event.status, 'scheduled');

  // Before anyone replies, the rules that can match are the invitation, which
  // targets everyone, and the chase, which targets students yet to register:
  // at this moment that is the same set. The reminders aimed at registered
  // students match nobody and so produce nothing.
  const perRule = getDb()
    .prepare(`SELECT r.audience_rule, COUNT(*) AS n FROM messages m
              JOIN reminder_rules r ON r.id = m.rule_id
              WHERE m.event_id = ? AND m.status = 'scheduled'
              GROUP BY r.audience_rule`)
    .all(event.id);
  const byRule = Object.fromEntries(perRule.map((row) => [row.audience_rule, row.n]));

  assert.equal(byRule.all, cohort.length, 'the invitation goes to every student');
  assert.equal(byRule.unregistered, cohort.length, 'so does the chase, since nobody has replied');
  assert.equal(byRule.registered, undefined, 'nothing is queued for students who have not registered');
  assert.equal(byRule.attended, undefined, 'and nothing for attendance that has not happened');
});

test('materialising twice never duplicates a message', () => {
  const { event } = buildEvent({ prefix: 'C2023C' });
  workflow.publish(event.id);
  const before = getDb().prepare('SELECT COUNT(*) AS n FROM messages WHERE event_id = ?').get(event.id).n;
  outbox.materialise(event.id);
  outbox.materialise(event.id);
  outbox.materialise(event.id);
  const after = getDb().prepare('SELECT COUNT(*) AS n FROM messages WHERE event_id = ?').get(event.id).n;
  assert.equal(after, before);
});

test('registering pulls a student into the reminders aimed at registered students', () => {
  const { event } = buildEvent({ prefix: 'D2023D' });
  workflow.publish(event.id);

  const rows = registrations.listForEvent(event.id);
  const countFor = () => getDb()
    .prepare(`SELECT COUNT(*) AS n FROM messages m JOIN reminder_rules r ON r.id = m.rule_id
              WHERE m.event_id = ? AND r.audience_rule = 'registered'`)
    .get(event.id).n;

  assert.equal(countFor(), 0);
  registrations.respond(rows[0].id, 'confirm');
  outbox.materialise(event.id);
  assert.ok(countFor() > 0, 'the registered-only reminders now have a recipient');
});

test('capacity turns an extra confirmation into a waiting list place, and a withdrawal promotes', () => {
  const { event, cohort } = buildEvent({ prefix: 'E2023E' });
  events.update(event.id, { capacity: 2 });
  workflow.publish(event.id);

  const rows = registrations.listForEvent(event.id);
  assert.equal(registrations.respond(rows[0].id, 'confirm').status, 'registered');
  assert.equal(registrations.respond(rows[1].id, 'confirm').status, 'registered');
  assert.equal(registrations.respond(rows[2].id, 'confirm').status, 'waitlisted');

  const withdrawal = registrations.respond(rows[0].id, 'decline');
  assert.equal(withdrawal.status, 'declined');
  assert.ok(withdrawal.promoted, 'the first waiting list place is promoted');
  assert.equal(registrations.get(rows[2].id).status, 'registered');
  assert.ok(cohort.length > 3);
});

test('moving the event retimes every message still waiting', () => {
  const { event } = buildEvent({ prefix: 'F2023F' });
  workflow.publish(event.id);

  const before = getDb()
    .prepare("SELECT id, scheduled_for FROM messages WHERE event_id = ? AND status = 'scheduled' ORDER BY scheduled_for LIMIT 1")
    .get(event.id);

  events.update(event.id, { event_date: dateIn(25) });
  outbox.materialise(event.id);

  const after = getDb().prepare('SELECT scheduled_for FROM messages WHERE id = ?').get(before.id);
  assert.notEqual(after.scheduled_for, before.scheduled_for);
  assert.ok(new Date(after.scheduled_for) > new Date(before.scheduled_for));
});

test('switching a reminder off withdraws the copies still waiting', () => {
  const { event } = buildEvent({ prefix: 'G2023G' });
  workflow.publish(event.id);

  const invitation = rules.list(event.id).find((r) => r.category === 'invitation' && r.audience_rule === 'all');
  rules.update(event.id, invitation.id, { enabled: false });
  outbox.materialise(event.id);

  const withdrawn = getDb()
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE rule_id = ? AND status = 'cancelled'")
    .get(invitation.id).n;
  assert.ok(withdrawn > 0);
});

test('cancelling an event withdraws pending messages and queues a notice', () => {
  const { event } = buildEvent({ prefix: 'H2023H' });
  workflow.publish(event.id);

  const result = workflow.cancel(event.id, { reason: 'The speaker cannot travel.', notify: true });
  assert.equal(result.event.status, 'cancelled');
  assert.ok(result.notified > 0, 'a cancellation notice is queued');

  const stillWaiting = getDb()
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE event_id = ? AND status = 'scheduled' AND category <> 'cancellation'")
    .get(event.id).n;
  assert.equal(stillWaiting, 0);
});

test('an opted out student is never given a registration or a message', () => {
  const { event, cohort } = buildEvent({ prefix: 'J2023J' });
  students.update(cohort[0].id, { opted_out: 1 });
  audience.syncRegistrations(event.id);
  workflow.publish(event.id);

  const has = getDb()
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE event_id = ? AND student_id = ?')
    .get(event.id, cohort[0].id).n;
  assert.equal(has, 0);
});

test('a student with no phone number is skipped on an SMS reminder, not failed', () => {
  const { event, cohort } = buildEvent({ prefix: 'K2023K' });
  students.update(cohort[0].id, { phone: '' });
  workflow.publish(event.id);

  rules.create(event.id, {
    label: 'Text reminder',
    category: 'reminder',
    channel: 'sms',
    anchor: 'start',
    offset_minutes: -120,
    audience_rule: 'all',
  });
  outbox.materialise(event.id);

  const skipped = getDb()
    .prepare("SELECT skip_reason FROM messages WHERE event_id = ? AND student_id = ? AND channel = 'sms'")
    .get(event.id, cohort[0].id);
  assert.ok(skipped);
  assert.match(skipped.skip_reason, /No phone number/);
});

test('the full lifecycle runs from invitation to feedback', async () => {
  const { event } = buildEvent({ prefix: 'L2023L', days: 20 });
  workflow.publish(event.id);

  // Everyone registers.
  for (const row of registrations.listForEvent(event.id)) {
    registrations.respond(row.id, 'confirm');
  }
  outbox.materialise(event.id);

  // Send everything that is due. The invitation was pulled forward to now.
  const dispatched = await outbox.dispatch({ limit: 100 });
  assert.ok(dispatched.sent > 0, 'the invitation goes out');

  // The event happens: move it into the past and close it.
  events.update(event.id, { event_date: dateIn(-1) });
  workflow.complete(event.id, { markRegisteredPresent: true });

  const counts = registrations.counts(event.id);
  assert.equal(counts.attended, counts.registered);

  // Closing releases the post event and feedback messages.
  outbox.materialise(event.id);
  const postEvent = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM messages m JOIN reminder_rules r ON r.id = m.rule_id
              WHERE m.event_id = ? AND r.category IN ('post_event', 'feedback')`)
    .get(event.id).n;
  assert.ok(postEvent > 0, 'thank you and feedback messages exist');

  // A student answers the feedback form.
  const attendee = registrations.listForEvent(event.id)[0];
  feedback.submit(registrations.get(attendee.id), {
    overall_rating: 5,
    content_rating: 4,
    would_recommend: '1',
    most_useful: 'The CV markup.',
  });
  const summary = feedback.summary(event.id);
  assert.equal(summary.responses, 1);
  assert.equal(summary.averages.overall_rating, 5);
  assert.equal(summary.recommend_rate, 100);

  // The feedback chase now excludes the student who answered.
  const chaseTargets = outbox.recipientsFor(event.id, 'awaiting_feedback');
  assert.ok(!chaseTargets.some((r) => r.id === attendee.id));
});

test('a message whose audience no longer matches is skipped at send time', async () => {
  const { event } = buildEvent({ prefix: 'M2023M' });
  workflow.publish(event.id);

  const rows = registrations.listForEvent(event.id);
  registrations.respond(rows[0].id, 'confirm');
  outbox.materialise(event.id);

  const target = getDb()
    .prepare(`SELECT m.* FROM messages m JOIN reminder_rules r ON r.id = m.rule_id
              WHERE m.event_id = ? AND r.audience_rule = 'registered' AND m.registration_id = ?
              LIMIT 1`)
    .get(event.id, rows[0].id);
  assert.ok(target, 'the registered-only reminder was created');

  // The student changes their mind before the reminder is due.
  registrations.respond(rows[0].id, 'decline');
  const outcome = await outbox.sendOne(target);
  assert.equal(outcome.status, 'skipped');
  assert.match(outcome.reason, /audience/);
});

test('a past event gets no schedule, because there is nothing left to send', () => {
  const cohort = makeCohort(3, 'N2023N');
  const group = groups.create({ name: 'Group N', kind: 'static' });
  groups.addMembers(group.id, cohort.map((s) => s.id));

  const past = events.create({
    name: 'Recorded after the fact',
    type: 'guest_lecture',
    event_date: dateIn(-30),
    start_time: '10:00',
    end_time: '11:00',
    timezone: 'Asia/Dubai',
    mode: 'in_person',
    venue: 'Room 1',
  });
  audience.add(past.id, { kind: 'group', refId: group.id });
  const applied = rules.applyPreset(past.id);
  assert.equal(applied.created, 0);
  assert.ok(applied.dropped.length > 0);
});

test('an online event without a joining link cannot be saved', () => {
  assert.throws(() => events.create({
    name: 'Broken online event',
    type: 'workshop',
    event_date: dateIn(10),
    start_time: '10:00',
    end_time: '11:00',
    timezone: 'Asia/Dubai',
    mode: 'online',
  }), /meeting link/i);
});

test('an in person event without a venue cannot be saved', () => {
  assert.throws(() => events.create({
    name: 'Broken in person event',
    type: 'workshop',
    event_date: dateIn(10),
    start_time: '10:00',
    end_time: '11:00',
    timezone: 'Asia/Dubai',
    mode: 'in_person',
  }), /venue/i);
});
