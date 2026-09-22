// Display formatting. The server sends UTC instants and pre-formatted local
// strings for anything tied to an event's own timezone; these helpers cover the
// rest, and always in the browser's locale-independent house style.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function longDate(value) {
  const d = toDate(value);
  if (!d) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fullDate(value) {
  const d = toDate(value);
  if (!d) return '';
  return `${WEEKDAYS[d.getDay()]}, ${longDate(d)}`;
}

export function dateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return `${longDate(d)}, ${time12(d)}`;
}

export function time12(value) {
  const d = toDate(value);
  if (!d) return '';
  const hours = d.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`;
}

export function relative(value, reference = Date.now()) {
  const d = toDate(value);
  if (!d) return '';
  const diff = d.getTime() - reference;
  const abs = Math.abs(diff);
  const units = [[86400000, 'day'], [3600000, 'hour'], [60000, 'minute']];
  for (const [size, label] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      return diff >= 0 ? `in ${n} ${label}${n === 1 ? '' : 's'}` : `${n} ${label}${n === 1 ? '' : 's'} ago`;
    }
  }
  return diff >= 0 ? 'in under a minute' : 'just now';
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : (pluralForm || `${singular}s`)}`;
}

export function percent(value) {
  return value === null || value === undefined ? '' : `${Math.round(value)}%`;
}

/** "YYYY-MM-DD" for today, in the browser's own timezone. */
export function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Signed minutes to "1 day before". Mirrors the server's own wording. */
export function offsetLabel(minutes) {
  const abs = Math.abs(minutes);
  const suffix = minutes < 0 ? 'before' : 'after';
  if (abs === 0) return 'at the anchor time';
  // Exact whole weeks, days and hours read best on their own. Anything else
  // falls through to the composite wording below.
  for (const [size, label] of [[10080, 'week'], [1440, 'day'], [60, 'hour']]) {
    if (abs % size === 0 && abs >= size) {
      const n = abs / size;
      return `${n} ${label}${n === 1 ? '' : 's'} ${suffix}`;
    }
  }
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const mins = abs % 60;
  const parts = [
    days && `${days} day${days === 1 ? '' : 's'}`,
    hours && `${hours} hour${hours === 1 ? '' : 's'}`,
    // Minutes are dropped once the offset is measured in days: "2 days 4 hours"
    // is what a person needs, not "2 days 4 hours 16 minutes".
    (!days && mins) && `${mins} minute${mins === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return `${parts.join(' ')} ${suffix}`;
}

/** "1 day before" back to signed minutes, for the reminder timing control. */
export function minutesFrom(amount, unit, direction) {
  const sizes = { minute: 1, hour: 60, day: 1440, week: 10080 };
  const magnitude = Math.abs(Number(amount) || 0) * (sizes[unit] || 1);
  return direction === 'after' ? magnitude : -magnitude;
}

/** Split signed minutes into the largest whole unit, for editing. */
export function splitOffset(minutes) {
  const abs = Math.abs(minutes);
  const direction = minutes < 0 ? 'before' : 'after';
  for (const [size, unit] of [[10080, 'week'], [1440, 'day'], [60, 'hour'], [1, 'minute']]) {
    if (abs % size === 0 && abs >= size) return { amount: abs / size, unit, direction };
  }
  return { amount: abs, unit: 'minute', direction };
}
