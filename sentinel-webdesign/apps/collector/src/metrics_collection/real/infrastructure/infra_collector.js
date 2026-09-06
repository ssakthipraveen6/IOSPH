const fs = require('fs');
const path = require('path');

// Import individual component collectors
const aviCollector = require('./avi_collector');
const databaseCollector = require('./database_collector');
const linuxCollector = require('./linux_collector');
const windowsCollector = require('./windows_collector');
const nasCollector = require('./nas_collector');
const s3Collector = require('./s3_collector');
const ssoCollector = require('./sso_collector');
const networkCollector = require('./network_collector');
const dockerCollector = require('./docker_collector');
const k8sCollector = require('./k8s_collector');
const nodeExporterCollector = require('./node_exporter_collector');
const providerSelector = require('../../telemetry_provider_selector');
const config = require('../../../config/config');

// Baselines fallback
const baselines = {
  sso_gateway: { authLatency: 120.5, activeSessions: 4200, failedAuthentications: 4, status: 'Healthy' },
  network_latency: { packetLoss: 0.0, latency_ms: 1.25, jitter: 0.15, status: 'Healthy' },
  avi_load_balancer: { 
    connections: 1520, ingressFlow: 45.2, throughput: 120, status: 'Healthy',
    bitbucket_ingressFlow: 18.4, jenkins_ingressFlow: 4.8, artifactory_ingressFlow: 15.6, argocd_ingressFlow: 6.4,
    bitbucket_latency: 45.0, jenkins_latency: 110.0, artifactory_latency: 85.0, argocd_latency: 55.0
  },
  database: { 
    cpu: 32.5, memory: 58.1, transactions: 450, iops: 800, status: 'Healthy',
    bitbucket_connections: 45, jenkins_connections: 18, artifactory_connections: 80, teamcity_connections: 12,
    bitbucket_tps: 180, jenkins_tps: 10, artifactory_tps: 120, teamcity_tps: 35,
    bitbucket_dbLatency: 12.4, jenkins_dbLatency: 24.5, artifactory_dbLatency: 15.2, teamcity_dbLatency: 8.5
  },
  windows_servers: { 
    cpu: 22.4, memory: 48.6, disk: 62.1, status: 'Healthy',
    fortify_cpu: 18.5, fortify_mem: 32.4, iis_threads: 250, iis_sessions: 1420
  },
  linux_servers: { 
    cpu: 18.2, memory: 40.5, load: 1.2, status: 'Healthy',
    bitbucket_cpu: 22.5, jenkins_cpu: 35.4, artifactory_cpu: 48.2, nexusiq_cpu: 15.0, teamcity_cpu: 25.1, mcp_cpu: 10.4, argocd_cpu: 6.5,
    bitbucket_mem: 8.2, jenkins_mem: 12.4, artifactory_mem: 24.5, nexusiq_mem: 6.1, teamcity_mem: 8.4, mcp_mem: 4.2, argocd_mem: 2.1
  },
  s3_storage: { 
    latency: 15.4, space: 1420, bandwidth: 85, status: 'Healthy',
    bitbucket_space: 450, jenkins_space: 125, artifactory_space: 1450, fortify_space: 85, teamcity_space: 220,
    bitbucket_bandwidth: 12.5, jenkins_bandwidth: 3.2, artifactory_bandwidth: 64.8
  },
  nas_performance: { 
    iops: 1200, throughput: 350, spaceUsed: 54.2, status: 'Healthy',
    bitbucket_spaceUsed: 15.4, jenkins_spaceUsed: 8.2, artifactory_spaceUsed: 22.5, nexusiq_spaceUsed: 1.8, teamcity_spaceUsed: 6.3,
    bitbucket_iops: 120, jenkins_iops: 35, artifactory_iops: 650, nexusiq_iops: 10, teamcity_iops: 75
  },
  docker: { registry_status: 'Healthy', image_pull_latency_ms: 42.0, container_count: 52, active_registries: 13 },
  k8s: { cluster_status: 'Healthy', apiserver_latency_ms: 18.5, active_namespaces: 13, pod_restarts: 0 },
  node_exporter: { active_node_exporters: 0, avg_cpu_idle: 82.5, avg_memory_available_pct: 64.2 }
};

async function collectInfraMetrics(simulations, db, writeNasLog, targetEnv = null) {
  const currentMetrics = {};
  const currentEnv = targetEnv || global.runtimeEnvironment || config.ENVIRONMENT || 'staging';
  const isProd = currentEnv === 'prod';
  
  const componentsList = [
    { key: 'avi_load_balancer', collector: aviCollector },
    { key: 'database', collector: databaseCollector },
    { key: 'linux_servers', collector: linuxCollector },
    { key: 'windows_servers', collector: windowsCollector },
    { key: 'nas_performance', collector: nasCollector },
    { key: 's3_storage', collector: s3Collector },
    { key: 'sso_gateway', collector: ssoCollector },
    { key: 'network_latency', collector: networkCollector },
    { key: 'docker', collector: dockerCollector },
    { key: 'k8s', collector: k8sCollector },
    { key: 'node_exporter', collector: nodeExporterCollector }
  ].filter(c => providerSelector.shouldRunCollector(c.key));

  for (let i = 0; i < componentsList.length; i++) {
    const { key, collector } = componentsList[i];
    let state = 'Healthy';
    const base = baselines[key] || {};
    
    let data = {};

    try {
      data = await collector.collect(currentEnv === 'staging' ? simulations : {}, base);
      if (currentEnv !== 'demo' && (!data || data.error === 'Data Not Available')) {
        data = { isLive: false, error: 'Data Not Available' };
        state = 'DATA_UNAVAILABLE';
      }
    } catch (err) {
      if (currentEnv === 'demo') {
        data = base;
      } else {
        data = { isLive: false, error: 'Data Not Available' };
        state = 'DATA_UNAVAILABLE';
      }
    }

    Object.keys(data).forEach(mName => {
      if (data[mName] !== undefined && data[mName] !== null) {
        db.addMetric(key, mName, data[mName], currentEnv);
      }
    });

    currentMetrics[key] = { status: state, metrics: data };
    if (state !== 'Healthy') {
      const metricsStr = Object.keys(data).map(k => `${k}: ${data[k]}`).join(', ');
      writeNasLog('WARN', 'INFRA_REAL', `${key} [${currentEnv.toUpperCase()}] | Status: ${state} | Metrics: ${metricsStr}`);
    }
  }

  return currentMetrics;
}

module.exports = {
  collectInfraMetrics
};
