/**
 * Runs the metric collectors on their intervals (by tier), per environment, on the leader node,
 * and feeds results to analysis and alerting.
 */
const db = require('@sentinel/database');
const { writeNasLog } = require('@sentinel/logger');
const simulations = require('@sentinel/config/simulations');
const config = require('@sentinel/config');
const { customChecks, triggerRecovery } = require('@sentinel/remediation');

// Collectors always come from ./real (the simulated collector tree was removed).
const mode = 'real';
if (config.USE_SIMULATED_COLLECTORS) {
  console.warn('[SYSTEM] USE_SIMULATED_COLLECTORS is set but simulated collectors no longer exist; using real collectors.');
}
console.log(`[SYSTEM] Starting Observability coordinator in [${mode.toUpperCase()}] mode.`);

// Load modular collectors dynamically
const infraCollector = require(`./${mode}/infrastructure/infra_collector`);
const appCollector = require(`./${mode}/applications/app_collector`);
const dynatraceCollector = require(`./${mode}/dynatrace/dynatrace_collector`);
const fluentdCollector = require(`../logs_collection/${mode}/fluentd/fluentd_log_collector`);
const aiAnalyzer = require('@sentinel/analysis').getAnalyzer(mode);
const providerSelector = require('./telemetry_provider_selector');
const leaderLock = require('@sentinel/database/leader_lock');

const timers = [];

// Demo collection lifecycle state:
// Starts collecting for prod/stg environment only by default.
// Demo collection starts ONLY when demo option is selected, and stops when switched to prod or staging.
function setDemoActive(_active) {
  // Phase D: Demo data collection permanently disabled.
}

// Environments to collect for.
function getActiveEnvironments() {
  // Telemetry is collected strictly for staging and prod
  return ['staging', 'prod'];
}

// Runs every collector of one tier.
async function collectTier(tierName) {
  // [M1.9] Only the leader node polls, analyses and self-heals; both nodes serve
  // the UI and accept pushed telemetry.
  if (!leaderLock.isLeader()) return;
  try {
    const activeSims = simulations.getSimulations();
    customChecks.runCustomChecks(activeSims);

    const environments = getActiveEnvironments();
    for (const env of environments) {
      global.collectorEnvironment = env;
      const simsForEnv = (env === 'staging') ? activeSims : {};

      if (tierName === 'high' || tierName === 'all') {
        if (providerSelector.shouldRunCollector('app_collector')) {
          await appCollector.collectAppMetrics(simsForEnv, db, writeNasLog, env);
        }
        
        if (providerSelector.shouldRunCollector('dynatrace')) {
          await dynatraceCollector.collectDynatraceAlerts(db, writeNasLog, env);
          if (config.GLOBAL_YAML?.collectors?.dynatrace?.fetch_host_management) {
            await dynatraceCollector.fetchHostManagementMetrics(db, writeNasLog, env);
          }
        }
        
        const rawLogs = await fluentdCollector.collectFluentdLogs(simsForEnv, db, writeNasLog, env);
        if (aiAnalyzer && typeof aiAnalyzer.analyzeServerLogs === 'function') {
          aiAnalyzer.analyzeServerLogs(rawLogs, writeNasLog, (comp, reason) => {
            triggerRecovery(comp, reason, { manual: false, env });
          }, env);
        }
      }

      if (tierName === 'medium' || tierName === 'all' || tierName === 'low') {
        const infraMetrics = await infraCollector.collectInfraMetrics(simsForEnv, db, writeNasLog, env);
        
        if (global.runPredictiveAnalysis) {
          global.runPredictiveAnalysis(infraMetrics, env);
        }
        if (global.runSelfHealingOrchestrator) {
          global.runSelfHealingOrchestrator(infraMetrics, env);
        }
      }
    }

    if (global.broadcastStateChange) {
      global.broadcastStateChange();
    }
  } catch (err) {
    console.error(`[COORDINATOR] Error in telemetry collection tier [${tierName}]:`, err);
  }
}

const circuitBreaker = require('./shared/circuit_breaker');

const SENTINEL_SHARD_INDEX = parseInt(process.env.SENTINEL_SHARD_INDEX || '0', 10);
const SENTINEL_SHARD_TOTAL = parseInt(process.env.SENTINEL_SHARD_TOTAL || '1', 10);

// True when this node's shard owns the target.
function isTargetAssignedToShard(targetKey) {
  if (SENTINEL_SHARD_TOTAL <= 1) return true;
  let hash = 0;
  for (let i = 0; i < targetKey.length; i++) {
    hash = ((hash << 5) - hash) + targetKey.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % SENTINEL_SHARD_TOTAL === SENTINEL_SHARD_INDEX;
}

// Starts the collector timers.
function start() {
  if (timers.length > 0) return;

  // [T2.4] Role Separation: if SENTINEL_ROLE is 'api', do not run collectors in this process
  if (process.env.SENTINEL_ROLE === 'api') {
    writeNasLog('INFO', 'COORDINATOR', '[ROLE=API] Background collector loops disabled on API node.');
    return;
  }

  writeNasLog('INFO', 'COORDINATOR', `Intelligent Observability Daemon started with Tiered Polling in [${mode.toUpperCase()}] mode (Shard ${SENTINEL_SHARD_INDEX}/${SENTINEL_SHARD_TOTAL}).`);

  // [T2.4] Scheduling jitter prevents stampeding targets simultaneously
  const jitter = () => Math.floor(Math.random() * 1500);

  // [M1.9] Leader election across the two app nodes (standalone without a database).
  if (process.env.SENTINEL_LEADER_LOCK !== 'off') {
    leaderLock.start().catch(err => writeNasLog('WARN', 'COORDINATOR', `Leader lock start failed: ${err.message}`));
  }

  // Immediate initial run with slight jitter
  setTimeout(() => collectTier('all'), jitter());

  // Tier 1: High priority app endpoints (every 10s + jitter)
  const scheduleTier = (tierName, intervalMs) => {
    const timer = setInterval(() => {
      setTimeout(() => collectTier(tierName), jitter());
    }, intervalMs);
    timers.push(timer);
  };

  scheduleTier('high', 10000);
  scheduleTier('medium', 30000);
  scheduleTier('low', 120000);
}

// Stops the collector timers.
function stop() {
  timers.forEach(t => clearInterval(t));
  timers.length = 0;
  leaderLock.stop().catch(() => {});
}

module.exports = {
  start,
  stop,
  collectTier,
  setDemoActive,
  isDemoActive: () => isDemoActive,
  getSimulations: simulations.getSimulations,
  triggerSimulation: simulations.triggerSimulation,
  fetchDynatraceHostManagement: dynatraceCollector.fetchHostManagementMetrics,
  isTargetAssignedToShard,
  getLeaderStatus: leaderLock.getStatus,
  getShardStatus: () => ({
    role: process.env.SENTINEL_ROLE || 'all',
    leader: leaderLock.getStatus(),
    shardIndex: SENTINEL_SHARD_INDEX,
    shardTotal: SENTINEL_SHARD_TOTAL
  }),
  circuitBreaker
};

