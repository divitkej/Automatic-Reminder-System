'use strict';

/**
 * Demonstration data.
 *
 * Loaded only into an empty database, so it never overwrites real records. It
 * exists so that the console has something to show on a first run: a cohort of
 * students, the groups Career Services actually works with, one event about to
 * happen, one still in draft, and one already finished with attendance and
 * feedback on it, which is what makes the reporting screens meaningful.
 */

const { getDb, transaction } = require('./index');
const config = require('../config');
const students = require('../services/students');
const groups = require('../services/groups');
const events = require('../services/events');
const rules = require('../services/rules');
const audience = require('../services/audience');
const registrations = require('../services/registrations');
const feedback = require('../services/feedback');
const workflow = require('../services/workflow');
const templates = require('../services/templates');
const dt = require('../lib/datetime');

const FIRST_NAMES = [
  'Aarav', 'Meera', 'Zayd', 'Ananya', 'Rohan', 'Fatima', 'Ishaan', 'Sara',
  'Kabir', 'Leila', 'Aditya', 'Noor', 'Vivaan', 'Hana', 'Arjun', 'Zara',
  'Neha', 'Omar', 'Riya', 'Yusuf', 'Tara', 'Karan', 'Amira', 'Dev',
  'Priya', 'Hamza', 'Anika', 'Rayan', 'Sneha', 'Bilal', 'Divya', 'Imran',
  'Kavya', 'Faisal', 'Nisha', 'Adnan', 'Pooja', 'Sami', 'Ritika', 'Tariq',
];

const LAST_NAMES = [
  'Menon', 'Nair', 'Al Hashimi', 'Sharma', 'Desai', 'Khan', 'Iyer', 'Ahmed',
  'Kapoor', 'Haddad', 'Rao', 'Siddiqui', 'Verma', 'Fernandes', 'Pillai', 'Mirza',
  'Joshi', 'Abdullah', 'Bhat', 'Rahman',
];

const DISCIPLINES = [
  'Computer Science', 'Electronics and Communication', 'Mechanical Engineering',
  'Chemical Engineering', 'Biotechnology', 'Electrical and Electronics', 'Civil Engineering',
];

/**
 * Deterministic pseudo-random source, so the demo data is the same every time.
 * Math.imul keeps the arithmetic inside 32 bits: a plain multiply would exceed
 * what a double can hold exactly and the sequence would degenerate.
 */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function offsetDate(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return dt.utcToZoned(d, config.defaultTimezone).date;
}

function buildStudents() {
  const random = makeRandom(20260924);
  const rows = [];
  const used = new Set();
  for (let i = 0; i < 48; i += 1) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
    const batchYear = 2022 + (i % 4);
    const yearOfStudy = 2026 - batchYear + 1;
    const serial = String(101 + i).padStart(4, '0');
    const campusId = `${batchYear}A7PS${serial}U`;
    if (used.has(campusId)) continue;
    used.add(campusId);
    rows.push({
      campus_id: campusId,
      name: `${first} ${last}`,
      email: `f${batchYear}${serial}@dubai.bits-pilani.ac.in`,
      phone: `+9715${Math.floor(random() * 9)}${String(Math.floor(random() * 10000000)).padStart(7, '0')}`,
      program: i % 11 === 0 ? 'M.E.' : 'B.E.',
      discipline: DISCIPLINES[i % DISCIPLINES.length],
      year_of_study: Math.min(5, Math.max(1, yearOfStudy)),
      batch: String(batchYear),
      cgpa: Number((6 + random() * 3.8).toFixed(2)),
      status: 'active',
      opted_out: i === 17 ? 1 : 0,
    });
  }
  return rows;
}

