-- ---------------------------------------------------------------------------
-- Career Services Automatic Event Reminder System
-- BITS Pilani, Dubai Campus
--
-- All timestamp columns whose name ends in _at or _utc hold ISO-8601 strings in
-- UTC. Wall-clock columns (event_date, start_time, end_time) hold the local
-- time of the event as typed by staff, interpreted in the event's timezone.
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------------
-- Students
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  campus_id     TEXT NOT NULL UNIQUE,        -- e.g. 2023A7PS0142U
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  program       TEXT,                        -- B.E., M.Sc., MBA
  discipline    TEXT,                        -- Computer Science, Mechanical
  year_of_study INTEGER,                     -- 1 to 5
  batch         TEXT,                        -- admission year, e.g. 2023
  cgpa          REAL,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'graduated')),
  opted_out     INTEGER NOT NULL DEFAULT 0,  -- suppresses all non-essential mail
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_students_email      ON students (email);
CREATE INDEX IF NOT EXISTS idx_students_status     ON students (status);
CREATE INDEX IF NOT EXISTS idx_students_discipline ON students (discipline);
CREATE INDEX IF NOT EXISTS idx_students_batch      ON students (batch);

-- --------------------------------------------------------------------------
-- Student groups
--   kind = 'static' : membership is an explicit list in group_members
--   kind = 'smart'  : membership is recomputed from filter_json on every use
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  kind        TEXT NOT NULL DEFAULT 'static' CHECK (kind IN ('static', 'smart')),
  filter_json TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id   TEXT NOT NULL REFERENCES student_groups (id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_student ON group_members (student_id);

-- --------------------------------------------------------------------------
-- Events
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL,       -- see server/lib/constants.js
  company               TEXT,
  speaker               TEXT,
  speaker_title         TEXT,
  event_date            TEXT NOT NULL,       -- YYYY-MM-DD, local to timezone
  start_time            TEXT NOT NULL,       -- HH:MM, 24 hour, local
  end_time              TEXT NOT NULL,       -- HH:MM, 24 hour, local
  timezone              TEXT NOT NULL DEFAULT 'Asia/Dubai',
  mode                  TEXT NOT NULL DEFAULT 'in_person'
                        CHECK (mode IN ('in_person', 'online', 'hybrid')),
  venue                 TEXT,
  meeting_link          TEXT,
  description           TEXT,
  dress_code            TEXT,
  preparation_notes     TEXT,
  registration_required INTEGER NOT NULL DEFAULT 1,
  registration_closes_at TEXT,               -- UTC, optional
  capacity              INTEGER,
  organiser_name        TEXT,
  organiser_email       TEXT,
  feedback_mode         TEXT NOT NULL DEFAULT 'builtin'
                        CHECK (feedback_mode IN ('builtin', 'external', 'none')),
  feedback_form_url     TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'scheduled', 'completed', 'cancelled')),
  starts_at_utc         TEXT NOT NULL,
  ends_at_utc           TEXT NOT NULL,
  published_at          TEXT,
  completed_at          TEXT,
  cancelled_at          TEXT,
  cancellation_reason   TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events (starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_events_type   ON events (type);

-- --------------------------------------------------------------------------
-- Who an event is aimed at. An event may combine several audience rows;
-- the resolved recipient list is the union, minus opted-out students.
--   kind = 'group'   -> ref_id is a student_groups.id
--   kind = 'student' -> ref_id is a students.id
--   kind = 'filter'  -> filter_json describes an ad hoc query
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_audiences (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('group', 'student', 'filter')),
  ref_id      TEXT,
  filter_json TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_audiences_event ON event_audiences (event_id);

-- --------------------------------------------------------------------------
-- Message templates. System templates ship with the product and are used as
-- the default body for every reminder rule of a matching category.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL
              CHECK (category IN ('invitation', 'confirmation', 'reminder',
                                  'post_event', 'feedback', 'update', 'cancellation')),
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  event_type  TEXT,                          -- NULL means it suits every type
  subject     TEXT,
  body        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_category ON templates (category, channel);

-- --------------------------------------------------------------------------
-- The reminder schedule for one event.
-- offset_minutes is signed and relative to anchor: negative is before.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminder_rules (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  category       TEXT NOT NULL
                 CHECK (category IN ('invitation', 'confirmation', 'reminder',
                                     'post_event', 'feedback', 'update', 'cancellation')),
  anchor         TEXT NOT NULL DEFAULT 'start'
                 CHECK (anchor IN ('start', 'end', 'registration_close')),
  offset_minutes INTEGER NOT NULL DEFAULT 0,
  channel        TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  template_id    TEXT REFERENCES templates (id) ON DELETE SET NULL,
  audience_rule  TEXT NOT NULL DEFAULT 'all'
                 CHECK (audience_rule IN ('all', 'registered', 'unregistered',
                                          'attended', 'absent', 'awaiting_feedback')),
  enabled        INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_event ON reminder_rules (event_id, sort_order);

-- --------------------------------------------------------------------------
-- One row per student invited to an event. Carries registration state,
-- attendance and the tokens behind the personal links in every message.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registrations (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited', 'registered', 'declined', 'waitlisted', 'cancelled')),
  token         TEXT NOT NULL UNIQUE,
  source        TEXT NOT NULL DEFAULT 'audience',
  responded_at  TEXT,
  attended      INTEGER NOT NULL DEFAULT 0,
  checked_in_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (event_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_registrations_event   ON registrations (event_id, status);
CREATE INDEX IF NOT EXISTS idx_registrations_student ON registrations (student_id);

-- --------------------------------------------------------------------------
-- The outbox. Every message the system will send, has sent, or decided not to
-- send. dedupe_key makes materialisation idempotent, so the scheduler can run
-- as often as it likes without ever duplicating a reminder.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  dedupe_key      TEXT NOT NULL UNIQUE,
  event_id        TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  rule_id         TEXT REFERENCES reminder_rules (id) ON DELETE SET NULL,
  registration_id TEXT REFERENCES registrations (id) ON DELETE CASCADE,
  student_id      TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  label           TEXT,
  to_address      TEXT,
  subject         TEXT,
  body            TEXT,
  scheduled_for   TEXT NOT NULL,             -- UTC
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'sending', 'sent', 'failed',
                                    'cancelled', 'skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  provider        TEXT,
  provider_ref    TEXT,
  sent_at         TEXT,
  opened_at       TEXT,
  clicked_at      TEXT,
  skip_reason     TEXT,
  -- Messages due at the same moment for the same reminder are handed over as
  -- one batch, so they carry a shared key.
  batch_key       TEXT,
  -- Set when a member of staff hands the batch to whoever sends campus mail.
  handed_off_at   TEXT,
  handed_off_by   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_due     ON messages (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_messages_event   ON messages (event_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_messages_student ON messages (student_id);
CREATE INDEX IF NOT EXISTS idx_messages_rule    ON messages (rule_id);
-- idx_messages_batch is created by migrate(), after batch_key has been added
-- to databases that predate it.

-- --------------------------------------------------------------------------
-- Built-in feedback form responses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_responses (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  student_id       TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  registration_id  TEXT REFERENCES registrations (id) ON DELETE SET NULL,
  overall_rating   INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  content_rating   INTEGER CHECK (content_rating BETWEEN 1 AND 5),
  speaker_rating   INTEGER CHECK (speaker_rating BETWEEN 1 AND 5),
  organisation_rating INTEGER CHECK (organisation_rating BETWEEN 1 AND 5),
  would_recommend  INTEGER,
  most_useful      TEXT,
  improvements     TEXT,
  future_topics    TEXT,
  submitted_at     TEXT NOT NULL,
  UNIQUE (event_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_event ON feedback_responses (event_id);

-- --------------------------------------------------------------------------
-- Audit trail
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  event_id   TEXT,
  actor      TEXT NOT NULL DEFAULT 'system',
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_event   ON activity_log (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log (created_at);

-- --------------------------------------------------------------------------
-- Key/value settings, used for schema version and operational flags
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);
