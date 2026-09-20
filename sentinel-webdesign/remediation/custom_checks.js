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

// [T0.20] Initialise check state to UNKNOWN, never Healthy; latencyMs to null
CUSTOM_CHECKS_REGISTRY.forEach(check => {
  checkRuntimeStates[check.id] = {
    ...check,
    status: "UNKNOWN",
    lastRunValue: null,
    lastRunTimestamp: null,
    latencyMs: null,
    failureCount: 0
  };
});

/**
 * Executes registered custom checks, updates runtime statistics, and writes log events
 * @param {Object} simulations - Active simulated failures payload
 * @returns {Array} - The array of custom check status metrics
 */
function runCustomChecks(simulations = {}) {
  const results = [];

  CUSTOM_CHECKS_REGISTRY.forEach(check => {
    const currentState = checkRuntimeStates[check.id];
    let isFailing = false;
    let actualValue = check.expectedState;
    let latency = 12;

    if (config.USE_SIMULATED_COLLECTORS) {
      if (check.type === "jenkins_job" && simulations.jenkins_k8s) {
        isFailing = true;
        actualValue = "FAILURE";
        latency = 1500;
      } else if (check.type === "app_api" && simulations.database) {
        isFailing = true;
        actualValue = "DOWN (DB Connection Pool Saturation)";
        latency = 3000;
      }
    } else {
      // In real/production mode without live integration probe configured,
      // state remains UNKNOWN / DATA_UNAVAILABLE rather than fabricating Healthy
      if (global.runtimeEnvironment === 'prod' || !config.USE_SIMULATED_COLLECTORS) {
        currentState.status = "UNKNOWN";
        currentState.lastRunValue = "DATA_UNAVAILABLE";
        currentState.latencyMs = null;
        currentState.lastRunTimestamp = new Date().toISOString();
        results.push({ ...currentState });
        return;
      }

      if (check.type === "jenkins_job" && simulations.jenkins_k8s) {
        isFailing = true;
        actualValue = "FAILURE";
        latency = 1500;
      } else if (check.type === "app_api" && simulations.database) {
        isFailing = true;
        actualValue = "DOWN (DB Connection Pool Saturation)";
        latency = 3000;
      }
    }

    if (isFailing) {
      currentState.status = "Critical";
      currentState.lastRunValue = actualValue;
      currentState.latencyMs = latency;
      currentState.failureCount += 1;
      currentState.lastRunTimestamp = new Date().toISOString();

      if (currentState.failureCount === 1) {
        logger.warn(`[CUSTOM CHECK] ${check.name} failed! Expected ${check.expectedState}, got ${actualValue}. Latency: ${latency}ms.`);
      }
    } else {
      currentState.status = "Healthy";
      currentState.lastRunValue = check.expectedState;
      currentState.latencyMs = latency;
      currentState.failureCount = 0;
      currentState.lastRunTimestamp = new Date().toISOString();
    }

    results.push({ ...currentState });
  });

  return results;
}

module.exports = {
  CUSTOM_CHECKS_REGISTRY,
  runCustomChecks
};
