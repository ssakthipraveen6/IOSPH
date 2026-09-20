/**
 * Maintenance Notification Configuration
 *
 * The values here are DEFAULTS ONLY. The live values come from `config/ui.yaml`
 * and are fetched once at startup by `hydrateUiConfig()` in main.jsx, so an
 * operator can change the banner by editing one YAML file and refreshing the
 * browser -- no rebuild, no restart.
 *
 * This object is mutated in place rather than replaced, so the ten components
 * that import it keep working unchanged.
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

/**
 * Loads config/ui.yaml via the API and merges it over the defaults above.
 * Never throws: if the endpoint is unreachable the defaults stand, so a
 * config problem degrades the banner rather than blanking the application.
 */
export async function hydrateUiConfig() {
  try {
    const res = await fetch('/api/ui-config');
    if (!res.ok) return MAINTENANCE_CONFIG;
    const remote = await res.json();
    if (remote && typeof remote === 'object') {
      Object.assign(MAINTENANCE_CONFIG, remote);
      if (remote.pages) MAINTENANCE_CONFIG.pages = { ...MAINTENANCE_CONFIG.pages, ...remote.pages };
      if (remote.tiles) MAINTENANCE_CONFIG.tiles = { ...MAINTENANCE_CONFIG.tiles, ...remote.tiles };
    }
  } catch (e) {
    console.warn('[UI-CONFIG] Could not load config/ui.yaml, using built-in defaults:', e.message);
  }
  return MAINTENANCE_CONFIG;
}
