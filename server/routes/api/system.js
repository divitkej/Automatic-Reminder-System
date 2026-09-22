'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/errors');
const config = require('../../config');
const constants = require('../../lib/constants');
const stats = require('../../services/stats');
const scheduler = require('../../services/scheduler');
const channels = require('../../services/channels');
const activity = require('../../services/activity');
const { presetFor } = require('../../services/reminder-presets');
const dt = require('../../lib/datetime');
const { getSetting } = require('../../db');

const router = express.Router();

/** Everything the interface needs to draw its forms. */
router.get('/meta', asyncHandler(async (req, res) => {
  res.json({
    event_types: constants.EVENT_TYPES,
    event_modes: constants.EVENT_MODES,
    event_statuses: constants.EVENT_STATUSES,
    channels: constants.CHANNELS,
    message_categories: constants.MESSAGE_CATEGORIES,
    audience_rules: constants.AUDIENCE_RULES,
    registration_statuses: constants.REGISTRATION_STATUSES,
    anchors: constants.ANCHORS,
    programs: constants.PROGRAMS,
    disciplines: constants.DISCIPLINES,
    org: config.org,
    default_timezone: config.defaultTimezone,
    public_base_url: config.publicBaseUrl,
    dry_run: config.dryRun,
    auth_enabled: config.auth.enabled,
    // Set when the demonstration data was loaded into an empty database, so
    // every screen that shows figures can say where those figures came from.
    demo_data_seeded_at: getSetting('demo_data_seeded_at', null),
  });
}));

/** The default schedule for an event type, shown before an event is created. */
router.get('/presets/:type', asyncHandler(async (req, res) => {
  res.json({
    type: req.params.type,
    label: constants.eventTypeLabel(req.params.type),
    rules: presetFor(req.params.type).map((rule) => ({
      ...rule,
      offset_label: dt.humaniseOffset(rule.offsetMinutes),
      anchor_label: constants.labelFor(constants.ANCHORS, rule.anchor),
      audience_label: constants.labelFor(constants.AUDIENCE_RULES, rule.audienceRule),
      category_label: constants.labelFor(constants.MESSAGE_CATEGORIES, rule.category),
    })),
  });
}));

router.get('/dashboard', asyncHandler(async (req, res) => {
  res.json({ ...stats.dashboard(), scheduler: scheduler.status(), activity: activity.recent(15) });
}));

router.get('/overview', asyncHandler(async (req, res) => {
  res.json(stats.overview({ from: req.query.from, to: req.query.to }));
}));

router.get('/health', asyncHandler(async (req, res) => {
  res.json({
    status: 'ok',
    time: dt.nowIso(),
    scheduler: scheduler.status(),
    channels: await channels.status(),
  });
}));

router.post('/scheduler/tick', asyncHandler(async (req, res) => {
  res.json(await scheduler.tick({ trigger: 'manual' }));
}));

router.get('/activity', asyncHandler(async (req, res) => {
  res.json({ rows: activity.recent(Number(req.query.limit) || 50) });
}));

module.exports = router;
