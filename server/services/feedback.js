'use strict';

const { getDb } = require('../db');
const { newId } = require('../lib/ids');
const { nowIso } = require('../lib/datetime');
const { ValidationError, NotFoundError } = require('../lib/errors');
const activity = require('./activity');

const RATING_FIELDS = ['overall_rating', 'content_rating', 'speaker_rating', 'organisation_rating'];

function cleanResponse(input) {
  const out = {};
  const problems = [];

  const overall = Number.parseInt(input.overall_rating, 10);
  if (!Number.isFinite(overall) || overall < 1 || overall > 5) {
    problems.push('Please give an overall rating from 1 to 5.');
  } else {
    out.overall_rating = overall;
  }

  for (const field of ['content_rating', 'speaker_rating', 'organisation_rating']) {
    const raw = input[field];
    if (raw === undefined || raw === null || raw === '') {
      out[field] = null;
      continue;
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 1 || value > 5) problems.push(`${field.replace('_', ' ')} must be between 1 and 5.`);
    else out[field] = value;
  }

  if (input.would_recommend === undefined || input.would_recommend === '') {
    out.would_recommend = null;
  } else {
    out.would_recommend = ['1', 'true', 'yes', 'y'].includes(String(input.would_recommend).toLowerCase()) ? 1 : 0;
  }

  for (const field of ['most_useful', 'improvements', 'future_topics']) {
    const value = String(input[field] ?? '').trim();
    if (value.length > 2000) problems.push('Please keep written answers under 2000 characters.');
    out[field] = value || null;
  }

  if (problems.length) throw new ValidationError(problems[0], problems);
  return out;
}

/** Record a response. A second submission from the same student replaces the first. */
function submit(registration, input) {
  const data = cleanResponse(input);
  const at = nowIso();
  const existing = getDb()
    .prepare('SELECT id FROM feedback_responses WHERE event_id = ? AND student_id = ?')
    .get(registration.event_id, registration.student_id);

  if (existing) {
    getDb().prepare(`
      UPDATE feedback_responses SET overall_rating = @overall_rating, content_rating = @content_rating,
        speaker_rating = @speaker_rating, organisation_rating = @organisation_rating,
        would_recommend = @would_recommend, most_useful = @most_useful,
        improvements = @improvements, future_topics = @future_topics, submitted_at = @submitted_at
      WHERE id = @id
    `).run({ ...data, id: existing.id, submitted_at: at });
    activity.log({ eventId: registration.event_id, actor: 'student', action: 'feedback.updated', detail: registration.name });
    return { id: existing.id, updated: true };
  }

  const id = newId('fbk');
  getDb().prepare(`
    INSERT INTO feedback_responses (id, event_id, student_id, registration_id, overall_rating,
      content_rating, speaker_rating, organisation_rating, would_recommend,
      most_useful, improvements, future_topics, submitted_at)
    VALUES (@id, @event_id, @student_id, @registration_id, @overall_rating, @content_rating,
      @speaker_rating, @organisation_rating, @would_recommend, @most_useful, @improvements,
      @future_topics, @submitted_at)
  `).run({
    ...data,
    id,
    event_id: registration.event_id,
    student_id: registration.student_id,
    registration_id: registration.id,
    submitted_at: at,
  });
  activity.log({ eventId: registration.event_id, actor: 'student', action: 'feedback.received', detail: registration.name });
  return { id, updated: false };
}

function forEvent(eventId) {
  return getDb().prepare(`
    SELECT f.*, s.name, s.campus_id, s.program, s.discipline, s.year_of_study
    FROM feedback_responses f
    JOIN students s ON s.id = f.student_id
    WHERE f.event_id = ?
    ORDER BY f.submitted_at DESC
  `).all(eventId);
}

function findForStudentEvent(eventId, studentId) {
  return getDb()
    .prepare('SELECT * FROM feedback_responses WHERE event_id = ? AND student_id = ?')
    .get(eventId, studentId) || null;
}

/** Ratings summary for an event, including the 1 to 5 distribution. */
function summary(eventId) {
  const rows = getDb().prepare('SELECT * FROM feedback_responses WHERE event_id = ?').all(eventId);
  if (rows.length === 0) {
    return { responses: 0, averages: {}, distribution: [0, 0, 0, 0, 0], recommend_rate: null, comments: [] };
  }
  const averages = {};
  for (const field of RATING_FIELDS) {
    const values = rows.map((r) => r[field]).filter((v) => typeof v === 'number');
    averages[field] = values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
  }
  const distribution = [0, 0, 0, 0, 0];
  for (const row of rows) distribution[row.overall_rating - 1] += 1;

  const recommendAnswers = rows.map((r) => r.would_recommend).filter((v) => v !== null);
  const recommendRate = recommendAnswers.length
    ? Math.round((recommendAnswers.filter((v) => v === 1).length / recommendAnswers.length) * 100)
    : null;

  const comments = rows
    .filter((r) => r.most_useful || r.improvements || r.future_topics)
    .map((r) => ({
      most_useful: r.most_useful,
      improvements: r.improvements,
      future_topics: r.future_topics,
      overall_rating: r.overall_rating,
      submitted_at: r.submitted_at,
    }));

  return { responses: rows.length, averages, distribution, recommend_rate: recommendRate, comments };
}

const EXPORT_COLUMNS = [
  { key: 'campus_id', label: 'Campus ID' },
  { key: 'name', label: 'Name' },
  { key: 'program', label: 'Programme' },
  { key: 'discipline', label: 'Discipline' },
  { key: 'year_of_study', label: 'Year' },
  { key: 'overall_rating', label: 'Overall' },
  { key: 'content_rating', label: 'Content' },
  { key: 'speaker_rating', label: 'Speaker' },
  { key: 'organisation_rating', label: 'Organisation' },
  { key: 'would_recommend', label: 'Would recommend', value: (r) => (r.would_recommend === null ? '' : (r.would_recommend ? 'Yes' : 'No')) },
  { key: 'most_useful', label: 'Most useful' },
  { key: 'improvements', label: 'Improvements' },
  { key: 'future_topics', label: 'Future topics' },
  { key: 'submitted_at', label: 'Submitted at' },
];

function exportCsv(eventId) {
  const csv = require('../lib/csv');
  return csv.stringify(EXPORT_COLUMNS, forEvent(eventId));
}

module.exports = { submit, forEvent, findForStudentEvent, summary, exportCsv, cleanResponse, EXPORT_COLUMNS };
