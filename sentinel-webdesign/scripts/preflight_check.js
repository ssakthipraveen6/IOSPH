/**
 * Preflight Config & Endpoint Reachability Checker (T2b.5)
 * 
 * Walks every configured endpoint and reports:
 * - REACHABLE: endpoint responded 200 OK
 * - AUTH_FAILED: endpoint responded 401/403 or SSO redirect
 * - UNREACHABLE: network timeout, ECONNREFUSED, DNS failure
 * - NOT_CONFIGURED: URL missing or blank
 */

const config = require('@sentinel/config');
const yamlConfig = require('@sentinel/config/yaml_config');
const { fetchJsonWithFallback } = require('../metrics_collection/shared/fetch_with_fallback');
const { performance } = require('perf_hooks');

// Probes one URL (REACHABLE, AUTH_FAILED, UNREACHABLE).
async function checkUrl(name, url, appId = null, options = {}) {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return {
      target: name,
      url: null,
      status: 'NOT_CONFIGURED',
      httpStatus: null,
      latencyMs: null,
      reason: 'No endpoint URL configured'
    };
  }

  const cleanUrl = url.trim();
  const t0 = performance.now();

  try {
    const res = await fetchJsonWithFallback(
      cleanUrl,
      {
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        appId: appId || name
      },
      options.timeoutMs || 3000
    );

    const latencyMs = res.latencyMs || parseFloat((performance.now() - t0).toFixed(2));

    if (res.authFailed) {
      return {
        target: name,
        url: cleanUrl,
        status: 'AUTH_FAILED',
        httpStatus: res.status || 401,
        latencyMs,
        reason: res.error || 'Authentication failed (401/403 or SSO challenge)'
      };
    }

    if (res.success || (res.status >= 200 && res.status < 400)) {
      return {
        target: name,
        url: cleanUrl,
        status: 'REACHABLE',
        httpStatus: res.status || 200,
        latencyMs,
        reason: 'Healthy (HTTP 200 OK)'
      };
    }

    return {
      target: name,
      url: cleanUrl,
      status: 'UNREACHABLE',
      httpStatus: res.status || 500,
      latencyMs,
      reason: res.error || `HTTP error ${res.status}`
    };
  } catch (err) {
    const latencyMs = parseFloat((performance.now() - t0).toFixed(2));
    return {
      target: name,
      url: cleanUrl,
      status: 'UNREACHABLE',
      httpStatus: null,
      latencyMs,
      reason: err.message || 'Connection refused or timeout'
    };
  }
}

