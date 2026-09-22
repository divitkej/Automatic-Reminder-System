'use strict';

const { getDb } = require('../db');
const dt = require('../lib/datetime');
const { eventTypeLabel } = require('../lib/constants');

/**
 * Figures for the dashboard and the event reports.
 *
 * Every number here is counted from the database at the moment it is asked for.
 * Nothing is estimated and nothing is cached, so a rate of zero means zero.
 */

function dashboard() {
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const in24h = new Date(now.getTime() + dt.DAY).toISOString();
  const in7d = new Date(now.getTime() + 7 * dt.DAY).toISOString();
  const dayAgo = new Date(now.getTime() - dt.DAY).toISOString();

  const upcoming = db.prepare(`
    SELECT * FROM events WHERE status = 'scheduled' AND ends_at_utc >= ?
    ORDER BY starts_at_utc LIMIT 8
  `).all(nowIso);

  const counts = {
    events_live: db.prepare("SELECT COUNT(*) AS n FROM events WHERE status = 'scheduled'").get().n,
    events_draft: db.prepare("SELECT COUNT(*) AS n FROM events WHERE status = 'draft'").get().n,
    events_next_7_days: db.prepare("SELECT COUNT(*) AS n FROM events WHERE status = 'scheduled' AND starts_at_utc BETWEEN ? AND ?").get(nowIso, in7d).n,
    students_active: db.prepare("SELECT COUNT(*) AS n FROM students WHERE status = 'active'").get().n,
    students_opted_out: db.prepare('SELECT COUNT(*) AS n FROM students WHERE opted_out = 1').get().n,
    groups: db.prepare('SELECT COUNT(*) AS n FROM student_groups').get().n,
  };

  const messages = {
    sent_24h: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'sent' AND sent_at >= ?").get(dayAgo).n,
    due_24h: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'scheduled' AND scheduled_for BETWEEN ? AND ?").get(nowIso, in24h).n,
    pending_total: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'scheduled'").get().n,
    failed_7d: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'failed' AND updated_at >= ?").get(new Date(now.getTime() - 7 * dt.DAY).toISOString()).n,
    skipped_7d: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'skipped' AND updated_at >= ?").get(new Date(now.getTime() - 7 * dt.DAY).toISOString()).n,
  };

  const nextOut = db.prepare(`
    SELECT m.scheduled_for, m.label, m.channel, e.name AS event_name, COUNT(*) AS recipients
    FROM messages m JOIN events e ON e.id = m.event_id
    WHERE m.status = 'scheduled' AND m.scheduled_for >= ?
    GROUP BY m.rule_id, m.scheduled_for, m.label
    ORDER BY m.scheduled_for LIMIT 8
  `).all(nowIso);

  const attention = [];
  if (messages.failed_7d > 0) {
    attention.push({ level: 'error', text: `${messages.failed_7d} message${messages.failed_7d === 1 ? '' : 's'} failed to send in the last seven days.`, link: '/messages?status=failed' });
  }
  const unpublished = db.prepare(`
    SELECT id, name, starts_at_utc FROM events
    WHERE status = 'draft' AND starts_at_utc BETWEEN ? AND ?
    ORDER BY starts_at_utc
  `).all(nowIso, in7d);
  for (const row of unpublished) {
    attention.push({
      level: 'warning',
      text: `"${row.name}" starts ${dt.relativeToNow(row.starts_at_utc)} and is still a draft, so no reminders will go out.`,
      link: `/events/${row.id}`,
    });
  }
  const awaitingAttendance = db.prepare(`
    SELECT e.id, e.name FROM events e
    WHERE e.status = 'completed' AND e.ends_at_utc >= ?
      AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.event_id = e.id AND r.attended = 1)
      AND EXISTS (SELECT 1 FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered')
    ORDER BY e.ends_at_utc DESC LIMIT 5
  `).all(new Date(now.getTime() - 14 * dt.DAY).toISOString());
  for (const row of awaitingAttendance) {
    attention.push({
      level: 'warning',
      text: `Attendance has not been marked for "${row.name}", so its thank you and feedback messages have nobody to go to.`,
      link: `/events/${row.id}/attendance`,
    });
  }

  return {
    counts,
    messages,
    upcoming: upcoming.map((e) => ({
      ...e,
      type_label: eventTypeLabel(e.type),
      date_long: dt.formatLongDate(e.event_date),
      time_range: dt.formatTimeRange(e.start_time, e.end_time),
      starts_in: dt.relativeToNow(e.starts_at_utc),
      registered: db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'registered'").get(e.id).n,
      invited: db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?').get(e.id).n,
    })),
    next_messages: nextOut.map((row) => ({
      ...row,
      scheduled_relative: dt.relativeToNow(row.scheduled_for),
    })),
    attention,
  };
}

