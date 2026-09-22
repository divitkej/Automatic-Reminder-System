'use strict';

const { getDb, transaction } = require('../db');
const { newId } = require('../lib/ids');
const dt = require('../lib/datetime');
const { NotFoundError, ValidationError } = require('../lib/errors');
const { AUDIENCE_RULES, MESSAGE_CATEGORIES, CHANNELS, ANCHORS, labelFor } = require('../lib/constants');
const events = require('./events');
const templates = require('./templates');
const activity = require('./activity');
const { presetFor, fitPresetToEvent } = require('./reminder-presets');

const CATEGORY_VALUES = MESSAGE_CATEGORIES.map((c) => c.value);
const CHANNEL_VALUES = CHANNELS.map((c) => c.value);
const AUDIENCE_VALUES = AUDIENCE_RULES.map((a) => a.value);
const ANCHOR_VALUES = ANCHORS.map((a) => a.value);

/** When a rule fires for a given event, as an absolute instant. */
function sendTimeFor(event, rule) {
  const anchors = {
    start: event.starts_at_utc,
    end: event.ends_at_utc,
    registration_close: event.registration_closes_at || event.starts_at_utc,
  };
  const base = new Date(anchors[rule.anchor] || event.starts_at_utc).getTime();
  return new Date(base + rule.offset_minutes * 60 * 1000);
}

function decorate(event, rule) {
  const sendAt = sendTimeFor(event, rule);
  const template = rule.template_id
    ? getDb().prepare('SELECT id, key, name, channel, subject FROM templates WHERE id = ?').get(rule.template_id)
    : null;
  const local = dt.utcToZoned(sendAt, event.timezone);
  return {
    ...rule,
    enabled: Boolean(rule.enabled),
    send_at_utc: sendAt.toISOString(),
    send_at_local: `${dt.formatLongDate(local.date)}, ${dt.formatTime12(local.time)}`,
    send_in: dt.relativeToNow(sendAt.toISOString()),
    is_past: sendAt.getTime() < Date.now(),
    offset_label: dt.humaniseOffset(rule.offset_minutes),
    anchor_label: labelFor(ANCHORS, rule.anchor),
    audience_label: labelFor(AUDIENCE_RULES, rule.audience_rule),
    category_label: labelFor(MESSAGE_CATEGORIES, rule.category),
    channel_label: labelFor(CHANNELS, rule.channel),
    template,
    template_missing: Boolean(rule.template_id) && !template,
  };
}

function list(eventId) {
  const event = events.get(eventId);
  return getDb()
    .prepare('SELECT * FROM reminder_rules WHERE event_id = ? ORDER BY sort_order, created_at')
    .all(eventId)
    .map((rule) => decorate(event, rule))
    .sort((a, b) => a.send_at_utc.localeCompare(b.send_at_utc));
}

function get(eventId, ruleId) {
  const rule = getDb().prepare('SELECT * FROM reminder_rules WHERE id = ? AND event_id = ?').get(ruleId, eventId);
  if (!rule) throw new NotFoundError('Reminder');
  return rule;
}

function cleanRule(input, { partial = false } = {}) {
  const out = {};
  const problems = [];
  const has = (key) => input[key] !== undefined;

  if (has('label') || !partial) {
    const label = String(input.label ?? '').trim();
    if (!label) problems.push('Give the reminder a label so the schedule reads clearly.');
    out.label = label;
  }
  if (has('category') || !partial) {
    if (!CATEGORY_VALUES.includes(input.category)) problems.push('Choose what kind of message this is.');
    out.category = input.category;
  }
  if (has('channel') || !partial) {
    const channel = input.channel || 'email';
    if (!CHANNEL_VALUES.includes(channel)) problems.push('Choose a channel.');
    out.channel = channel;
  }
  if (has('anchor') || !partial) {
    const anchor = input.anchor || 'start';
    if (!ANCHOR_VALUES.includes(anchor)) problems.push('Choose what the timing is measured from.');
    out.anchor = anchor;
  }
  if (has('audience_rule') || !partial) {
    const audience = input.audience_rule || 'all';
    if (!AUDIENCE_VALUES.includes(audience)) problems.push('Choose who this message goes to.');
    out.audience_rule = audience;
  }
  if (has('offset_minutes') || !partial) {
    const offset = Number.parseInt(input.offset_minutes, 10);
    if (!Number.isFinite(offset)) problems.push('The timing offset must be a whole number of minutes.');
    else if (Math.abs(offset) > 365 * 24 * 60) problems.push('The timing offset cannot be more than a year from the anchor.');
    else out.offset_minutes = offset;
  }
  if (has('enabled')) out.enabled = input.enabled ? 1 : 0;
  if (has('sort_order')) out.sort_order = Number.parseInt(input.sort_order, 10) || 0;

  if (problems.length) throw new ValidationError(problems[0], problems);
  return out;
}

