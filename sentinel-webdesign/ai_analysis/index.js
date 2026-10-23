/**
 * Entry point of the analysis package: exposes the analyzer, predictive checks, RCA engine, rota
 * service, baselines, change points, alert engine and scorecard.
 */
const realAnalyzer = require('./real_analyzer');
const predictive = require('./predictive');
const rcaAnalyticsEngine = require('./rca_analytics_engine');
const teamRotaService = require('./team_rota_service');
const baselines = require('./baselines');
const changePoints = require('./change_points');
const alertEngine = require('./alert_engine');
const scorecard = require('./scorecard');

module.exports = {
  realAnalyzer,
  predictive,
  rcaAnalyticsEngine,
  rcaEngine: rcaAnalyticsEngine,
  teamRotaService,
  baselines,
  changePoints,
  alertEngine,
  scorecard,
  getAnalyzer: () => realAnalyzer,
  analyzeServerLogs: (logLines, writeNasLog, triggerRecoveryFunc, env = 'staging') => {
    return realAnalyzer.analyzeServerLogs(logLines, writeNasLog, triggerRecoveryFunc, env);
  },
  analyzeMetricStream: (component, metricName, value, env = 'staging') => {
    return realAnalyzer.analyzeMetricStream(component, metricName, value, env);
  },
  MetricBaselineStore: realAnalyzer.MetricBaselineStore,
  defaultBaselineStore: realAnalyzer.defaultBaselineStore,
  runPredictiveAnalysis: predictive.runPredictiveAnalysis
};
