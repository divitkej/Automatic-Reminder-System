'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers').useTemporaryDatabase();
const dt = require('../server/lib/datetime');

test('a Dubai wall clock time converts to the right UTC instant', () => {
  const window = dt.computeEventWindow({
    event_date: '2026-09-24',
    start_time: '17:00',
    end_time: '18:30',
    timezone: 'Asia/Dubai',
  });
  assert.equal(window.startsAtUtc, '2026-09-24T13:00:00.000Z');
  assert.equal(window.endsAtUtc, '2026-09-24T14:30:00.000Z');
});

test('the conversion round trips', () => {
  const back = dt.utcToZoned('2026-09-24T13:00:00.000Z', 'Asia/Dubai');
  assert.deepEqual(back, { date: '2026-09-24', time: '17:00' });
});

test('daylight saving is handled in a zone that observes it', () => {
  assert.equal(dt.zonedToUtc('2026-07-01', '12:00', 'Europe/London').toISOString(), '2026-07-01T11:00:00.000Z');
  assert.equal(dt.zonedToUtc('2026-01-01', '12:00', 'Europe/London').toISOString(), '2026-01-01T12:00:00.000Z');
});

test('an event running past midnight ends on the following day', () => {
  const window = dt.computeEventWindow({
    event_date: '2026-09-24',
    start_time: '22:00',
    end_time: '01:00',
    timezone: 'Asia/Dubai',
  });
  assert.equal(window.startsAtUtc, '2026-09-24T18:00:00.000Z');
  assert.equal(window.endsAtUtc, '2026-09-24T21:00:00.000Z');
  assert.ok(new Date(window.endsAtUtc) > new Date(window.startsAtUtc));
});

test('an unknown timezone is rejected rather than silently treated as UTC', () => {
  assert.throws(() => dt.zonedToUtc('2026-09-24', '17:00', 'Mars/Olympus'), /Unknown timezone/);
});

test('offsets are described in the largest whole unit', () => {
  assert.equal(dt.humaniseOffset(-10080), '1 week before');
  assert.equal(dt.humaniseOffset(-1440), '1 day before');
  assert.equal(dt.humaniseOffset(-60), '1 hour before');
  assert.equal(dt.humaniseOffset(-15), '15 minutes before');
  assert.equal(dt.humaniseOffset(-90), '1 hour 30 minutes before');
  assert.equal(dt.humaniseOffset(120), '2 hours after');
  assert.equal(dt.humaniseOffset(0), 'at the anchor time');
});

test('dates and times are formatted in the house style', () => {
  assert.equal(dt.formatFullDate('2026-09-24'), 'Thursday, 24 September 2026');
  assert.equal(dt.formatLongDate('2026-09-24'), '24 September 2026');
  assert.equal(dt.formatTimeRange('17:00', '18:30'), '5:00 PM to 6:30 PM');
  assert.equal(dt.formatTime12('00:05'), '12:05 AM');
  assert.equal(dt.formatTime12('12:00'), '12:00 PM');
});
