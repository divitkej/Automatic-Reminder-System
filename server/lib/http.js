'use strict';

const { ValidationError } = require('./errors');

/**
 * Read an uploaded CSV whether it arrived as a raw text body or as a JSON
 * envelope with a `csv` field, which is what the browser upload control sends.
 */
function readBody(req) {
  if (typeof req.body === 'string' && req.body.trim()) return req.body;
  if (req.body && typeof req.body.csv === 'string' && req.body.csv.trim()) return req.body.csv;
  if (Buffer.isBuffer(req.body) && req.body.length) return req.body.toString('utf8');
  throw new ValidationError('No file content was received.');
}

module.exports = { readBody };
