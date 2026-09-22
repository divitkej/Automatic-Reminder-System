'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers').useTemporaryDatabase();
const csv = require('../server/lib/csv');

test('quoted fields containing commas are kept whole', () => {
  const { rows } = csv.parseObjects('Name,Note\n"Rao, Aarav",ok\n');
  assert.equal(rows[0].name, 'Rao, Aarav');
});

test('a byte order mark from Excel is stripped', () => {
  const { headers } = csv.parseObjects('﻿Campus ID,Name\n1,A\n');
  assert.deepEqual(headers, ['campus_id', 'name']);
});

test('doubled quotes decode to one quote', () => {
  const { rows } = csv.parseObjects('a\n"say ""hi"""\n');
  assert.equal(rows[0].a, 'say "hi"');
});

test('CRLF line endings are handled', () => {
  const { rows } = csv.parseObjects('a,b\r\n1,2\r\n3,4\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].b, '4');
});

test('blank lines are ignored', () => {
  const { rows } = csv.parseObjects('a\n1\n\n2\n');
  assert.equal(rows.length, 2);
});

test('writing escapes what needs escaping', () => {
  const out = csv.stringify([{ key: 'a', label: 'A' }], [{ a: 'x,y"z' }]);
  assert.equal(out, 'A\r\n"x,y""z"');
});
