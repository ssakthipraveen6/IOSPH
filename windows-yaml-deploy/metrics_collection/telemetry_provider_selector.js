const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const config = require('../config/config');

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
  hybrid: 1
};

function loadProfilesYaml() {
  const profilePath = path.join(__dirname, '../config/telemetry_profiles.yaml');
  try {
    if (fs.existsSync(profilePath)) {
      const content = fs.readFileSync(profilePath, 'utf8');
      return yaml.load(content) || {};
    }
  } catch (e) {
    // fallback
  }
  return {};
}

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

function getActiveStrategy() {
  const profileNum = getActiveProfileNumber();
  return COMBINATION_STRATEGIES[profileNum] || COMBINATION_STRATEGIES[1];
}

function shouldRunCollector(collectorKey) {
  const strategy = getActiveStrategy();
  return strategy.allowedCollectors.includes(collectorKey);
}

function getProviderDetails() {
  const profileNum = getActiveProfileNumber();
  const strategy = getActiveStrategy();
  return {
    profileNumber: profileNum,
    id: strategy.id,
    displayName: strategy.name,
    allowedCollectors: strategy.allowedCollectors,
    skippedCollectors: strategy.skippedCollectors
  };
}

module.exports = {
  getActiveProfileNumber,
  getActiveStrategy,
  shouldRunCollector,
  getProviderDetails,
  COMBINATION_STRATEGIES,
  PROVIDER_STRATEGIES: COMBINATION_STRATEGIES
};

