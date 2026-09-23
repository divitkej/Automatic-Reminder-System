'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Draft mode has to be chosen before config is first required.
require('./helpers').useTemporaryDatabase();
process.env.DELIVERY_MODE = 'draft';
delete process.env.DRY_RUN;

const config = require('../server/config');
const { migrate, getDb } = require('../server/db');
const templates = require('../server/services/templates');
const students = require('../server/services/students');
const groups = require('../server/services/groups');
const events = require('../server/services/events');
const audience = require('../server/services/audience');
const rules = require('../server/services/rules');
const outbox = require('../server/services/outbox');
const workflow = require('../server/services/workflow');
const dt = require('../server/lib/datetime');

migrate();
templates.installSystemTemplates();

function dateIn(days) {
  return dt.utcToZoned(new Date(Date.now() + days * 86400000), 'Asia/Dubai').date;
}

/** An event whose invitation is already due, so a batch is waiting. */
function dueEvent(prefix) {
  const cohort = [];
  for (let i = 0; i < 4; i += 1) {
    cohort.push(students.create({
      campus_id: `${prefix}${i}U`,
      name: `Student ${prefix}${i}`,
      email: `${prefix.toLowerCase()}${i}@dubai.bits-pilani.ac.in`,
    }));
  }
  const group = groups.create({ name: `Group ${prefix}`, kind: 'static' });
  groups.addMembers(group.id, cohort.map((s) => s.id));

  const event = events.create({
    name: `Draft event ${prefix}`,
    type: 'company_talk',
    company: 'Example Holdings',
    event_date: dateIn(3),
    start_time: '15:00',
    end_time: '16:00',
    timezone: 'Asia/Dubai',
    mode: 'in_person',
    venue: 'Auditorium',
  });
  audience.add(event.id, { kind: 'group', refId: group.id });
  rules.applyPreset(event.id);
  audience.syncRegistrations(event.id);

  // The preset pulls an invitation forward to a couple of minutes from now, so
  // it is not due yet. Retime it to an hour ago, which is the state these tests
  // are about: a batch sitting in the queue waiting for a person.
  const invitation = rules.list(event.id).find((r) => r.category === 'invitation' && r.audience_rule === 'all');
  const minutesBeforeStart = Math.round(
    (new Date(event.starts_at_utc).getTime() - (Date.now() - 60 * 60 * 1000)) / 60000,
  );
  rules.update(event.id, invitation.id, { offset_minutes: -minutesBeforeStart });

  // Leave only that one reminder enabled, so each test deals with one batch.
  for (const rule of rules.list(event.id)) {
    if (rule.id !== invitation.id) rules.update(event.id, rule.id, { enabled: false });
  }

  workflow.publish(event.id);
  outbox.materialise(event.id);
  return { event, cohort, ruleId: invitation.id };
}

test('draft is the delivery mode under test', () => {
  assert.equal(config.deliveryMode, 'draft');
  assert.equal(config.isDraftMode, true);
});

test('dispatch delivers nothing and reports what is waiting', async () => {
  const { event, cohort } = dueEvent('D1A2023');
  const result = await outbox.dispatch();

  assert.equal(result.mode, 'draft');
  assert.equal(result.sent, 0);
  assert.ok(result.waiting_for_handoff >= cohort.length);

  const sent = getDb()
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE event_id = ? AND status = 'sent'")
    .get(event.id).n;
  assert.equal(sent, 0, 'nothing is marked sent by a dispatcher that does not send');
});

test('a message waiting for a person is never expired', () => {
  const { event } = dueEvent('D2A2023');
  // Push it well past the lateness window that applies when the system sends.
  getDb().prepare("UPDATE messages SET scheduled_for = ? WHERE event_id = ?")
    .run(new Date(Date.now() - 30 * 86400000).toISOString(), event.id);

  assert.equal(outbox.expireStale(), 0);
  const skipped = getDb()
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE event_id = ? AND status = 'skipped'")
    .get(event.id).n;
  assert.equal(skipped, 0);
});

test('due messages are grouped into one batch per reminder', () => {
  const { event, cohort } = dueEvent('D3A2023');
  const batches = outbox.dueBatches().filter((b) => b.event_id === event.id);
  assert.ok(batches.length >= 1);
  for (const batch of batches) {
    assert.equal(batch.recipients, cohort.length);
    assert.ok(batch.batch_key);
  }
});

test('marking a batch sent records who said so, and clears it from the queue', () => {
  const { event, cohort } = dueEvent('D4A2023');
  const batch = outbox.dueBatches().find((b) => b.event_id === event.id);

  const result = outbox.markBatchSent(batch.batch_key, { actor: 'A Staffmember' });
  assert.equal(result.changed, cohort.length);

  const row = getDb().prepare('SELECT * FROM messages WHERE batch_key = ? LIMIT 1').get(batch.batch_key);
  assert.equal(row.status, 'sent');
  assert.equal(row.provider, 'handed_off');
  assert.equal(row.handed_off_by, 'A Staffmember');
  assert.ok(row.handed_off_at);

  const stillQueued = outbox.dueBatches().some((b) => b.batch_key === batch.batch_key);
  assert.equal(stillQueued, false);
});

