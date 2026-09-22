'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/errors');
const templates = require('../../services/templates');
const { sampleContext, fieldCatalogue } = require('../../services/context');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({
    rows: templates.list({
      category: req.query.category,
      channel: req.query.channel,
      eventType: req.query.event_type,
    }),
    fields: fieldCatalogue(),
  });
}));

router.get('/fields', asyncHandler(async (req, res) => {
  res.json({ fields: fieldCatalogue(), sample: sampleContext() });
}));

router.post('/preview', asyncHandler(async (req, res) => {
  const rendered = templates.preview({ subject: req.body.subject, body: req.body.body });
  res.json({ ...rendered, validation: templates.validateBody(req.body) });
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(templates.create(req.body));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const template = templates.get(req.params.id);
  res.json({ template, preview: templates.preview(template) });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(templates.update(req.params.id, req.body));
}));

router.post('/:id/reset', asyncHandler(async (req, res) => {
  res.json(templates.resetToSystem(req.params.id));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  templates.remove(req.params.id);
  res.json({ deleted: true });
}));

module.exports = router;
