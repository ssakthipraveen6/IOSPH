/**
 * backend/jobs/job_config.js
 *
 * Reads `jobs:` from config/global.yaml. Every job can be switched off and its
 * interval changed there; missing values fall back to the defaults below.
 */

const yamlConfig = require('../config/yaml_config');

const DEFAULTS = {
  environments: ['prod', 'staging'],
  vip_probes: { enabled: true, interval_seconds: 60 },
  avi_overhead: { enabled: true, interval_seconds: 60 },
  baselines: { enabled: true, interval_seconds: 3600, lookback_days: 28 },
  change_points: { enabled: true, interval_seconds: 900, window_hours: 24, bucket_minutes: 15 },
  alert_rules: { enabled: true, interval_seconds: 60 },
  problem_grouping: { enabled: true, interval_seconds: 60 },
  scorecard: { enabled: true, weekday: 1, hour: 6 },
  cve_scan: { enabled: true, interval_seconds: 86400 },
  fleet_health: { enabled: true, interval_seconds: 60, silent_after_seconds: 300 },
  stale_processes: { enabled: true, interval_seconds: 300, lookback_minutes: 15 },
  log_archive: { enabled: true, interval_seconds: 86400, retention_days: 14, s3_bucket: '', s3_region: 'us-east-1', s3_prefix: 'sentinel/logs', delete_local_after_upload: false },
  inventory_sync: { enabled: true, interval_seconds: 900 }
};

// jobs section of config/global.yaml merged over the defaults.
function getJobsConfig() {
  let cfg = {};
  try {
    cfg = (yamlConfig.loadGlobalConfig() || {}).jobs || {};
  } catch (_) {
    cfg = {};
  }
  const out = { environments: Array.isArray(cfg.environments) && cfg.environments.length ? cfg.environments : DEFAULTS.environments };
  for (const [name, def] of Object.entries(DEFAULTS)) {
    if (name === 'environments') continue;
    out[name] = { ...def, ...(cfg[name] || {}) };
  }
  return out;
}

// config/global.yaml (empty object when unreadable).
function getGlobal() {
  try { return yamlConfig.loadGlobalConfig() || {}; } catch (_) { return {}; }
}

module.exports = { getJobsConfig, getGlobal, DEFAULTS };