function seedIfEmpty() {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) AS n FROM students').get().n
    + db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  if (existing > 0) return { seeded: false, reason: 'The database already holds records.' };

  templates.installSystemTemplates();

  const created = { students: 0, groups: 0, events: 0 };

  transaction(() => {
    for (const row of buildStudents()) {
      students.create(row);
      created.students += 1;
    }
  });

  const all = students.matching({ includeOptedOut: true });

  const finalYear = groups.create({
    name: 'Final year, 2026 graduating',
    description: 'Students in their final year, the main audience for placement activity.',
    kind: 'smart',
    filter: { years: [4, 5], status: ['active'] },
  });
  const computing = groups.create({
    name: 'Computer Science and Electronics',
    description: 'Used for technology employer sessions.',
    kind: 'smart',
    filter: { disciplines: ['Computer Science', 'Electronics and Communication'], status: ['active'] },
  });
  const cohort3 = groups.create({
    name: 'Career Readiness Cohort 3',
    description: 'The third readiness cohort of the semester. Membership is set by the Career Services team.',
    kind: 'static',
  });
  groups.addMembers(cohort3.id, all.slice(0, 26).map((s) => s.id));
  created.groups = 3;

  // -------------------------------------------------------------------------
  // The flagship upcoming event, matching the brief's worked example.
  // -------------------------------------------------------------------------
  const workshop = events.create({
    name: 'Career Readiness Workshop, Cohort 3',
    type: 'career_readiness_workshop',
    speaker: 'Ms Reema Fernandes',
    speaker_title: 'Head of Talent Acquisition, Gulf Technology Partners',
    event_date: offsetDate(2),
    start_time: '17:00',
    end_time: '18:30',
    timezone: config.defaultTimezone,
    mode: 'online',
    meeting_link: 'https://meet.example.org/bpdc-career-readiness-c3',
    description: 'A working session on CV structure, matching your CV to a job description, and the first sixty seconds of an interview. Bring a draft and leave with it marked up.',
    preparation_notes: 'A current draft of your CV in PDF form, and one job advertisement you would genuinely apply to.',
    capacity: 60,
    registration_required: true,
    organiser_name: 'Career Services',
    organiser_email: config.org.email,
    feedback_mode: 'builtin',
  });
  audience.add(workshop.id, { kind: 'group', refId: cohort3.id });
  rules.applyPreset(workshop.id);
  workflow.publish(workshop.id, { actor: 'seed', force: true });

  // A realistic spread of responses.
  const workshopRegistrations = registrations.listForEvent(workshop.id);
  const random = makeRandom(7717);
  workshopRegistrations.forEach((registration, index) => {
    const roll = random();
    if (roll < 0.62) registrations.setStatus(registration.id, 'registered', { actor: 'seed' });
    else if (roll < 0.74) registrations.setStatus(registration.id, 'declined', { actor: 'seed' });
    else if (index % 9 === 0) registrations.setStatus(registration.id, 'registered', { actor: 'seed' });
  });
  created.events += 1;

  // -------------------------------------------------------------------------
  // A company talk still being put together.
  // -------------------------------------------------------------------------
  const talk = events.create({
    name: 'Engineering Graduate Programme, Gulf Technology Partners',
    type: 'company_talk',
    company: 'Gulf Technology Partners',
    speaker: 'Mr Daniel Okafor',
    speaker_title: 'Director of Early Careers',
    event_date: offsetDate(16),
    start_time: '14:00',
    end_time: '15:30',
    timezone: config.defaultTimezone,
    mode: 'in_person',
    venue: 'Auditorium, Academic Block B',
    description: 'How the graduate programme selects, what the two year rotation covers, and what the panel looks for in a first interview. Open to final year students across engineering disciplines.',
    dress_code: 'Smart casual',
    capacity: 120,
    registration_required: true,
    organiser_name: 'Career Services',
    organiser_email: config.org.email,
    feedback_mode: 'builtin',
  });
  audience.add(talk.id, { kind: 'group', refId: finalYear.id });
  audience.add(talk.id, { kind: 'group', refId: computing.id });
  rules.applyPreset(talk.id);
  audience.syncRegistrations(talk.id, { actor: 'seed' });
  created.events += 1;

  // -------------------------------------------------------------------------
  // A finished event, so the reporting screens have real figures.
  // -------------------------------------------------------------------------
  const pastFair = events.create({
    name: 'Autumn Career Fair 2026',
    type: 'career_fair',
    event_date: offsetDate(-12),
    start_time: '10:00',
    end_time: '16:00',
    timezone: config.defaultTimezone,
    mode: 'in_person',
    venue: 'Sports Complex, Main Campus',
    description: 'Twenty two employers across engineering, technology, energy and finance, with on the spot CV review from the Career Services team.',
    dress_code: 'Business formal',
    registration_required: true,
    organiser_name: 'Career Services',
    organiser_email: config.org.email,
    feedback_mode: 'builtin',
  });
  audience.add(pastFair.id, { kind: 'group', refId: finalYear.id });
  // Give the finished event the schedule it would have had when it was set up,
  // five weeks before the doors opened, rather than the empty one that fitting
  // a preset to a past date correctly produces.
  rules.applyPreset(pastFair.id, {
    referenceTime: new Date(pastFair.starts_at_utc).getTime() - 35 * 24 * 60 * 60 * 1000,
  });
  workflow.publish(pastFair.id, { actor: 'seed', force: true });

  const fairRegistrations = registrations.listForEvent(pastFair.id);
  const fairRandom = makeRandom(31337);
  const attendees = [];
  for (const registration of fairRegistrations) {
    const roll = fairRandom();
    if (roll < 0.78) {
      registrations.setStatus(registration.id, 'registered', { actor: 'seed' });
      if (fairRandom() < 0.82) {
        registrations.setAttendance(registration.id, true, { actor: 'seed' });
        attendees.push(registration);
      }
    } else {
      registrations.setStatus(registration.id, 'declined', { actor: 'seed' });
    }
  }
  workflow.complete(pastFair.id, { actor: 'seed' });
  workflow.refresh(pastFair.id, { actor: 'seed' });
  markDemoHistoryAsSent(pastFair.id);

  const comments = [
    ['The CV review desk was the best part. Ten minutes there was worth more than the talk I went to afterwards.',
      'Two of the employers I most wanted to meet had queues I could not get through. More staggered slots would help.'],
    ['Speaking to engineers doing the job rather than only recruiters.',
      'The hall was very warm by the afternoon.'],
    ['Getting a straight answer on what they expect from a third year internship application.',
      'A floor plan sent the day before would have saved me twenty minutes.'],
    ['The energy sector employers were much more open about salary bands than I expected.', null],
    [null, 'More companies hiring for chemical engineering. It was heavily weighted to software.'],
  ];
  const feedbackRandom = makeRandom(9091);
  attendees.slice(0, Math.ceil(attendees.length * 0.55)).forEach((registration, index) => {
    const pair = comments[index % comments.length];
    feedback.submit(registrations.get(registration.id), {
      overall_rating: feedbackRandom() < 0.7 ? 4 + Math.round(feedbackRandom()) : 3,
      content_rating: 3 + Math.round(feedbackRandom() * 2),
      organisation_rating: 3 + Math.round(feedbackRandom() * 2),
      would_recommend: feedbackRandom() < 0.88 ? '1' : '0',
      most_useful: pair[0] || '',
      improvements: pair[1] || '',
      future_topics: index % 4 === 0 ? 'A session on applying to roles outside the UAE.' : '',
    });
  });
  created.events += 1;

  workflow.refresh(workshop.id, { actor: 'seed' });

  require('./index').setSetting('demo_data_seeded_at', new Date().toISOString());
  return { seeded: true, ...created };
}