/** Warnings that do not block saving but are worth showing in the interface. */
function warningsFor(event, rule) {
  const warnings = [];
  const sendAt = sendTimeFor(event, rule);
  if (sendAt.getTime() < Date.now() && event.status !== 'completed') {
    warnings.push('This send time has already passed, so nothing will go out for it.');
  }
  if (rule.anchor === 'start' && rule.offset_minutes > 0) {
    warnings.push('This is timed after the event starts. Use the event end as the anchor for post event messages.');
  }
  if (['attended', 'absent', 'awaiting_feedback'].includes(rule.audience_rule) && rule.offset_minutes < 0 && rule.anchor === 'start') {
    warnings.push('Attendance is not known before the event, so this will reach nobody.');
  }
  if (rule.channel === 'sms' || rule.channel === 'whatsapp') {
    const missing = getDb().prepare(`
      SELECT COUNT(*) AS n FROM registrations r
      JOIN students s ON s.id = r.student_id
      WHERE r.event_id = ? AND (s.phone IS NULL OR s.phone = '')
    `).get(event.id).n;
    if (missing > 0) warnings.push(`${missing} student${missing === 1 ? ' has' : 's have'} no phone number on record and will be skipped.`);
  }
  if (rule.category === 'feedback' && event.feedback_mode === 'none') {
    warnings.push('Feedback collection is switched off for this event.');
  }
  return warnings;
}

function create(eventId, input) {
  const event = events.get(eventId);
  const data = cleanRule(input);
  const template = input.template_id
    ? templates.get(input.template_id)
    : templates.resolveForRule({
      templateKey: input.template_key,
      category: data.category,
      channel: data.channel,
      eventType: event.type,
    });
  if (template && template.channel !== data.channel) {
    throw new ValidationError(`The chosen template is written for ${template.channel}, not ${data.channel}.`);
  }
  const id = newId('rul');
  const at = dt.nowIso();
  const maxOrder = getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM reminder_rules WHERE event_id = ?').get(eventId).n;

  getDb().prepare(`
    INSERT INTO reminder_rules (id, event_id, label, category, anchor, offset_minutes, channel,
                                template_id, audience_rule, enabled, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, eventId, data.label, data.category, data.anchor, data.offset_minutes, data.channel,
    template ? template.id : null, data.audience_rule,
    data.enabled === undefined ? 1 : data.enabled,
    data.sort_order === undefined ? maxOrder + 10 : data.sort_order, at, at);

  activity.log({ eventId, action: 'rule.created', detail: `${data.label} (${dt.humaniseOffset(data.offset_minutes)} ${data.anchor})` });
  return decorate(event, get(eventId, id));
}

function update(eventId, ruleId, input) {
  const event = events.get(eventId);
  const existing = get(eventId, ruleId);
  const data = cleanRule(input, { partial: true });

  if (input.template_id !== undefined) {
    if (input.template_id === null || input.template_id === '') {
      data.template_id = null;
    } else {
      const template = templates.get(input.template_id);
      const channel = data.channel || existing.channel;
      if (template.channel !== channel) {
        throw new ValidationError(`The chosen template is written for ${template.channel}, not ${channel}.`);
      }
      data.template_id = template.id;
    }
  } else if (data.channel && data.channel !== existing.channel) {
    // The channel changed but no template was named: move to the matching one.
    const replacement = templates.resolveForRule({
      category: data.category || existing.category,
      channel: data.channel,
      eventType: event.type,
    });
    data.template_id = replacement ? replacement.id : null;
  }

  const keys = Object.keys(data);
  if (keys.length === 0) return decorate(event, existing);

  getDb().prepare(`UPDATE reminder_rules SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...data, id: ruleId, updated_at: dt.nowIso() });

  activity.log({ eventId, action: 'rule.updated', detail: existing.label });
  return decorate(event, get(eventId, ruleId));
}

