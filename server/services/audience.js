'use strict';

const { getDb, transaction } = require('../db');
const { newId, newToken } = require('../lib/ids');
const { nowIso } = require('../lib/datetime');
const { NotFoundError, ValidationError } = require('../lib/errors');
const { normaliseFilter, describeFilter } = require('./student-filter');
const students = require('./students');
const groups = require('./groups');
const events = require('./events');
const activity = require('./activity');

/**
 * An event's audience is a set of rows that are combined as a union: whole
 * groups, individual students, and ad hoc filters. Resolving the audience is
 * how "select target students" in the workflow becomes a concrete list, and
 * syncRegistrations turns that list into the per-student rows that carry
 * registration state, attendance and the personal links in every message.
 */

function rows(eventId) {
  return getDb().prepare('SELECT * FROM event_audiences WHERE event_id = ? ORDER BY created_at').all(eventId);
}

function describe(row) {
  if (row.kind === 'group') {
    const group = getDb().prepare('SELECT name, kind FROM student_groups WHERE id = ?').get(row.ref_id);
    return {
      label: group ? group.name : 'Group that no longer exists',
      detail: group ? `${group.kind === 'smart' ? 'Smart' : 'Static'} group` : 'Remove this row',
      valid: Boolean(group),
    };
  }
  if (row.kind === 'student') {
    const student = getDb().prepare('SELECT name, campus_id FROM students WHERE id = ?').get(row.ref_id);
    return {
      label: student ? student.name : 'Student that no longer exists',
      detail: student ? student.campus_id : 'Remove this row',
      valid: Boolean(student),
    };
  }
  const filter = row.filter_json ? JSON.parse(row.filter_json) : {};
  return { label: 'Filter', detail: describeFilter(filter), valid: true };
}

function listDecorated(eventId) {
  return rows(eventId).map((row) => {
    const described = describe(row);
    let count = 0;
    try {
      count = studentsForRow(row).length;
    } catch {
      count = 0;
    }

    return { ...row, ...described, student_count: count };
  });
}

function studentsForRow(row, { includeOptedOut = false } = {}) {
  if (row.kind === 'group') {
    const exists = getDb().prepare('SELECT id FROM student_groups WHERE id = ?').get(row.ref_id);
    return exists ? groups.members(row.ref_id, { includeOptedOut }) : [];
  }
  if (row.kind === 'student') {
    const student = getDb().prepare('SELECT * FROM students WHERE id = ?').get(row.ref_id);
    if (!student) return [];
    if (student.opted_out && !includeOptedOut) return [];
    return [student];
  }
  const filter = row.filter_json ? JSON.parse(row.filter_json) : {};
  return students.matching({ ...filter, includeOptedOut });
}

/**
 * Every distinct student the event targets, in name order. Students who have
 * opted out of Career Services mail are left out, which is what makes the opt
 * out meaningful: they are never given a registration row and so can never be
 * picked up by a reminder.
 */
