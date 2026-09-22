# Career Services Automatic Event Reminder System

**BITS Pilani, Dubai Campus**

Career Services runs workshops, company talks, CEO interactions, MOU signings,
career fairs, mock interviews, industry sessions and guest lectures. Every one
of them carries the same tail of communication: an invitation, a chase for the
students who have not replied, a reminder a week out, another the day before,
a final nudge on the day, thanks afterwards, a note to the students who were
absent, and a feedback form with one reminder.

That is nine to eleven messages per event, each aimed at a different slice of
the audience, each due at a different time, and today each one sent by hand.

This system does it once. Create the event, pick the target students, confirm
the reminder schedule, publish. Everything after that runs without anyone
touching it.

---

## The workflow

```
Create event
  -> Select target students          groups, filters, or named individuals
  -> Configure reminder schedule     filled in from the event type
  -> Publish
       |
       +-- Invitation and registration request        sent automatically
       +-- Chase, to students yet to reply            sent automatically
       +-- Reminders, on the schedule                 sent automatically
       +-- Registration confirmations                 sent on each reply
       |
  -> Mark attendance
       |
       +-- Thank you, to students who attended        sent automatically
       +-- Note to students who were absent           sent automatically
       +-- Feedback form                              sent automatically
       +-- Feedback reminder, to those yet to reply   sent automatically
       |
  -> Read the report
```

Everything in the middle column happens on its own. The only manual steps are
creating the event, choosing who it is for, and marking who turned up.

---

## Getting started

Requires Node.js 20.11 or newer. No database server, no build step.

```bash
npm install
cp .env.example .env      # edit it, see Configuration below
npm start
```

Open <http://localhost:3000>. On a first run the database is created, the
standard message templates are installed, and a small set of demonstration
data is loaded so the screens have something to show. Set `SEED_DEMO_DATA=false`
before the first start to skip it, or run `npm run reset` to clear everything.

`npm test` runs the test suite.

---

## Configuration

All settings are environment variables, documented in `.env.example`. The ones
that matter most:

| Variable | What it does |
| --- | --- |
| `DRY_RUN` | **Defaults to `true`.** Every message is composed, scheduled, tracked and shown in the outbox, but nothing is delivered. Leave it on until you have run a test event end to end. |
| `PUBLIC_BASE_URL` | The address that goes into every registration and feedback link. If it is wrong, students click links that do not resolve. |
| `SMTP_HOST` and friends | The campus mail server. With no host set, email stays in preview mode whatever `DRY_RUN` says. |
| `STAFF_PASSWORD` | A shared password for the console. Empty means no login screen, which is only safe on a machine nobody else can reach. |
| `SCHEDULER_ENABLED` | The background worker. Off means nothing is ever sent automatically. |
| `DEFAULT_TIMEZONE` | `Asia/Dubai`. Each event can override it, which matters for a session run with a partner in another country. |

### Going live

1. Keep `DRY_RUN=true`. Create a real event, publish it, and read the messages
   in the outbox. They are complete, including the personal links.
2. Fill in the SMTP details. The settings screen verifies the connection.
3. Set `DRY_RUN=false` and restart.
4. Run one event with a small audience, ideally the Career Services team
   themselves, before pointing it at a cohort.

---

## How it works

### Events

An event holds everything students are told: name, type, organisation, speaker,
date, start and end time, timezone, mode, venue, joining link, description,
what to bring, dress code, capacity and how feedback is collected.

Times are typed as local wall-clock values and stored as absolute instants, so
the schedule is correct across daylight-saving changes in any timezone. Moving
an event moves every reminder with it, automatically, because reminder times
are stored as offsets rather than as dates.

An event is a **draft** until it is published. A draft sends nothing. The
readiness panel lists what is blocking publication, and separately what is
merely worth checking.

### Audiences

An event's audience is built from three kinds of row, combined as a union:

- **Groups.** A *fixed* group holds a list of students, which suits a cohort. A
  *smart* group holds a rule, such as final year Computer Science with a CGPA
  of 7 or above, and is recalculated every time it is used, so it never goes
  stale.
- **Filters,** for an ad hoc slice that does not deserve a permanent group.
- **Individual students,** for the one who asked in person.

Resolving the audience produces one registration row per student, carrying that
student's response, attendance and the unguessable token behind every personal
link in every message sent to them.

Students who have opted out are excluded before anything else happens, so they
can never be picked up by a reminder.

### Reminder schedules

Choosing an event type loads a default schedule. A career fair is announced
thirty days out and reminded the day before with a preparation checklist; a
guest lecture gets a week; a CEO interaction gets briefing notes and a ninety
minute warning because the seats are scarce. All of it can be edited.

Each reminder carries:

- **Timing:** an offset from the event start, the event end, or the
  registration deadline. "1 day before the start", "2 hours after the end".
- **Audience:** everyone, registered students only, students yet to register,
  students who attended, registered but absent, or attended with no feedback
  yet.
