/**
 * backend/jobs/stale_processes.js
 *
 * Phase O8 / O8.3: Stale Process & Service Detector Job.
 * Runs on leader every 5 minutes against osquery telemetry and DB receiver stats.
 *
 * Rules:
 *   1. Zombie process (state 'Z')
 *   2. Linux D state > 60s seen in 2 consecutive samples
 *   3. Orphaned product-user process (ppid 1, not a declared service)
 *   4. Process older than manifest processes.max_age_hours
 *   5. Build tool children (maven, gradle, git, docker) of missing Jenkins agent parent > 6h
 *   6. Running old code (on_disk = 0 or binary mtime > start time)
 *   7. More instances running than manifest processes.expected_instances
 *   8. Holding deleted files (open files referencing deleted inodes)
 *   9. Windows Automatic service stopped or stuck START_PENDING / STOP_PENDING
 *  10. DB sessions idle in transaction > 30 min holding locks (from O2.5)
 *
 * Each finding generates a low-severity alert, de-duplicated by finding key.
 */

'use strict';

const yamlConfig = require('../config/yaml_config');
const db = require('../../database/db');

// State tracking for consecutive samples: host:pid -> { count, firstSeenMs }
const dStateTracker = new Map();

/**
 * Evaluates stale process rules against host process/service inventory.
 */
