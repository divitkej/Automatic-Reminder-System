'use strict';

const email = require('./email');
const { makeSender } = require('./webhook');
const config = require('../../config');

const sms = makeSender('sms');
const whatsapp = makeSender('whatsapp');

const CHANNELS = { email, sms, whatsapp };

/** The address a message on this channel should go to, or null if unreachable. */
function addressFor(channel, student) {
  if (channel === 'email') return student.email || null;
  return student.phone || null;
}

function reasonUnreachable(channel) {
  return channel === 'email'
    ? 'No email address on record'
    : 'No phone number on record';
}

async function deliver(channel, payload) {
  const handler = CHANNELS[channel];
  if (!handler) throw new Error(`Unknown channel: ${channel}`);
  return handler.send(payload);
}

/** Per channel readiness, shown on the settings screen. */
async function status() {
  const out = {
    dry_run: config.dryRun,
    email: { configured: config.mail.configured, ...(await email.verify()) },
    sms: { configured: Boolean(config.sms.webhookUrl), ...(await sms.verify()) },
    whatsapp: { configured: Boolean(config.whatsapp.webhookUrl), ...(await whatsapp.verify()) },
  };
  return out;
}

module.exports = { deliver, addressFor, reasonUnreachable, status, email, sms, whatsapp };
