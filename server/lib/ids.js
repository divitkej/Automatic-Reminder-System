'use strict';

const crypto = require('crypto');

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** Short, unambiguous, URL safe identifier with a readable prefix. */
function newId(prefix) {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Unguessable token for the personal links in student messages. */
function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { newId, newToken, sha256, timingSafeEqual };