/**
 * The finished event's reminders were due before this database existed, so the
 * dispatcher would rightly discard them as too late to send. Marking them as
 * delivered gives the reporting screens a realistic history to show. It applies
 * only to the demonstration event, in a database that was empty a moment ago.
 */
function markDemoHistoryAsSent(eventId) {
  const db = getDb();
  const random = makeRandom(4242);
  const due = db
    .prepare("SELECT id, scheduled_for FROM messages WHERE event_id = ? AND status = 'scheduled' AND scheduled_for < ?")
    .all(eventId, new Date().toISOString());
  const update = db.prepare(`
    UPDATE messages SET status = 'sent', provider = 'preview', sent_at = ?,
                        opened_at = ?, clicked_at = ?, updated_at = ?
    WHERE id = ?
  `);
  transaction(() => {
    for (const row of due) {
      const sentAt = new Date(new Date(row.scheduled_for).getTime() + Math.floor(random() * 90) * 1000).toISOString();
      const opened = random() < 0.71;
      const clicked = opened && random() < 0.42;
      update.run(
        sentAt,
        opened ? new Date(new Date(sentAt).getTime() + Math.floor(random() * 6 * 3600) * 1000).toISOString() : null,
        clicked ? new Date(new Date(sentAt).getTime() + Math.floor(random() * 8 * 3600) * 1000).toISOString() : null,
        sentAt,
        row.id,
      );
    }
  });
  return due.length;
}

if (require.main === module) {
  const { migrate } = require('./index');
  migrate();
  const report = seedIfEmpty();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { seedIfEmpty, buildStudents };
