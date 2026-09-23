'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/errors');
const outbox = require('../../services/outbox');
const scheduler = require('../../services/scheduler');
const config = require('../../config');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(outbox.listMessages({
    eventId: req.query.event_id,
    status: req.query.status,
    channel: req.query.channel,
    category: req.query.category,
    studentId: req.query.student_id,
    search: req.query.search,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
}));

// ---------------------------------------------------------------------------
// The handoff queue, used when the system drafts rather than sends.
// ---------------------------------------------------------------------------

router.get('/due', asyncHandler(async (req, res) => {
  res.json({
    mode: config.deliveryMode,
    waiting: outbox.dueCount(),
    batches: outbox.dueBatches({ limit: Number(req.query.limit) || 100 }),
  });
}));

router.get('/batches/:batchKey', asyncHandler(async (req, res) => {
  res.json(outbox.getBatch(req.params.batchKey));
}));

router.post('/batches/:batchKey/mark-sent', asyncHandler(async (req, res) => {
  const result = outbox.markBatchSent(req.params.batchKey, {
    actor: req.actor,
    note: req.body && req.body.note ? String(req.body.note) : null,
  });
  res.json(result);
}));

router.post('/batches/:batchKey/reopen', asyncHandler(async (req, res) => {
  res.json(outbox.reopenBatch(req.params.batchKey, { actor: req.actor }));
}));

router.get('/batches/:batchKey/mail-merge.csv', asyncHandler(async (req, res) => {
  const batch = outbox.getBatch(req.params.batchKey);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${slug(batch.event_name)}-${slug(batch.label)}.csv"`);
  res.send(outbox.batchAsCsv(req.params.batchKey));
}));

/** The batch rendered once for everyone, with no student's private token in it. */
router.get('/batches/:batchKey/generic', asyncHandler(async (req, res) => {
  res.json(outbox.batchGeneric(req.params.batchKey));
}));

router.get('/batches/:batchKey/recipients.txt', asyncHandler(async (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.send(outbox.batchRecipients(req.params.batchKey, {
    separator: req.query.separator === 'newline' ? '\n' : ', ',
  }));
}));

router.get('/batches/:batchKey/messages.eml', asyncHandler(async (req, res) => {
  const batch = outbox.getBatch(req.params.batchKey);
  res.setHeader('content-type', 'message/rfc822; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${slug(batch.event_name)}-${slug(batch.label)}.eml"`);
  res.send(outbox.batchAsEml(req.params.batchKey));
}));

function slug(value) {
  return String(value || 'batch').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 50) || 'batch';
}

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(outbox.getMessage(req.params.id));
}));

router.post('/:id/send-now', asyncHandler(async (req, res) => {
  const result = await outbox.sendNow(req.params.id);
  res.json({ result, message: outbox.getMessage(req.params.id) });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  res.json(outbox.cancelMessage(req.params.id));
}));

/** Run a scheduler pass by hand, used from the settings screen. */
router.post('/dispatch', asyncHandler(async (req, res) => {
  res.json(await scheduler.tick({ trigger: 'manual' }));
}));

module.exports = router;