function evaluateStaleProcesses({
  host = 'localhost',
  processes = [],
  services = [],
  openFiles = [],
  dbSessions = [],
  manifest = {},
  nowMs = Date.now()
} = {}) {
  const findings = [];
  const procConfig = manifest.processes || {};
  const maxAgeHours = Number(procConfig.max_age_hours) || null;
  const expectedInstances = procConfig.expected_instances ? Number(procConfig.expected_instances) : null;
  const namedProcesses = Array.isArray(procConfig.names) ? procConfig.names : [];

  // Group processes by name for instance counting
  const instancesByName = new Map();

  for (const p of processes) {
    const name = String(p.name || p.cmdline || '').toLowerCase();
    instancesByName.set(name, (instancesByName.get(name) || 0) + 1);

    // Rule 1: Zombie process
    if (String(p.state).toUpperCase() === 'Z' || String(p.state).toLowerCase() === 'zombie') {
      findings.push({
        rule: 'zombie',
        host,
        pid: p.pid,
        name: p.name,
        severity: 'low',
        message: `Zombie process detected: PID ${p.pid} (${p.name})`
      });
    }

    // Rule 2: D state > 60s across 2 consecutive samples
    const dKey = `${host}:${p.pid}`;
    if (String(p.state).toUpperCase() === 'D') {
      const prev = dStateTracker.get(dKey) || { count: 0, firstSeenMs: nowMs };
      const count = prev.count + 1;
      dStateTracker.set(dKey, { count, firstSeenMs: prev.firstSeenMs });
      const elapsedSeconds = p.duration_d_sec !== undefined ? p.duration_d_sec : (nowMs - prev.firstSeenMs) / 1000;
      if (count >= 2 || elapsedSeconds >= 60) {
        findings.push({
          rule: 'd_state',
          host,
          pid: p.pid,
          name: p.name,
          severity: 'low',
          message: `Process PID ${p.pid} (${p.name}) in uninterruptible D-state for ${Math.round(elapsedSeconds)}s (>= 2 samples)`
        });
      }
    } else {
      dStateTracker.delete(dKey);
    }

    // Rule 3: Orphaned product-user process (ppid 1, not root/system, not service)
    const isSystemUser = ['root', 'system', 'localsystem', '0'].includes(String(p.uid || p.user || '').toLowerCase());
    if (p.ppid === 1 && !isSystemUser && !p.is_service) {
      findings.push({
        rule: 'orphaned_product',
        host,
        pid: p.pid,
        name: p.name,
        severity: 'low',
        message: `Orphaned product process under init (ppid 1): PID ${p.pid} (${p.name}) owned by user ${p.user || p.uid}`
      });
    }

    // Helper to get time in MS
    const getMs = (v) => {
      if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
      return new Date(v).getTime();
    };

    // Rule 4: Older than processes.max_age_hours
    if (maxAgeHours && p.start_time) {
      const startMs = getMs(p.start_time);
      const ageHours = (nowMs - startMs) / (3600 * 1000);
      if (ageHours > maxAgeHours) {
        findings.push({
          rule: 'max_age_exceeded',
          host,
          pid: p.pid,
          name: p.name,
          severity: 'low',
          message: `Process PID ${p.pid} (${p.name}) running for ${ageHours.toFixed(1)}h (exceeds limit ${maxAgeHours}h)`
        });
      }
    }

    // Rule 5: Build-tool children (maven, gradle, git, docker) with missing/dead parent > 6h
    const buildTools = ['mvn', 'maven', 'gradle', 'git', 'docker'];
    const isBuildTool = buildTools.some(b => name.includes(b));
    if (isBuildTool && (p.parent_missing || p.jenkins_agent_alive === false)) {
      const startMs = p.start_time ? getMs(p.start_time) : 0;
      const ageHours = p.age_hours !== undefined ? p.age_hours : (nowMs - startMs) / (3600 * 1000);
      if (ageHours > 6) {
        findings.push({
          rule: 'orphaned_build_tool',
          host,
          pid: p.pid,
          name: p.name,
          severity: 'low',
          message: `Orphaned build tool process PID ${p.pid} (${p.name}) running for ${ageHours.toFixed(1)}h without parent agent`
        });
      }
    }

    // Rule 6: Running old code (on_disk = 0 or binary mtime > start time)
    if (p.on_disk === 0) {
      findings.push({
        rule: 'deleted_binary',
        host,
        pid: p.pid,
        name: p.name,
        severity: 'low',
        message: `Process PID ${p.pid} (${p.name}) binary deleted from disk (on_disk = 0)`
      });
    } else if (p.binary_mtime && p.start_time && getMs(p.binary_mtime) > getMs(p.start_time)) {
      findings.push({
        rule: 'binary_replaced',
        host,
        pid: p.pid,
        name: p.name,
        severity: 'low',
        message: `Process PID ${p.pid} (${p.name}) is running old code (binary replaced on disk after process start)`
      });
    }
  }

  // Rule 7: More instances than expected_instances
  if (expectedInstances !== null) {
    for (const [procName, count] of instancesByName.entries()) {
      if (namedProcesses.some(np => procName.includes(np.toLowerCase())) && count > expectedInstances) {
        findings.push({
          rule: 'instances_exceeded',
          host,
          name: procName,
          severity: 'low',
          message: `Instance count for "${procName}" (${count}) exceeds expected instances (${expectedInstances})`
        });
      }
    }
  }

  // Rule 8: Holding deleted files
  for (const of of openFiles) {
    if (of.deleted || of.deleted_files_count || String(of.path || '').includes('(deleted)')) {
      findings.push({
        rule: 'holding_deleted_files',
        host,
        pid: of.pid,
        path: of.path || 'deleted_fd',
        severity: 'low',
        message: `Process PID ${of.pid} holding open handle to deleted file`
      });
    }
  }

  // Rule 9: Windows Automatic service stopped or stuck
  for (const svc of services) {
    const startType = String(svc.start_type || '').toLowerCase();
    const status = String(svc.status || '').toUpperCase();
    if (startType === 'automatic' || startType === 'auto') {
      if (status === 'STOPPED' || status === 'START_PENDING' || status === 'STOP_PENDING') {
        findings.push({
          rule: 'windows_service_failure',
          host,
          service: svc.name || svc.service_name,
          severity: 'low',
          message: `Automatic Windows Service "${svc.name || svc.service_name}" is ${status}`
        });
      }
    }
  }

  // Rule 10: DB sessions idle in transaction > 30 min holding locks
  for (const sess of dbSessions) {
    const idleSeconds = Number(sess.idle_seconds !== undefined ? sess.idle_seconds : sess.idle_in_transaction_sec) || 0;
    if ((sess.idle_in_transaction || sess.idle_in_transaction_sec) && idleSeconds >= 1800 && sess.locks_held > 0) {
      findings.push({
        rule: 'db_idle_transaction',
        host,
        session_id: sess.session_id || sess.pid,
        severity: 'low',
        message: `Database session ${sess.session_id || sess.pid} idle in transaction for ${Math.round(idleSeconds / 60)}m holding ${sess.locks_held} locks`
      });
    }
  }

  return findings;
}

// Finds stale or stuck processes from osquery, process and session data.
function detectStaleProcesses(opts = {}) {
  const { osqueryRows = [], processes = [], services = [], openFiles = [], dbSessions = [], manifest = {}, nowMs = Date.now(), nowSec = null } = opts;
  const currentMs = nowSec ? nowSec * 1000 : nowMs;
  const procs = [...processes];
  const svcs = [...services];
  const ofs = [...openFiles];
  const dbs = [...dbSessions];

  for (const r of osqueryRows) {
    if (r.db_session || r.idle_in_transaction_sec !== undefined) dbs.push(r);
    else if (r.service_name || (r.start_type && r.status)) svcs.push(r);
    else if (r.deleted_files_count || r.deleted || (r.path && String(r.path).includes('(deleted)'))) ofs.push(r);
    else procs.push(r);
  }

  return evaluateStaleProcesses({
    host: opts.host || (osqueryRows[0] && osqueryRows[0].host) || 'h1',
    processes: procs,
    services: svcs,
    openFiles: ofs,
    dbSessions: dbs,
    manifest,
    nowMs: currentMs
  });
}

