'use strict';

const { getDb, transaction } = require('../db');
const { newId } = require('../lib/ids');
const dt = require('../lib/datetime');
const { NotFoundError, ValidationError, ConflictError } = require('../lib/errors');
const { EVENT_TYPE_VALUES, eventTypeLabel } = require('../lib/constants');
const config = require('../config');
const activity = require('./activity');

const MODES = ['in_person', 'online', 'hybrid'];
const FEEDBACK_MODES = ['builtin', 'external', 'none'];
const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Validate and normalise an event form submission.
 *
 * The checks here are the ones that stop a bad event reaching students: a
 * mistyped date, an online session with no joining link, an in-person session
 * with no venue, a registration deadline after the event has started.
 */
function cleanEvent(input, { partial = false } = {}) {
  const out = {};
  const problems = [];
  const has = (key) => input[key] !== undefined;
  const str = (key) => String(input[key] ?? '').trim();

  if (has('name') || !partial) {
    const name = str('name').replace(/\s+/g, ' ');
    if (!name) problems.push('An event name is required.');
    else if (name.length > 200) problems.push('The event name is too long. Keep it under 200 characters.');
    out.name = name;
  }

  if (has('type') || !partial) {
    const type = str('type');
    if (!EVENT_TYPE_VALUES.includes(type)) problems.push('Choose an event type from the list.');
    out.type = type;
  }

  if (has('company')) out.company = str('company') || null;
  if (has('speaker')) out.speaker = str('speaker') || null;
  if (has('speaker_title')) out.speaker_title = str('speaker_title') || null;
  if (has('description')) out.description = String(input.description ?? '').trim() || null;
  if (has('dress_code')) out.dress_code = str('dress_code') || null;
  if (has('preparation_notes')) out.preparation_notes = String(input.preparation_notes ?? '').trim() || null;
  if (has('organiser_name')) out.organiser_name = str('organiser_name') || null;
  if (has('organiser_email')) out.organiser_email = str('organiser_email').toLowerCase() || null;

  if (has('event_date') || !partial) {
    const date = str('event_date');
    if (!dt.DATE_RE.test(date)) problems.push('The event date must be a real date.');
    else if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) problems.push('The event date is not a valid calendar date.');
    out.event_date = date;
  }

  for (const key of ['start_time', 'end_time']) {
    if (has(key) || !partial) {
      const value = str(key);
      if (!dt.TIME_RE.test(value)) problems.push(`The ${key === 'start_time' ? 'start' : 'end'} time must be in 24 hour HH:MM form.`);
      out[key] = value;
    }
  }

  if (has('timezone') || !partial) {
    const timezone = str('timezone') || config.defaultTimezone;
    if (!dt.isValidTimeZone(timezone)) problems.push(`"${timezone}" is not a timezone this system recognises.`);
    out.timezone = timezone;
  }

  if (has('mode') || !partial) {
    const mode = str('mode') || 'in_person';
    if (!MODES.includes(mode)) problems.push('Choose a mode from the list.');
    out.mode = mode;
  }

  if (has('venue')) out.venue = str('venue') || null;
  if (has('meeting_link')) {
    const link = str('meeting_link');
    if (link && !URL_RE.test(link)) problems.push('The meeting link must start with http:// or https://.');
    out.meeting_link = link || null;
  }

  if (has('registration_required')) {
    out.registration_required = ['1', 'true', 'yes', 'on'].includes(String(input.registration_required).toLowerCase()) ? 1 : 0;
  }

  if (has('capacity')) {
    const raw = str('capacity');
    if (raw === '') out.capacity = null;
    else {
      const capacity = Number.parseInt(raw, 10);
      if (!Number.isFinite(capacity) || capacity < 1) problems.push('Capacity must be a whole number of seats, or left blank.');
      else out.capacity = capacity;
    }
  }

  if (has('feedback_mode')) {
    const feedbackMode = str('feedback_mode') || 'builtin';
    if (!FEEDBACK_MODES.includes(feedbackMode)) problems.push('Choose how feedback is collected.');
    out.feedback_mode = feedbackMode;
  }
  if (has('feedback_form_url')) {
    const url = str('feedback_form_url');
    if (url && !URL_RE.test(url)) problems.push('The feedback form link must start with http:// or https://.');
    out.feedback_form_url = url || null;
  }

  if (problems.length) throw new ValidationError(problems[0], problems);
  return { data: out, raw: input };
}

/** Checks that need the whole event, not one field at a time. */
function crossCheck(event) {
  const problems = [];
  if (event.mode === 'online' && !event.meeting_link) {
    problems.push('An online event needs a meeting link. Students have no other way to join.');
  }
  if (event.mode === 'in_person' && !event.venue) {
    problems.push('An in person event needs a venue.');
  }
  if (event.mode === 'hybrid' && (!event.venue || !event.meeting_link)) {
    problems.push('A hybrid event needs both a venue and a meeting link.');
  }
  if (event.feedback_mode === 'external' && !event.feedback_form_url) {
    problems.push('Choose the built in feedback form, or give the link to the external form.');
  }
  if (event.registration_closes_at && event.starts_at_utc
      && new Date(event.registration_closes_at) > new Date(event.starts_at_utc)) {
    problems.push('Registration cannot close after the event has started.');
  }
  return problems;
}

