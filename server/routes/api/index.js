'use strict';

const express = require('express');

const router = express.Router();

router.use((req, res, next) => {
  req.actor = req.get('x-staff-name') || 'Career Services';
  next();
});

router.use('/system', require('./system'));
router.use('/events', require('./events'));
router.use('/students', require('./students'));
router.use('/groups', require('./groups'));
router.use('/templates', require('./templates'));
router.use('/messages', require('./messages'));

router.use((req, res) => {
  res.status(404).json({ error: { message: `No API route matches ${req.method} ${req.originalUrl}.` } });
});

module.exports = router;
