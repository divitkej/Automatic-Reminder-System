'use strict';

/**
 * Turns the audience filter used by smart groups, the student list screen and
 * ad hoc event targeting into a single parameterised WHERE clause, so the three
 * of them can never drift apart in what they consider a match.
 */

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((v) => String(v).trim()).filter(Boolean);
}

function normaliseFilter(input = {}) {
  const filter = {
    status: asArray(input.status),
    programs: asArray(input.programs ?? input.program),
    disciplines: asArray(input.disciplines ?? input.discipline),
    batches: asArray(input.batches ?? input.batch),
    years: asArray(input.years ?? input.year_of_study).map(Number).filter(Number.isFinite),
    minCgpa: input.minCgpa === undefined || input.minCgpa === null || input.minCgpa === ''
      ? null
      : Number(input.minCgpa),
    includeOptedOut: Boolean(input.includeOptedOut),
    search: String(input.search || '').trim(),
  };
  if (filter.minCgpa !== null && !Number.isFinite(filter.minCgpa)) filter.minCgpa = null;
  if (filter.status.length === 0) filter.status = ['active'];
  return filter;
}

/** WHERE fragment and bound parameters for a normalised filter. */
function buildWhere(filter, alias = 's') {
  const f = normaliseFilter(filter);
  const clauses = [];
  const params = [];

  if (f.status.length && !f.status.includes('any')) {
    clauses.push(`${alias}.status IN (${f.status.map(() => '?').join(', ')})`);
    params.push(...f.status);
  }
  if (f.programs.length) {
    clauses.push(`${alias}.program IN (${f.programs.map(() => '?').join(', ')})`);
    params.push(...f.programs);
  }
  if (f.disciplines.length) {
    clauses.push(`${alias}.discipline IN (${f.disciplines.map(() => '?').join(', ')})`);
    params.push(...f.disciplines);
  }
  if (f.batches.length) {
    clauses.push(`${alias}.batch IN (${f.batches.map(() => '?').join(', ')})`);
    params.push(...f.batches);
  }
  if (f.years.length) {
    clauses.push(`${alias}.year_of_study IN (${f.years.map(() => '?').join(', ')})`);
    params.push(...f.years);
  }
  if (f.minCgpa !== null) {
    clauses.push(`${alias}.cgpa IS NOT NULL AND ${alias}.cgpa >= ?`);
    params.push(f.minCgpa);
  }
  if (!f.includeOptedOut) {
    clauses.push(`${alias}.opted_out = 0`);
  }
  if (f.search) {
    clauses.push(`(${alias}.name LIKE ? OR ${alias}.email LIKE ? OR ${alias}.campus_id LIKE ?)`);
    const like = `%${f.search}%`;
    params.push(like, like, like);
  }

  return {
    sql: clauses.length ? clauses.join(' AND ') : '1 = 1',
    params,
    filter: f,
  };
}

/** Plain English summary of a filter, shown next to smart groups. */
function describeFilter(filter) {
  const f = normaliseFilter(filter);
  const parts = [];
  if (f.programs.length) parts.push(`programme ${f.programs.join(' or ')}`);
  if (f.disciplines.length) parts.push(`${f.disciplines.join(' or ')}`);
  if (f.years.length) parts.push(`year ${f.years.join(' or ')}`);
  if (f.batches.length) parts.push(`batch ${f.batches.join(' or ')}`);
  if (f.minCgpa !== null) parts.push(`CGPA ${f.minCgpa} and above`);
  if (f.search) parts.push(`matching "${f.search}"`);
  if (!f.status.includes('any')) parts.push(`${f.status.join(' or ')} students`);
  return parts.length ? parts.join(', ') : 'all active students';
}

module.exports = { normaliseFilter, buildWhere, describeFilter, asArray };
