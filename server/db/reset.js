'use strict';

const fs = require('fs');
const config = require('../config');
const { close } = require('./index');

close();
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.databaseFile}${suffix}`;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
process.stdout.write(`Removed ${config.databaseFile}\nRun "npm start" to rebuild it.\n`);
