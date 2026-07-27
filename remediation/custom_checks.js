const fs = require('fs');
const path = require('path');
const logger = require('../backend/logger');

// =========================================================================
// FUTURE CHECKS REGISTRY FOR EXTENDED INTEGRATIONS
// To register new custom checks (e.g. Jenkins builds, container states, database pools),
// append objects to the CUSTOM_CHECKS_REGISTRY array below:
// =========================================================================
const CUSTOM_CHECKS_REGISTRY = [
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

// In-memory runtime cache for custom check states
const checkRuntimeStates = {};

// Initialize state storage
CUSTOM_CHECKS_REGISTRY.forEach(check => {
  checkRuntimeStates[check.id] = {
    ...check,
    status: "Healthy",
    lastRunValue: check.expectedState,
    lastRunTimestamp: new Date().toISOString(),
    latencyMs: 12,
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
    let latency = 5 + Math.floor(Math.random() * 20);

    // Simulated failure hooks:
    // If the check's type aligns with an active simulation, flag it as down
    if (check.type === "jenkins_job" && simulations.jenkins_k8s) {
      isFailing = true;
      actualValue = "FAILURE";
      latency = 1500; // Simulated network timeout
    } else if (check.type === "app_api" && simulations.database) {
      isFailing = true;
      actualValue = "DOWN (DB Connection Connection Pool Saturation)";
      latency = 3000;
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
      // Resolve/Normal state
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