function remove(eventId, ruleId) {
  const existing = get(eventId, ruleId);
  transaction(() => {
    getDb().prepare(`UPDATE messages SET status = 'cancelled', skip_reason = 'The reminder was deleted', updated_at = ?
                     WHERE rule_id = ? AND status = 'scheduled'`).run(dt.nowIso(), ruleId);
    getDb().prepare('DELETE FROM reminder_rules WHERE id = ?').run(ruleId);
  });
  activity.log({ eventId, action: 'rule.deleted', detail: existing.label });
}

/**
 * Install the default schedule for an event's type. Rules whose send time has
 * already passed are left out and returned, so the interface can say what was
 * skipped instead of quietly shipping a shorter schedule than the preset name
 * implies. `referenceTime` moves the notion of "already passed", which is how a
 * historical event can be given the schedule it would have had.
 */
function applyPreset(eventId, { replace = false, referenceTime = Date.now() } = {}) {
  const event = events.get(eventId);
  const preset = presetFor(event.type);
  const { kept, dropped } = fitPresetToEvent(preset, {
    startsAtUtc: event.starts_at_utc,
    endsAtUtc: event.ends_at_utc,
    registrationClosesAt: event.registration_closes_at,
  }, referenceTime);

  const at = dt.nowIso();
  const created = [];

  transaction(() => {
    if (replace) {
      const existing = getDb().prepare('SELECT id FROM reminder_rules WHERE event_id = ?').all(eventId);
      for (const row of existing) remove(eventId, row.id);
    }
    for (const item of kept) {
      const template = templates.resolveForRule({
        templateKey: item.templateKey,
        category: item.category,
        channel: item.channel,
        eventType: event.type,
      });
      const id = newId('rul');
      getDb().prepare(`
        INSERT INTO reminder_rules (id, event_id, label, category, anchor, offset_minutes, channel,
                                    template_id, audience_rule, enabled, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(id, eventId, item.label, item.category, item.anchor, item.offsetMinutes, item.channel,
        template ? template.id : null, item.audienceRule, item.sortOrder, at, at);
      created.push(id);
    }
  });

  activity.log({
    eventId,
    action: 'rules.preset_applied',
    detail: `${created.length} reminders added from the ${event.type} schedule${dropped.length ? `, ${dropped.length} skipped as already past` : ''}`,
  });

  return { created: created.length, dropped: dropped.map((d) => d.label), rules: list(eventId) };
}

/** The rules whose template no longer suits the event type, after a type change. */
function realignTemplates(eventId) {
  const event = events.get(eventId);
  const rules = getDb().prepare('SELECT * FROM reminder_rules WHERE event_id = ?').all(eventId);
  let moved = 0;
  transaction(() => {
    for (const rule of rules) {
      if (!rule.template_id) continue;
      const template = getDb().prepare('SELECT * FROM templates WHERE id = ?').get(rule.template_id);
      if (!template || !template.event_type || template.event_type === event.type) continue;
      const replacement = templates.resolveForRule({
        templateKey: template.key,
        category: rule.category,
        channel: rule.channel,
        eventType: event.type,
      });
      if (replacement && replacement.id !== rule.template_id) {
        getDb().prepare('UPDATE reminder_rules SET template_id = ?, updated_at = ? WHERE id = ?')
          .run(replacement.id, dt.nowIso(), rule.id);
        moved += 1;
      }
    }
  });
  return moved;
}

module.exports = { list, get, create, update, remove, applyPreset, decorate, sendTimeFor, warningsFor, realignTemplates };
