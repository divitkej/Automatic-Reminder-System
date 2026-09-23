'use strict';

/**
 * Builds the merge context every template is rendered against, and publishes
 * the catalogue of fields so the template editor can list them and reject a
 * misspelled one before a message goes out.
 */

const config = require('../config');
const dt = require('../lib/datetime');
const { eventTypeLabel, labelFor, EVENT_MODES } = require('../lib/constants');

function firstName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) return 'student';
  return trimmed.split(/\s+/)[0];
}

function lastName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function trackedUrl(base, messageId) {
  if (!messageId) return base;
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}m=${encodeURIComponent(messageId)}`;
}

function buildEventContext(event, at = Date.now()) {
  const tzLabel = dt.timezoneLabel(event.timezone, new Date(event.starts_at_utc));
  return {
    id: event.id,
    name: event.name,
    type: event.type,
    type_label: eventTypeLabel(event.type),
    company: event.company || '',
    speaker: event.speaker || '',
    speaker_title: event.speaker_title || '',
    date_iso: event.event_date,
    date_long: dt.formatLongDate(event.event_date),
    date_full: dt.formatFullDate(event.event_date),
    start_time: event.start_time,
    end_time: event.end_time,
    start_time_12: dt.formatTime12(event.start_time),
    end_time_12: dt.formatTime12(event.end_time),
    time_range: dt.formatTimeRange(event.start_time, event.end_time),
    timezone: event.timezone,
    timezone_label: tzLabel,
    mode: event.mode,
    mode_label: labelFor(EVENT_MODES, event.mode),
    is_online: event.mode === 'online',
    is_in_person: event.mode === 'in_person',
    is_hybrid: event.mode === 'hybrid',
    venue: event.venue || '',
    meeting_link: event.meeting_link || '',
    has_link: Boolean(event.meeting_link),
    description: event.description || '',
    dress_code: event.dress_code || '',
    preparation_notes: event.preparation_notes || '',
    capacity: event.capacity || '',
    registration_required: Boolean(event.registration_required),
    registration_deadline: event.registration_closes_at
      ? `${dt.formatLongDate(dt.utcToZoned(event.registration_closes_at, event.timezone).date)} at ${dt.formatTime12(dt.utcToZoned(event.registration_closes_at, event.timezone).time)}`
      : '',
    organiser_name: event.organiser_name || config.org.shortName,
    organiser_email: event.organiser_email || config.org.email,
    status: event.status,
    cancellation_reason: event.cancellation_reason || '',
    has_feedback: event.feedback_mode !== 'none',
    starts_in: dt.relativeToNow(event.starts_at_utc, at),
    ends_in: dt.relativeToNow(event.ends_at_utc, at),
  };
}

function buildStudentContext(student) {
  return {
    id: student.id,
    campus_id: student.campus_id,
    name: student.name,
    first_name: firstName(student.name),
    last_name: lastName(student.name),
    email: student.email,
    phone: student.phone || '',
    program: student.program || '',
    discipline: student.discipline || '',
    year_of_study: student.year_of_study || '',
    batch: student.batch || '',
  };
}

function buildLinks(event, registration, messageId) {
  const base = config.publicBaseUrl;
  if (!registration || !registration.token) {
    return { register: base, decline: base, details: base, feedback: base, calendar: base };
  }
  const token = registration.token;
  const detail = `${base}/r/${token}`;
  const feedback = event.feedback_mode === 'external' && event.feedback_form_url
    ? event.feedback_form_url
    : `${base}/f/${token}`;
  return {
    details: trackedUrl(detail, messageId),
    register: trackedUrl(`${detail}?a=confirm`, messageId),
    decline: trackedUrl(`${detail}?a=decline`, messageId),
    feedback: trackedUrl(feedback, messageId),
    calendar: `${base}/r/${token}/calendar.ics`,
  };
}

/**
 * The context for a message that will be sent to a whole group at once.
 *
 * There is no individual here, so there can be no individual links. Every
 * personal link is replaced by the event's public page, where a student
 * identifies themselves before replying. This exists so that a batch copied
 * into a BCC field can never carry one student's private token to everyone
 * else, which would let any of them answer as that student.
 */
function buildGenericContext({ event, at = Date.now() }) {
  const base = config.publicBaseUrl;
  const publicPage = `${base}/e/${event.id}`;
  return {
    event: buildEventContext(event, at),
    student: {
      id: '',
      campus_id: '',
      name: 'student',
      first_name: 'student',
      last_name: '',
      email: '',
      phone: '',
      program: '',
      discipline: '',
      year_of_study: '',
      batch: '',
    },
    registration: { status: 'invited', is_registered: false, has_declined: false, attended: false },
    links: {
      details: publicPage,
      register: publicPage,
      decline: publicPage,
      feedback: event.feedback_mode === 'external' && event.feedback_form_url
        ? event.feedback_form_url
        : `${publicPage}/feedback`,
      calendar: `${publicPage}/calendar.ics`,
    },
    org: {
      name: config.org.name,
      short_name: config.org.shortName,
      email: config.org.email,
      phone: config.org.phone,
    },
    system: { year: String(new Date().getFullYear()), base_url: config.publicBaseUrl },
  };
}

/** The full context for one message. */
function buildContext({ event, student, registration, messageId, at = Date.now() }) {
  return {
    event: buildEventContext(event, at),
    student: buildStudentContext(student),
    registration: {
      status: registration ? registration.status : 'invited',
      is_registered: Boolean(registration && registration.status === 'registered'),
      has_declined: Boolean(registration && registration.status === 'declined'),
      attended: Boolean(registration && registration.attended),
    },
    links: buildLinks(event, registration, messageId),
    org: {
      name: config.org.name,
      short_name: config.org.shortName,
      email: config.org.email,
      phone: config.org.phone,
    },
    system: {
      year: String(new Date().getFullYear()),
      base_url: config.publicBaseUrl,
    },
  };
}

/** Sample data used for the preview pane in the template editor. */
function sampleContext() {
  return buildContext({
    event: {
      id: 'evt_sample',
      name: 'Career Readiness Workshop, Cohort 3',
      type: 'career_readiness_workshop',
      company: '',
      speaker: 'Ms Reema Fernandes',
      speaker_title: 'Head of Talent Acquisition',
      event_date: '2026-09-24',
      start_time: '17:00',
      end_time: '18:30',
      timezone: config.defaultTimezone,
      mode: 'online',
      venue: '',
      meeting_link: 'https://meet.example.org/crw-cohort-3',
      description: 'A working session on CV structure, keyword matching and the first sixty seconds of an interview.',
      dress_code: '',
      preparation_notes: 'A current draft of your CV in PDF form.',
      capacity: 60,
      registration_required: 1,
      registration_closes_at: null,
      organiser_name: 'Career Services',
      organiser_email: config.org.email,
      status: 'scheduled',
      feedback_mode: 'builtin',
      starts_at_utc: '2026-09-24T13:00:00.000Z',
      ends_at_utc: '2026-09-24T14:30:00.000Z',
    },
    student: {
      id: 'stu_sample',
      campus_id: '2023A7PS0142U',
      name: 'Aarav Menon',
      email: 'f20230142@dubai.bits-pilani.ac.in',
      phone: '+971 50 000 0000',
      program: 'B.E.',
      discipline: 'Computer Science',
      year_of_study: 3,
      batch: '2023',
    },
    registration: { token: 'sample-token', status: 'registered', attended: 0 },
    messageId: null,
    at: Date.parse('2026-09-17T13:00:00.000Z'),
  });
}

/** Every merge field a template may use, for validation and for the editor. */
function fieldCatalogue() {
  const sample = sampleContext();
  const out = [];
  for (const [group, values] of Object.entries(sample)) {
    for (const key of Object.keys(values)) {
      out.push(`${group}.${key}`);
    }
  }
  return out.sort();
}

module.exports = { buildContext, buildGenericContext, sampleContext, fieldCatalogue, buildEventContext, buildStudentContext, buildLinks, firstName };
