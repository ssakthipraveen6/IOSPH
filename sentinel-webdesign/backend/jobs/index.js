/**
 * backend/jobs/index.js
 *
 * Phase P: wires the background jobs P1–P10 into one scheduler.
 * Started from backend/server.js after collector.start(), stopped in shutdown().
 * Status: GET /api/v2/jobs/status (read-only).
 */

const { JobScheduler } = require('./scheduler');
const { getJobsConfig, getGlobal } = require('./job_config');
const { runVipProbes } = require('./vip_probes');
const { runAviOverhead } = require('./avi_overhead');
const { runChangePointScan } = require('./change_points');
const { runAlertRules } = require('./alert_rules');
const { runProblemGrouping } = require('./problem_grouping');
const { runWeeklyScorecards, isScorecardDue, weekStartOf } = require('./scorecard_weekly');
const { runCveScan } = require('./cve_scan');
const { runFleetHealth } = require('./fleet_health');
const baselines = require('../../ai_analysis/baselines');

let scheduler = null;

// Registers every background job with its interval (from config/global.yaml jobs).
function buildScheduler(options = {}) {
  const cfg = getJobsConfig();
  const envs = cfg.environments;
  const sec = (n) => Number(n) * 1000;
  const s = new JobScheduler(options);

  s.register({
    name: 'vip_probes', task: 'P1', leaderOnly: false,
    enabled: cfg.vip_probes.enabled !== false, intervalMs: sec(cfg.vip_probes.interval_seconds),
    run: () => {
      let onResults = null;
      try { onResults = require('../../inventory/sources/vip_discovery').recordVipDiscovery; } catch (_) { onResults = null; }
      return runVipProbes({ environments: envs, onResults });
    }
  });
  s.register({
    name: 'avi_overhead', task: 'P2',
    enabled: cfg.avi_overhead.enabled !== false, intervalMs: sec(cfg.avi_overhead.interval_seconds),
    run: ({ now }) => runAviOverhead({ environments: envs, nowMs: now() })
  });
  s.register({
    name: 'baselines', task: 'P3',
    enabled: cfg.baselines.enabled !== false, intervalMs: sec(cfg.baselines.interval_seconds),
    run: ({ now }) => baselines.computeBaselinesFromClickHouse(Number(cfg.baselines.lookback_days) || 28, { nowMs: now(), skipLeaderCheck: true })
  });
  s.register({
    name: 'change_points', task: 'P4',
    enabled: cfg.change_points.enabled !== false, intervalMs: sec(cfg.change_points.interval_seconds),
    run: ({ now }) => runChangePointScan({
      environments: envs,
      nowMs: now(),
      windowHours: Number(cfg.change_points.window_hours) || 24,
      bucketMinutes: Number(cfg.change_points.bucket_minutes) || 15
    })
  });
  s.register({
    name: 'alert_rules', task: 'P5',
    enabled: cfg.alert_rules.enabled !== false, intervalMs: sec(cfg.alert_rules.interval_seconds),
    run: ({ now }) => runAlertRules({ environments: envs, nowMs: now() })
  });
  s.register({
    name: 'problem_grouping', task: 'P6/P7',
    enabled: cfg.problem_grouping.enabled !== false, intervalMs: sec(cfg.problem_grouping.interval_seconds),
    run: ({ now }) => runProblemGrouping({ environments: envs, nowMs: now() })
  });

  let lastScorecardWeek = null;
  s.register({
    name: 'weekly_scorecard', task: 'P8',
    enabled: cfg.scorecard.enabled !== false,
    scheduleText: `weekly, weekday ${cfg.scorecard.weekday} at ${String(cfg.scorecard.hour).padStart(2, '0')}:00 server time`,
    due: (nowMs) => isScorecardDue(nowMs, lastScorecardWeek, { weekday: Number(cfg.scorecard.weekday), hour: Number(cfg.scorecard.hour) }),
    run: async ({ now }) => {
      const result = await runWeeklyScorecards({ environments: envs, nowMs: now(), weekday: Number(cfg.scorecard.weekday) });
      lastScorecardWeek = weekStartOf(new Date(now()), Number(cfg.scorecard.weekday));
      return result;
    }
  });
  s.register({
    name: 'cve_scan', task: 'P9',
    enabled: cfg.cve_scan.enabled !== false, intervalMs: sec(cfg.cve_scan.interval_seconds),
    run: () => runCveScan({ environments: envs, settings: ((getGlobal().security || {}).cve_scan) || {} })
  });
  s.register({
    name: 'fleet_health', task: 'P10',
    enabled: cfg.fleet_health.enabled !== false, intervalMs: sec(cfg.fleet_health.interval_seconds),
    run: ({ now }) => runFleetHealth({ environments: envs, nowMs: now(), silentAfterSeconds: Number(cfg.fleet_health.silent_after_seconds) || 300 })
  });
  s.register({
    name: 'expiry_sync', task: 'O7.1/O7.3', leaderOnly: true,
    enabled: true, intervalMs: 15 * 60 * 1000,
    run: ({ now }) => {
      const { runExpirySync } = require('./expiry_sync');
      return runExpirySync({ nowMs: now() });
    }
  });
  s.register({
    name: 'stale_processes', task: 'O8.3', leaderOnly: true,
    enabled: cfg.stale_processes.enabled !== false, intervalMs: sec(cfg.stale_processes.interval_seconds),
    run: ({ now }) => {
      const { runStaleProcessJob } = require('./stale_processes');
      return runStaleProcessJob({ environments: envs, nowMs: now(), lookbackMinutes: Number(cfg.stale_processes.lookback_minutes) || 15 });
    }
  });
  s.register({
    name: 'log_archive', task: 'P11', leaderOnly: true,
    enabled: cfg.log_archive.enabled !== false, intervalMs: sec(cfg.log_archive.interval_seconds),
    run: async () => {
      const { archiveLogs } = require('../../logs_collection/archival/s3_archiver');
      const results = {};
      for (const environment of envs) {
        results[environment] = await archiveLogs({
          environment,
          retentionDays: Number(cfg.log_archive.retention_days) || 14,
          s3Bucket: cfg.log_archive.s3_bucket,
          s3Region: cfg.log_archive.s3_region,
          s3Prefix: cfg.log_archive.s3_prefix,
          deleteLocalAfterUpload: cfg.log_archive.delete_local_after_upload === true
        });
      }
      return results;
    }
  });
  s.register({
    name: 'inventory_sync', task: 'P12', leaderOnly: true,
    enabled: cfg.inventory_sync.enabled !== false, intervalMs: sec(cfg.inventory_sync.interval_seconds),
    run: () => require('@sentinel/inventory').syncAllSources()
  });
  s.register({
    name: 'url_checks', task: 'O7.5', leaderOnly: false,
    enabled: true, intervalMs: 5 * 60 * 1000,
    run: ({ now }) => {
      const { runUrlChecks } = require('./url_checks');
      return runUrlChecks({ nowMs: now() });
    }
  });
  return s;
}

/** Starts all jobs once. Loads persisted baselines first (every node). */
function startJobs(options = {}) {
  if (scheduler) return scheduler;
  scheduler = buildScheduler(options);
  baselines.loadBaselinesFromClickHouse()
    .then(r => { if (r && r.status === 'SUCCESS') console.log(`[JOBS] Loaded ${r.loaded} persisted baselines.`); })
    .catch(err => console.warn('[JOBS] Could not load persisted baselines:', err.message));
  scheduler.start();
  return scheduler;
}

// Stops the scheduler.
function stopJobs() {
  if (scheduler) scheduler.stop();
}

// The running scheduler.
function getScheduler() {
  return scheduler;
}

// Status of every job.
function getJobsStatus() {
  if (!scheduler) return { started: false, jobs: [] };
  return scheduler.getStatus();
}

module.exports = { buildScheduler, startJobs, stopJobs, getScheduler, getJobsStatus };