function resolve(eventId, { includeOptedOut = false } = {}) {
  const seen = new Map();
  for (const row of rows(eventId)) {
    for (const student of studentsForRow(row, { includeOptedOut })) {
      if (!seen.has(student.id)) seen.set(student.id, student);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function add(eventId, { kind, refId = null, filter = null }) {
  events.get(eventId);
  if (!['group', 'student', 'filter'].includes(kind)) {
    throw new ValidationError('An audience row is a group, a student or a filter.');
  }
  if (kind === 'group') {
    if (!getDb().prepare('SELECT id FROM student_groups WHERE id = ?').get(refId)) throw new NotFoundError('Student group');
  }
  if (kind === 'student') {
    if (!getDb().prepare('SELECT id FROM students WHERE id = ?').get(refId)) throw new NotFoundError('Student');
  }
  if (kind === 'filter' && !filter) throw new ValidationError('A filter row needs a filter.');

  const duplicate = rows(eventId).find((row) => row.kind === kind && row.ref_id === refId
    && (kind !== 'filter' || row.filter_json === JSON.stringify(normaliseFilter(filter))));
  if (duplicate) return duplicate;

  const id = newId('aud');
  getDb().prepare(`INSERT INTO event_audiences (id, event_id, kind, ref_id, filter_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, eventId, kind, refId, kind === 'filter' ? JSON.stringify(normaliseFilter(filter)) : null, nowIso());
  activity.log({ eventId, action: 'audience.added', detail: describe({ kind, ref_id: refId, filter_json: kind === 'filter' ? JSON.stringify(filter) : null }).label });
  return getDb().prepare('SELECT * FROM event_audiences WHERE id = ?').get(id);
}

function remove(eventId, audienceId) {
  const row = getDb().prepare('SELECT * FROM event_audiences WHERE id = ? AND event_id = ?').get(audienceId, eventId);
  if (!row) throw new NotFoundError('Audience row');
  getDb().prepare('DELETE FROM event_audiences WHERE id = ?').run(audienceId);
  activity.log({ eventId, action: 'audience.removed', detail: describe(row).label });
}

/**
 * Bring the registration rows in line with the resolved audience.
 *
 * Students added to the audience gain an invitation row with a fresh token.
 * Students no longer targeted are withdrawn only if nothing has happened to
 * them yet: an invitation with no response and no message sent. A student who
 * registered, declined or was already written to keeps their row, because
 * removing it would lose a real answer and break the link in a message that has
 * already left the building.
 */
function syncRegistrations(eventId, { actor = 'system' } = {}) {
  const db = getDb();
  const targeted = resolve(eventId);
  const targetedIds = new Set(targeted.map((s) => s.id));
  const existing = db.prepare('SELECT * FROM registrations WHERE event_id = ?').all(eventId);
  const existingByStudent = new Map(existing.map((r) => [r.student_id, r]));
  const at = nowIso();

  const report = { added: 0, withdrawn: 0, kept: 0, total: targeted.length };

  transaction(() => {
    const insert = db.prepare(`
      INSERT INTO registrations (id, event_id, student_id, status, token, source, created_at, updated_at)
      VALUES (?, ?, ?, 'invited', ?, 'audience', ?, ?)
    `);
    for (const student of targeted) {
      if (existingByStudent.has(student.id)) {
        report.kept += 1;
        continue;
      }
      insert.run(newId('reg'), eventId, student.id, newToken(), at, at);
      report.added += 1;
    }

    for (const registration of existing) {
      if (targetedIds.has(registration.student_id)) continue;
      if (registration.status !== 'invited' || registration.source !== 'audience') continue;
      const touched = db.prepare(
        `SELECT COUNT(*) AS n FROM messages WHERE registration_id = ? AND status IN ('sent', 'sending', 'failed')`,
      ).get(registration.id).n;
      if (touched > 0) continue;
      db.prepare(`UPDATE messages SET status = 'cancelled', skip_reason = 'Student left the audience', updated_at = ?
                  WHERE registration_id = ? AND status = 'scheduled'`).run(at, registration.id);
      db.prepare('DELETE FROM registrations WHERE id = ?').run(registration.id);
      report.withdrawn += 1;
    }
  });

  if (report.added || report.withdrawn) {
    activity.log({
      eventId,
      actor,
      action: 'audience.synced',
      detail: `${report.added} added, ${report.withdrawn} withdrawn, ${report.total} in the audience`,
    });
  }
  return report;
}

/** What the audience would look like without writing anything. */
function preview(eventId) {
  const list = resolve(eventId);
  const withOptOuts = resolve(eventId, { includeOptedOut: true });
  return {
    total: list.length,
    reachable_by_email: list.filter((s) => s.email).length,
    missing_phone: list.filter((s) => !s.phone).length,
    opted_out: withOptOuts.length - list.length,
    students: list,
  };
}

module.exports = { rows, listDecorated, resolve, add, remove, syncRegistrations, preview, describe, studentsForRow };
