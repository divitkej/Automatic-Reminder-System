'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('../config');
const { nowIso } = require('../lib/datetime');

let db = null;

function getDb() {
  if (db) return db;
  db = new Database(config.databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves an
 * existing table alone, so new columns have to be added explicitly. ALTER TABLE
 * ADD COLUMN is cheap in SQLite and this is checked rather than assumed, which
 * makes running it on every start harmless.
 */
const ADDED_COLUMNS = [
  ['messages', 'batch_key', 'TEXT'],
  ['messages', 'handed_off_at', 'TEXT'],
  ['messages', 'handed_off_by', 'TEXT'],
];

function addMissingColumns(connection) {
  const added = [];
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = connection.prepare(`PRAGMA table_info(${table})`).all()
      .some((row) => row.name === column);
    if (exists) continue;
    connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    added.push(`${table}.${column}`);
  }
  return added;
}

/**
 * Give a batch key to messages written before the column existed.
 *
 * Without this, a message already sitting in the outbox at the time of the
 * upgrade would never appear in the To send queue: it would be due, and
 * invisible. Grouping matches what materialisation does now, so an upgraded
 * database and a fresh one behave identically.
 */
function backfillBatchKeys(connection) {
  return connection.prepare(`
    UPDATE messages
    SET batch_key = CASE
      WHEN rule_id IS NOT NULL THEN rule_id || '@' || scheduled_for
      ELSE 'legacy:' || id
    END
    WHERE batch_key IS NULL
  `).run().changes;
}

function migrate() {
  const connection = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  connection.exec(schema);
  const added = addMissingColumns(connection);
  connection.exec('CREATE INDEX IF NOT EXISTS idx_messages_batch ON messages (batch_key)');
  const backfilled = backfillBatchKeys(connection);
  setSetting('schema_version', '2');
  return { connection, added, backfilled };
}

function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  getDb()
    .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
              ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, value === null || value === undefined ? null : String(value), nowIso());
}

/** Run `fn` inside a transaction. Nested calls reuse the outer transaction. */
function transaction(fn) {
  const connection = getDb();
  if (connection.inTransaction) return fn();
  return connection.transaction(fn)();
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, migrate, addMissingColumns, backfillBatchKeys, getSetting, setSetting, transaction, close };