- **Channel:** email, SMS or WhatsApp.
- **Template:** the wording, shared across every event that uses it.

If an event is created closer than the preset assumes, reminders whose time has
already passed are left out and reported, rather than silently shortening the
sequence. The invitation is the exception: it is pulled forward to a couple of
minutes from now, because otherwise nobody would ever hear about the event.

### The outbox

This is where a reminder becomes a real message. For each reminder and each
matching student, one row is written with the exact time it is due.

Two properties make the system safe to leave alone:

- **It is idempotent.** Each row is keyed on the reminder and the student, so
  running the process again, on every worker tick, after an edit, or after a
  restart, never produces a second copy of a reminder.
- **Audience is rechecked at send time.** A student who registers an hour
  before the day-before reminder still receives it. A student who withdraws
  does not, and the row records why it was skipped rather than vanishing.

Bodies are re-rendered against live event data immediately before delivery, so
a venue change that landed after scheduling is reflected in what actually goes
out.

Every row keeps its outcome: sent, waiting, failed with the error, skipped with
the reason, or withdrawn. Email opens and link clicks are recorded.

### The background worker

Every thirty seconds, it:

1. closes events that finished more than an hour ago, which is what releases
   their thank you and feedback messages;
2. brings the outbox in line with every live event, picking up new students,
   new reminders and changed timings;
3. sends what is due.

Ticks never overlap. A message that falls more than three hours behind is
dropped rather than sent late, and says so, because a reminder for an event
that has already started is worse than no reminder.

### Registration, capacity and the waiting list

Students reply through a personal link. Where an event has a capacity,
confirmations past the limit join a waiting list. A withdrawal promotes the
earliest waiting student automatically and sends them their confirmation, so
the released place is actually taken up. That is the job Career Services
otherwise does by hand on the morning of the event.

Registration and feedback links act only on a form submission, never on a bare
page load, so a mail scanner following a link cannot confirm a place on a
student's behalf.

### Templates

Twenty message templates ship with the system, covering every stage and with
copy written specifically for career fairs, mock interviews, CEO interactions
and MOU ceremonies. They are plain text with merge fields:

```
Dear {{student.first_name}},

{{event.name}} takes place tomorrow.

{{#if event.meeting_link}}Join here: {{event.meeting_link}}
{{else}}Venue: {{event.venue}}
{{/if}}
```

The editor lists every available field and previews the result against sample
data as you type. A template with an unbalanced section or a misspelled field
will not save.

Editing a standard template keeps your wording through upgrades, and the
original can be restored at any time.

### Channels

Email goes out over SMTP, wrapped in a plain institutional layout that survives
Outlook, Gmail and a phone on campus wifi. SMS and WhatsApp post a small JSON
payload to a gateway URL, so the campus can use whichever provider it has
contracted without the system needing to know about it. A channel with nothing
configured records its messages in full and sends nothing.

---

## Project layout

```
server/
  index.js              express app, startup, shutdown
  config.js             environment
  db/
    schema.sql          the whole data model, commented
    seed.js             demonstration data
  lib/
    datetime.js         timezone conversion, formatting
    template.js         the merge-field language
    csv.js              RFC 4180 reading and writing
    ics.js              calendar files
    render.js           student-facing page shell
  services/
    events.js           event validation and lifecycle
    audience.js         resolving who an event targets
    rules.js            reminder schedules
    reminder-presets.js the default schedule per event type
    outbox.js           materialisation and dispatch
    scheduler.js        the background worker
    workflow.js         publish, cancel, complete
    registrations.js    responses, capacity, attendance
    feedback.js         the built-in form
    templates.js        template storage and validation
    system-templates.js the shipped message copy
    stats.js            dashboard and report figures
    channels/           email, SMS, WhatsApp
  routes/
    api/                the JSON API
    public.js           student registration and feedback
    legal.js            privacy and terms
    auth.js             staff sign in
public/
  index.html            the console shell
  assets/
    tokens.css          design tokens
    console.css         staff console
    public.css          student pages
    js/                 ES modules, no build step
test/                   38 tests
```

---

## What it deliberately does not do

- **It does not read replies.** A student who answers a reminder by email
  reaches the Career Services inbox, as they should.
- **It does not hold documents.** CVs and slide decks live where they already
  live; put the link in the event description.
- **It does not decide who to invite.** That stays with the team.
- **It does not unsubscribe a student on a single click.** Opt-out requests go
  to the team, so that nobody is dropped from placement communication by a
  mis-tap. The privacy notice says so plainly.

---

## Data protection

The system holds student names, campus identifiers, contact details, academic
details, event responses, attendance and feedback, plus a delivery record for
every message. The privacy notice at `/privacy` sets out what is held, why, for
how long, and how a student asks to see or correct it. The terms of use are at
`/terms`. Both are linked from every student-facing page and from the console.

Email open tracking and link click tracking are used to tell whether a reminder
reached students. There are no third party scripts anywhere, and the pages set
no cookies except the staff session.
