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
            triggerRecovery(comp, reason, env);
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

function start() {
  if (timers.length > 0) return;

  writeNasLog('INFO', 'COORDINATOR', `Intelligent Observability Daemon started with Tiered Polling in [${mode.toUpperCase()}] mode.`);

  // Immediate initial run (collects prod/stg only)
  collectTier('all');

  // Tier 1: High priority app endpoints (every 10s)
  const highTimer = setInterval(() => collectTier('high'), 10000);

  // Tier 2: Medium priority compute/network/AVI (every 30s)
  const medTimer = setInterval(() => collectTier('medium'), 30000);

  // Tier 3: Deep infrastructure storage/K8s/Docker (every 120s)
  const lowTimer = setInterval(() => collectTier('low'), 120000);

  timers.push(highTimer, medTimer, lowTimer);
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
  fetchDynatraceHostManagement: dynatraceCollector.fetchHostManagementMetrics
};
