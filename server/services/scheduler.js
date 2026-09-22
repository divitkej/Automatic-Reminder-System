'use strict';

const config = require('../config');
const { setSetting, getSetting } = require('../db');
const { nowIso } = require('../lib/datetime');
const outbox = require('./outbox');
const workflow = require('./workflow');

/**
 * The background worker.
 *
 * On every tick it does four things, in order:
 *
 *   1. closes events that finished more than an hour ago, so their thank you
 *      and feedback messages have a completed event to hang from;
 *   2. materialises the outbox for every live event, which picks up new
 *      students, new reminders and changed timings without anyone asking;
 *   3. sends what is due;
 *   4. records the result so the interface can show that the worker is alive.
 *
 * Ticks never overlap. If a tick is still running when the next is due, the
 * next is skipped rather than queued, which keeps a slow SMTP server from
 * building a backlog of concurrent passes over the same rows.
 */

let timer = null;
let running = false;
let lastRun = null;
let lastError = null;
let ticks = 0;

async function tick({ trigger = 'timer' } = {}) {
  if (running) return { skipped: true, reason: 'A tick is already in progress.' };
  running = true;
  const startedAt = Date.now();
  const result = { trigger, started_at: nowIso(), completed: [], materialised: null, dispatch: null };

  try {
    result.completed = workflow.autoCompleteFinishedEvents();
    result.materialised = outbox.materialiseAll();
    result.dispatch = await outbox.dispatch({ limit: config.scheduler.batchSize });
    lastError = null;
  } catch (error) {
    lastError = { message: error.message, at: nowIso() };
    result.error = error.message;
  } finally {
    running = false;
    ticks += 1;
    result.duration_ms = Date.now() - startedAt;
    lastRun = result;
    try {
      setSetting('scheduler_last_run', JSON.stringify({
        at: result.started_at,
        duration_ms: result.duration_ms,
        sent: result.dispatch ? result.dispatch.sent : 0,
        error: result.error || null,
      }));
    } catch {
      // A settings write failure must not stop the worker.
    }
  }
  return result;
}

function start() {
  if (!config.scheduler.enabled) return { started: false, reason: 'The scheduler is switched off by configuration.' };
  if (timer) return { started: true, alreadyRunning: true };
  const intervalMs = config.scheduler.intervalSeconds * 1000;
  timer = setInterval(() => {
    tick({ trigger: 'timer' }).catch(() => { /* recorded in lastError */ });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  // Run once at start so a restart does not wait a whole interval.
  setTimeout(() => tick({ trigger: 'startup' }).catch(() => {}), 1500).unref?.();
  return { started: true, intervalSeconds: config.scheduler.intervalSeconds };
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  return { stopped: true };
}

function status() {
  let persisted = null;
  try {
    const raw = getSetting('scheduler_last_run');
    persisted = raw ? JSON.parse(raw) : null;
  } catch {
    persisted = null;
  }
  return {
    enabled: config.scheduler.enabled,
    running: Boolean(timer),
    in_progress: running,
    interval_seconds: config.scheduler.intervalSeconds,
    batch_size: config.scheduler.batchSize,
    max_lateness_minutes: config.scheduler.maxLatenessMinutes,
    dry_run: config.dryRun,
    ticks_this_process: ticks,
    last_run: lastRun,
    last_run_persisted: persisted,
    last_error: lastError,
  };
}

module.exports = { start, stop, tick, status };