test('a batch marked sent by mistake can be put back', () => {
  const { event, cohort } = dueEvent('D5A2023');
  const batch = outbox.dueBatches().find((b) => b.event_id === event.id);

  outbox.markBatchSent(batch.batch_key, { actor: 'A Staffmember' });
  const reopened = outbox.reopenBatch(batch.batch_key, { actor: 'A Staffmember' });

  assert.equal(reopened.changed, cohort.length);
  const row = getDb().prepare('SELECT * FROM messages WHERE batch_key = ? LIMIT 1').get(batch.batch_key);
  assert.equal(row.status, 'scheduled');
  assert.equal(row.sent_at, null);
  assert.equal(row.handed_off_by, null);
  assert.ok(outbox.dueBatches().some((b) => b.batch_key === batch.batch_key));
});

test('the mail merge file keeps every student their own body and links', () => {
  const { event, cohort } = dueEvent('D6A2023');
  const batch = outbox.dueBatches().find((b) => b.event_id === event.id);
  const text = outbox.batchAsCsv(batch.batch_key);
  const lines = text.split('\r\n');

  assert.match(lines[0], /Email.*Subject.*Body/);
  assert.equal(lines.length - 1, cohort.length);

  // Each row carries a different token, which is what keeps replies tracked.
  const tokens = getDb()
    .prepare('SELECT token FROM registrations WHERE event_id = ?')
    .all(event.id)
    .map((r) => r.token);
  const found = tokens.filter((token) => text.includes(token));
  assert.equal(found.length, tokens.length, 'every student’s own link is in the file');
});

test('the group version carries no student’s private token', () => {
  const { event } = dueEvent('D7A2023');
  const batch = outbox.dueBatches().find((b) => b.event_id === event.id);
  const generic = outbox.batchGeneric(batch.batch_key);

  const tokens = getDb().prepare('SELECT token FROM registrations WHERE event_id = ?').all(event.id);
  for (const { token } of tokens) {
    assert.ok(!generic.body.includes(token), 'a personal token leaked into the group message');
  }
  assert.match(generic.body, /Dear student,/);
  assert.ok(generic.body.includes(`${config.publicBaseUrl}/e/${event.id}`), 'it points at the public event page');
  assert.equal(generic.personalised, false);
});

test('stripPersonalLinks rewrites tokens in a message with no template', () => {
  const { event } = dueEvent('D8A2023');
  const body = `Confirm: ${config.publicBaseUrl}/r/AbCdEfGhIjKlMnOpQrStUv?a=confirm\nFeedback: ${config.publicBaseUrl}/f/AbCdEfGhIjKlMnOpQrStUv`;
  const stripped = outbox.stripPersonalLinks(body, event);

  assert.ok(!stripped.includes('AbCdEfGhIjKlMnOpQrStUv'));
  assert.ok(stripped.includes(`/e/${event.id}`));
});

test('the .eml bundle is one addressed message per student', () => {
  const { event, cohort } = dueEvent('D9A2023');
  const batch = outbox.dueBatches().find((b) => b.event_id === event.id);
  const eml = outbox.batchAsEml(batch.batch_key);

  assert.equal((eml.match(/^Subject:/gm) || []).length, cohort.length);
  assert.equal((eml.match(/^To:/gm) || []).length, cohort.length);
  for (const student of cohort) {
    assert.ok(eml.includes(student.email), `${student.email} is addressed`);
  }
});

test('sendNow refuses, because this system is not the sender', async () => {
  const { event } = dueEvent('DAA2023');
  const message = getDb()
    .prepare("SELECT id FROM messages WHERE event_id = ? AND status = 'scheduled' LIMIT 1")
    .get(event.id);

  await assert.rejects(() => outbox.sendNow(message.id), /draft mode/i);
});

test('messages written before the upgrade are given a batch key and reach the queue', () => {
  const { event, ruleId } = dueEvent('DBA2023');
  const { backfillBatchKeys } = require('../server/db');

  // Put the database back into the shape the previous release left it in.
  getDb().prepare('UPDATE messages SET batch_key = NULL WHERE event_id = ?').run(event.id);
  assert.equal(
    outbox.dueBatches().some((b) => b.event_id === event.id),
    false,
    'without a batch key the messages are due and invisible',
  );

  const changed = backfillBatchKeys(getDb());
  assert.ok(changed > 0);

  const batch = outbox.dueBatches().find((b) => b.event_id === event.id);
  assert.ok(batch, 'the batch is back in the queue after the backfill');
  assert.equal(batch.batch_key.startsWith(ruleId), true, 'grouped the same way a fresh database groups it');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM messages WHERE batch_key IS NULL').get().n, 0);
});
