'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const rootDir = path.resolve(__dirname, '..');
const databaseFile = path.resolve(rootDir, process.env.DATABASE_FILE || './data/reminders.db');

fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

const config = {
  rootDir,
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`).replace(/\/+$/, ''),
  databaseFile,

  org: {
    name: process.env.ORG_NAME || 'Career Services, BITS Pilani Dubai Campus',
    shortName: process.env.ORG_SHORT_NAME || 'Career Services',
    email: process.env.ORG_EMAIL || 'careerservices@dubai.bits-pilani.ac.in',
    phone: process.env.ORG_PHONE || '+971 4 420 0700',
  },

  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Dubai',

  /**
   * How a message leaves the system once it is due.
   *
   *   draft   The system works out who gets what and when, then holds the
   *           finished message in a queue for a member of staff to hand to
   *           whoever actually sends campus mail. Nothing is delivered from
   *           here. This is the default.
   *   send    Delivered directly over SMTP and the configured gateways.
   *   preview Pretends to send, for testing. Messages are marked sent with
   *           the `preview` provider and nothing leaves the machine.
   */
  deliveryMode: (() => {
    const named = String(process.env.DELIVERY_MODE || '').trim().toLowerCase();
    if (['draft', 'send', 'preview'].includes(named)) return named;
    // DRY_RUN is the older setting. Honour it so an existing .env keeps working.
    if (process.env.DRY_RUN !== undefined && process.env.DELIVERY_MODE === undefined) {
      return bool(process.env.DRY_RUN, true) ? 'preview' : 'send';
    }
    return 'draft';
  })(),

  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Career Services <careerservices@dubai.bits-pilani.ac.in>',
    replyTo: process.env.MAIL_REPLY_TO || process.env.ORG_EMAIL || '',
  },

  sms: {
    webhookUrl: process.env.SMS_WEBHOOK_URL || '',
    webhookToken: process.env.SMS_WEBHOOK_TOKEN || '',
  },

  whatsapp: {
    webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || '',
    webhookToken: process.env.WHATSAPP_WEBHOOK_TOKEN || '',
  },

  scheduler: {
    enabled: bool(process.env.SCHEDULER_ENABLED, true),
    intervalSeconds: Math.max(5, int(process.env.SCHEDULER_INTERVAL_SECONDS, 30)),
    batchSize: Math.max(1, int(process.env.SCHEDULER_BATCH_SIZE, 50)),
    maxLatenessMinutes: Math.max(5, int(process.env.SCHEDULER_MAX_LATENESS_MINUTES, 180)),
    maxAttempts: Math.max(1, int(process.env.SCHEDULER_MAX_ATTEMPTS, 3)),
  },

  auth: {
    password: process.env.STAFF_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || 'career-services-dev-secret',
  },

  seedDemoData: bool(process.env.SEED_DEMO_DATA, true),
};

config.auth.enabled = config.auth.password.length > 0;
config.mail.configured = config.mail.host.length > 0;

config.isDraftMode = config.deliveryMode === 'draft';
// Kept because a lot of code reads it: preview behaves as dry run always did,
// and draft never reaches a provider at all.
config.dryRun = config.deliveryMode === 'preview';

module.exports = config;
