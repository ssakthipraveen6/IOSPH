const realAnalyzer = require('./real_analyzer');
const simulationAnalyzer = require('./simulation_analyzer');
const predictive = require('./predictive');
const rcaAnalyticsEngine = require('./rca_analytics_engine');
const teamRotaService = require('./team_rota_service');

module.exports = {
  realAnalyzer,
  simulationAnalyzer,
  predictive,
  rcaAnalyticsEngine,
  rcaEngine: rcaAnalyticsEngine,
  teamRotaService,
  getAnalyzer: (mode = 'real') => (mode === 'simulation' ? simulationAnalyzer : realAnalyzer),
  analyzeServerLogs: (logLines, writeNasLog, triggerRecoveryFunc, env = 'staging') => {
    return realAnalyzer.analyzeServerLogs(logLines, writeNasLog, triggerRecoveryFunc, env);
  },
  runPredictiveAnalysis: predictive.runPredictiveAnalysis
};
