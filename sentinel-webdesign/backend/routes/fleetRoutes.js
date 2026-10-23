/**
 * backend/routes/fleetRoutes.js — U2
 *
 * Fleet view data (Govern › Agents and Observe › Hosts).
 *
 *   GET /overview  — every host entity in the session's environment with its agent
 *                    state, plus a summary: version distribution, coverage against
 *                    `fleet.expected_hosts` (config/global.yaml), silent and drifted counts.
 *
 * Sources, nothing synthesised:
 *  - host entities and their heartbeat labels (agent_version, os, config_hash,
 *    last_heartbeat) written by POST /api/v2/shipper/heartbeat into @sentinel/inventory;
 *  - drift state written to the same labels by the P10 fleet-health job
 *    (config_drift, expected_config_hash); for a host P10 has not labelled, the
 *    reported config_hash is compared with the hash /api/v2/agent/config serves
 *    (P10's own comparison). No reported hash → 'unknown';
 *  - silent = last heartbeat older than jobs.fleet_health.silent_after_seconds (P10's threshold).
 *
 * No host entity at all → { status: 'DATA_UNAVAILABLE', reason, ... }.
 * Coverage is null when `fleet.expected_hosts` is not configured.
 */

const express = require('express');
const { requestEnvironment } = require('./_prototype');
const { getJobsConfig, getGlobal } = require('../jobs/job_config');

const DEFAULT_SILENT_AFTER_SECONDS = 300;

