'use strict';

const config = require('../config');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tagged template that escapes every interpolated value. */
function html(strings, ...values) {
  return strings.reduce((out, part, index) => {
    if (index === 0) return part;
    const value = values[index - 1];
    const rendered = value && value.__raw ? value.value : escapeHtml(value);
    return out + rendered + part;
  }, '');
}

/** Mark a string as already-safe HTML. */
function raw(value) {
  return { __raw: true, value: String(value ?? '') };
}

/**
 * The shell for every student-facing page. These pages are opened from a link
 * in an email, often on a phone, sometimes on campus wifi, so they are one
 * column, load a single stylesheet and carry no scripts beyond a short inline
 * one for the rating control.
 */
function page({ title, heading, subheading, body, footerNote = '', bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)} | ${escapeHtml(config.org.shortName)}</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/assets/public.css" />
</head>
<body class="${escapeHtml(bodyClass)}">
  <header class="masthead">
    <div class="masthead-inner">
      <span class="masthead-institution">BITS Pilani, Dubai Campus</span>
      <span class="masthead-unit">${escapeHtml(config.org.shortName)}</span>
    </div>
  </header>
  <main class="sheet">
    <h1>${escapeHtml(heading)}</h1>
    ${subheading ? `<p class="lede">${escapeHtml(subheading)}</p>` : ''}
    ${body}
  </main>
  <footer class="page-footer">
    <p>${footerNote || `Sent by ${escapeHtml(config.org.name)}.`}</p>
    <p>
      <a href="mailto:${escapeHtml(config.org.email)}">${escapeHtml(config.org.email)}</a>
      <span aria-hidden="true">·</span>
      <a href="/privacy">Privacy</a>
      <span aria-hidden="true">·</span>
      <a href="/terms">Terms</a>
    </p>
  </footer>
</body>
</html>`;
}

/** The event facts block shown on the registration and feedback pages. */
function eventFacts(event) {
  const dt = require('./datetime');
  const rows = [
    ['Date', dt.formatFullDate(event.event_date)],
    ['Time', `${dt.formatTimeRange(event.start_time, event.end_time)} (${dt.timezoneLabel(event.timezone, new Date(event.starts_at_utc))})`],
    ['Mode', event.mode === 'in_person' ? 'In person' : event.mode === 'online' ? 'Online' : 'Hybrid'],
  ];
  if (event.company) rows.splice(0, 0, ['Organisation', event.company]);
  if (event.speaker) rows.push(['Speaker', event.speaker_title ? `${event.speaker}, ${event.speaker_title}` : event.speaker]);
  if (event.venue) rows.push(['Venue', event.venue]);

  const body = rows
    .map(([label, value]) => `<div class="fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');
  return `<dl class="facts">${body}</dl>`;
}

module.exports = { page, html, raw, escapeHtml, eventFacts };
