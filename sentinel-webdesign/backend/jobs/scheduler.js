/**
 * backend/jobs/scheduler.js
 *
 * Phase P: small in-process job scheduler.
 * - Each job has a name, an interval (or a custom `due()` check for calendar jobs),
 *   and runs either on every node or only on the collector leader.
 * - A run never overlaps the previous run of the same job.
 * - Start/finish/duration, last success and last error are recorded and exposed
 *   read-only through GET /api/v2/jobs/status.
 * - Intervals and on/off flags come from `jobs:` in config/global.yaml.
 */

let leaderLock = null;
try {
  leaderLock = require('@sentinel/database/leader_lock');
} catch (_) {
  try { leaderLock = require('../../database/leader_lock'); } catch (__) { leaderLock = null; }
}

const TICK_MS = Number(process.env.SENTINEL_JOBS_TICK_MS) || 5000;

// Simple job scheduler: runs due jobs on the leader node only.
class JobScheduler {
  // Creates the scheduler.
  constructor({ isLeader, now, log } = {}) {
    this.jobs = new Map();
    this.timer = null;
    this.started = false;
    this.isLeader = isLeader || (() => (leaderLock ? leaderLock.isLeader() : true));
    this.now = now || (() => Date.now());
    this.log = log || ((level, msg) => {
      if (level === 'error') console.error(msg);
      else if (process.env.SENTINEL_JOBS_QUIET !== 'true') console.log(msg);
    });
  }

  /**
   * @param {object} job
   * @param {string} job.name
   * @param {string} job.task     plan task id, e.g. 'P1'
   * @param {number} [job.intervalMs]
   * @param {function} [job.due]  (nowMs, state) => boolean; replaces intervalMs for calendar jobs
   * @param {boolean} [job.leaderOnly=true]
   * @param {boolean} [job.enabled=true]
   * @param {function} job.run    async (ctx) => summary object
   */
  register(job) {
    if (!job || !job.name || typeof job.run !== 'function') {
      throw new Error('[JOBS] register() needs a name and a run function');
    }
    this.jobs.set(job.name, {
      leaderOnly: true,
      enabled: true,
      ...job,
      state: {
        runs: 0,
        failures: 0,
        running: false,
        lastStartAt: null,
        lastFinishAt: null,
        lastDurationMs: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        lastResult: null,
        lastSkipReason: null,
        nextDueAt: null
      }
    });
    return this;
  }

  // True when a job is due.
  isDue(job, nowMs) {
    if (typeof job.due === 'function') return job.due(nowMs, job.state);
    if (!job.state.lastStartAt) return true;
    return nowMs - new Date(job.state.lastStartAt).getTime() >= job.intervalMs;
  }

  /** Runs one job now (used by the tick loop and by tests). */
  async runJob(name, { force = false } = {}) {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`[JOBS] Unknown job ${name}`);
    const st = job.state;
    if (st.running) return { skipped: true, reason: 'ALREADY_RUNNING' };
    if (!job.enabled && !force) {
      st.lastSkipReason = 'DISABLED';
      return { skipped: true, reason: 'DISABLED' };
    }
    if (job.leaderOnly && !this.isLeader()) {
      st.lastSkipReason = 'NOT_LEADER';
      // A follower checks again on the next interval, not on every tick.
      st.lastStartAt = new Date(this.now()).toISOString();
      return { skipped: true, reason: 'NOT_LEADER' };
    }

    st.running = true;
    st.lastSkipReason = null;
    const started = this.now();
    st.lastStartAt = new Date(started).toISOString();
    this.log('info', `[JOBS] ${job.task || ''} ${name} started`);
    try {
      const result = await job.run({ now: () => this.now(), scheduler: this });
      st.runs++;
      st.lastResult = result === undefined ? null : result;
      st.lastSuccessAt = new Date(this.now()).toISOString();
      return result;
    } catch (err) {
      st.runs++;
      st.failures++;
      st.lastError = err && err.message ? err.message : String(err);
      st.lastErrorAt = new Date(this.now()).toISOString();
      this.log('error', `[JOBS] ${name} failed: ${st.lastError}`);
      return { error: st.lastError };
    } finally {
      st.running = false;
      st.lastFinishAt = new Date(this.now()).toISOString();
      st.lastDurationMs = this.now() - started;
      this.log('info', `[JOBS] ${name} finished in ${st.lastDurationMs}ms`);
    }
  }

  // Runs every due job once.
  async tick() {
    const nowMs = this.now();
    const due = [];
    for (const job of this.jobs.values()) {
      if (!job.enabled || job.state.running) continue;
      if (this.isDue(job, nowMs)) due.push(job.name);
    }
    // Jobs are independent; a slow one must not hold back the others.
    await Promise.all(due.map(name => this.runJob(name).catch(() => {})));
  }

  // Starts the timer.
  start() {
    if (this.started) return;
    this.started = true;
    const loop = () => {
      if (!this.started) return;
      this.tick().finally(() => {
        if (!this.started) return;
        this.timer = setTimeout(loop, TICK_MS);
        if (this.timer.unref) this.timer.unref();
      });
    };
    loop();
  }

  // Stops the timer.
  stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // Status of every job.
  getStatus() {
    const jobs = [];
    for (const job of this.jobs.values()) {
      const st = job.state;
      jobs.push({
        name: job.name,
        task: job.task || null,
        enabled: job.enabled,
        leader_only: job.leaderOnly,
        interval_seconds: job.intervalMs ? Math.round(job.intervalMs / 1000) : null,
        schedule: job.scheduleText || null,
        running: st.running,
        runs: st.runs,
        failures: st.failures,
        last_start_at: st.lastStartAt,
        last_finish_at: st.lastFinishAt,
        last_duration_ms: st.lastDurationMs,
        last_success_at: st.lastSuccessAt,
        last_error_at: st.lastErrorAt,
        last_error: st.lastError,
        last_skip_reason: st.lastSkipReason,
        last_result: st.lastResult
      });
    }
    return {
      started: this.started,
      leader: this.isLeader(),
      jobs
    };
  }
}

module.exports = { JobScheduler };
