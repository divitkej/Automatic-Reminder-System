'use strict';

const { getDb, transaction } = require('../db');
const { newId, newToken } = require('../lib/ids');
const { nowIso } = require('../lib/datetime');
const { NotFoundError, ValidationError, ConflictError } = require('../lib/errors');
const csv = require('../lib/csv');
const events = require('./events');
const students = require('./students');
const activity = require('./activity');

const JOIN = `
  SELECT r.*, s.name, s.campus_id, s.email, s.phone, s.program, s.discipline,
         s.year_of_study, s.batch, s.opted_out,
         (SELECT COUNT(*) FROM feedback_responses f
           WHERE f.event_id = r.event_id AND f.student_id = r.student_id) AS has_feedback,
         (SELECT COUNT(*) FROM messages m
           WHERE m.registration_id = r.id AND m.status = 'sent') AS messages_sent
  FROM registrations r
  JOIN students s ON s.id = r.student_id
`;

function listForEvent(eventId, { status, attended, search } = {}) {
  const clauses = ['r.event_id = ?'];
  const params = [eventId];
  if (status) { clauses.push('r.status = ?'); params.push(status); }
  if (attended === true) clauses.push('r.attended = 1');
  if (attended === false) clauses.push('r.attended = 0');
  if (search) {
    clauses.push('(s.name LIKE ? OR s.campus_id LIKE ? OR s.email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  return getDb()
    .prepare(`${JOIN} WHERE ${clauses.join(' AND ')} ORDER BY s.name COLLATE NOCASE`)
    .all(...params)
    .map((row) => ({ ...row, attended: Boolean(row.attended), has_feedback: row.has_feedback > 0 }));
}

function listForStudent(studentId, { limit = 50 } = {}) {
  return getDb()
    .prepare(`SELECT r.*, e.name AS event_name, e.type, e.event_date, e.start_time,
                     e.starts_at_utc, e.status AS event_status
              FROM registrations r
              JOIN events e ON e.id = r.event_id
              WHERE r.student_id = ?
              ORDER BY e.starts_at_utc DESC LIMIT ?`)
    .all(studentId, limit);
}

function get(id) {
  const row = getDb().prepare(`${JOIN} WHERE r.id = ?`).get(id);
  if (!row) throw new NotFoundError('Registration');
  return { ...row, attended: Boolean(row.attended), has_feedback: row.has_feedback > 0 };
}

function findByToken(token) {
  const row = getDb().prepare(`${JOIN} WHERE r.token = ?`).get(String(token || ''));
  if (!row) return null;
  return { ...row, attended: Boolean(row.attended), has_feedback: row.has_feedback > 0 };
}

function counts(eventId) {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) AS invited,
      SUM(CASE WHEN status = 'registered'  THEN 1 ELSE 0 END) AS registered,
      SUM(CASE WHEN status = 'declined'    THEN 1 ELSE 0 END) AS declined,
      SUM(CASE WHEN status = 'waitlisted'  THEN 1 ELSE 0 END) AS waitlisted,
      SUM(CASE WHEN status = 'invited'     THEN 1 ELSE 0 END) AS no_response,
      SUM(CASE WHEN attended = 1           THEN 1 ELSE 0 END) AS attended
    FROM registrations WHERE event_id = ?
  `).get(eventId);
  const feedback = getDb()
    .prepare('SELECT COUNT(*) AS n FROM feedback_responses WHERE event_id = ?')
    .get(eventId).n;
  const invited = row.invited || 0;
  const registered = row.registered || 0;
  const attended = row.attended || 0;
  return {
    invited,
    registered,
    declined: row.declined || 0,
    waitlisted: row.waitlisted || 0,
    no_response: row.no_response || 0,
    attended,
    feedback_received: feedback,
    registration_rate: invited ? Math.round((registered / invited) * 100) : 0,
    attendance_rate: registered ? Math.round((attended / registered) * 100) : 0,
    feedback_rate: attended ? Math.round((feedback / attended) * 100) : 0,
  };
}

/** Seats left, or null when the event has no capacity limit. */
function seatsRemaining(event) {
  if (!event.capacity) return null;
  const taken = getDb()
    .prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'registered'")
    .get(event.id).n;
  return Math.max(0, event.capacity - taken);
}

/**
 * Record a student's answer to an invitation.
 *
 * When an event is full, a confirmation becomes a waitlist place rather than an
 * over-booking, and a student who withdraws frees the earliest waitlisted place
 * automatically, which is the part of the job Career Services otherwise does by
 * hand on the morning of the event.
 */
function respond(registrationId, action, { actor = 'student' } = {}) {
  const registration = get(registrationId);
  const event = events.get(registration.event_id);
  if (event.status === 'cancelled') throw new ConflictError('This event has been cancelled.');

  const at = nowIso();
  let status;
  let promoted = null;

  if (action === 'confirm' || action === 'register') {
    if (event.registration_closes_at && new Date(event.registration_closes_at) < new Date()) {
      throw new ConflictError('Registration for this event has closed.');
    }
    if (registration.status === 'registered') return { registration, changed: false, status: 'registered' };
    const remaining = seatsRemaining(event);
    status = remaining === 0 ? 'waitlisted' : 'registered';
  } else if (action === 'decline' || action === 'cancel') {
    if (registration.status === 'declined') return { registration, changed: false, status: 'declined' };
    status = 'declined';
  } else {
    throw new ValidationError('An invitation can be confirmed or declined.');
  }

  transaction(() => {
    getDb().prepare('UPDATE registrations SET status = ?, responded_at = ?, updated_at = ? WHERE id = ?')
      .run(status, at, at, registrationId);

    if (status === 'declined' && registration.status === 'registered' && event.capacity) {
      const next = getDb()
        .prepare("SELECT id FROM registrations WHERE event_id = ? AND status = 'waitlisted' ORDER BY responded_at LIMIT 1")
        .get(event.id);
      if (next) {
        getDb().prepare("UPDATE registrations SET status = 'registered', updated_at = ? WHERE id = ?").run(at, next.id);
        promoted = next.id;
      }
    }
  });

  activity.log({
    eventId: event.id,
    actor,
    action: `registration.${status}`,
    detail: `${registration.name} (${registration.campus_id})`,
  });
  if (promoted) {
    const promotedRow = get(promoted);
    activity.log({
      eventId: event.id,
      actor: 'system',
      action: 'registration.promoted',
      detail: `${promotedRow.name} moved from the waiting list to a confirmed place`,
    });
  }

  return { registration: get(registrationId), changed: true, status, promoted };
}

function setStatus(registrationId, status, { actor = 'staff' } = {}) {
  const registration = get(registrationId);
  const allowed = ['invited', 'registered', 'declined', 'waitlisted', 'cancelled'];
  if (!allowed.includes(status)) throw new ValidationError(`Unknown registration status: ${status}`);
  const at = nowIso();
  getDb().prepare('UPDATE registrations SET status = ?, responded_at = COALESCE(responded_at, ?), updated_at = ? WHERE id = ?')
    .run(status, status === 'invited' ? null : at, at, registrationId);
  activity.log({ eventId: registration.event_id, actor, action: 'registration.status_set', detail: `${registration.name}: ${status}` });
  return get(registrationId);
}

function setAttendance(registrationId, attended, { actor = 'staff' } = {}) {
  const registration = get(registrationId);
  const at = nowIso();
  getDb().prepare('UPDATE registrations SET attended = ?, checked_in_at = ?, updated_at = ? WHERE id = ?')
    .run(attended ? 1 : 0, attended ? at : null, at, registrationId);
  activity.log({
    eventId: registration.event_id,
    actor,
    action: attended ? 'attendance.present' : 'attendance.absent',
    detail: `${registration.name} (${registration.campus_id})`,
  });
  return get(registrationId);
}

function setAttendanceBulk(eventId, registrationIds, attended, { actor = 'staff' } = {}) {
  const at = nowIso();
  let changed = 0;
  transaction(() => {
    const stmt = getDb().prepare('UPDATE registrations SET attended = ?, checked_in_at = ?, updated_at = ? WHERE id = ? AND event_id = ?');
    for (const id of registrationIds) {
      changed += stmt.run(attended ? 1 : 0, attended ? at : null, at, id, eventId).changes;
    }
  });
  activity.log({
    eventId,
    actor,
    action: 'attendance.bulk',
    detail: `${changed} student${changed === 1 ? '' : 's'} marked ${attended ? 'present' : 'absent'}`,
  });
  return changed;
}

/** Mark everyone who registered as present, then correct the exceptions. */
function markAllRegisteredPresent(eventId, { actor = 'staff' } = {}) {
  const at = nowIso();
  const changed = getDb()
    .prepare("UPDATE registrations SET attended = 1, checked_in_at = ?, updated_at = ? WHERE event_id = ? AND status = 'registered' AND attended = 0")
    .run(at, at, eventId).changes;
  activity.log({ eventId, actor, action: 'attendance.bulk', detail: `${changed} registered students marked present` });
  return changed;
}

/** Add a student to an event outside the audience rules, for a walk-in. */
function addStudent(eventId, studentId, { status = 'registered', actor = 'staff' } = {}) {
  events.get(eventId);
  const student = students.get(studentId);
  const existing = getDb().prepare('SELECT * FROM registrations WHERE event_id = ? AND student_id = ?').get(eventId, studentId);
  if (existing) return get(existing.id);
  const id = newId('reg');
  const at = nowIso();
  getDb().prepare(`INSERT INTO registrations (id, event_id, student_id, status, token, source, responded_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)`)
    .run(id, eventId, studentId, status, newToken(), status === 'invited' ? null : at, at, at);
  activity.log({ eventId, actor, action: 'registration.added', detail: `${student.name} added by hand` });
  return get(id);
}

function removeStudent(eventId, registrationId, { actor = 'staff' } = {}) {
  const registration = get(registrationId);
  if (registration.event_id !== eventId) throw new NotFoundError('Registration');
  transaction(() => {
    getDb().prepare(`UPDATE messages SET status = 'cancelled', skip_reason = 'Removed from the event', updated_at = ?
                     WHERE registration_id = ? AND status = 'scheduled'`).run(nowIso(), registrationId);
    getDb().prepare('DELETE FROM registrations WHERE id = ?').run(registrationId);
  });
  activity.log({ eventId, actor, action: 'registration.removed', detail: registration.name });
}

/**
 * Import an attendance sheet. Campus IDs are matched against the event's
 * registration list; a student present on the sheet but not invited is added as
 * a walk-in rather than rejected, because that is what happens at a career fair.
 */
function importAttendanceCsv(eventId, text, { addWalkIns = true, actor = 'staff' } = {}) {
  events.get(eventId);
  const { rows, headers } = csv.parseObjects(text);
  const idHeader = ['campus_id', 'student_id', 'id', 'bits_id', 'roll_no'].find((h) => headers.includes(h));
  if (!idHeader) {
    throw new ValidationError(`The file needs a campus ID column. Columns found: ${headers.filter(Boolean).join(', ')}.`);
  }
  const presentHeader = ['attended', 'present', 'status'].find((h) => headers.includes(h));
  const report = { marked: 0, walk_ins: 0, unknown: [], total: rows.length };
  const at = nowIso();

  transaction(() => {
    for (const row of rows) {
      const campusId = String(row[idHeader] || '').trim();
      if (!campusId) continue;
      const attended = presentHeader
        ? ['1', 'true', 'yes', 'y', 'present', 'attended'].includes(String(row[presentHeader]).toLowerCase())
        : true;
      const student = students.findByCampusId(campusId);
      if (!student) {
        report.unknown.push({ line: row.__line, campus_id: campusId });
        continue;
      }
      let registration = getDb().prepare('SELECT * FROM registrations WHERE event_id = ? AND student_id = ?').get(eventId, student.id);
      if (!registration) {
        if (!addWalkIns) {
          report.unknown.push({ line: row.__line, campus_id: campusId });
          continue;
        }
        const id = newId('reg');
        getDb().prepare(`INSERT INTO registrations (id, event_id, student_id, status, token, source, responded_at, created_at, updated_at)
                         VALUES (?, ?, ?, 'registered', ?, 'walk_in', ?, ?, ?)`)
          .run(id, eventId, student.id, newToken(), at, at, at);
        registration = { id };
        report.walk_ins += 1;
      }
      getDb().prepare('UPDATE registrations SET attended = ?, checked_in_at = ?, updated_at = ? WHERE id = ?')
        .run(attended ? 1 : 0, attended ? at : null, at, registration.id);
      report.marked += 1;
    }
  });

  activity.log({
    eventId,
    actor,
    action: 'attendance.imported',
    detail: `${report.marked} rows applied, ${report.walk_ins} walk-ins added, ${report.unknown.length} unmatched`,
  });
  return report;
}

const EXPORT_COLUMNS = [
  { key: 'campus_id', label: 'Campus ID' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'program', label: 'Programme' },
  { key: 'discipline', label: 'Discipline' },
  { key: 'year_of_study', label: 'Year' },
  { key: 'status', label: 'Registration status' },
  { key: 'attended', label: 'Attended', value: (r) => (r.attended ? 'Yes' : 'No') },
  { key: 'checked_in_at', label: 'Checked in at' },
  { key: 'has_feedback', label: 'Feedback received', value: (r) => (r.has_feedback ? 'Yes' : 'No') },
  { key: 'messages_sent', label: 'Messages sent' },
];

function exportCsv(eventId) {
  return csv.stringify(EXPORT_COLUMNS, listForEvent(eventId));
}

module.exports = {
  listForEvent, listForStudent, get, findByToken, counts, seatsRemaining, respond,
  setStatus, setAttendance, setAttendanceBulk, markAllRegisteredPresent,
  addStudent, removeStudent, importAttendanceCsv, exportCsv, EXPORT_COLUMNS,
};
