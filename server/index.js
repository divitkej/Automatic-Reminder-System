'use strict';

const path = require('path');
const express = require('express');

const config = require('./config');
const { migrate } = require('./db');
const { AppError } = require('./lib/errors');
const { page, escapeHtml } = require('./lib/render');
const templates = require('./services/templates');
const scheduler = require('./services/scheduler');
const seed = require('./db/seed');
const auth = require('./routes/auth');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Body parsing. CSV uploads arrive as text on their own routes, so the JSON
// limit here stays small.
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/** Minimal cookie reader, which is all the single staff session needs. */
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index === -1) continue;
      const key = part.slice(0, index).trim();
      if (key) req.cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  next();
});

app.use((req, res, next) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  next();
});

// ---------------------------------------------------------------------------
// Public surfaces: student pages, legal pages, sign in, static assets.
// ---------------------------------------------------------------------------
app.use('/assets', express.static(path.join(config.rootDir, 'public', 'assets'), {
  maxAge: config.env === 'production' ? '7d' : 0,
}));
app.use(auth.router);
app.use(require('./routes/legal'));
app.use(require('./routes/public'));

// ---------------------------------------------------------------------------
// Staff console.
// ---------------------------------------------------------------------------
app.use('/api', auth.requireStaff, require('./routes/api'));

const CONSOLE_ROUTES = ['/', '/events', '/events/*splat', '/students', '/students/*splat',
  '/groups', '/groups/*splat', '/templates', '/templates/*splat', '/messages',
  '/to-send', '/to-send/*splat', '/reports', '/settings'];

app.get(CONSOLE_ROUTES, auth.requireStaff, (req, res) => {
  res.sendFile(path.join(config.rootDir, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ error: { message: 'Not found.' } });
  }
  res.status(404).type('html').send(page({
    title: 'Page not found',
    heading: 'Page not found',
    body: '<p>That address does not match anything in this system.</p><p><a href="/">Go to the console</a></p>',
  }));
});

app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = error instanceof AppError ? error.status : 500;
  if (status >= 500) {
    process.stderr.write(`[error] ${req.method} ${req.originalUrl}\n${error.stack}\n`);
  }
  const message = status >= 500 ? 'Something went wrong at our end. The error has been logged.' : error.message;

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(status).json({
      error: { message, details: error.details || null, name: error.name || 'Error' },
    });
  }
  res.status(status).type('html').send(page({
    title: status >= 500 ? 'Something went wrong' : 'That did not work',
    heading: status >= 500 ? 'Something went wrong' : 'That did not work',
    body: `<p>${escapeHtml(message)}</p><p><a href="/">Go to the console</a></p>`,
  }));
});

// ---------------------------------------------------------------------------
// Start up
// ---------------------------------------------------------------------------
function describeDelivery() {
  if (config.deliveryMode === 'draft') {
    return 'DRAFT. Messages are prepared and held in the To send queue for a person to hand over.';
  }
  if (config.deliveryMode === 'preview') {
    return 'DRY RUN. Messages are recorded but not sent.';
  }
  return config.mail.configured
    ? `SEND, over SMTP via ${config.mail.host}`
    : 'SEND is set but no SMTP host is configured, so email is recorded rather than delivered.';
}

function bootstrap() {
  migrate();
  const templateReport = templates.installSystemTemplates();
  const seedReport = config.seedDemoData ? seed.seedIfEmpty() : { seeded: false };
  return { templateReport, seedReport };
}

function start() {
  const { templateReport, seedReport } = bootstrap();
  const schedulerReport = scheduler.start();

  const server = app.listen(config.port, () => {
    const lines = [
      '',
      '  Career Services Automatic Event Reminder System',
      '  BITS Pilani, Dubai Campus',
      '',
      `  Console      ${config.publicBaseUrl}`,
      `  Database     ${config.databaseFile}`,
      `  Templates    ${templateReport.installed} installed, ${templateReport.refreshed} refreshed, ${templateReport.preserved} kept as edited`,
      `  Scheduler    ${schedulerReport.started ? `every ${schedulerReport.intervalSeconds} seconds` : schedulerReport.reason}`,
      `  Delivery     ${describeDelivery()}`,
      `  Sign in      ${config.auth.enabled ? 'Staff password required' : 'Open, no password set'}`,
    ];
    if (seedReport.seeded) lines.push(`  Demo data    ${seedReport.students} students, ${seedReport.events} events`);
    lines.push('');
    process.stdout.write(`${lines.join('\n')}\n`);
  });

  const shutdown = (signal) => {
    process.stdout.write(`\nReceived ${signal}, shutting down.\n`);
    scheduler.stop();
    server.close(() => {
      require('./db').close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start, bootstrap };
