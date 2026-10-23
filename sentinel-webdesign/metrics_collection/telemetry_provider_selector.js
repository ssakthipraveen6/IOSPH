const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const config = require('@sentinel/config');

/**
 * Telemetry Provider Selector & Combination Profile Manager
 * Resolves the chosen combination from config/telemetry_profiles.yaml (or global_config.yaml)
 * and guarantees that only the necessary collectors run without duplicate overhead.
 */

// Master Production Metric Extraction Strategies
const COMBINATION_STRATEGIES = {
  // Profile 1: OpenTelemetry OTLP Push + Sentinel Unified Prober (PRIMARY)
  1: {
    id: 'opentelemetry_production',
    name: 'Profile 1: OpenTelemetry Collector Fleet + Sentinel Prober (Primary)',
    allowedCollectors: [
      'app_collector',
      'avi_load_balancer',
      'database',
      'nas_performance',
      's3_storage',
      'sso_gateway',
      'network_latency',
      'docker',
      'k8s'
    ],
    skippedCollectors: ['linux_servers', 'windows_servers', 'node_exporter', 'dynatrace']
  },

  // Profile 2: Dynatrace OneAgent (Host/JVM/AI) + Sentinel Unified Prober
  2: {
    id: 'dynatrace_production',
    name: 'Profile 2: Dynatrace API v2 Sync + Sentinel Prober',
    allowedCollectors: [
      'dynatrace',
      'app_collector',
      'avi_load_balancer',
      'database',
      'nas_performance',
      's3_storage',
      'sso_gateway',
      'network_latency',
      'docker',
      'k8s'
    ],
    skippedCollectors: ['linux_servers', 'windows_servers', 'node_exporter']
  },

  // Profile 3: Prometheus Node Exporter Scrapes + Sentinel Unified Prober
  3: {
    id: 'node_exporter_production',
    name: 'Profile 3: Prometheus Node Exporter Fleet + Sentinel Prober',
    allowedCollectors: [
      'node_exporter',
      'app_collector',
      'avi_load_balancer',
      'database',
      'nas_performance',
      's3_storage',
      'sso_gateway',
      'network_latency',
      'docker',
      'k8s'
    ],
    skippedCollectors: ['linux_servers', 'windows_servers', 'dynatrace']
  },

  // Profile 4 (M1.12): every source runs and the source arbiter picks, per metric,
  // the highest-priority source that is still fresh (Dynatrace -> OTel -> probe).
  4: {
    id: 'arbitrated_production',
    name: 'Profile 4: Arbitrated sources (Dynatrace when available, else OTel, else Sentinel probes)',
    arbitrated: true,
    allowedCollectors: [
      'dynatrace',
      'app_collector',
      'avi_load_balancer',
      'database',
      'nas_performance',
      's3_storage',
      'sso_gateway',
      'network_latency',
      'docker',
      'k8s'
    ],
    skippedCollectors: ['linux_servers', 'windows_servers', 'node_exporter']
  }
};

// Aliases for string names
const ALIAS_MAP = {
  opentelemetry: 1,
  opentelemetry_alone: 1,
  opentelemetry_production: 1,
  otel: 1,
  dynatrace: 2,
  dynatrace_alone: 2,
  dynatrace_production: 2,
  node_exporter: 3,
  node_exporter_production: 3,
  arbitrated: 4,
  arbitrated_production: 4,
  hybrid: 1
};

// Loads config/telemetry.yaml.
function loadProfilesYaml() {
  const candidatePaths = [
    path.resolve(__dirname, '../config/telemetry.yaml'),
    path.resolve(__dirname, '../config/telemetry_profiles.yaml')
  ];
  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        return yaml.load(content) || {};
      }
    } catch (e) {
      // try next
    }
  }
  return {};
}

// Selected telemetry profile number.
function getActiveProfileNumber() {
  const profilesYaml = loadProfilesYaml();
  let raw = process.env.TELEMETRY_PROFILE || profilesYaml.selected_profile || config.TELEMETRY_PROVIDER || 1;

  if (typeof raw === 'number' && COMBINATION_STRATEGIES[raw]) {
    return raw;
  }

  const str = String(raw).toLowerCase().trim();
  if (COMBINATION_STRATEGIES[str]) {
    return parseInt(str, 10);
  }

  if (ALIAS_MAP[str]) {
    return ALIAS_MAP[str];
  }

  return 1; // Default to Profile 1: OpenTelemetry Collector Fleet + Sentinel Prober
}

// Collector strategy of the profile.
function getActiveStrategy() {
  const profileNum = getActiveProfileNumber();
  return COMBINATION_STRATEGIES[profileNum] || COMBINATION_STRATEGIES[1];
}

// True when a collector should run for the profile.
function shouldRunCollector(collectorKey) {
  // 1. Check if collector/component is explicitly disabled via global config toggles
  if (collectorKey === 'dynatrace') {
    if (typeof config.isDynatraceEnabled === 'function' && !config.isDynatraceEnabled()) {
      return false;
    }
  } else if (typeof config.isComponentEnabled === 'function') {
    if (!config.isComponentEnabled(collectorKey)) {
      return false;
    }
  }

  // 2. Check if allowed by the active telemetry profile strategy
  const strategy = getActiveStrategy();
  return strategy.allowedCollectors.includes(collectorKey);
}


// Details of the active profile.
function getProviderDetails() {
  const profileNum = getActiveProfileNumber();
  const strategy = getActiveStrategy();
  return {
    profileNumber: profileNum,
    id: strategy.id,
    displayName: strategy.name,
    allowedCollectors: strategy.allowedCollectors,
    skippedCollectors: strategy.skippedCollectors,
    arbitrated: !!strategy.arbitrated
  };
}

module.exports = {
  loadProfilesYaml,
  getActiveProfileNumber,
  getActiveStrategy,
  shouldRunCollector,
  getProviderDetails,
  COMBINATION_STRATEGIES,
  PROVIDER_STRATEGIES: COMBINATION_STRATEGIES
};

