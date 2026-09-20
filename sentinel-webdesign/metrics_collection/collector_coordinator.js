const db = require('@sentinel/database');
const { writeNasLog } = require('@sentinel/logger');
const simulations = require('@sentinel/config/simulations');
const config = require('@sentinel/config');
const { customChecks, triggerRecovery } = require('@sentinel/remediation');

// Determine execution folder mode
const mode = config.USE_SIMULATED_COLLECTORS ? 'simulation' : 'real';
console.log(`[SYSTEM] Starting Observability coordinator in [${mode.toUpperCase()}] mode.`);

// Load modular collectors dynamically
const infraCollector = require(`./${mode}/infrastructure/infra_collector`);
const appCollector = require(`./${mode}/applications/app_collector`);
const dynatraceCollector = require(`./${mode}/dynatrace/dynatrace_collector`);
const fluentdCollector = require(`../logs_collection/${mode}/fluentd/fluentd_log_collector`);
const aiAnalyzer = require('@sentinel/analysis').getAnalyzer(mode);
const providerSelector = require('./telemetry_provider_selector');

const timers = [];

// Demo collection lifecycle state:
// Starts collecting for prod/stg environment only by default.
// Demo collection starts ONLY when demo option is selected, and stops when switched to prod or staging.
let isDemoActive = false;

function setDemoActive(active) {
  isDemoActive = Boolean(active);
  writeNasLog('INFO', 'COORDINATOR', `Demo collection & simulation ${isDemoActive ? 'STARTED (Demo option selected)' : 'STOPPED (Switched to prod/staging)'}`);
}

function getActiveEnvironments() {
  // Always collect telemetry for staging and prod in background
  const environments = ['staging', 'prod'];
  // Include demo ONLY when demo option is actively selected
  if (isDemoActive) {
    environments.push('demo');
  }
  return environments;
}

async function collectTier(tierName) {
  try {
    const activeSims = simulations.getSimulations();
    customChecks.runCustomChecks(activeSims);

    const environments = getActiveEnvironments();
    for (const env of environments) {
      global.collectorEnvironment = env;
      const simsForEnv = (env === 'staging' || env === 'demo') ? activeSims : {};

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

function isTargetAssignedToShard(targetKey) {
  if (SENTINEL_SHARD_TOTAL <= 1) return true;
  let hash = 0;
  for (let i = 0; i < targetKey.length; i++) {
    hash = ((hash << 5) - hash) + targetKey.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % SENTINEL_SHARD_TOTAL === SENTINEL_SHARD_INDEX;
}

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

function stop() {
  timers.forEach(t => clearInterval(t));
  timers.length = 0;
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
  getShardStatus: () => ({
    role: process.env.SENTINEL_ROLE || 'all',
    shardIndex: SENTINEL_SHARD_INDEX,
    shardTotal: SENTINEL_SHARD_TOTAL
  }),
  circuitBreaker
};