function withTiming(data, existing = null) {
  const merged = { ...(existing || {}), ...data };
  const window = dt.computeEventWindow({
    event_date: merged.event_date,
    start_time: merged.start_time,
    end_time: merged.end_time,
    timezone: merged.timezone || config.defaultTimezone,
  });
  return { ...data, starts_at_utc: window.startsAtUtc, ends_at_utc: window.endsAtUtc };
}

function parseRegistrationClose(value, timezone) {
  if (value === undefined) return undefined;
  const raw = String(value || '').trim();
  if (!raw) return null;
  // Accept either a full ISO instant or a local "YYYY-MM-DDTHH:MM" from the form.
  const localMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/);
  if (localMatch) return dt.zonedToUtc(localMatch[1], localMatch[2], timezone).toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError('The registration deadline is not a valid date and time.');
  return parsed.toISOString();
}

function get(id) {
  const row = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Event');
  return row;
}

function decorate(event) {
  const now = Date.now();
  const starts = new Date(event.starts_at_utc).getTime();
  const ends = new Date(event.ends_at_utc).getTime();
  return {
    ...event,
    type_label: eventTypeLabel(event.type),
    registration_required: Boolean(event.registration_required),
    date_long: dt.formatLongDate(event.event_date),
    date_full: dt.formatFullDate(event.event_date),
    time_range: dt.formatTimeRange(event.start_time, event.end_time),
    timezone_label: dt.timezoneLabel(event.timezone, new Date(event.starts_at_utc)),
    starts_in: dt.relativeToNow(event.starts_at_utc, now),
    is_past: ends < now,
    is_live: starts <= now && now <= ends,
  };
}

