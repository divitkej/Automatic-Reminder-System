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

function migrate() {
  const connection = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  connection.exec(schema);
  setSetting('schema_version', '1');
  return connection;
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

module.exports = { getDb, migrate, getSetting, setSetting, transaction, close };
