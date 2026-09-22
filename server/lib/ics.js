'use strict';

/** Minimal RFC 5545 calendar file so students can add an event in one click. */

function escapeText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toIcsStamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Fold lines at 75 octets as the specification requires. */
function fold(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 74) {
      out.push(current);
      current = ' ';
    }
    current += char;
  }
  if (current.trim().length) out.push(current);
  return out.join('\r\n');
}

function buildEventIcs({ uid, summary, description, location, url, startsAtUtc, endsAtUtc, organiserName, organiserEmail, status = 'CONFIRMED' }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BITS Pilani Dubai Campus//Career Services Reminder System//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsStamp(new Date().toISOString())}`,
    `DTSTART:${toIcsStamp(startsAtUtc)}`,
    `DTEND:${toIcsStamp(endsAtUtc)}`,
    `SUMMARY:${escapeText(summary)}`,
    `STATUS:${status}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (url) lines.push(`URL:${escapeText(url)}`);
  if (organiserEmail) {
    lines.push(`ORGANIZER;CN=${escapeText(organiserName || organiserEmail)}:mailto:${organiserEmail}`);
  }
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(summary)}`, 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildEventIcs };
