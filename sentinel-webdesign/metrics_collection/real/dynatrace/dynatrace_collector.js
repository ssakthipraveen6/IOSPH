const config = require('@sentinel/config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const { SEVERITY } = require('@sentinel/shared-constants');

const tokenProvider = require('./token_provider');
const metricResolver = require('./metric_resolver');

/**
 * The Dynatrace API address for an environment: PROD_DYNATRACE_API_ENDPOINT / STG_DYNATRACE_API_ENDPOINT
 * (like every other URL override), else prod_urls / stg_urls in config/global.yaml. The collector read only
 * the static yaml values before, so setting the variable on the server had no effect.
 */
function endpointFor(env, urls) {
  const prefix = env === 'prod' ? 'PROD' : 'STG';
  const fromEnv = process.env[`${prefix}_DYNATRACE_API_ENDPOINT`];
  const value = (fromEnv && fromEnv.trim()) || (urls && urls.dynatrace_api_endpoint) || '';
  return String(value).replace(/\/+$/, '') || undefined;
}

// [T5.1 REMEDIATED] Token resolution through short-lived (30s) token provider with single-flight lock
async function resolveApiToken(forceRefresh = false) {
  return await tokenProvider.getApiToken(forceRefresh);
}

/**
 * Synchronizes metrics and open problem events from Dynatrace API v2.
 * @param {object} db Datastore manager
 * @param {function} writeNasLog Logging function
 */
async function collectDynatraceAlerts(db, writeNasLog, targetEnv = null) {
  // If Dynatrace is disabled in global configuration, exit cleanly
  if (typeof config.isCollectorEnabled === 'function' && !config.isCollectorEnabled('dynatrace')) {
    return { status: 'DISABLED', metrics: { alertCount: 0, error: 'Dynatrace disabled in configuration' } };
  }

  const currentEnv = targetEnv || global.runtimeEnvironment || config.ENVIRONMENT || 'staging';
  const targetConfig = (currentEnv === 'prod' ? config.PROD_URLS : config.STG_URLS) || config.ACTIVE_URLS || {};
  const baseUrl = endpointFor(currentEnv, targetConfig);
  if (!baseUrl) {
    return { status: 'DATA_UNAVAILABLE', metrics: { alertCount: null, error: 'dynatrace_api_endpoint not configured' } };
  }

  // In production without token, report DATA_UNAVAILABLE
  const token = await resolveApiToken();
  // [M1.1] No token means no data in staging as in prod; the source arbiter then
  // falls back to SENTINEL's own agents and probes.
  if (!token) {
    if (writeNasLog) {
      writeNasLog('WARN', 'DYNATRACE_REAL', `No Dynatrace API token configured in ${String(currentEnv).toUpperCase()}. Status: DATA_UNAVAILABLE`);
    }
    return { status: 'DATA_UNAVAILABLE', metrics: { alertCount: 0, error: 'Data Not Available' } };
  }

  let problemCount = 0;
  let problemsOk = false;
  let jvmHeapUsedMb = null;
  let hostCpuAvgPct = null;
  let hostMemAvgPct = null;

  // 1. Query Dynatrace API v2 Problems Feed
  try {
    const problemsUrl = `${baseUrl}/api/v2/problems?problemSelector=status("OPEN")&pageSize=50`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(problemsUrl, {
      headers: {
        'Authorization': `Api-Token ${token}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(id);

    if (res.ok) {
      const payload = await res.json();
      const openProblems = payload.problems || [];
      problemCount = payload.totalCount || openProblems.length;
      problemsOk = true;

      // Sync active critical problems as Sentinel alerts
      openProblems.forEach(prob => {
        const component = prob.affectedEntities?.[0]?.name?.toLowerCase() || 'dynatrace_cluster';
        db.addAlert(component, prob.severityLevel === 'AVAILABILITY' ? SEVERITY.CRITICAL : SEVERITY.WARNING, `[DYNATRACE-AI] ${prob.title}`, 'Active', currentEnv);
      });
    }
  } catch (e) {
    console.debug(`[DYNATRACE] Problems endpoint unreachable (${baseUrl}): ${e.message}`);
  }

  // 2. Query Dynatrace API v2 Metrics Query Feed (Bulk Host + JVM stats)
  // Metric keys drift between Dynatrace versions, so each canonical metric is resolved against
  // the descriptors this tenant actually has (config/dynatrace_metric_aliases.yaml). A metric that
  // matches none of its candidates raises a DYNATRACE-DRIFT alert and stays null.
  const CANONICAL = ['host_cpu_avg_pct', 'host_mem_avg_pct', 'jvm_heap_used_mb'];
  const aliases = metricResolver.loadAliases();
  let available = [];
  try {
    const candidates = CANONICAL.flatMap(c => aliases[c]?.candidates || []);
    if (candidates.length) {
      const dRes = await fetch(`${baseUrl}/api/v2/metrics?metricSelector=${encodeURIComponent(candidates.join(','))}&fields=metricId&pageSize=100`, {
        headers: { 'Authorization': `Api-Token ${token}` },
        signal: AbortSignal.timeout(1500)
      });
      if (dRes.ok) available = ((await dRes.json()).metrics || []).map(m => m.metricId).filter(Boolean);
    }
  } catch (e) {
    console.debug(`[DYNATRACE] Metric descriptor lookup failed (${baseUrl}): ${e.message}`);
  }
  // Empty `available` (lookup failed) => resolver falls back to each metric's primary candidate.
  const resolved = metricResolver.resolveDescriptors(available, db, currentEnv);
  const selectorFor = (canonical) => resolved.get(canonical) || null;
  const selectors = CANONICAL.map(c => ({ canonical: c, selector: selectorFor(c) })).filter(x => x.selector);

  if (selectors.length) {
    try {
      const metricSelector = selectors.map(x => `${x.selector}:avg`).join(',');
      const metricsUrl = `${baseUrl}/api/v2/metrics/query?metricSelector=${encodeURIComponent(metricSelector)}&resolution=1m`;
      const res = await fetch(metricsUrl, {
        headers: { 'Authorization': `Api-Token ${token}` },
        signal: AbortSignal.timeout(1500)
      });

      if (res.ok) {
        const payload = await res.json();
        (payload.result || []).forEach(r => {
          const val = r.data?.[0]?.values?.[0];
          if (val === undefined || val === null) return;
          const match = selectors.find(x => String(r.metricId).startsWith(x.selector));
          if (!match) return;
          // Some candidates report the inverse (idle / available %): convert to "used %".
          const inverse = /idle|available/.test(match.selector);
          const pct = (v) => parseFloat((inverse ? 100 - v : v).toFixed(2));
          if (match.canonical === 'host_cpu_avg_pct') hostCpuAvgPct = pct(val);
          if (match.canonical === 'host_mem_avg_pct') hostMemAvgPct = pct(val);
          if (match.canonical === 'jvm_heap_used_mb') jvmHeapUsedMb = Math.round(val / (1024 * 1024));
        });
      }
    } catch (e) {
      console.debug(`[DYNATRACE] Metrics query endpoint unreachable (${baseUrl}): ${e.message}`);
    }
  }

  const activeAlerts = db.getAlerts(currentEnv).filter(a => a.status === 'Active' && a.severity === 'Critical');
  const totalAlerts = Math.max(activeAlerts.length, problemCount);

  const data = {
    alertCount: totalAlerts,
    host_cpu_avg_pct: hostCpuAvgPct,
    host_mem_avg_pct: hostMemAvgPct,
    jvm_heap_used_mb: jvmHeapUsedMb
  };

  // Only values Dynatrace actually returned are stored, labelled with their source.
  Object.keys(data).forEach(mName => {
    if (mName === 'alertCount' && !problemsOk) return;
    if (typeof data[mName] === 'number') {
      db.addMetric('dynatrace', mName, data[mName], currentEnv, null, 'dynatrace');
    }
  });

  if (writeNasLog) {
    writeNasLog('INFO', 'DYNATRACE_REAL', `Dynatrace API v2 Sync - Problems: ${totalAlerts} | CPU: ${hostCpuAvgPct}% | JVM: ${jvmHeapUsedMb}MB`);
  }

  return {
    status: totalAlerts > 0 ? 'Critical' : 'Healthy',
    metrics: data
  };
}

// Open Dynatrace problems for the environment.
async function getActiveProblems(env = null) {
  const currentEnv = env || global.runtimeEnvironment || 'staging';

  // 1. PROD MODE: strictly query live Dynatrace API v2 endpoint
  const targetConfig = (currentEnv === 'prod' ? config.PROD_URLS : config.STG_URLS) || config.ACTIVE_URLS || {};
  const baseUrl = endpointFor(currentEnv, targetConfig);
  if (!baseUrl) return [];
  const token = await resolveApiToken();

  if (!token) {
    return [];
  }

  try {
    const problemsUrl = `${baseUrl}/api/v2/problems?problemSelector=status("OPEN")&pageSize=20`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(problemsUrl, {
      headers: {
        'Authorization': `Api-Token ${token}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(id);

    if (res.ok) {
      const payload = await res.json();
      return payload.problems || [];
    }
  } catch (err) {
    console.debug(`[DYNATRACE] Endpoint unreachable: ${err.message}`);
  }

  return [];
}

/**
 * Dedicated Dynatrace API v2 function to fetch host infrastructure and management-level telemetry.
 * Queries /api/v2/managementZones and /api/v2/entities?entitySelector=type("HOST")
 * @param {object} db Datastore manager
 * @param {function} writeNasLog Logging function
 * @param {string} targetEnv 'prod' | 'staging' | 'demo'
 */
async function fetchHostManagementMetrics(db = null, writeNasLog = null, targetEnv = null) {
  const currentEnv = targetEnv || global.runtimeEnvironment || config.ENVIRONMENT || 'staging';
  const targetConfig = (currentEnv === 'prod' ? config.PROD_URLS : config.STG_URLS) || config.ACTIVE_URLS || {};
  const baseUrl = endpointFor(currentEnv, targetConfig);
  if (!baseUrl) {
    return {
      status: 'DATA_UNAVAILABLE',
      enabled: false,
      managementZones: [],
      hosts: [],
      summary: { totalHosts: 0, healthyHosts: 0, avgCpuPct: null, avgMemPct: null }
    };
  }

  // 1. Check if Dynatrace is enabled in configuration
  if (typeof config.isCollectorEnabled === 'function' && !config.isCollectorEnabled('dynatrace')) {
    if (writeNasLog) {
      writeNasLog('INFO', 'DYNATRACE_MANAGEMENT', 'Dynatrace host/management collection skipped (disabled in global_config.yaml)');
    }
    return {
      status: 'DISABLED',
      enabled: false,
      managementZones: [],
      hosts: [],
      summary: { totalHosts: 0, healthyHosts: 0, avgCpuPct: null, avgMemPct: null }
    };
  }

  // 2. Resolve API Token
  const token = await resolveApiToken();
  // [M1.1] No token means no data, in staging as in prod: nothing is synthesized.
  if (!token) {
    if (writeNasLog) {
      writeNasLog('WARN', 'DYNATRACE_MANAGEMENT', `No Dynatrace API token in ${String(currentEnv).toUpperCase()} for host management query. Status: DATA_UNAVAILABLE`);
    }
    return {
      status: 'DATA_UNAVAILABLE',
      enabled: true,
      managementZones: [],
      hosts: [],
      summary: { totalHosts: 0, healthyHosts: 0, avgCpuPct: null, avgMemPct: null, error: 'Data Not Available' }
    };
  }

  // 4. Live API v2 Query: Management Zones & Host Entities
  let managementZones = [];
  let hosts = [];

  try {
    const mzUrl = `${baseUrl}/api/v2/managementZones?pageSize=50`;
    const ctrl1 = new AbortController();
    const t1 = setTimeout(() => ctrl1.abort(), 1500);
    const mzRes = await fetch(mzUrl, {
      headers: { 'Authorization': `Api-Token ${token}`, 'Content-Type': 'application/json' },
      signal: ctrl1.signal
    });
    clearTimeout(t1);

    if (mzRes.ok) {
      const mzPayload = await mzRes.json();
      managementZones = (mzPayload.values || []).map(z => ({
        id: z.id,
        name: z.name,
        description: z.description || ''
      }));
    }
  } catch (err) {
    console.debug(`[DYNATRACE_MANAGEMENT] Management zones query unreachable: ${err.message}`);
  }

  try {
    const hostsUrl = `${baseUrl}/api/v2/entities?entitySelector=type("HOST")&fields=properties,toRelationships&pageSize=50`;
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 1500);
    const hostsRes = await fetch(hostsUrl, {
      headers: { 'Authorization': `Api-Token ${token}`, 'Content-Type': 'application/json' },
      signal: ctrl2.signal
    });
    clearTimeout(t2);

    if (hostsRes.ok) {
      const hostsPayload = await hostsRes.json();
      hosts = (hostsPayload.entities || []).map(h => ({
        entityId: h.entityId,
        displayName: h.displayName,
        osType: h.properties?.osType || 'UNKNOWN',
        state: h.properties?.state || 'RUNNING',
        ipAddresses: h.properties?.ipAddress || []
      }));
    }
  } catch (err) {
    console.debug(`[DYNATRACE_MANAGEMENT] Host entities query unreachable: ${err.message}`);
  }

  const summary = {
    totalHosts: hosts.length,
    healthyHosts: hosts.filter(h => h.state === 'RUNNING').length,
    totalManagementZones: managementZones.length
  };

  if (db && typeof db.addMetric === 'function') {
    db.addMetric('dynatrace_hosts', 'host_count', hosts.length, currentEnv, null, 'dynatrace');
    db.addMetric('dynatrace_hosts', 'mz_count', managementZones.length, currentEnv, null, 'dynatrace');
  }

  if (writeNasLog) {
    writeNasLog('INFO', 'DYNATRACE_MANAGEMENT', `Dynatrace Host & Management API - Hosts: ${hosts.length} | Zones: ${managementZones.length}`);
  }

  return {
    status: 'Healthy',
    enabled: true,
    managementZones,
    hosts,
    summary
  };
}

module.exports = {
  collectDynatraceAlerts,
  getActiveProblems,
  fetchHostManagementMetrics
};

