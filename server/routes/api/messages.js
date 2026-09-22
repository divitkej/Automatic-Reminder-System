'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/errors');
const outbox = require('../../services/outbox');
const scheduler = require('../../services/scheduler');

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
