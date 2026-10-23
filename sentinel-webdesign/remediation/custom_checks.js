/**
 * Custom checks declared in YAML: runs them and records results.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('@sentinel/logger');
const config = require('@sentinel/config');

// [T0.20] Load custom check registry from externalized YAML configuration
function loadCustomChecksRegistry() {
  const yamlPath = path.resolve(__dirname, '../config/custom_checks.yaml');
  try {
    if (fs.existsSync(yamlPath)) {
      const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
      if (parsed && Array.isArray(parsed.checks)) {
        return parsed.checks;
      }
    }
  } catch (e) {
    logger.warn(`[CUSTOM CHECKS] Error loading ${yamlPath}: ${e.message}`);
  }

  return [
    {
      id: "check_jenkins_billing",
      name: "Jenkins Pipeline: billing-service",
      type: "jenkins_job",
      endpoint: "https://jenkins-stg.internal.corp/job/billing-service",
      expectedState: "SUCCESS",
      description: "Monitors build status of billing-service pipeline in STG"
    },
    {
      id: "check_payment_gateway",
      name: "Application API: payment-gateway",
      type: "app_api",
      endpoint: "https://stg-api.internal.corp/payment/health",
      expectedState: "UP",
      description: "Validates JSON response {status: UP} from payment-gateway microservice"
    },
    {
      id: "check_private_harbor",
      name: "Registry: private-docker-harbor",
      type: "container_registry",
      endpoint: "https://harbor-stg.internal.corp/api/v2/health",
      expectedState: "ONLINE",
      description: "Pings Private Docker registry storage availability"
    }
  ];
}

const CUSTOM_CHECKS_REGISTRY = loadCustomChecksRegistry();

// In-memory runtime cache for custom check states
const checkRuntimeStates = {};

// [T0.20 / O0.4] Initialise check state to UNKNOWN, never Healthy; latencyMs to null; lastRunValue to DATA_UNAVAILABLE
CUSTOM_CHECKS_REGISTRY.forEach(check => {
  checkRuntimeStates[check.id] = {
    ...check,
    status: "UNKNOWN",
    lastRunValue: "DATA_UNAVAILABLE",
    lastRunTimestamp: null,
    latencyMs: null,
    failureCount: 0
  };
});

/**
 * [Phase O0.4 / O6.1] Records an executed check result into the runtime state store
 */
function recordCheckResult(checkId, result = {}) {
  if (checkRuntimeStates[checkId]) {
    checkRuntimeStates[checkId] = {
      ...checkRuntimeStates[checkId],
      status: result.status || (result.success ? "Healthy" : "Critical"),
      lastRunValue: result.lastRunValue || (result.success ? checkRuntimeStates[checkId].expectedState : "FAILURE"),
      lastRunTimestamp: result.timestamp || new Date().toISOString(),
      latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
      failureCount: result.success ? 0 : (checkRuntimeStates[checkId].failureCount + 1)
    };
  }
}

/**
 * Returns registered custom check runtime states.
 * O0.4: Simulation-only path with hard-coded latency=12 deleted.
 * Returns stored results or DATA_UNAVAILABLE per check.
 * @returns {Array} - The array of custom check status metrics
 */
function runCustomChecks() {
  return CUSTOM_CHECKS_REGISTRY.map(check => ({
    ...checkRuntimeStates[check.id]
  }));
}

// Runs and returns the custom checks.
function getCustomChecks() {
  return runCustomChecks();
}

module.exports = {
  CUSTOM_CHECKS_REGISTRY,
  checkRuntimeStates,
  recordCheckResult,
  runCustomChecks,
  getCustomChecks
};