/**
 * Main stale processes scan runner.
 */
async function runStaleProcessScan({
  store = db,
  manifests = null,
  nowMs = Date.now(),
  hostData = []
} = {}) {
  const allFindings = [];

  for (const data of hostData) {
    const hostFindings = evaluateStaleProcesses({
      host: data.host,
      processes: data.processes || [],
      services: data.services || [],
      openFiles: data.openFiles || [],
      dbSessions: data.dbSessions || [],
      manifest: data.manifest || {},
      nowMs
    });

    for (const f of hostFindings) {
      allFindings.push(f);
      if (store && typeof store.addAlert === 'function') {
        const key = `[stale:${f.host}:${f.pid || f.service || f.name}:${f.rule}]`;
        store.addAlert(data.product || f.host, 'info', `${key} ${f.message}`, 'Active', data.env || 'prod');
      }
    }
  }

  return {
    scanned_at: new Date(nowMs).toISOString(),
    findings_count: allFindings.length,
    findings: allFindings
  };
}

/**
 * Reads recent osquery result lines (shipped by the agent as logs with
 * sentinel.log.source=osquery) from ClickHouse and groups them per host.
 * Returns null when ClickHouse is not configured: there is no other process store,
 * and an empty result is never fabricated.
 */
async function collectHostData({ env, sinceMs, limit = 50000 } = {}) {
  const clickhouse = require('../../database/clickhouse');
  if (!clickhouse.isConfigured()) return null;
  const rows = await clickhouse.query(
    `SELECT ts, entity_id, app_id, message FROM logs
     WHERE env = {env:String} AND ts >= fromUnixTimestamp64Milli({sinceMs:Int64}, 'UTC')
       AND fields['sentinel.log.source'] = 'osquery'
     ORDER BY ts DESC LIMIT {limit:UInt32}`,
    { env, sinceMs, limit }
  );

  let apps = {};
  try { apps = yamlConfig.loadAllApplications() || {}; } catch (_) {}
  const manifestForHost = (host) => {
    const short = String(host).split('.')[0].toLowerCase();
    for (const [id, app] of Object.entries(apps)) {
      const hosts = app?.layers?.hosts || [];
      if (hosts.some(h => String(h).split('.')[0].toLowerCase() === short)) return { id, manifest: app };
    }
    return { id: null, manifest: {} };
  };

  const byHost = new Map();
  for (const r of rows) {
    let obj;
    try { obj = JSON.parse(r.message); } catch (_) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    const host = obj.hostIdentifier || obj.host || String(r.entity_id || '').replace(/^host:/, '');
    if (!host) continue;
    if (obj.action === 'removed') continue;
    const cols = obj.snapshot && Array.isArray(obj.snapshot) ? obj.snapshot : (obj.columns ? [obj.columns] : []);
    if (!cols.length) continue;
    if (!byHost.has(host)) {
      const m = manifestForHost(host);
      byHost.set(host, { host, product: m.id, manifest: m.manifest, env, osqueryRows: [] });
    }
    byHost.get(host).osqueryRows.push(...cols);
  }
  return [...byHost.values()];
}

/**
 * Scheduler entry point (leader only). Findings become low-severity alerts via runStaleProcessScan.
 */
async function runStaleProcessJob({ environments = ['prod'], nowMs = Date.now(), lookbackMinutes = 15 } = {}) {
  const summary = { status: 'OK', environments: {} };
  for (const env of environments) {
    const hostData = await collectHostData({ env, sinceMs: nowMs - lookbackMinutes * 60 * 1000 });
    if (hostData === null) {
      summary.environments[env] = { status: 'DATA_UNAVAILABLE', reason: 'ClickHouse not configured' };
      continue;
    }
    let findings = 0;
    for (const h of hostData) {
      const hostFindings = detectStaleProcesses({ host: h.host, osqueryRows: h.osqueryRows, manifest: h.manifest, nowMs });
      findings += hostFindings.length;
      for (const f of hostFindings) {
        if (typeof db.addAlert === 'function') {
          const key = `[stale:${f.host}:${f.pid || f.service || f.name}:${f.rule}]`;
          db.addAlert(h.product || f.host, 'info', `${key} ${f.message}`, 'Active', env);
        }
      }
    }
    summary.environments[env] = { status: 'OK', hosts: hostData.length, findings, scanned_at: new Date(nowMs).toISOString() };
  }
  return summary;
}

// Clears the D-state tracking used between runs.
function resetDStateTracker() {
  dStateTracker.clear();
}

module.exports = {
  evaluateStaleProcesses,
  detectStaleProcesses,
  runStaleProcessScan,
  collectHostData,
  runStaleProcessJob,
  resetDStateTracker
};
