'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Every test file gets its own database file, set before any module that
 * touches config is required. The server reads DATABASE_FILE once at load, so
 * this has to happen first.
 */
function useTemporaryDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-reminders-test-'));
  process.env.DATABASE_FILE = path.join(dir, 'test.db');
  process.env.SEED_DEMO_DATA = 'false';
  process.env.SCHEDULER_ENABLED = 'false';
  process.env.DRY_RUN = 'true';
  process.env.PUBLIC_BASE_URL = 'http://localhost:9999';
  return dir;
}

module.exports = { useTemporaryDatabase };
