'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/errors');
const groups = require('../../services/groups');
const { readBody } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({ rows: groups.list() });
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(groups.create({
    name: req.body.name,
    description: req.body.description,
    kind: req.body.kind || 'static',
    filter: req.body.filter || null,
    studentIds: [].concat(req.body.student_ids || []),
  }));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ group: groups.get(req.params.id), members: groups.members(req.params.id, { includeOptedOut: true }) });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(groups.update(req.params.id, req.body));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  groups.remove(req.params.id);
  res.json({ deleted: true });
}));

router.post('/:id/members', asyncHandler(async (req, res) => {
  const added = groups.addMembers(req.params.id, [].concat(req.body.student_ids || []));
  res.json({ added, group: groups.get(req.params.id) });
}));

router.delete('/:id/members', asyncHandler(async (req, res) => {
  const removed = groups.removeMembers(req.params.id, [].concat(req.body.student_ids || []));
  res.json({ removed, group: groups.get(req.params.id) });
}));

router.post('/:id/members/from-filter', asyncHandler(async (req, res) => {
  const count = groups.setMembersFromFilter(req.params.id, req.body.filter || {});
  res.json({ members: count, group: groups.get(req.params.id) });
}));

router.post('/:id/members/import', express.text({ type: '*/*', limit: '10mb' }), asyncHandler(async (req, res) => {
  const report = groups.importMembersCsv(req.params.id, readBody(req));
  res.json({ ...report, group: groups.get(req.params.id) });
}));

router.get('/:id/members.csv', asyncHandler(async (req, res) => {
  const group = groups.get(req.params.id);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv"`);
  res.send(groups.exportMembersCsv(req.params.id));
}));

module.exports = router;
