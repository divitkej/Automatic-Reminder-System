'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/errors');
const students = require('../../services/students');
const registrations = require('../../services/registrations');
const outbox = require('../../services/outbox');
const { readBody } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { limit, offset, order_by: orderBy, ...filter } = req.query;
  res.json({ ...students.list({ filter, limit, offset, orderBy }), facets: students.facets() });
}));

router.get('/facets', asyncHandler(async (req, res) => {
  res.json(students.facets());
}));

router.post('/count', asyncHandler(async (req, res) => {
  res.json({ count: students.countMatching(req.body || {}) });
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(students.create(req.body));
}));

router.post('/import', express.text({ type: '*/*', limit: '10mb' }), asyncHandler(async (req, res) => {
  const text = readBody(req);
  const report = students.importCsv(text, { updateExisting: req.query.update !== 'false' });
  res.status(report.applied ? 200 : 422).json(report);
}));

router.get('/export.csv', asyncHandler(async (req, res) => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="students.csv"');
  res.send(students.exportCsv(req.query));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const student = students.get(req.params.id);
  res.json({
    student,
    registrations: registrations.listForStudent(req.params.id),
    messages: outbox.listMessages({ studentId: req.params.id, limit: 50 }).rows,
  });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(students.update(req.params.id, req.body));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  students.remove(req.params.id);
  res.json({ deleted: true });
}));

module.exports = router;
