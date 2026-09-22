'use strict';

/**
 * RFC 4180 CSV reading and writing.
 *
 * Career Services exports student lists from the campus systems, so the parser
 * has to cope with quoted fields containing commas and line breaks, a UTF-8
 * byte order mark left by Excel, and both CRLF and LF line endings.
 */

function parse(input) {
  const text = String(input || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  let i = 0;

  const pushField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"' && field.trim() === '') {
      inQuotes = true;
      fieldWasQuoted = true;
      field = '';
      i += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

function normaliseHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Parse into objects keyed by a normalised header, so "Student ID", "student_id"
 * and "STUDENT-ID" all land on the same field.
 */
function parseObjects(input) {
  const rows = parse(input);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(normaliseHeader);
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const raw = rows[r];
    if (raw.every((cell) => String(cell).trim() === '')) continue;
    const obj = {};
    headers.forEach((header, index) => {
      if (!header) return;
      obj[header] = raw[index] === undefined ? '' : String(raw[index]).trim();
    });
    obj.__line = r + 1;
    out.push(obj);
  }
  return { headers, rows: out };
}

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Build a CSV document from column definitions and rows. */
function stringify(columns, rows) {
  const header = columns.map((col) => escapeCell(col.label ?? col.key)).join(',');
  const lines = rows.map((row) => columns
    .map((col) => escapeCell(typeof col.value === 'function' ? col.value(row) : row[col.key]))
    .join(','));
  return [header, ...lines].join('\r\n');
}

module.exports = { parse, parseObjects, stringify, normaliseHeader };
