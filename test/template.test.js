'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers').useTemporaryDatabase();
const tpl = require('../server/lib/template');

test('merge fields are substituted', () => {
  assert.equal(tpl.render('Dear {{a.b}},', { a: { b: 'Aarav' } }), 'Dear Aarav,');
});

test('a missing field renders as nothing rather than throwing', () => {
  assert.equal(tpl.render('[{{nope.here}}]', {}), '[]');
});

test('conditional sections take the right branch', () => {
  const source = '{{#if x}}yes{{else}}no{{/if}}';
  assert.equal(tpl.render(source, { x: true }), 'yes');
  assert.equal(tpl.render(source, { x: false }), 'no');
  assert.equal(tpl.render(source, { x: '' }), 'no');
  assert.equal(tpl.render(source, { x: '  ' }), 'no');
  assert.equal(tpl.render(source, { x: 0 }), 'yes');
});

test('unless is the inverse of if', () => {
  assert.equal(tpl.render('{{#unless x}}gone{{/unless}}', { x: '' }), 'gone');
  assert.equal(tpl.render('{{#unless x}}gone{{/unless}}', { x: 'here' }), '');
});

test('sections nest', () => {
  const source = '{{#if a}}A{{#if b}}B{{/if}}{{/if}}';
  assert.equal(tpl.render(source, { a: true, b: true }), 'AB');
  assert.equal(tpl.render(source, { a: true, b: false }), 'A');
  assert.equal(tpl.render(source, { a: false, b: true }), '');
});

test('fields inside an untaken branch are still catalogued', () => {
  const fields = tpl.fieldsUsed('{{#if a}}{{b}}{{else}}{{c}}{{/if}}');
  assert.deepEqual(fields.sort(), ['a', 'b', 'c']);
});

test('an unbalanced section is reported', () => {
  const result = tpl.validateTemplate('{{#if a}}x', ['a']);
  assert.equal(result.valid, false);
  assert.match(result.problems[0], /opened but never closed/);
});

test('an unknown merge field is reported', () => {
  const result = tpl.validateTemplate('{{made.up}}', ['real.field']);
  assert.equal(result.valid, false);
  assert.match(result.problems[0], /Unknown merge field/);
});

test('every template shipped with the system validates', () => {
  const { fieldCatalogue } = require('../server/services/context');
  const { templates } = require('../server/services/system-templates');
  const fields = fieldCatalogue();
  for (const item of templates) {
    const result = tpl.validateTemplate(`${item.body}\n${item.subject || ''}`, fields);
    assert.equal(result.valid, true, `${item.key}: ${result.problems.join('; ')}`);
  }
});
