const db = require('../database/db');
const { writeNasLog } = require('../backend/logger');
const simulations = require('../config/simulations');
const config = require('../config/config');
const customChecks = require('../remediation/custom_checks');

// Determine execution folder mode
const mode = config.USE_SIMULATED_COLLECTORS ? 'simulation' : 'real';
console.log(`[SYSTEM] Starting Observability coordinator in [${mode.toUpperCase()}] mode.`);

// Load modular collectors dynamically
const infraCollector = require(`./${mode}/infrastructure/infra_collector`);
const appCollector = require(`./${mode}/applications/app_collector`);
const dynatraceCollector = require(`./${mode}/dynatrace/dynatrace_collector`);
const fluentdCollector = require(`../logs_collection/${mode}/fluentd/fluentd_log_collector`);
const aiAnalyzer = require(`../ai_analysis/${mode}_analyzer`);
const providerSelector = require('./telemetry_provider_selector');
const { triggerRecovery } = require('../remediation/recovery');

const timers = [];

async function collectTier(tierName) {
  try {
    const activeSims = simulations.getSimulations();
    customChecks.runCustomChecks(activeSims);

    if (tierName === 'high' || tierName === 'all') {
      if (providerSelector.shouldRunCollector('app_collector')) {
        await appCollector.collectAppMetrics(activeSims, db, writeNasLog);
      }
      
      if (providerSelector.shouldRunCollector('dynatrace')) {
        await dynatraceCollector.collectDynatraceAlerts(db, writeNasLog);
      }
      
      const rawLogs = await fluentdCollector.collectFluentdLogs(activeSims, db, writeNasLog);
      aiAnalyzer.analyzeServerLogs(rawLogs, writeNasLog, (comp, reason) => {
        triggerRecovery(comp, reason);
      });
    }

    if (tierName === 'medium' || tierName === 'all' || tierName === 'low') {
      const infraMetrics = await infraCollector.collectInfraMetrics(activeSims, db, writeNasLog);
      
      if (global.runPredictiveAnalysis) {
        global.runPredictiveAnalysis(infraMetrics);
      }
      if (global.runSelfHealingOrchestrator) {
        global.runSelfHealingOrchestrator(infraMetrics);
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

  // Immediate initial run
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
  getSimulations: simulations.getSimulations,
  triggerSimulation: simulations.triggerSimulation
};
