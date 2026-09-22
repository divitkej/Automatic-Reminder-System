'use strict';

const config = require('../../config');

/**
 * SMS and WhatsApp are delivered by posting a JSON payload to a gateway URL.
 *
 * Campuses buy these from different providers, so rather than bind the system
 * to one vendor's SDK, it posts a small, stable payload that any gateway or a
 * short relay script can consume. With no URL configured the channel behaves
 * like email in dry run: the message is recorded in full and nothing is sent.
 */
function makeSender(channel) {
  const settings = channel === 'sms' ? config.sms : config.whatsapp;

  async function send({ to, text, messageId, event, student }) {
    if (config.dryRun || !settings.webhookUrl) {
      return {
        provider: 'preview',
        providerRef: messageId || null,
        note: config.dryRun
          ? 'Dry run is on, so the message was recorded but not sent.'
          : `No ${channel.toUpperCase()} gateway is configured, so the message was recorded but not sent.`,
      };
    }
    const headers = { 'content-type': 'application/json' };
    if (settings.webhookToken) headers.authorization = `Bearer ${settings.webhookToken}`;

    const response = await fetch(settings.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        channel,
        to,
        text,
        message_id: messageId,
        event_id: event ? event.id : null,
        event_name: event ? event.name : null,
        student_campus_id: student ? student.campus_id : null,
        sent_by: config.org.name,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`${channel.toUpperCase()} gateway returned ${response.status}. ${body.slice(0, 200)}`);
    }
    let providerRef = null;
    try {
      const payload = await response.json();
      providerRef = payload.id || payload.message_id || payload.sid || null;
    } catch {
      providerRef = null;
    }
    return { provider: `${channel}_webhook`, providerRef };
  }

  async function verify() {
    if (!settings.webhookUrl) return { ok: false, reason: `No ${channel.toUpperCase()} gateway is configured.` };
    return { ok: true, reason: `Gateway set to ${settings.webhookUrl}` };
  }

  return { send, verify };
}

module.exports = { makeSender };
