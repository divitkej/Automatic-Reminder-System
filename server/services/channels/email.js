'use strict';

const nodemailer = require('nodemailer');
const config = require('../../config');

let transport = null;
let transportError = null;

function getTransport() {
  if (transport || transportError) return transport;
  if (!config.mail.configured) return null;
  try {
    transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  } catch (error) {
    transportError = error;
    return null;
  }
  return transport;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const URL_IN_TEXT = /(https?:\/\/[^\s<>"')]+)/g;

function linkify(escapedLine) {
  return escapedLine.replace(URL_IN_TEXT, (url) => `<a href="${url}">${url}</a>`);
}

/**
 * Turn the rendered plain text body into the HTML part of the email.
 *
 * The templates are written as plain text so that staff never have to think
 * about markup. Blank lines become paragraphs, lines that begin with a number
 * become a list, and a line of the form "Label: value" inside the event details
 * block is laid out as a definition row. The layout is deliberately plain: a
 * single column, system fonts, no images and no tracking beyond the open pixel,
 * because that is what survives Outlook, Gmail and a phone on campus wifi.
 */
function textToHtml(text, { title, openPixelUrl } = {}) {
  const blocks = String(text || '').split(/\n{2,}/);
  const html = blocks.map((block) => {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) return '';

    const isOrderedList = lines.length > 1 && lines.every((line) => /^\s*\d+\.\s+/.test(line));
    if (isOrderedList) {
      const items = lines.map((line) => `<li>${linkify(escapeHtml(line.replace(/^\s*\d+\.\s+/, '')))}</li>`).join('');
      return `<ol style="margin:0 0 16px 0;padding-left:22px;">${items}</ol>`;
    }

    const isDetailBlock = lines.length > 1 && lines.every((line) => /^[A-Z][A-Za-z ]{2,24}:\s/.test(line));
    if (isDetailBlock) {
      const rows = lines.map((line) => {
        const index = line.indexOf(':');
        const label = escapeHtml(line.slice(0, index));
        const value = linkify(escapeHtml(line.slice(index + 1).trim()));
        return `<tr>
          <td style="padding:5px 16px 5px 0;color:#5b6472;white-space:nowrap;vertical-align:top;">${label}</td>
          <td style="padding:5px 0;color:#16202e;vertical-align:top;">${value}</td>
        </tr>`;
      }).join('');
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
        style="margin:0 0 16px 0;border-left:3px solid #1b3a63;padding-left:14px;font-size:15px;">${rows}</table>`;
    }

    return `<p style="margin:0 0 16px 0;">${lines.map((line) => linkify(escapeHtml(line))).join('<br />')}</p>`;
  }).join('\n');

  const pixel = openPixelUrl
    ? `<img src="${openPixelUrl}" width="1" height="1" alt="" style="display:block;border:0;" />`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title || config.org.shortName)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f1ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f1ee;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="max-width:600px;background:#ffffff;border:1px solid #ddd9d2;">
        <tr>
          <td style="background:#16304f;padding:18px 28px;">
            <div style="font:600 15px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:0.01em;">
              BITS Pilani, Dubai Campus
            </div>
            <div style="font:400 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#b8c6d8;margin-top:2px;">
              ${escapeHtml(config.org.shortName)}
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16202e;">
            ${html}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #e6e2db;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6b7280;">
            This message was sent by ${escapeHtml(config.org.name)}.<br />
            Questions about an event can go to <a href="mailto:${escapeHtml(config.org.email)}" style="color:#16304f;">${escapeHtml(config.org.email)}</a>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
${pixel}
</body>
</html>`;
}

/**
 * Deliver one email. In dry run, or with no SMTP host configured, the message
 * is reported as delivered by the `preview` provider: it is stored complete in
 * the outbox and can be read in the interface, but nothing leaves the machine.
 */
async function send({ to, subject, text, html, messageId }) {
  const mailer = getTransport();
  if (config.dryRun || !mailer) {
    return {
      provider: 'preview',
      providerRef: messageId || null,
      note: config.dryRun
        ? 'Dry run is on, so the message was recorded but not sent.'
        : 'No SMTP host is configured, so the message was recorded but not sent.',
    };
  }
  const info = await mailer.sendMail({
    from: config.mail.from,
    replyTo: config.mail.replyTo || undefined,
    to,
    subject,
    text,
    html,
  });
  return { provider: 'smtp', providerRef: info.messageId || null };
}

async function verify() {
  const mailer = getTransport();
  if (!mailer) return { ok: false, reason: 'No SMTP host is configured.' };
  try {
    await mailer.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

module.exports = { send, verify, textToHtml, escapeHtml, getTransport };
