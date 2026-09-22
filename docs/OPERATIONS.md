# Running the system

Notes for whoever looks after this day to day.

## The weekly rhythm

**Setting up an event.** Create it, add the audience, check the reminder
schedule, publish. The readiness panel on the event page lists anything
blocking publication and, separately, anything merely worth a look. Nothing is
sent while an event is a draft, so there is no risk in setting one up early.

**While it is live.** Nothing to do. The dashboard shows what goes out next and
flags anything that needs attention. The registration figures on the event page
update as students reply.

**On the day.** Open the event's attendance tab. "Mark everyone present" and
then correcting the exceptions is usually quicker than the other way round. For
a career fair, import the door scan as a CSV instead: unknown campus IDs are
reported rather than guessed at, and students who turn up without registering
are added as walk-ins.

**Afterwards.** Close the event. That releases the thank you, the note to the
students who were absent, and the feedback form. If you forget, the worker
closes it an hour after it finishes.

## Things that go wrong, and what to do

**A student says they never got the invitation.** Open the student's page. It
lists every message sent to them, with the delivery outcome, whether the email
was opened, and whether a link was followed. If the row says "skipped", the
reason is on it, usually a missing email address or an opt-out.

**The venue changed.** Edit the event. Every pending reminder is retimed and
re-rendered automatically. The console then offers to send an update notice to
students holding a place. Send it: they are working from the message you sent
last week, not from the event page.

**The event is cancelled.** Use "Cancel event" rather than deleting it. Pending
messages are withdrawn, a cancellation notice goes to the whole audience, and
the record stays for reporting.

**A reminder is going to the wrong people.** Change its audience on the
reminders tab. Copies already sent stay in the record; copies still waiting are
rebuilt for the new audience on the next worker pass.

**Messages are showing as failed.** The outbox shows the provider's error on
each row. Fix the cause, then use "Send now" on the individual message, or wait
for the worker to retry. It gives up after three attempts.

**Nothing is being sent at all.** Check the settings screen. Either the
background worker is not running, or dry run is still on. Both are stated
plainly at the top of that screen and on the dashboard.

**The server was down when reminders were due.** Anything less than three hours
late is sent as soon as the worker starts again. Anything older is marked
skipped, with the reason, rather than sent at the wrong time. The window is
`SCHEDULER_MAX_LATENESS_MINUTES`.

## Importing students

A CSV needs a campus ID, a name and an email address. Everything else is
optional. Column names are matched loosely, so "Student ID", "student_id" and
"BITS ID" all work.

Rows are matched on campus ID, so re-uploading a corrected export updates the
existing records rather than duplicating them. If any row is unreadable, the
whole file is rejected and each problem is listed by line number. Nothing is
half-imported.

## Backups

Everything is in one SQLite file, by default `data/reminders.db`. Copy it. With
the server stopped, the file alone is enough. With the server running, use
`sqlite3 data/reminders.db ".backup backup.db"`, which is safe against a live
writer.

## Upgrading

Stop the server, pull, `npm install`, start. The schema is applied on startup
and standard message templates are refreshed, except any you have edited, which
keep your wording.
