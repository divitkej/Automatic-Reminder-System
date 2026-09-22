'use strict';

const { getDb, transaction } = require('../db');
const { newId } = require('../lib/ids');
const { nowIso } = require('../lib/datetime');
const { buildWhere } = require('./student-filter');
const { NotFoundError, ValidationError, ConflictError } = require('../lib/errors');
const csv = require('../lib/csv');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const COLUMNS = ['campus_id', 'name', 'email', 'phone', 'program', 'discipline',
  'year_of_study', 'batch', 'cgpa', 'status', 'opted_out', 'notes'];

function cleanStudent(input, { partial = false } = {}) {
  const out = {};
  const problems = [];

  const take = (key, value) => {
    if (value === undefined) return;
    out[key] = value;
  };

  if (input.campus_id !== undefined) {
    const campusId = String(input.campus_id).trim().toUpperCase();
    if (!campusId) problems.push('A campus ID is required.');
    take('campus_id', campusId);
  } else if (!partial) {
    problems.push('A campus ID is required.');
  }

  if (input.name !== undefined) {
    const name = String(input.name).trim().replace(/\s+/g, ' ');
    if (!name) problems.push('A name is required.');
    take('name', name);
  } else if (!partial) {
    problems.push('A name is required.');
  }

  if (input.email !== undefined) {
    const email = String(input.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) problems.push(`"${input.email}" is not a valid email address.`);
    take('email', email);
  } else if (!partial) {
    problems.push('An email address is required.');
  }

  if (input.phone !== undefined) take('phone', String(input.phone).trim() || null);
  if (input.program !== undefined) take('program', String(input.program).trim() || null);
  if (input.discipline !== undefined) take('discipline', String(input.discipline).trim() || null);
  if (input.batch !== undefined) take('batch', String(input.batch).trim() || null);
  if (input.notes !== undefined) take('notes', String(input.notes).trim() || null);

  if (input.year_of_study !== undefined && input.year_of_study !== '') {
    const year = Number.parseInt(input.year_of_study, 10);
    if (!Number.isFinite(year) || year < 1 || year > 7) problems.push('Year of study must be between 1 and 7.');
    else take('year_of_study', year);
  } else if (input.year_of_study === '') {
    take('year_of_study', null);
  }

  if (input.cgpa !== undefined && input.cgpa !== '') {
    const cgpa = Number(input.cgpa);
    if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) problems.push('CGPA must be between 0 and 10.');
    else take('cgpa', cgpa);
  } else if (input.cgpa === '') {
    take('cgpa', null);
  }

  if (input.status !== undefined) {
    const status = String(input.status).trim().toLowerCase() || 'active';
    if (!['active', 'inactive', 'graduated'].includes(status)) problems.push(`Unknown student status: ${status}`);
    take('status', status);
  }

  if (input.opted_out !== undefined) {
    take('opted_out', ['1', 'true', 'yes', 'y'].includes(String(input.opted_out).toLowerCase()) ? 1 : 0);
  }

  if (problems.length) throw new ValidationError(problems[0], problems);
  return out;
}

function list({ filter = {}, limit = 200, offset = 0, orderBy = 'name' } = {}) {
  const where = buildWhere({ ...filter, includeOptedOut: true }, 's');
  const order = ['name', 'campus_id', 'created_at', 'discipline'].includes(orderBy) ? orderBy : 'name';
  const rows = getDb()
    .prepare(`SELECT * FROM students s WHERE ${where.sql} ORDER BY s.${order} COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...where.params, Math.min(Number(limit) || 200, 1000), Number(offset) || 0);
  const total = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM students s WHERE ${where.sql}`)
    .get(...where.params).n;
  return { rows, total };
}

/** Students matching a filter, used when resolving an audience. */
function matching(filter) {
  const where = buildWhere(filter, 's');
  return getDb()
    .prepare(`SELECT * FROM students s WHERE ${where.sql} ORDER BY s.name COLLATE NOCASE`)
    .all(...where.params);
}

function countMatching(filter) {
  const where = buildWhere(filter, 's');
  return getDb().prepare(`SELECT COUNT(*) AS n FROM students s WHERE ${where.sql}`).get(...where.params).n;
}

function get(id) {
  const row = getDb().prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Student');
  return row;
}

function findByCampusId(campusId) {
  return getDb().prepare('SELECT * FROM students WHERE campus_id = ?').get(String(campusId).trim().toUpperCase());
}

function create(input) {
  const data = cleanStudent(input);
  if (findByCampusId(data.campus_id)) {
    throw new ConflictError(`A student with campus ID ${data.campus_id} already exists.`);
  }
  const id = newId('stu');
  const at = nowIso();
  getDb().prepare(`
    INSERT INTO students (id, campus_id, name, email, phone, program, discipline,
                          year_of_study, batch, cgpa, status, opted_out, notes,
                          created_at, updated_at)
    VALUES (@id, @campus_id, @name, @email, @phone, @program, @discipline,
            @year_of_study, @batch, @cgpa, @status, @opted_out, @notes, @created_at, @updated_at)
  `).run({
    id,
    campus_id: data.campus_id,
    name: data.name,
    email: data.email,
    phone: data.phone ?? null,
    program: data.program ?? null,
    discipline: data.discipline ?? null,
    year_of_study: data.year_of_study ?? null,
    batch: data.batch ?? null,
    cgpa: data.cgpa ?? null,
    status: data.status ?? 'active',
    opted_out: data.opted_out ?? 0,
    notes: data.notes ?? null,
    created_at: at,
    updated_at: at,
  });
  return get(id);
}