function list({ status, type, search, when = 'all', limit = 200, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (type) { clauses.push('type = ?'); params.push(type); }
  if (search) {
    clauses.push('(name LIKE ? OR company LIKE ? OR speaker LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const now = new Date().toISOString();
  if (when === 'upcoming') { clauses.push('ends_at_utc >= ?'); params.push(now); }
  if (when === 'past') { clauses.push('ends_at_utc < ?'); params.push(now); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const direction = when === 'past' ? 'DESC' : 'ASC';
  const rows = getDb()
    .prepare(`SELECT * FROM events ${where} ORDER BY starts_at_utc ${direction} LIMIT ? OFFSET ?`)
    .all(...params, Math.min(Number(limit) || 200, 1000), Number(offset) || 0);
  const total = getDb().prepare(`SELECT COUNT(*) AS n FROM events ${where}`).get(...params).n;
  return { rows: rows.map(decorate), total };
}

function create(input) {
  const { data } = cleanEvent(input);
  const timed = withTiming(data);
  const registrationClosesAt = parseRegistrationClose(input.registration_closes_at, timed.timezone);

  const candidate = {
    registration_required: 1,
    feedback_mode: 'builtin',
    ...timed,
    registration_closes_at: registrationClosesAt ?? null,
  };
  const problems = crossCheck(candidate);
  if (problems.length) throw new ValidationError(problems[0], problems);

  const id = newId('evt');
  const at = dt.nowIso();
  getDb().prepare(`
    INSERT INTO events (id, name, type, company, speaker, speaker_title, event_date,
                        start_time, end_time, timezone, mode, venue, meeting_link,
                        description, dress_code, preparation_notes, registration_required,
                        registration_closes_at, capacity, organiser_name, organiser_email,
                        feedback_mode, feedback_form_url, status, starts_at_utc, ends_at_utc,
                        created_at, updated_at)
    VALUES (@id, @name, @type, @company, @speaker, @speaker_title, @event_date,
            @start_time, @end_time, @timezone, @mode, @venue, @meeting_link,
            @description, @dress_code, @preparation_notes, @registration_required,
            @registration_closes_at, @capacity, @organiser_name, @organiser_email,
            @feedback_mode, @feedback_form_url, 'draft', @starts_at_utc, @ends_at_utc,
            @created_at, @updated_at)
  `).run({
    id,
    name: candidate.name,
    type: candidate.type,
    company: candidate.company ?? null,
    speaker: candidate.speaker ?? null,
    speaker_title: candidate.speaker_title ?? null,
    event_date: candidate.event_date,
    start_time: candidate.start_time,
    end_time: candidate.end_time,
    timezone: candidate.timezone,
    mode: candidate.mode,
    venue: candidate.venue ?? null,
    meeting_link: candidate.meeting_link ?? null,
    description: candidate.description ?? null,
    dress_code: candidate.dress_code ?? null,
    preparation_notes: candidate.preparation_notes ?? null,
    registration_required: candidate.registration_required ?? 1,
    registration_closes_at: candidate.registration_closes_at ?? null,
    capacity: candidate.capacity ?? null,
    organiser_name: candidate.organiser_name ?? null,
    organiser_email: candidate.organiser_email ?? null,
    feedback_mode: candidate.feedback_mode ?? 'builtin',
    feedback_form_url: candidate.feedback_form_url ?? null,
    starts_at_utc: candidate.starts_at_utc,
    ends_at_utc: candidate.ends_at_utc,
    created_at: at,
    updated_at: at,
  });

  activity.log({ eventId: id, action: 'event.created', detail: candidate.name });
  return get(id);
}

/** Fields whose change matters to students who already hold an invitation. */
const NOTIFIABLE_FIELDS = ['event_date', 'start_time', 'end_time', 'timezone', 'mode', 'venue', 'meeting_link'];

function update(id, input) {
  const existing = get(id);
  if (existing.status === 'cancelled') {
    throw new ConflictError('A cancelled event cannot be edited. Create a new event for the rescheduled session.');
  }
  const { data } = cleanEvent(input, { partial: true });
  const timingTouched = ['event_date', 'start_time', 'end_time', 'timezone'].some((k) => data[k] !== undefined);
  const timed = timingTouched ? withTiming(data, existing) : data;

  const timezone = timed.timezone || existing.timezone;
  const registrationClosesAt = parseRegistrationClose(input.registration_closes_at, timezone);
  if (registrationClosesAt !== undefined) timed.registration_closes_at = registrationClosesAt;

  const candidate = { ...existing, ...timed };
  const problems = crossCheck(candidate);
  if (problems.length) throw new ValidationError(problems[0], problems);

  const keys = Object.keys(timed);
  if (keys.length === 0) return existing;

  const changed = keys.filter((key) => existing[key] !== timed[key]);
  getDb().prepare(`UPDATE events SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...timed, id, updated_at: dt.nowIso() });

  if (changed.length) {
    activity.log({ eventId: id, action: 'event.updated', detail: `Changed: ${changed.join(', ')}` });
  }

  return {
    event: get(id),
    changed,
    timingChanged: changed.some((key) => ['starts_at_utc', 'ends_at_utc'].includes(key)),
    notifiableChange: changed.some((key) => NOTIFIABLE_FIELDS.includes(key)),
  };
}

function setStatus(id, status, extra = {}) {
  const at = dt.nowIso();
  const fields = { status, updated_at: at };
  if (status === 'scheduled') fields.published_at = at;
  if (status === 'completed') fields.completed_at = at;
  if (status === 'cancelled') {
    fields.cancelled_at = at;
    fields.cancellation_reason = extra.reason || null;
  }
  const keys = Object.keys(fields);
  getDb().prepare(`UPDATE events SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`)
    .run({ ...fields, id });
  return get(id);
}

function remove(id) {
  const existing = get(id);
  if (existing.status === 'scheduled') {
    throw new ConflictError('Cancel the event before deleting it, so that pending messages are withdrawn and students are told.');
  }
  transaction(() => {
    getDb().prepare('DELETE FROM events WHERE id = ?').run(id);
  });
  activity.log({ eventId: null, action: 'event.deleted', detail: existing.name });
}

/** Copy an event, its audience and its reminder schedule to a new date. */
function duplicate(id, { name, event_date, start_time, end_time }) {
  const source = get(id);
  const draft = {
    ...source,
    name: name || `${source.name} (copy)`,
    event_date: event_date || source.event_date,
    start_time: start_time || source.start_time,
    end_time: end_time || source.end_time,
  };
  delete draft.id;
  const created = create(draft);

  const audiences = getDb().prepare('SELECT * FROM event_audiences WHERE event_id = ?').all(id);
  const rules = getDb().prepare('SELECT * FROM reminder_rules WHERE event_id = ? ORDER BY sort_order').all(id);
  const at = dt.nowIso();

  transaction(() => {
    for (const row of audiences) {
      getDb().prepare(`INSERT INTO event_audiences (id, event_id, kind, ref_id, filter_json, created_at)
                       VALUES (?, ?, ?, ?, ?, ?)`)
        .run(newId('aud'), created.id, row.kind, row.ref_id, row.filter_json, at);
    }
    for (const row of rules) {
      getDb().prepare(`INSERT INTO reminder_rules (id, event_id, label, category, anchor, offset_minutes,
                                                   channel, template_id, audience_rule, enabled, sort_order,
                                                   created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(newId('rul'), created.id, row.label, row.category, row.anchor, row.offset_minutes,
          row.channel, row.template_id, row.audience_rule, row.enabled, row.sort_order, at, at);
    }
  });

  activity.log({ eventId: created.id, action: 'event.duplicated', detail: `Copied from ${source.name}` });
  return get(created.id);
}

module.exports = {
  get, decorate, list, create, update, remove, duplicate, setStatus,
  cleanEvent, crossCheck, withTiming, parseRegistrationClose, NOTIFIABLE_FIELDS,
};
