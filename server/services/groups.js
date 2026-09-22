'use strict';

const { getDb, transaction } = require('../db');
const { newId } = require('../lib/ids');
const { nowIso } = require('../lib/datetime');
const { NotFoundError, ValidationError, ConflictError } = require('../lib/errors');
const { normaliseFilter, buildWhere, describeFilter } = require('./student-filter');
const students = require('./students');
const csv = require('../lib/csv');

function decorate(row) {
  if (!row) return row;
  const filter = row.filter_json ? JSON.parse(row.filter_json) : null;
  return {
    ...row,
    filter,
    filter_summary: row.kind === 'smart' ? describeFilter(filter || {}) : null,
    member_count: countMembers(row),
  };
}

function countMembers(group) {
  if (group.kind === 'smart') {
    return students.countMatching(group.filter_json ? JSON.parse(group.filter_json) : {});
  }
  return getDb()
    .prepare(`SELECT COUNT(*) AS n FROM group_members gm
              JOIN students s ON s.id = gm.student_id
              WHERE gm.group_id = ? AND s.status <> 'graduated'`)
    .get(group.id).n;
}

function list() {
  return getDb()
    .prepare('SELECT * FROM student_groups ORDER BY name COLLATE NOCASE')
    .all()
    .map(decorate);
}

function get(id) {
  const row = getDb().prepare('SELECT * FROM student_groups WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Student group');
  return decorate(row);
}

function getRaw(id) {
  const row = getDb().prepare('SELECT * FROM student_groups WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Student group');
  return row;
}

/**
 * The students in a group. A static group returns its explicit membership; a
 * smart group is recomputed from its filter every time it is read, so a group
 * such as "Final year, CGPA 7 and above" stays correct as records change.
 */
function members(id, { includeOptedOut = false } = {}) {
  const group = getRaw(id);
  if (group.kind === 'smart') {
    const filter = group.filter_json ? JSON.parse(group.filter_json) : {};
    return students.matching({ ...filter, includeOptedOut });
  }
  const optOutClause = includeOptedOut ? '' : ' AND s.opted_out = 0';
  return getDb()
    .prepare(`SELECT s.* FROM group_members gm
              JOIN students s ON s.id = gm.student_id
              WHERE gm.group_id = ?${optOutClause}
              ORDER BY s.name COLLATE NOCASE`)
    .all(id);
}

function create({ name, description, kind = 'static', filter = null, studentIds = [] }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new ValidationError('A group name is required.');
  if (!['static', 'smart'].includes(kind)) throw new ValidationError('A group is either static or smart.');
  if (kind === 'smart' && !filter) throw new ValidationError('A smart group needs a filter.');

  const clash = getDb().prepare('SELECT id FROM student_groups WHERE name = ? COLLATE NOCASE').get(cleanName);
  if (clash) throw new ConflictError(`A group called "${cleanName}" already exists.`);

  const id = newId('grp');
  const at = nowIso();
  transaction(() => {
    getDb().prepare(`
      INSERT INTO student_groups (id, name, description, kind, filter_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanName, String(description || '').trim() || null, kind,
      kind === 'smart' ? JSON.stringify(normaliseFilter(filter)) : null, at, at);
    if (kind === 'static' && studentIds.length) addMembers(id, studentIds);
  });
  return get(id);
}

function update(id, { name, description, filter, kind }) {
  const existing = getRaw(id);
  const fields = {};
  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) throw new ValidationError('A group name is required.');
    const clash = getDb().prepare('SELECT id FROM student_groups WHERE name = ? COLLATE NOCASE AND id <> ?').get(cleanName, id);
    if (clash) throw new ConflictError(`A group called "${cleanName}" already exists.`);
    fields.name = cleanName;
  }
  if (description !== undefined) fields.description = String(description).trim() || null;
  if (kind !== undefined) {
    if (!['static', 'smart'].includes(kind)) throw new ValidationError('A group is either static or smart.');
    fields.kind = kind;
  }
  if (filter !== undefined) {
    fields.filter_json = filter ? JSON.stringify(normaliseFilter(filter)) : null;
  }
  const targetKind = fields.kind || existing.kind;
  const targetFilter = fields.filter_json !== undefined ? fields.filter_json : existing.filter_json;
  if (targetKind === 'smart' && !targetFilter) throw new ValidationError('A smart group needs a filter.');

  const keys = Object.keys(fields);
  if (keys.length) {
    getDb().prepare(`UPDATE student_groups SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...fields, id, updated_at: nowIso() });
  }
  return get(id);
}