// Probes every configured endpoint.
async function runPreflightCheck(targetEnv = null) {
  const env = targetEnv || global.runtimeEnvironment || config.ENVIRONMENT || 'staging';
  const activeUrls = config.ACTIVE_URLS || {};
  const appsConfig = yamlConfig.loadAllApplications ? yamlConfig.loadAllApplications() : {};

  const targets = [
    // Applications
    { name: 'Jenkins Master', url: activeUrls.jenkins_master_url, appId: 'cloudbees_jenkins' },
    { name: 'JFrog Artifactory', url: activeUrls.artifactory_api ? `${activeUrls.artifactory_api}/storageinfo` : null, appId: 'jfrog_artifactory' },
    { name: 'Bitbucket Server', url: activeUrls.bitbucket_api ? `${activeUrls.bitbucket_api}/status` : null, appId: 'bitbucket' },
    { name: 'SonarQube', url: activeUrls.sonarqube_api ? `${activeUrls.sonarqube_api}/system/status` : null, appId: 'sonarqube' },
    { name: 'TeamCity', url: activeUrls.teamcity_api ? `${activeUrls.teamcity_api}/buildQueue` : null, appId: 'jetbrains_teamcity' },
    { name: 'Fortify SSC', url: activeUrls.fortify_api ? `${activeUrls.fortify_api}/auth/isAuthenticated` : null, appId: 'fortify' },
    { name: 'Nexus IQ', url: activeUrls.nexusiq_api ? `${activeUrls.nexusiq_api}/healthcheck` : null, appId: 'nexusiq' },
    { name: 'ArgoCD', url: activeUrls.argocd_api ? `${activeUrls.argocd_api}/applications` : null, appId: 'argocd' },
    { name: 'Argo Workflows', url: activeUrls.argoworkflows_api ? `${activeUrls.argoworkflows_api}/workflows/default` : null, appId: 'argoworkflows' },
    { name: 'GitHub Enterprise', url: activeUrls.github_api ? `${activeUrls.github_api}/rate_limit` : null, appId: 'github' },
    { name: 'OTKR Scanner', url: activeUrls.otkr_api ? `${activeUrls.otkr_api}/status` : null, appId: 'otkr' },
    { name: 'Performance Center', url: activeUrls.performance_center_api ? `${activeUrls.performance_center_api}/api/status` : null, appId: 'performance_center' },
    { name: 'MCP Gateway', url: activeUrls.mcp_api ? `${activeUrls.mcp_api}/status` : null, appId: 'mcp' },
    { name: 'Bitbucket External', url: activeUrls.bitbucket_external_api, appId: 'bitbucket_external' },

    // Infrastructure
    { name: 'AVI Load Balancer', url: activeUrls.avi_api, appId: 'avi' },
    { name: 'Kubernetes API', url: activeUrls.k8s_api, appId: 'k8s' },
    { name: 'Database API', url: activeUrls.database_api, appId: 'database' },
    { name: 'NAS Performance API', url: activeUrls.nas_performance_api, appId: 'nas' },
    { name: 'S3 Object Storage', url: activeUrls.s3_endpoint, appId: 's3' },
    { name: 'Linux Server Telemetry', url: activeUrls.linux_api || activeUrls.unix_api, appId: 'linux' },
    { name: 'Windows Server Telemetry', url: activeUrls.windows_api, appId: 'windows' },
    { name: 'Docker Registry API', url: activeUrls.docker_api || activeUrls.registry_api, appId: 'docker' },
    { name: 'SSO Gateway / IdP', url: activeUrls.sso_api || activeUrls.sso_gateway_url, appId: 'sso' }
  ];

  const results = [];
  for (const target of targets) {
    const check = await checkUrl(target.name, target.url, target.appId);
    results.push(check);
  }

  const summary = {
    environment: env,
    timestamp: new Date().toISOString(),
    totalTargets: results.length,
    reachable: results.filter(r => r.status === 'REACHABLE').length,
    authFailed: results.filter(r => r.status === 'AUTH_FAILED').length,
    unreachable: results.filter(r => r.status === 'UNREACHABLE').length,
    notConfigured: results.filter(r => r.status === 'NOT_CONFIGURED').length,
    results
  };

  return summary;
}

if (require.main === module) {
  (async () => {
    console.log('=== RUNNING SENTINEL CONFIG PREFLIGHT CHECK (T2b.5) ===');
    const summary = await runPreflightCheck();
    console.log(`Environment: ${summary.environment.toUpperCase()}`);
    console.log(`Timestamp: ${summary.timestamp}`);
    console.log(`Summary: ${summary.reachable}/${summary.totalTargets} REACHABLE, ${summary.authFailed} AUTH_FAILED, ${summary.unreachable} UNREACHABLE, ${summary.notConfigured} NOT CONFIGURED\n`);

    for (const r of summary.results) {
      const icon = r.status === 'REACHABLE' ? '✔' : r.status === 'AUTH_FAILED' ? '⚠' : r.status === 'NOT_CONFIGURED' ? '⚪' : '✖';
      const statusColor = r.status === 'REACHABLE' ? '\x1b[32m' : r.status === 'AUTH_FAILED' ? '\x1b[33m' : '\x1b[31m';
      console.log(`  ${icon} [${statusColor}${r.status}\x1b[0m] ${r.target.padEnd(25)} ${r.url || '(none)'}`);
      if (r.status !== 'REACHABLE') {
        console.log(`     └─ Reason: ${r.reason}`);
      }
    }
    console.log('\n=== PREFLIGHT CHECK COMPLETE ===');
    // Let the event loop drain; calling process.exit() here aborts with a libuv
    // assertion while fetch/AbortController handles are still closing.
    process.exitCode = 0;
  })();
}

module.exports = {
  runPreflightCheck,
  checkUrl
};
