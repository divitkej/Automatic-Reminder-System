'use strict';

const { getDb, transaction } = require('../db');
const { newId } = require('../lib/ids');
const { nowIso } = require('../lib/datetime');
const { NotFoundError, ValidationError, ConflictError } = require('../lib/errors');
const tpl = require('../lib/template');
const { sampleContext, fieldCatalogue } = require('./context');
const { templates: systemTemplates } = require('./system-templates');

/**
 * Install or refresh the templates that ship with the system.
 *
 * A system template is refreshed on every start so that improvements to the
 * standard wording arrive with an upgrade, unless a member of staff has edited
 * it, which is recorded by updated_at moving past created_at. Local wording
 * always wins.
 */
function installSystemTemplates() {
  const db = getDb();
  const at = nowIso();
  let installed = 0;
  let refreshed = 0;
  let preserved = 0;

  transaction(() => {
    for (const item of systemTemplates) {
      const existing = db.prepare('SELECT * FROM templates WHERE key = ?').get(item.key);
      if (!existing) {
        db.prepare(`
          INSERT INTO templates (id, key, name, category, channel, event_type, subject, body,
                                 description, is_system, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(newId('tpl'), item.key, item.name, item.category, item.channel,
          item.event_type || null, item.subject || null, item.body, item.description || null, at, at);
        installed += 1;
        continue;
      }
      const edited = existing.updated_at !== existing.created_at;
      if (edited) {
        preserved += 1;
        continue;
      }
      const unchanged = existing.body === item.body
        && (existing.subject || null) === (item.subject || null)
        && existing.name === item.name;
      if (unchanged) continue;
      db.prepare(`
        UPDATE templates SET name = ?, category = ?, channel = ?, event_type = ?,
                             subject = ?, body = ?, description = ?,
                             created_at = ?, updated_at = ?
        WHERE id = ?
      `).run(item.name, item.category, item.channel, item.event_type || null,
        item.subject || null, item.body, item.description || null, at, at, existing.id);
      refreshed += 1;
    }
  });

  return { installed, refreshed, preserved };
}

function list({ category, channel, eventType } = {}) {
  const clauses = [];
  const params = [];
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (channel) { clauses.push('channel = ?'); params.push(channel); }
  if (eventType) { clauses.push('(event_type IS NULL OR event_type = ?)'); params.push(eventType); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM templates ${where} ORDER BY category, channel, name COLLATE NOCASE`)
    .all(...params);
}

function get(id) {
  const row = getDb().prepare('SELECT * FROM templates WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Template');
  return row;
}

function getByKey(key) {
  return getDb().prepare('SELECT * FROM templates WHERE key = ?').get(key) || null;
}

/**
 * Pick the template a new reminder rule should use: the one written for this
 * event type if there is one, otherwise the general template for the category
 * and channel.
 */
function resolveForRule({ templateKey, category, channel, eventType }) {
  if (templateKey) {
    const byKey = getByKey(templateKey);
    if (byKey && (!byKey.event_type || !eventType || byKey.event_type === eventType)) {
      return byKey;
    }
    if (byKey && byKey.event_type && eventType && byKey.event_type !== eventType) {
      // The key names copy written for a different event type. System keys are
      // built as sys_<slot>_<event type>_<channel>, so removing the type
      // segment gives the general version of the same message.
      const generic = getByKey(byKey.key.replace(`_${byKey.event_type}_`, '_'));
      if (generic) return generic;
    }
  }
  if (eventType) {
    const specific = getDb()
      .prepare(`SELECT * FROM templates WHERE category = ? AND channel = ? AND event_type = ?
                ORDER BY is_system DESC, key LIMIT 1`)
      .get(category, channel, eventType);
    if (specific) return specific;
  }
  return getDb()
    .prepare(`SELECT * FROM templates WHERE category = ? AND channel = ? AND event_type IS NULL
              ORDER BY is_system DESC, key LIMIT 1`)
    .get(category, channel) || null;
}

function validateBody({ subject, body, channel }) {
  const fields = fieldCatalogue();
  const problems = [];
  const bodyCheck = tpl.validateTemplate(body, fields);
  problems.push(...bodyCheck.problems);
  if (subject) {
    const subjectCheck = tpl.validateTemplate(subject, fields);
    problems.push(...subjectCheck.problems.map((p) => `Subject: ${p}`));
  }
  if (channel === 'email' && !String(subject || '').trim()) {
    problems.push('An email template needs a subject line.');
  }
  if (!String(body || '').trim()) problems.push('The message body is empty.');
  return { valid: problems.length === 0, problems };
}

function create(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new ValidationError('A template name is required.');
  const channel = input.channel || 'email';
  const category = input.category;
  const check = validateBody({ subject: input.subject, body: input.body, channel });
  if (!check.valid) throw new ValidationError(check.problems[0], check.problems);

  const key = String(input.key || '').trim() || `tpl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
  if (getByKey(key)) throw new ConflictError(`A template with the key "${key}" already exists.`);

  const id = newId('tpl');
  const at = nowIso();
  getDb().prepare(`
    INSERT INTO templates (id, key, name, category, channel, event_type, subject, body,
                           description, is_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, key, name, category, channel, input.event_type || null,
    input.subject || null, input.body, input.description || null, at, at);
  return get(id);
}

function update(id, input) {
  const existing = get(id);
  const next = {
    name: input.name !== undefined ? String(input.name).trim() : existing.name,
    category: input.category !== undefined ? input.category : existing.category,
    channel: input.channel !== undefined ? input.channel : existing.channel,
    event_type: input.event_type !== undefined ? (input.event_type || null) : existing.event_type,
    subject: input.subject !== undefined ? (input.subject || null) : existing.subject,
    body: input.body !== undefined ? input.body : existing.body,
    description: input.description !== undefined ? (input.description || null) : existing.description,
  };
  if (!next.name) throw new ValidationError('A template name is required.');
  const check = validateBody(next);
  if (!check.valid) throw new ValidationError(check.problems[0], check.problems);

  getDb().prepare(`
    UPDATE templates SET name = @name, category = @category, channel = @channel,
                         event_type = @event_type, subject = @subject, body = @body,
                         description = @description, updated_at = @updated_at
    WHERE id = @id
  `).run({ ...next, id, updated_at: nowIso() });
  return get(id);
}

function remove(id) {
  const existing = get(id);
  if (existing.is_system) {
    throw new ConflictError('A template that ships with the system cannot be deleted. Edit it instead, or add your own alongside it.');
  }
  const inUse = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM reminder_rules r
              JOIN events e ON e.id = r.event_id
              WHERE r.template_id = ? AND e.status IN ('draft', 'scheduled')`)
    .get(id).n;
  if (inUse > 0) {
    throw new ConflictError(`This template is used by ${inUse} reminder${inUse === 1 ? '' : 's'} on events that have not finished yet.`);
  }
  getDb().prepare('DELETE FROM templates WHERE id = ?').run(id);
}

/** Restore a system template to the wording it shipped with. */
function resetToSystem(id) {
  const existing = get(id);
  const original = systemTemplates.find((t) => t.key === existing.key);
  if (!original) throw new ValidationError('This template did not ship with the system, so there is nothing to restore.');
  const at = nowIso();
  getDb().prepare(`
    UPDATE templates SET name = ?, category = ?, channel = ?, event_type = ?,
                         subject = ?, body = ?, description = ?, created_at = ?, updated_at = ?
    WHERE id = ?
  `).run(original.name, original.category, original.channel, original.event_type || null,
    original.subject || null, original.body, original.description || null, at, at, id);
  return get(id);
}

/** Render a template against sample data for the editor's preview pane. */
function preview({ subject, body }, context = sampleContext()) {
  return {
    subject: tpl.render(subject || '', context),
    body: tpl.tidy(tpl.render(body || '', context)),
  };
}

module.exports = {
  installSystemTemplates, list, get, getByKey, resolveForRule,
  create, update, remove, resetToSystem, preview, validateBody,
};