/** `fleet.expected_hosts` as a positive integer, or null when not configured / invalid. */
function readExpectedHosts(globalCfg) {
  const raw = globalCfg && globalCfg.fleet ? globalCfg.fleet.expected_hosts : undefined;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// Host name of an inventory entity.
function hostName(entity) {
  return entity.name || String(entity.entity_id || '').replace(/^host:/, '');
}

// ISO date or null.
function toIso(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Drift state: 'in_sync' | 'drifted' | 'unknown', with where it came from.
 *  1. P10's outputs on the host labels (expected_config_hash, else config_drift);
 *  2. otherwise the served hash rendered now (renderAgentConfig), the same
 *     comparison P10 makes — P10 only writes labels when the drift state changes,
 *     so a host that has always been in sync carries no P10 label;
 *  3. no reported config_hash, or no way to render → 'unknown'.
 */
function driftState(labels, expectedHash = null) {
  if (!labels.config_hash) return { state: 'unknown', source: null };
  if (labels.expected_config_hash) {
    return { state: labels.expected_config_hash === labels.config_hash ? 'in_sync' : 'drifted', source: 'p10' };
  }
  if (typeof labels.config_drift === 'boolean') return { state: labels.config_drift ? 'drifted' : 'in_sync', source: 'p10' };
  if (expectedHash) return { state: expectedHash === labels.config_hash ? 'in_sync' : 'drifted', source: 'served_config' };
  return { state: 'unknown', source: null };
}

/** The hash /api/v2/agent/config serves this host today (P10's comparison), or null. */
function servedConfigHash(entity, environment, render) {
  if (!render) return null;
  const labels = entity.labels || {};
  try {
    return render({ host: hostName(entity), os: labels.os || '', agentVersion: labels.agent_version || null, env: environment }).config_hash || null;
  } catch (_) {
    return null;
  }
}

/** One host row. */
function shapeHost(entity, { nowMs, silentAfterSeconds, environment, render = null }) {
  const labels = entity.labels || {};
  const needsRender = labels.last_heartbeat && labels.config_hash && !labels.expected_config_hash && typeof labels.config_drift !== 'boolean';
  const drift = driftState(labels, needsRender ? servedConfigHash(entity, environment, render) : null);
  const lastHeartbeat = toIso(labels.last_heartbeat);
  const hasAgent = Boolean(lastHeartbeat);
  const ageSeconds = hasAgent ? Math.max(0, Math.round((nowMs - new Date(lastHeartbeat).getTime()) / 1000)) : null;
  return {
    entity_id: entity.entity_id,
    host: hostName(entity),
    os: labels.os || null,
    agent_version: labels.agent_version || labels.shipper_version || null,
    has_agent: hasAgent,
    last_seen: lastHeartbeat || toIso(entity.last_seen),
    last_heartbeat: lastHeartbeat,
    heartbeat_age_seconds: ageSeconds,
    silent: hasAgent ? ageSeconds > silentAfterSeconds : null,
    drift: hasAgent ? drift.state : 'unknown',
    drift_source: hasAgent ? drift.source : null,
    config_hash: labels.config_hash || null,
    expected_config_hash: labels.expected_config_hash || null,
    status: entity.status || null,
    region: entity.region || null
  };
}

/**
 * Pure shaping: host entities → fleet overview payload.
 * @param {object} p
 * @param {Array}  p.entities           host entities from inventory
 * @param {string} p.environment
 * @param {number|null} p.expectedHosts `fleet.expected_hosts` or null
 * @param {number} p.silentAfterSeconds
 * @param {number} p.nowMs
 * @param {Function|null} p.render     renderAgentConfig, for hosts P10 has not labelled
 */
function shapeFleetOverview({ entities, environment, expectedHosts = null, silentAfterSeconds = DEFAULT_SILENT_AFTER_SECONDS, nowMs = Date.now(), render = null }) {
  const list = (Array.isArray(entities) ? entities : []).filter(e => e && String(e.kind || '').toLowerCase() === 'host');
  const expected = Number.isFinite(expectedHosts) && expectedHosts > 0 ? expectedHosts : null;

  if (list.length === 0) {
    return {
      status: 'DATA_UNAVAILABLE',
      environment,
      reason: 'No host has been discovered or has sent an agent heartbeat in this environment.',
      expected_hosts: expected,
      hosts: [],
      summary: null
    };
  }

  const hosts = list
    .map(e => shapeHost(e, { nowMs, silentAfterSeconds, environment, render }))
    .sort((a, b) => a.host.localeCompare(b.host));
  const agents = hosts.filter(h => h.has_agent);

  const versions = new Map();
  for (const h of agents) {
    const key = h.agent_version || null;
    versions.set(key, (versions.get(key) || 0) + 1);
  }
  const versionDistribution = [...versions.entries()]
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => b.count - a.count || String(a.version).localeCompare(String(b.version)));

  const silent = agents.filter(h => h.silent).length;
  const reporting = agents.length - silent;
  const drifted = agents.filter(h => h.drift === 'drifted').length;
  const inSync = agents.filter(h => h.drift === 'in_sync').length;

  const lastTimes = agents.map(h => new Date(h.last_heartbeat).getTime());
  const lastSeen = lastTimes.length ? new Date(Math.max(...lastTimes)).toISOString() : null;

  return {
    status: 'OK',
    environment,
    generated_at: new Date(nowMs).toISOString(),
    silent_after_seconds: silentAfterSeconds,
    summary: {
      hosts_total: hosts.length,
      agents_total: agents.length,
      hosts_without_agent: hosts.length - agents.length,
      reporting,
      silent,
      drifted,
      in_sync: inSync,
      drift_unknown: agents.length - drifted - inSync,
      last_seen: lastSeen,
      version_distribution: versionDistribution,
      coverage: {
        reporting,
        expected: expected,
        pct: expected ? Math.round((reporting / expected) * 1000) / 10 : null
      }
    },
    hosts
  };
}

/**
 * Router factory. Dependencies are injectable for tests.
 */
function createFleetRouter({
  inv = null,
  loadGlobal = getGlobal,
  loadJobs = getJobsConfig,
  now = () => Date.now(),
  render = null
} = {}) {
  const router = express.Router();

  // Fleet overview: hosts, agents, silent and drifted counts.
  router.get('/overview', async (req, res) => {
    const environment = requestEnvironment(req);
    try {
      const inventory = inv || require('@sentinel/inventory');
      const result = await inventory.getEntities({ kind: 'host', environment, limit: 100000 });
      const entities = Array.isArray(result) ? result : (result && result.entities) || [];
      const jobsCfg = loadJobs() || {};
      const silentAfter = Number(jobsCfg.fleet_health && jobsCfg.fleet_health.silent_after_seconds) || DEFAULT_SILENT_AFTER_SECONDS;
      res.json(shapeFleetOverview({
        entities,
        environment,
        expectedHosts: readExpectedHosts(loadGlobal()),
        silentAfterSeconds: silentAfter,
        nowMs: now(),
        render: render || require('./agentRoutes').renderAgentConfig
      }));
    } catch (err) {
      res.status(500).json({ status: 'ERROR', environment, error: `Fleet overview failed: ${err.message}` });
    }
  });

  return router;
}

const router = createFleetRouter();

module.exports = router;
module.exports.createFleetRouter = createFleetRouter;
module.exports.shapeFleetOverview = shapeFleetOverview;
module.exports.shapeHost = shapeHost;
module.exports.driftState = driftState;
module.exports.readExpectedHosts = readExpectedHosts;
