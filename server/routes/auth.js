'use strict';

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { page, escapeHtml } = require('../lib/render');
const { timingSafeEqual } = require('../lib/ids');

const router = express.Router();
const COOKIE = 'cs_staff';

/**
 * A single shared staff password, which is what a small office actually uses.
 *
 * The cookie holds a signed timestamp rather than the password, so the password
 * never travels back to the browser, and a session expires after twelve hours.
 * Leave STAFF_PASSWORD empty to run without a login screen, which is only
 * appropriate on a machine nobody else can reach.
 */
function sign(value) {
  return crypto.createHmac('sha256', config.auth.sessionSecret).update(value).digest('hex');
}

function issue(res) {
  const issuedAt = String(Date.now());
  const token = `${issuedAt}.${sign(issuedAt)}`;
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicBaseUrl.startsWith('https://'),
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function isSignedIn(req) {
  if (!config.auth.enabled) return true;
  const raw = req.cookies ? req.cookies[COOKIE] : null;
  if (!raw) return false;
  const [issuedAt, signature] = String(raw).split('.');
  if (!issuedAt || !signature) return false;
  if (!timingSafeEqual(signature, sign(issuedAt))) return false;
  const age = Date.now() - Number(issuedAt);
  return Number.isFinite(age) && age >= 0 && age < 12 * 60 * 60 * 1000;
}

function loginPage({ error } = {}) {
  return page({
    title: 'Sign in',
    heading: 'Career Services console',
    subheading: 'Sign in to manage events and reminders.',
    body: `
      ${error ? `<p class="flash flash-alert">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/sign-in" class="feedback-form">
        <label class="field">
          <span>Staff password</span>
          <input type="password" name="password" autocomplete="current-password" required autofocus />
        </label>
        <button type="submit" class="button button-primary">Sign in</button>
      </form>
      <p class="muted small">This console is for Career Services staff. Students should use the link in their invitation email.</p>`,
    bodyClass: 'narrow',
  });
}

router.get('/sign-in', (req, res) => {
  if (!config.auth.enabled || isSignedIn(req)) return res.redirect('/');
  res.type('html').send(loginPage());
});

router.post('/sign-in', (req, res) => {
  if (!config.auth.enabled) return res.redirect('/');
  const submitted = String((req.body && req.body.password) || '');
  if (submitted && timingSafeEqual(sign(submitted), sign(config.auth.password))) {
    issue(res);
    return res.redirect('/');
  }
  res.status(401).type('html').send(loginPage({ error: 'That password was not recognised.' }));
});

router.post('/sign-out', (req, res) => {
  res.clearCookie(COOKIE);
  res.redirect('/sign-in');
});

/** Guard for the staff console and its API. */
function requireStaff(req, res, next) {
  if (isSignedIn(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: { message: 'Sign in to use the Career Services console.', code: 'signed_out' } });
  }
  return res.redirect('/sign-in');
}

module.exports = { router, requireStaff, isSignedIn };
