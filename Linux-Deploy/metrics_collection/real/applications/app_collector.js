const fs = require('fs');
const path = require('path');

// Import individual component collectors
const bitbucketCollector = require('./bitbucket_collector');
const jenkinsCollector = require('./jenkins_collector');
const artifactoryCollector = require('./artifactory_collector');
const nexusiqCollector = require('./nexusiq_collector');
const fortifyCollector = require('./fortify_collector');
const teamcityCollector = require('./teamcity_collector');
const argocdCollector = require('./argocd_collector');
const mcpCollector = require('./mcp_collector');
const argoworkflowsCollector = require('./argoworkflows_collector');
const sonarqubeCollector = require('./sonarqube_collector');
const githubCollector = require('./github_collector');
const bitbucketExternalCollector = require('./bitbucket_external_collector');
const otkrCollector = require('./otkr_collector');
const performanceCenterCollector = require('./performance_center_collector');

// Baseline values for applications
const baselines = {
  bitbucket: { responseTime: 85, successRate: 99.8, requests: 45, status: 'Healthy' },
  jenkins_k8s: { executors: 8, queue: 0, responseTime: 125, podsOnline: 5, podsTotal: 5, status: 'Healthy' },
  artifactory: { heap: 52.4, space: 72.8, latency: 45, status: 'Healthy' },
  nexusiq: { scanQueue: 1, violations: 12, responseTime: 180, status: 'Healthy' },
  fortify: { scanQueue: 2, cpu: 15.0, failures: 0, status: 'Healthy' },
  teamcity: { activeBuilds: 4, agents: 10, load: 24.5, status: 'Healthy' },
  mcp_server_k8s: { cpu: 28.6, latency: 60, replicas: 3, status: 'Healthy' },
  argocd_k8s: { syncStatus: 'Synced', latency: 45, clusterCount: 4, status: 'Healthy' },
  argoworkflows_k8s: { activeWorkflows: 3, failedWorkflows: 0, responseTime: 95, status: 'Healthy' },
  sonarqube: { qualityGatesPassed: 1, analysisQueue: 0, responseTime: 110, status: 'Healthy' },
  github: { apiRateLimitRemaining: 4950, pendingPullRequests: 14, responseTime: 75, status: 'Healthy' },
  bitbucket_external: { responseTime: 95, successRate: 99.6, requests: 32, status: 'Healthy' },
  otkr: { scanQueue: 2, findings: 8, responseTime: 160, status: 'Healthy' },
  performance_center: { activeTests: 5, avgResponseTime: 450, throughput: 120, status: 'Healthy' }
};

async function collectAppMetrics(simulations, db, writeNasLog) {
  const currentMetrics = {};
  
  const appsList = [
    { key: 'bitbucket', collector: bitbucketCollector },
    { key: 'jenkins_k8s', collector: jenkinsCollector },
    { key: 'artifactory', collector: artifactoryCollector },
    { key: 'nexusiq', collector: nexusiqCollector },
    { key: 'fortify', collector: fortifyCollector },
    { key: 'teamcity', collector: teamcityCollector },
    { key: 'argocd_k8s', collector: argocdCollector },
    { key: 'mcp_server_k8s', collector: mcpCollector },
    { key: 'argoworkflows_k8s', collector: argoworkflowsCollector },
    { key: 'sonarqube', collector: sonarqubeCollector },
    { key: 'github', collector: githubCollector },
    { key: 'bitbucket_external', collector: bitbucketExternalCollector },
    { key: 'otkr', collector: otkrCollector },
    { key: 'performance_center', collector: performanceCenterCollector }
  ];

  for (let i = 0; i < appsList.length; i++) {
    const { key, collector } = appsList[i];
    let state = 'Healthy';
    const base = baselines[key];
    
    if (simulations[key] && simulations[key].type === 'outage') {
      state = 'Critical';
    }

    const data = await collector.collect(simulations, base);

    Object.keys(data).forEach(mName => {
      db.addMetric(key, mName, data[mName]);
    });

    currentMetrics[key] = { status: state, metrics: data };
    const metricsStr = Object.keys(data).map(k => `${k}: ${data[k]}`).join(', ');
    writeNasLog('INFO', 'APP_REAL', `${key} | Status: ${state} | Metrics: ${metricsStr}`);
  }

  return currentMetrics;
}

module.exports = {
  collectAppMetrics
};