/** Delivery and engagement figures for one event. */
function eventReport(eventId) {
  const db = getDb();
  const registrations = require('./registrations');
  const feedback = require('./feedback');

  const delivery = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent'      THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped'   THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
    FROM messages WHERE event_id = ?
  `).get(eventId);

  const byChannel = db.prepare(`
    SELECT channel,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM messages WHERE event_id = ? GROUP BY channel
  `).all(eventId);

  const sent = delivery.sent || 0;
  return {
    registrations: registrations.counts(eventId),
    delivery: {
      ...delivery,
      open_rate: sent ? Math.round(((delivery.opened || 0) / sent) * 100) : 0,
      click_rate: sent ? Math.round(((delivery.clicked || 0) / sent) * 100) : 0,
    },
    by_channel: byChannel,
    feedback: feedback.summary(eventId),
  };
}

/** Totals across a date range, for reporting to the department. */
function overview({ from, to } = {}) {
  const db = getDb();
  const fromIso = from ? new Date(from).toISOString() : new Date(Date.now() - 180 * dt.DAY).toISOString();
  const toIso = to ? new Date(to).toISOString() : new Date().toISOString();

  const byType = db.prepare(`
    SELECT e.type,
      COUNT(DISTINCT e.id) AS events,
      COUNT(r.id) AS invited,
      SUM(CASE WHEN r.status = 'registered' THEN 1 ELSE 0 END) AS registered,
      SUM(CASE WHEN r.attended = 1 THEN 1 ELSE 0 END) AS attended
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id
    WHERE e.starts_at_utc BETWEEN ? AND ? AND e.status <> 'cancelled'
    GROUP BY e.type ORDER BY events DESC
  `).all(fromIso, toIso).map((row) => ({
    ...row,
    type_label: eventTypeLabel(row.type),
    registration_rate: row.invited ? Math.round((row.registered / row.invited) * 100) : 0,
    attendance_rate: row.registered ? Math.round((row.attended / row.registered) * 100) : 0,
  }));

  const totals = db.prepare(`
    SELECT COUNT(*) AS events FROM events
    WHERE starts_at_utc BETWEEN ? AND ? AND status <> 'cancelled'
  `).get(fromIso, toIso);

  const messagesSent = db.prepare(`
    SELECT COUNT(*) AS n FROM messages WHERE status = 'sent' AND sent_at BETWEEN ? AND ?
  `).get(fromIso, toIso).n;

  const feedbackAverage = db.prepare(`
    SELECT AVG(f.overall_rating) AS avg, COUNT(*) AS n
    FROM feedback_responses f JOIN events e ON e.id = f.event_id
    WHERE e.starts_at_utc BETWEEN ? AND ?
  `).get(fromIso, toIso);

  return {
    from: fromIso,
    to: toIso,
    events: totals.events,
    messages_sent: messagesSent,
    feedback_responses: feedbackAverage.n || 0,
    feedback_average: feedbackAverage.avg ? Number(feedbackAverage.avg.toFixed(2)) : null,
    by_type: byType,
  };
}

module.exports = { dashboard, eventReport, overview };