function remove(id) {
  getRaw(id);
  const inUse = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM event_audiences ea
              JOIN events e ON e.id = ea.event_id
              WHERE ea.kind = 'group' AND ea.ref_id = ? AND e.status IN ('draft', 'scheduled')`)
    .get(id).n;
  if (inUse > 0) {
    throw new ConflictError(`This group is the audience for ${inUse} event${inUse === 1 ? '' : 's'} that has not finished yet. Remove it from those events first.`);
  }
  getDb().prepare('DELETE FROM student_groups WHERE id = ?').run(id);
}

function addMembers(id, studentIds) {
  const group = getRaw(id);
  if (group.kind === 'smart') {
    throw new ValidationError('A smart group takes its members from its filter, so members cannot be added by hand.');
  }
  const at = nowIso();
  const stmt = getDb().prepare(`
    INSERT INTO group_members (group_id, student_id, added_at) VALUES (?, ?, ?)
    ON CONFLICT (group_id, student_id) DO NOTHING
  `);
  let added = 0;
  transaction(() => {
    for (const studentId of studentIds) {
      const exists = getDb().prepare('SELECT 1 FROM students WHERE id = ?').get(studentId);
      if (!exists) continue;
      added += stmt.run(id, studentId, at).changes;
    }
  });
  return added;
}

function removeMembers(id, studentIds) {
  const group = getRaw(id);
  if (group.kind === 'smart') {
    throw new ValidationError('A smart group takes its members from its filter, so members cannot be removed by hand.');
  }
  let removed = 0;
  const stmt = getDb().prepare('DELETE FROM group_members WHERE group_id = ? AND student_id = ?');
  transaction(() => {
    for (const studentId of studentIds) removed += stmt.run(id, studentId).changes;
  });
  return removed;
}

/** Replace a static group's membership with the students matching a filter. */
function setMembersFromFilter(id, filter) {
  const group = getRaw(id);
  if (group.kind === 'smart') {
    throw new ValidationError('A smart group already takes its members from a filter.');
  }
  const matched = students.matching({ ...filter, includeOptedOut: true });
  transaction(() => {
    getDb().prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
    addMembers(id, matched.map((s) => s.id));
  });
  return matched.length;
}

/**
 * Build a static group from a CSV of campus IDs. Students already on record are
 * matched; rows that do not match anything are reported rather than created, so
 * a typo in a cohort list never becomes a second copy of a student.
 */
function importMembersCsv(id, text) {
  getRaw(id);
  const { rows, headers } = csv.parseObjects(text);
  const idHeader = ['campus_id', 'student_id', 'id', 'bits_id', 'roll_no'].find((h) => headers.includes(h));
  if (!idHeader) {
    throw new ValidationError(`The file needs a campus ID column. Columns found: ${headers.filter(Boolean).join(', ')}.`);
  }
  const found = [];
  const unmatched = [];
  for (const row of rows) {
    const campusId = String(row[idHeader] || '').trim();
    if (!campusId) continue;
    const student = students.findByCampusId(campusId);
    if (student) found.push(student.id);
    else unmatched.push({ line: row.__line, campus_id: campusId });
  }
  const added = addMembers(id, found);
  return { matched: found.length, added, unmatched, total: rows.length };
}

function exportMembersCsv(id) {
  return csv.stringify(students.EXPORT_COLUMNS, members(id, { includeOptedOut: true }));
}

module.exports = {
  list, get, getRaw, members, create, update, remove,
  addMembers, removeMembers, setMembersFromFilter, importMembersCsv, exportMembersCsv,
  countMembers, decorate,
};
