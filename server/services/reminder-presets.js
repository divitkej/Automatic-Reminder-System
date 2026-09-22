'use strict';

/**
 * Default reminder schedules.
 *
 * Career Services should not have to design a schedule from scratch for every
 * event. Choosing an event type loads the sequence below, which staff can then
 * add to, remove from or retime. The sequences follow what the office already
 * sends by hand: an invitation, a chase for the students who have not replied,
 * a week out, the day before, a final nudge on the day, then thanks, a note to
 * the students who were absent, and the feedback form with one chase.
 */

const MIN = 1;
const HOUR = 60;
const DAY = 24 * 60;
const WEEK = 7 * DAY;

/** Shorthand for a rule definition. */
function rule(label, category, anchor, offsetMinutes, templateKey, audienceRule = 'all', channel = 'email') {
  return { label, category, anchor, offsetMinutes, templateKey, audienceRule, channel };
}

const AFTER_EVENT = [
  rule('Thank you for attending', 'post_event', 'end', 1 * HOUR, 'sys_post_event_email', 'attended'),
  rule('Note to registered students who did not attend', 'post_event', 'end', 4 * HOUR, 'sys_post_event_absent_email', 'absent'),
  rule('Feedback form', 'feedback', 'end', 2 * HOUR, 'sys_feedback_email', 'attended'),
  rule('Feedback reminder', 'feedback', 'end', 2 * DAY, 'sys_feedback_chase_email', 'awaiting_feedback'),
];

const STANDARD_BEFORE = [
  rule('Invitation and registration request', 'invitation', 'start', -14 * DAY, 'sys_invitation_email', 'all'),
  rule('Registration chase', 'invitation', 'start', -5 * DAY, 'sys_registration_chase_email', 'unregistered'),
  rule('One week to go', 'reminder', 'start', -1 * WEEK, 'sys_reminder_week_email', 'registered'),
  rule('Day before', 'reminder', 'start', -1 * DAY, 'sys_reminder_day_email', 'registered'),
  rule('Starting in one hour', 'reminder', 'start', -1 * HOUR, 'sys_reminder_hour_email', 'registered'),
];