function update(id, input) {
  const existing = get(id);
  const data = cleanStudent(input, { partial: true });
  const keys = Object.keys(data).filter((k) => COLUMNS.includes(k));
  if (keys.length === 0) return existing;

  if (data.campus_id && data.campus_id !== existing.campus_id) {
    const clash = findByCampusId(data.campus_id);
    if (clash && clash.id !== id) {
      throw new ConflictError(`A student with campus ID ${data.campus_id} already exists.`);
    }
  }
  const assignments = keys.map((k) => `${k} = @${k}`).join(', ');
  getDb().prepare(`UPDATE students SET ${assignments}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...data, id, updated_at: nowIso() });
  return get(id);
}

function remove(id) {
  get(id);
  getDb().prepare('DELETE FROM students WHERE id = ?').run(id);
}

/**
 * Import a CSV of students. Rows are matched on campus ID, so re-uploading a
 * corrected export updates the existing records instead of duplicating them.
 * The whole file is applied in one transaction: either every valid row lands or
 * none does, which keeps a half-imported cohort from being sent invitations.
 */
function importCsv(text, { updateExisting = true } = {}) {
  const { rows, headers } = csv.parseObjects(text);
  if (rows.length === 0) {
    throw new ValidationError('The file has a header row but no student rows.');
  }
  const required = ['campus_id', 'name', 'email'];
  const aliases = {
    campus_id: ['campus_id', 'student_id', 'id', 'bits_id', 'roll_no', 'roll_number'],
    name: ['name', 'student_name', 'full_name'],
    email: ['email', 'email_address', 'campus_email'],
    phone: ['phone', 'mobile', 'phone_number', 'contact'],
    program: ['program', 'programme', 'degree'],
    discipline: ['discipline', 'branch', 'department', 'major'],
    year_of_study: ['year_of_study', 'year', 'study_year'],
    batch: ['batch', 'admission_year', 'cohort'],
    cgpa: ['cgpa', 'gpa'],
    status: ['status'],
    notes: ['notes', 'remarks'],
  };
  const resolved = {};
  for (const [field, options] of Object.entries(aliases)) {
    const found = options.find((option) => headers.includes(option));
    if (found) resolved[field] = found;
  }
  const missing = required.filter((field) => !resolved[field]);
  if (missing.length) {
    throw new ValidationError(
      `The file is missing a column for: ${missing.join(', ')}. Columns found: ${headers.filter(Boolean).join(', ')}.`,
    );
  }

  const report = { created: 0, updated: 0, skipped: 0, errors: [], total: rows.length };
  const prepared = [];

  for (const row of rows) {
    const input = {};
    for (const [field, header] of Object.entries(resolved)) {
      input[field] = row[header];
    }
    try {
      prepared.push({ line: row.__line, data: cleanStudent(input) });
    } catch (error) {
      report.errors.push({ line: row.__line, message: error.message });
    }
  }

  const seen = new Set();
  for (const item of prepared) {
    if (seen.has(item.data.campus_id)) {
      report.errors.push({ line: item.line, message: `Campus ID ${item.data.campus_id} appears more than once in the file.` });
    }
    seen.add(item.data.campus_id);
  }

  if (report.errors.length) {
    report.applied = false;
    return report;
  }

  transaction(() => {
    for (const item of prepared) {
      const existing = findByCampusId(item.data.campus_id);
      if (existing) {
        if (updateExisting) {
          update(existing.id, item.data);
          report.updated += 1;
        } else {
          report.skipped += 1;
        }
      } else {
        create(item.data);
        report.created += 1;
      }
    }
  });
  report.applied = true;
  return report;
}

const EXPORT_COLUMNS = [
  { key: 'campus_id', label: 'Campus ID' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'program', label: 'Programme' },
  { key: 'discipline', label: 'Discipline' },
  { key: 'year_of_study', label: 'Year of study' },
  { key: 'batch', label: 'Batch' },
  { key: 'cgpa', label: 'CGPA' },
  { key: 'status', label: 'Status' },
  { key: 'opted_out', label: 'Opted out' },
];

function exportCsv(filter = {}) {
  const { rows } = list({ filter, limit: 10000 });
  return csv.stringify(EXPORT_COLUMNS, rows);
}

/** Distinct values used to populate the filter dropdowns. */
function facets() {
  const db = getDb();
  const pick = (column) => db
    .prepare(`SELECT DISTINCT ${column} AS value FROM students WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY ${column}`)
    .all()
    .map((r) => r.value);
  return {
    programs: pick('program'),
    disciplines: pick('discipline'),
    batches: pick('batch'),
    years: pick('year_of_study'),
  };
}

module.exports = {
  list, matching, countMatching, get, findByCampusId, create, update, remove,
  importCsv, exportCsv, facets, cleanStudent, EXPORT_COLUMNS,
};
