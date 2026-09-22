'use strict';

const { getDb } = require('../db');
const { newId } = require('../lib/ids');
const { nowIso } = require('../lib/datetime');

/** Append-only record of what the system and staff did, per event. */
function log({ eventId = null, actor = 'system', action, detail = null }) {
  getDb()
    .prepare('INSERT INTO activity_log (id, event_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId('act'), eventId, actor, action, detail, nowIso());
}

function forEvent(eventId, limit = 100) {
  return getDb()
    .prepare('SELECT * FROM activity_log WHERE event_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(eventId, limit);
}

function recent(limit = 50) {
  return getDb()
    .prepare(`SELECT a.*, e.name AS event_name FROM activity_log a
              LEFT JOIN events e ON e.id = a.event_id
              ORDER BY a.created_at DESC LIMIT ?`)
    .all(limit);
}

module.exports = { log, forEvent, recent };
