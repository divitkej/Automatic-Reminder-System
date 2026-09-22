'use strict';

/**
 * The message copy that ships with the system.
 *
 * These are installed into the `templates` table on first start and refreshed
 * on every start unless a member of staff has edited them, so an upgrade
 * improves the standard wording without overwriting local edits.
 *
 * Bodies are plain text. The email channel wraps the rendered text in a simple
 * institutional HTML layout; SMS and WhatsApp send the text as it stands, which
 * is why those bodies are kept short and put the essential facts first.
 */

const SIGN_OFF = `{{org.name}}
{{org.email}} | {{org.phone}}`;

const EVENT_BLOCK = `Event: {{event.name}}
{{#if event.company}}Organisation: {{event.company}}
{{/if}}{{#if event.speaker}}Speaker: {{event.speaker}}{{#if event.speaker_title}}, {{event.speaker_title}}{{/if}}
{{/if}}Date: {{event.date_full}}
Time: {{event.time_range}} ({{event.timezone_label}})
Mode: {{event.mode_label}}
{{#if event.venue}}Venue: {{event.venue}}
{{/if}}{{#if event.meeting_link}}Meeting link: {{event.meeting_link}}
{{/if}}`;

const templates = [
  // -------------------------------------------------------------------------
  // Invitation and registration
  // -------------------------------------------------------------------------
  {
    key: 'sys_invitation_email',
    name: 'Invitation and registration request',
    category: 'invitation',
    channel: 'email',
    subject: 'Invitation: {{event.name}}, {{event.date_long}}',
    description: 'First contact. Introduces the event and asks the student to confirm a place.',
    body: `Dear {{student.first_name}},

Career Services invites you to {{event.name}}{{#if event.company}}, hosted with {{event.company}}{{/if}}.

${EVENT_BLOCK}
{{#if event.description}}
About this session:
{{event.description}}
{{/if}}
{{#if event.registration_required}}Places are confirmed in the order responses are received{{#if event.capacity}} and this session is limited to {{event.capacity}} students{{/if}}. Please tell us whether you will attend:

Confirm my place: {{links.register}}
I cannot attend: {{links.decline}}
{{#if event.registration_deadline}}
Registration closes on {{event.registration_deadline}}.
{{/if}}{{else}}No registration is needed. Full details are here: {{links.details}}
{{/if}}
{{#if event.preparation_notes}}
Before you attend:
{{event.preparation_notes}}
{{/if}}
Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_invitation_sms',
    name: 'Invitation, SMS',
    category: 'invitation',
    channel: 'sms',
    subject: null,
    description: 'Short invitation for students who are better reached by text.',
    body: `{{org.short_name}}, BITS Pilani Dubai: {{event.name}} on {{event.date_long}}, {{event.start_time_12}}{{#if event.venue}} at {{event.venue}}{{/if}}. Confirm your place: {{links.register}}`,
  },
  {
    key: 'sys_invitation_mou_email',
    name: 'Invitation, MOU signing ceremony',
    category: 'invitation',
    channel: 'email',
    event_type: 'mou_signing',
    subject: 'Invitation: MOU signing with {{event.company}}, {{event.date_long}}',
    description: 'Ceremony invitation with the protocol notes an MOU signing needs.',
    body: `Dear {{student.first_name}},

You are invited to attend the signing of a Memorandum of Understanding between BITS Pilani, Dubai Campus and {{event.company}}.

${EVENT_BLOCK}
{{#if event.description}}
{{event.description}}
{{/if}}
Please note the following:

1. Guests are requested to be seated fifteen minutes before the ceremony begins.
2. {{#if event.dress_code}}Dress code: {{event.dress_code}}.{{else}}Formal attire is expected.{{/if}}
3. Photography during the signing is handled by the campus media team.

Confirm your attendance: {{links.register}}
I cannot attend: {{links.decline}}

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_registration_chase_email',
    name: 'Registration chase',
    category: 'invitation',
    channel: 'email',
    subject: 'Response needed: {{event.name}}, {{event.date_long}}',
    description: 'Sent only to students who have not yet responded to the invitation.',
    body: `Dear {{student.first_name}},

We have not yet had your response for {{event.name}} on {{event.date_full}}.

${EVENT_BLOCK}
{{#if event.capacity}}Places are limited to {{event.capacity}} students.
{{/if}}{{#if event.registration_deadline}}Registration closes on {{event.registration_deadline}}.
{{/if}}
Confirm my place: {{links.register}}
I cannot attend: {{links.decline}}

If you have already replied, please ignore this message.

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_confirmation_email',
    name: 'Registration confirmation',
    category: 'confirmation',
    channel: 'email',
    subject: 'Confirmed: {{event.name}}, {{event.date_long}}',
    description: 'Sent the moment a student confirms a place.',
    body: `Dear {{student.first_name}},

Your place at {{event.name}} is confirmed.

${EVENT_BLOCK}
{{#if event.is_online}}Please join a few minutes early and use your campus email address to sign in.
{{/if}}{{#if event.is_in_person}}Please carry your campus identity card for entry.
{{/if}}{{#if event.preparation_notes}}
Before you attend:
{{event.preparation_notes}}
{{/if}}{{#if event.dress_code}}
Dress code: {{event.dress_code}}
{{/if}}
Add this to your calendar: {{links.calendar}}

If your plans change, please let us know here: {{links.decline}}

Regards,

${SIGN_OFF}`,
  },

  // -------------------------------------------------------------------------
  // Reminders
  // -------------------------------------------------------------------------
  {
    key: 'sys_reminder_week_email',
    name: 'Reminder, one week out',
    category: 'reminder',
    channel: 'email',
    subject: 'Next week: {{event.name}}, {{event.date_long}}',
    description: 'Early reminder that leaves time to prepare.',
    body: `Dear {{student.first_name}},

A reminder that {{event.name}} takes place {{event.starts_in}}.

${EVENT_BLOCK}
{{#if event.preparation_notes}}
To get the most from the session:
{{event.preparation_notes}}
{{/if}}
Full details: {{links.details}}

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_reminder_day_email',
    name: 'Reminder, day before',
    category: 'reminder',
    channel: 'email',
    subject: 'Tomorrow: {{event.name}}, {{event.time_range}}',
    description: 'The main reminder. Repeats every joining detail so nothing has to be searched for.',
    body: `Dear {{student.first_name}},

{{event.name}} takes place tomorrow.

${EVENT_BLOCK}
{{#if event.is_online}}Joining notes:

1. Open the meeting link a few minutes before the start time.
2. Sign in with your campus email address.
3. Keep your microphone muted until the question and answer section.
{{/if}}{{#if event.is_in_person}}Please carry your campus identity card and arrive ten minutes early.
{{/if}}{{#if event.dress_code}}
Dress code: {{event.dress_code}}
{{/if}}{{#if event.preparation_notes}}
Please bring:
{{event.preparation_notes}}
{{/if}}
If you can no longer attend, tell us here so the place can be offered to another student: {{links.decline}}

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_reminder_day_career_fair_email',
    name: 'Reminder, day before a career fair',
    category: 'reminder',
    channel: 'email',
    event_type: 'career_fair',
    subject: 'Tomorrow: {{event.name}}, {{event.time_range}}',
    description: 'Career fair reminder covering CVs, dress and the employer floor.',
    body: `Dear {{student.first_name}},

{{event.name}} opens tomorrow.

${EVENT_BLOCK}
Please come prepared:

1. Bring at least ten printed copies of your CV.
2. {{#if event.dress_code}}Dress code: {{event.dress_code}}.{{else}}Business formal dress is expected.{{/if}}
3. Carry your campus identity card. It is required for entry.
4. Prepare a ninety second introduction covering your programme, your project work and the roles you are seeking.
5. Note the three employers you most want to meet and visit them first.

{{#if event.description}}{{event.description}}

{{/if}}The floor stays open for the full duration, so you do not need to arrive at the opening minute, but the quietest time to speak with recruiters is the first hour.

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_reminder_day_mock_interview_email',
    name: 'Reminder, day before a mock interview',
    category: 'reminder',
    channel: 'email',
    event_type: 'mock_interview',
    subject: 'Tomorrow: your mock interview, {{event.time_range}}',
    description: 'Interview specific reminder with the preparation checklist.',
    body: `Dear {{student.first_name}},

Your mock interview is tomorrow.

${EVENT_BLOCK}
Please prepare the following:

1. A printed copy of the CV you want the panel to work from.
2. Two examples of project or internship work you can talk through in detail.
3. Two questions you would genuinely ask an employer.
4. {{#if event.dress_code}}Dress code: {{event.dress_code}}.{{else}}Business formal dress.{{/if}}

{{#if event.is_online}}Test your camera and microphone before the session and join from a quiet room with a plain background.
{{/if}}{{#if event.is_in_person}}Please report to the venue ten minutes before your slot.
{{/if}}
Slots cannot be reallocated on the day, so if you cannot attend, tell us now: {{links.decline}}

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_reminder_day_ceo_interaction_email',
    name: 'Reminder, day before a CEO interaction',
    category: 'reminder',
    channel: 'email',
    event_type: 'ceo_interaction',
    subject: 'Tomorrow: {{event.name}} with {{event.speaker}}',
    description: 'Reminder for a curated leadership session where seats are scarce.',
    body: `Dear {{student.first_name}},

{{event.name}} takes place tomorrow{{#if event.speaker}} with {{event.speaker}}{{#if event.speaker_title}}, {{event.speaker_title}}{{/if}}{{/if}}.

${EVENT_BLOCK}
This is a small session and your seat was allocated from a longer list of applicants, so please:

1. Arrive ten minutes early. Latecomers cannot be admitted once the session begins.
2. Read briefly about {{#if event.company}}{{event.company}}{{else}}the speaker's organisation{{/if}} beforehand.
3. Prepare one considered question. There is time for only a handful.
4. {{#if event.dress_code}}Dress code: {{event.dress_code}}.{{else}}Business formal dress is expected.{{/if}}

If you cannot attend, release your seat here: {{links.decline}}

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_reminder_hour_email',
    name: 'Reminder, starting soon',
    category: 'reminder',
    channel: 'email',
    subject: 'Starting soon: {{event.name}}, {{event.start_time_12}}',
    description: 'Final short reminder with only the joining information.',
    body: `Dear {{student.first_name}},

{{event.name}} starts {{event.starts_in}}, at {{event.start_time_12}} ({{event.timezone_label}}).

{{#if event.meeting_link}}Join here: {{event.meeting_link}}
{{/if}}{{#if event.venue}}Venue: {{event.venue}}
{{/if}}
See you there.

${SIGN_OFF}`,
  },
  {
    key: 'sys_reminder_sms',
    name: 'Reminder, SMS',
    category: 'reminder',
    channel: 'sms',
    subject: null,
    description: 'Short text reminder. Keep under 320 characters.',
    body: `{{org.short_name}}: {{event.name}} starts {{event.starts_in}} at {{event.start_time_12}}{{#if event.venue}}, {{event.venue}}{{/if}}.{{#if event.meeting_link}} Join: {{event.meeting_link}}{{/if}}`,
  },
  {
    key: 'sys_reminder_whatsapp',
    name: 'Reminder, WhatsApp',
    category: 'reminder',
    channel: 'whatsapp',
    subject: null,
    description: 'WhatsApp reminder with a little more room than SMS.',
    body: `*{{event.name}}*
{{event.date_long}}, {{event.time_range}} ({{event.timezone_label}})
{{#if event.venue}}Venue: {{event.venue}}
{{/if}}{{#if event.meeting_link}}Join: {{event.meeting_link}}
{{/if}}
This is a reminder from {{org.short_name}}, BITS Pilani Dubai Campus.`,
  },

  // -------------------------------------------------------------------------
  // Changes and cancellation
  // -------------------------------------------------------------------------
  {
    key: 'sys_update_email',
    name: 'Event update',
    category: 'update',
    channel: 'email',
    subject: 'Updated details: {{event.name}}, {{event.date_long}}',
    description: 'Sent when the date, time, venue or joining link changes.',
    body: `Dear {{student.first_name}},

The details for {{event.name}} have changed. The current arrangements are below and replace anything sent earlier.

${EVENT_BLOCK}
{{#if event.description}}
{{event.description}}
{{/if}}
Full details: {{links.details}}

We are sorry for the change of plan.

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_cancellation_email',
    name: 'Event cancellation',
    category: 'cancellation',
    channel: 'email',
    subject: 'Cancelled: {{event.name}}, {{event.date_long}}',
    description: 'Withdraws an event and stops every pending reminder.',
    body: `Dear {{student.first_name}},

{{event.name}}, scheduled for {{event.date_full}}, has been cancelled.

{{#if event.cancellation_reason}}{{event.cancellation_reason}}

{{/if}}No action is needed from you. If the session is rescheduled we will write to you again with the new arrangements.

We are sorry for the inconvenience.

Regards,

${SIGN_OFF}`,
  },

  // -------------------------------------------------------------------------
  // After the event
  // -------------------------------------------------------------------------
  {
    key: 'sys_post_event_email',
    name: 'Thank you, attended',
    category: 'post_event',
    channel: 'email',
    subject: 'Thank you for attending {{event.name}}',
    description: 'Sent to students marked present.',
    body: `Dear {{student.first_name}},

Thank you for attending {{event.name}}{{#if event.company}} with {{event.company}}{{/if}} on {{event.date_full}}.

{{#if event.speaker}}Our thanks also to {{event.speaker}}{{#if event.speaker_title}}, {{event.speaker_title}}{{/if}}, for giving their time.

{{/if}}Career Services runs sessions of this kind throughout the semester. Keep an eye on your campus email for the next one, and do come to the Career Services office if you would like to talk through anything raised today.

{{#if event.has_feedback}}We would value your view of the session: {{links.feedback}}

{{/if}}Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_post_event_absent_email',
    name: 'Missed you, registered but absent',
    category: 'post_event',
    channel: 'email',
    subject: 'We missed you at {{event.name}}',
    description: 'Sent to students who registered but were not marked present.',
    body: `Dear {{student.first_name}},

You had a place at {{event.name}} on {{event.date_full}}, but we did not record your attendance.

If something prevented you from coming, that is understood. We ask only that you release a place in advance next time, because these sessions are usually oversubscribed and another student could have used it.

If you did attend and the record is wrong, reply to this message and we will correct it.

The next Career Services sessions are announced by campus email.

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_feedback_email',
    name: 'Feedback request',
    category: 'feedback',
    channel: 'email',
    subject: 'Two minutes on {{event.name}}',
    description: 'The feedback form request, sent shortly after the event ends.',
    body: `Dear {{student.first_name}},

Thank you for attending {{event.name}}.

Your feedback decides what Career Services runs next semester and what we ask of the organisations we invite. The form takes about two minutes and asks four rating questions and two open ones.

Open the form: {{links.feedback}}

Responses are read by the Career Services team only and are reported to speakers in aggregate.

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_feedback_chase_email',
    name: 'Feedback reminder',
    category: 'feedback',
    channel: 'email',
    subject: 'Reminder: feedback on {{event.name}}',
    description: 'Sent only to students who attended and have not yet responded.',
    body: `Dear {{student.first_name}},

We have not yet received your feedback on {{event.name}}, held on {{event.date_full}}.

It takes about two minutes: {{links.feedback}}

This is the last message we will send about it.

Regards,

${SIGN_OFF}`,
  },
  {
    key: 'sys_feedback_sms',
    name: 'Feedback request, SMS',
    category: 'feedback',
    channel: 'sms',
    subject: null,
    description: 'Short feedback nudge.',
    body: `{{org.short_name}}: thank you for attending {{event.name}}. Two minutes of feedback would help us plan the next session: {{links.feedback}}`,
  },
];

module.exports = { templates, EVENT_BLOCK, SIGN_OFF };
