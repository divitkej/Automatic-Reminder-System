'use strict';

/**
 * Timezone-aware helpers.
 *
 * Staff type an event's date and time as local wall-clock values ("24 September
 * 2026, 17:00") together with a timezone ("Asia/Dubai"). Everything the
 * scheduler compares is an absolute instant, so those wall-clock values have to
 * be converted to UTC, and back again for display. These helpers do that with
 * Intl only, which keeps the project free of a timezone data dependency and
 * correct across daylight-saving changes in any zone Career Services may use.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const partsCache = new Map();

function formatterFor(timeZone) {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, fmt);
  }
  return fmt;
}

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `instant` as observed in `timeZone`. */
function wallClockParts(instant, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  // Some engines render midnight as hour 24.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetMsAt(instant, timeZone) {
  const p = wallClockParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/**
 * Convert a local wall-clock date and time in `timeZone` to a UTC Date.
 * Two passes settle the offset correctly on daylight-saving boundaries.
 */
function zonedToUtc(dateStr, timeStr, timeZone) {
  if (!DATE_RE.test(dateStr)) throw new RangeError(`Invalid date: ${dateStr}`);
  if (!TIME_RE.test(timeStr)) throw new RangeError(`Invalid time: ${timeStr}`);
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Unknown timezone: ${timeZone}`);

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);

  let ts = naive - offsetMsAt(new Date(naive), timeZone);
  ts = naive - offsetMsAt(new Date(ts), timeZone);
  return new Date(ts);
}

/** Absolute instant -> { date: 'YYYY-MM-DD', time: 'HH:MM' } in `timeZone`. */
function utcToZoned(instant, timeZone) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const p = wallClockParts(d, timeZone);
  return {
    date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Event timing is stored once, on write, so the scheduler never has to redo
 * timezone maths. An end time earlier than the start time is read as an event
 * that runs past midnight.
 */
function computeEventWindow({ event_date, start_time, end_time, timezone }) {
  const startsAt = zonedToUtc(event_date, start_time, timezone);
  let endsAt = zonedToUtc(event_date, end_time, timezone);
  if (endsAt.getTime() <= startsAt.getTime()) {
    const nextDay = utcToZoned(new Date(zonedToUtc(event_date, '12:00', timezone).getTime() + DAY), timezone).date;
    endsAt = zonedToUtc(nextDay, end_time, timezone);
  }
  return { startsAtUtc: startsAt.toISOString(), endsAtUtc: endsAt.toISOString() };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "24 September 2026" */
function formatLongDate(dateStr) {
  if (!DATE_RE.test(String(dateStr || ''))) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Thursday, 24 September 2026" */
function formatFullDate(dateStr) {
  if (!DATE_RE.test(String(dateStr || ''))) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "5:00 PM" */
function formatTime12(timeStr) {
  if (!TIME_RE.test(String(timeStr || ''))) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${suffix}`;
}

/** "5:00 PM to 6:30 PM" */
function formatTimeRange(startTime, endTime) {
  const a = formatTime12(startTime);
  const b = formatTime12(endTime);
  if (a && b) return `${a} to ${b}`;
  return a || b || '';
}

/** Short zone label, e.g. "GST" or "GMT+4". */
function timezoneLabel(timeZone, instant = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(instant);
    const name = parts.find((p) => p.type === 'timeZoneName');
    return name ? name.value : timeZone;
  } catch {
    return timeZone;
  }
}

/** "in 3 days", "in 2 hours", "12 minutes ago". */
function humaniseOffset(minutes) {
  const abs = Math.abs(minutes);
  const suffix = minutes < 0 ? 'before' : 'after';
  if (abs === 0) return 'at the anchor time';
  // Exact whole weeks, days and hours read best on their own. Anything else
  // falls through to the composite wording below.
  const units = [
    [7 * 24 * 60, 'week'],
    [24 * 60, 'day'],
    [60, 'hour'],
  ];
  for (const [size, label] of units) {
    if (abs % size === 0 && abs >= size) {
      const value = abs / size;
      return `${value} ${label}${value === 1 ? '' : 's'} ${suffix}`;
    }
  }
  const days = Math.floor(abs / (24 * 60));
  const hours = Math.floor((abs % (24 * 60)) / 60);
  const mins = abs % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  // Minutes are noise once the offset runs to days.
  if (mins && !days) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`);
  return `${parts.join(' ')} ${suffix}`;
}

/** Relative wording for a timestamp compared with now. */
function relativeToNow(iso, reference = Date.now()) {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = ts - reference;
  const abs = Math.abs(diff);
  const units = [
    [DAY, 'day'],
    [HOUR, 'hour'],
    [MINUTE, 'minute'],
  ];
  for (const [size, label] of units) {
    if (abs >= size) {
      const value = Math.round(abs / size);
      return diff >= 0
        ? `in ${value} ${label}${value === 1 ? '' : 's'}`
        : `${value} ${label}${value === 1 ? '' : 's'} ago`;
    }
  }
  return diff >= 0 ? 'in under a minute' : 'just now';
}

module.exports = {
  DATE_RE,
  TIME_RE,
  MINUTE,
  HOUR,
  DAY,
  isValidTimeZone,
  zonedToUtc,
  utcToZoned,
  offsetMsAt,
  wallClockParts,
  computeEventWindow,
  formatLongDate,
  formatFullDate,
  formatTime12,
  formatTimeRange,
  timezoneLabel,
  humaniseOffset,
  relativeToNow,
  toIso,
  nowIso,
  pad,
};
