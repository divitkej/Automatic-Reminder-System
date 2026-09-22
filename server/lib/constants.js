'use strict';

/**
 * The event types Career Services runs. `defaultsKey` selects the reminder
 * schedule preset in server/services/reminder-presets.js, and the copy hints
 * steer which system template a new rule picks up.
 */
const EVENT_TYPES = [
  {
    value: 'career_readiness_workshop',
    label: 'Career Readiness Workshop',
    description: 'Cohort based skills sessions such as CV writing, LinkedIn and interview technique.',
    defaultMode: 'online',
    leadTimeDays: 14,
  },
  {
    value: 'company_talk',
    label: 'Company Talk',
    description: 'A recruiting or awareness session delivered by a visiting organisation.',
    defaultMode: 'in_person',
    leadTimeDays: 10,
  },
  {
    value: 'ceo_interaction',
    label: 'CEO Interaction',
    description: 'A senior leadership conversation, usually with limited seats and a curated audience.',
    defaultMode: 'in_person',
    leadTimeDays: 14,
  },
  {
    value: 'mou_signing',
    label: 'MOU Signing',
    description: 'A formal memorandum of understanding ceremony with an industry or academic partner.',
    defaultMode: 'in_person',
    leadTimeDays: 10,
  },
  {
    value: 'career_fair',
    label: 'Career Fair',
    description: 'A multi employer fair running across a half or full day.',
    defaultMode: 'in_person',
    leadTimeDays: 30,
  },
  {
    value: 'mock_interview',
    label: 'Mock Interview',
    description: 'Scheduled practice interviews with staff, alumni or recruiter panels.',
    defaultMode: 'in_person',
    leadTimeDays: 10,
  },
  {
    value: 'industry_session',
    label: 'Industry Session',
    description: 'A sector briefing or panel covering hiring trends and role expectations.',
    defaultMode: 'hybrid',
    leadTimeDays: 10,
  },
  {
    value: 'guest_lecture',
    label: 'Guest Lecture',
    description: 'A single academic or professional lecture by an external speaker.',
    defaultMode: 'in_person',
    leadTimeDays: 7,
  },
  {
    value: 'workshop',
    label: 'Workshop',
    description: 'A general hands on workshop that does not belong to a readiness cohort.',
    defaultMode: 'in_person',
    leadTimeDays: 10,
  },
];

const EVENT_TYPE_VALUES = EVENT_TYPES.map((t) => t.value);

const EVENT_MODES = [
  { value: 'in_person', label: 'In person' },
  { value: 'online', label: 'Online' },
  { value: 'hybrid', label: 'Hybrid' },
];

const EVENT_STATUSES = [
  { value: 'draft', label: 'Draft', hint: 'Nothing is sent while an event is a draft.' },
  { value: 'scheduled', label: 'Scheduled', hint: 'The reminder schedule is live.' },
  { value: 'completed', label: 'Completed', hint: 'The event has finished. Post event messages still run.' },
  { value: 'cancelled', label: 'Cancelled', hint: 'All pending messages are withdrawn.' },
];

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

const MESSAGE_CATEGORIES = [
  { value: 'invitation', label: 'Invitation' },
  { value: 'confirmation', label: 'Registration confirmation' },
  { value: 'reminder', label: 'Reminder' },
  { value: 'update', label: 'Update' },
  { value: 'post_event', label: 'Post event' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'cancellation', label: 'Cancellation' },
];

const AUDIENCE_RULES = [
  { value: 'all', label: 'Everyone in the audience', description: 'Every student the event targets.' },
  { value: 'registered', label: 'Registered students only', description: 'Students who confirmed a place.' },
  { value: 'unregistered', label: 'Students yet to register', description: 'Invited students with no response or a declined response.' },
  { value: 'attended', label: 'Students who attended', description: 'Requires attendance to be marked.' },
  { value: 'absent', label: 'Registered but absent', description: 'Registered students not marked present.' },
  { value: 'awaiting_feedback', label: 'Attended, feedback not received', description: 'Chase list for the feedback form.' },
];

const REGISTRATION_STATUSES = [
  { value: 'invited', label: 'Invited' },
  { value: 'registered', label: 'Registered' },
  { value: 'declined', label: 'Declined' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'cancelled', label: 'Cancelled' },
];

const ANCHORS = [
  { value: 'start', label: 'Event start' },
  { value: 'end', label: 'Event end' },
  { value: 'registration_close', label: 'Registration deadline' },
];

const PROGRAMS = ['B.E.', 'B.Pharm.', 'M.Sc.', 'M.E.', 'MBA', 'Ph.D.'];

const DISCIPLINES = [
  'Computer Science',
  'Electronics and Communication',
  'Electrical and Electronics',
  'Mechanical Engineering',
  'Chemical Engineering',
  'Civil Engineering',
  'Biotechnology',
  'Economics and Finance',
  'General Studies',
];

function eventTypeLabel(value) {
  const found = EVENT_TYPES.find((t) => t.value === value);
  return found ? found.label : value;
}

function labelFor(list, value) {
  const found = list.find((item) => item.value === value);
  return found ? found.label : value;
}

module.exports = {
  EVENT_TYPES,
  EVENT_TYPE_VALUES,
  EVENT_MODES,
  EVENT_STATUSES,
  CHANNELS,
  MESSAGE_CATEGORIES,
  AUDIENCE_RULES,
  REGISTRATION_STATUSES,
  ANCHORS,
  PROGRAMS,
  DISCIPLINES,
  eventTypeLabel,
  labelFor,
};