const PRESETS = {
  career_readiness_workshop: [
    rule('Invitation and registration request', 'invitation', 'start', -14 * DAY, 'sys_invitation_email', 'all'),
    rule('Registration chase', 'invitation', 'start', -6 * DAY, 'sys_registration_chase_email', 'unregistered'),
    rule('One week to go', 'reminder', 'start', -1 * WEEK, 'sys_reminder_week_email', 'registered'),
    rule('Day before', 'reminder', 'start', -1 * DAY, 'sys_reminder_day_email', 'registered'),
    rule('Morning of the session', 'reminder', 'start', -8 * HOUR, 'sys_reminder_hour_email', 'registered'),
    rule('Joining link, fifteen minutes before', 'reminder', 'start', -15 * MIN, 'sys_reminder_hour_email', 'registered'),
    ...AFTER_EVENT,
  ],

  company_talk: [
    rule('Invitation and registration request', 'invitation', 'start', -10 * DAY, 'sys_invitation_email', 'all'),
    rule('Registration chase', 'invitation', 'start', -4 * DAY, 'sys_registration_chase_email', 'unregistered'),
    rule('Day before', 'reminder', 'start', -1 * DAY, 'sys_reminder_day_email', 'registered'),
    rule('Starting in two hours', 'reminder', 'start', -2 * HOUR, 'sys_reminder_hour_email', 'registered'),
    ...AFTER_EVENT,
  ],

  ceo_interaction: [
    rule('Invitation and application request', 'invitation', 'start', -14 * DAY, 'sys_invitation_email', 'all'),
    rule('Registration chase', 'invitation', 'start', -8 * DAY, 'sys_registration_chase_email', 'unregistered'),
    rule('One week to go', 'reminder', 'start', -1 * WEEK, 'sys_reminder_week_email', 'registered'),
    rule('Day before, with briefing notes', 'reminder', 'start', -1 * DAY, 'sys_reminder_day_ceo_interaction_email', 'registered'),
    rule('Ninety minutes before', 'reminder', 'start', -90 * MIN, 'sys_reminder_hour_email', 'registered'),
    ...AFTER_EVENT,
  ],

  mou_signing: [
    rule('Ceremony invitation', 'invitation', 'start', -10 * DAY, 'sys_invitation_mou_email', 'all'),
    rule('Attendance chase', 'invitation', 'start', -5 * DAY, 'sys_registration_chase_email', 'unregistered'),
    rule('Two days before', 'reminder', 'start', -2 * DAY, 'sys_reminder_day_email', 'registered'),
    rule('Two hours before', 'reminder', 'start', -2 * HOUR, 'sys_reminder_hour_email', 'registered'),
    rule('Thank you for attending', 'post_event', 'end', 2 * HOUR, 'sys_post_event_email', 'attended'),
  ],

  career_fair: [
    rule('Save the date', 'invitation', 'start', -30 * DAY, 'sys_invitation_email', 'all'),
    rule('Registration chase', 'invitation', 'start', -14 * DAY, 'sys_registration_chase_email', 'unregistered'),
    rule('One week to go', 'reminder', 'start', -1 * WEEK, 'sys_reminder_week_email', 'all'),
    rule('Day before, preparation checklist', 'reminder', 'start', -1 * DAY, 'sys_reminder_day_career_fair_email', 'all'),
    rule('Doors open in two hours', 'reminder', 'start', -2 * HOUR, 'sys_reminder_sms', 'all', 'sms'),
    rule('Thank you for attending', 'post_event', 'end', 3 * HOUR, 'sys_post_event_email', 'attended'),
    rule('Feedback form', 'feedback', 'end', 4 * HOUR, 'sys_feedback_email', 'attended'),
    rule('Feedback reminder', 'feedback', 'end', 3 * DAY, 'sys_feedback_chase_email', 'awaiting_feedback'),
  ],

  mock_interview: [
    rule('Invitation and slot booking', 'invitation', 'start', -10 * DAY, 'sys_invitation_email', 'all'),
    rule('Booking chase', 'invitation', 'start', -5 * DAY, 'sys_registration_chase_email', 'unregistered'),
    rule('Two days before, preparation checklist', 'reminder', 'start', -2 * DAY, 'sys_reminder_day_mock_interview_email', 'registered'),
    rule('Day before', 'reminder', 'start', -1 * DAY, 'sys_reminder_day_mock_interview_email', 'registered'),
    rule('Ninety minutes before', 'reminder', 'start', -90 * MIN, 'sys_reminder_sms', 'registered', 'sms'),
    rule('Thank you and next steps', 'post_event', 'end', 1 * HOUR, 'sys_post_event_email', 'attended'),
    rule('Note to students who missed their slot', 'post_event', 'end', 4 * HOUR, 'sys_post_event_absent_email', 'absent'),
    rule('Feedback form', 'feedback', 'end', 3 * HOUR, 'sys_feedback_email', 'attended'),
    rule('Feedback reminder', 'feedback', 'end', 2 * DAY, 'sys_feedback_chase_email', 'awaiting_feedback'),
  ],

  industry_session: [...STANDARD_BEFORE, ...AFTER_EVENT],
  guest_lecture: [
    rule('Invitation and registration request', 'invitation', 'start', -7 * DAY, 'sys_invitation_email', 'all'),
    rule('Registration chase', 'invitation', 'start', -3 * DAY, 'sys_registration_chase_email', 'unregistered'),
    rule('Day before', 'reminder', 'start', -1 * DAY, 'sys_reminder_day_email', 'registered'),
    rule('Starting in one hour', 'reminder', 'start', -1 * HOUR, 'sys_reminder_hour_email', 'registered'),
    rule('Thank you for attending', 'post_event', 'end', 2 * HOUR, 'sys_post_event_email', 'attended'),
    rule('Feedback form', 'feedback', 'end', 3 * HOUR, 'sys_feedback_email', 'attended'),
  ],
  workshop: [...STANDARD_BEFORE, ...AFTER_EVENT],
};

const DEFAULT_PRESET = [...STANDARD_BEFORE, ...AFTER_EVENT];

/** The untimed schedule for an event type. */
function presetFor(eventType) {
  const found = PRESETS[eventType] || DEFAULT_PRESET;
  return found.map((item, index) => ({ ...item, sortOrder: index * 10 }));
}

/**
 * Fit a preset to an event that may be closer than the preset assumes.
 *
 * A rule whose send time has already passed is useless, with one exception: if
 * the invitation itself is in the past the students have never been told about
 * the event at all, so it is pulled forward to a couple of minutes from now
 * instead of being dropped. Everything else that has passed is returned in
 * `dropped` so the interface can say what was left out rather than quietly
 * shortening the schedule.
 */
function fitPresetToEvent(preset, { startsAtUtc, endsAtUtc, registrationClosesAt }, now = Date.now()) {
  const anchors = {
    start: new Date(startsAtUtc).getTime(),
    end: new Date(endsAtUtc).getTime(),
    registration_close: registrationClosesAt ? new Date(registrationClosesAt).getTime() : null,
  };
  const floor = now + 2 * 60 * 1000;
  // Pulling an invitation forward only makes sense while there is still an
  // event to invite people to. For an event being recorded after the fact, the
  // whole schedule is history and none of it should be scheduled to send.
  const canStillInvite = anchors.start > now;
  const kept = [];
  const dropped = [];

  for (const item of preset) {
    const anchorTime = anchors[item.anchor] ?? anchors.start;
    const sendAt = anchorTime + item.offsetMinutes * 60 * 1000;
    if (sendAt >= now) {
      kept.push(item);
      continue;
    }
    if (canStillInvite && item.category === 'invitation' && item.audienceRule === 'all') {
      kept.push({
        ...item,
        offsetMinutes: Math.round((floor - anchorTime) / 60000),
        adjusted: true,
      });
      continue;
    }
    dropped.push(item);
  }
  return { kept, dropped };
}

module.exports = { presetFor, fitPresetToEvent, PRESETS, DEFAULT_PRESET, MIN, HOUR, DAY, WEEK };
