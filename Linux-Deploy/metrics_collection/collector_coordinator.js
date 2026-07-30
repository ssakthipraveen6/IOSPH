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

let intervalId = null;

async function collectAllData() {
  try {
    const activeSims = simulations.getSimulations();
    
    // Run custom extension checks (e.g. future Jenkins statuses/microservices)
    customChecks.runCustomChecks(activeSims);
    
    // 1. Collect Infrastructure performance metrics
    const infraMetrics = await infraCollector.collectInfraMetrics(activeSims, db, writeNasLog);
    
    // 2. Collect Application performance metrics
    const appMetrics = await appCollector.collectAppMetrics(activeSims, db, writeNasLog);
    
    // 3. Sync Dynatrace alert count
    const dtMetrics = await dynatraceCollector.collectDynatraceAlerts(db, writeNasLog);
    
    // Combine all current metrics
    const currentMetrics = {
      ...infraMetrics,
      ...appMetrics,
      dynatrace: dtMetrics
    };
    
    // 3.5. Archive performance metrics to secondary database
    const sqliteMetrics = require('../database/sqlite_metrics');
    sqliteMetrics.archiveMetrics(currentMetrics);
    
    // 4. Stream Fluentd logs
    const rawLogs = await fluentdCollector.collectFluentdLogs(activeSims, db, writeNasLog);
    
    // 5. Feed logs into the Local AI log analyzer
    const { triggerRecovery } = require('../remediation/recovery');
    aiAnalyzer.analyzeServerLogs(rawLogs, writeNasLog, (comp, reason, jenkinsJob) => {
      // Triggers self-healing. In manual mode, it puts it in Awaiting-Approval state.
      // In autonomous mode, it executes immediately.
      triggerRecovery(comp, reason);
    });
    
    // 6. Run predictive analysis algorithms
    if (global.runPredictiveAnalysis) {
      global.runPredictiveAnalysis(currentMetrics);
    }
    
    // 7. Run recovery orchestrator checks
    if (global.runSelfHealingOrchestrator) {
      global.runSelfHealingOrchestrator(currentMetrics);
    }
    
    // Broadcast update to websockets
    if (global.broadcastStateChange) {
      global.broadcastStateChange();
    }
  } catch (err) {
    console.error('[COORDINATOR] Error in telemetry collection loop:', err);
  }
}

function start() {
  if (intervalId) return;
  
  writeNasLog('INFO', 'COORDINATOR', `Intelligent Observability Daemon started successfully in [${mode.toUpperCase()}] mode.`);
  
  // Run collection immediately
  collectAllData();
  
  // Schedule every 10 seconds
  intervalId = setInterval(collectAllData, 10000);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  start,
  stop,
  getSimulations: simulations.getSimulations,
  triggerSimulation: simulations.triggerSimulation
};
