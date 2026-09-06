/**
 * Maintenance Notification Configuration
 * Set any page, component, or tile mode to true to display an "Under Maintenance" badge/banner.
 * Whenever PROD data is fully implemented and validated, you can toggle any key to false.
 */
export const MAINTENANCE_CONFIG = {
  // Global Banner toggle at top of app
  showGlobalBanner: true,
  globalNote: "Under Maintenance — Production live telemetry data pipeline integration & validation in progress.",

  // Page-level maintenance notices
  pages: {
    healthOverview: true,
    metricsDetail: true,
    commandCenter: true,
    powerBiDashboard: true,
    aiLogPerformance: true,
    unifiedHealthMatrix: true,
    rcaDashboard: true,
    yamlConfigManager: true,
    adminManagement: true
  },

  // Specific tile / section maintenance badges
  tiles: {
    healthScoreTile: true,
    activeIncidentsTile: true,
    autonomousRecoveryTile: true,
    telemetryChartsTile: true,
    powerBiAnalyticsTile: true,
    rcaCorrelationTile: true,
    gitopsYamlTile: true,
    ssoEldapAuthTile: true,
    serviceNowTile: true
  },

  serviceNowNote: "Under Maintenance — ServiceNow ITSM REST API ticket synchronization in progress."
};
