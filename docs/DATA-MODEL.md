# Data model

The full schema, with comments, is in `server/db/schema.sql`. This is the map.

```
students ──┬─< group_members >── student_groups
           │
           ├─< registrations >── events ──< event_audiences
           │        │                │
           │        │                ├──< reminder_rules >── templates
           │        │                │
           │        └────────────────┴──< messages
           │
           └─< feedback_responses >── events
```

## The tables that carry the work

**`events`** holds one session. `starts_at_utc` and `ends_at_utc` are derived
on write from the wall-clock fields plus the timezone, so the scheduler never
repeats timezone arithmetic and a query for "what is due" is a string compare.

**`event_audiences`** holds the rows that describe who an event targets: a
group, a named student, or a filter. They are combined as a union.

**`registrations`** is the join between a student and an event, one row per
invited student. It carries the response, attendance, and the token that stands
behind every personal link in every message to that student. It is created when
the audience is resolved and is never silently destroyed once anything has
happened to it.

**`reminder_rules`** is one line of the schedule: an offset from an anchor, a
channel, an audience rule and a template. Offsets rather than dates is what
makes moving an event move its whole schedule.

**`messages`** is the outbox: one row per reminder per student, from scheduled
through to sent, failed, skipped or withdrawn. `dedupe_key` is
`<rule id>:<registration id>`, and the unique index on it is what makes
materialisation safe to run on every worker tick.

**`templates`** holds the wording. `is_system` marks the templates that ship
with the product; a system template whose `updated_at` has moved past its
`created_at` has been edited locally and is never overwritten by an upgrade.

## Conventions

- Every timestamp column ending in `_at` or `_utc` is an ISO-8601 string in UTC.
- `event_date`, `start_time` and `end_time` are local wall-clock values,
  interpreted in the event's own `timezone`.
- Identifiers are short prefixed strings (`evt_`, `stu_`, `msg_`) drawn from an
  alphabet with no ambiguous characters, so they can be read aloud.
- Foreign keys are enforced, and cascade deletes are used where a child row has
  no meaning without its parent.

## Why SQLite

The whole of Career Services is a handful of people and a few thousand
students. One file, no server to administer, no connection pool to tune, and a
backup is a file copy. Write-ahead logging is on, so the worker writing to the
outbox never blocks the console reading it.

If the campus later wants this on Postgres, the queries are plain SQL in the
service layer with no ORM in the way.
