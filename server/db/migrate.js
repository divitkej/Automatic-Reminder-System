'use strict';

const { migrate } = require('./index');
const config = require('../config');

migrate();
process.stdout.write(`Schema applied to ${config.databaseFile}\n`);
