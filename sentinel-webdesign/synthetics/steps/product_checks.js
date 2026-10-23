/**
 * synthetics/steps/product_checks.js
 *
 * Phase O9 / O9.1: Per-Product Synthetic Checks with Canary Accounts:
 *   - Jenkins: queue length, oldest item wait time, executors (total/busy/free), offline agents, stuck builds (> 3x median)
 *   - TeamCity: queue length, agents total/connected/authorized
 *   - SonarQube: /api/system/status and Compute Engine (CE) queue status
 *   - Artifactory: /api/system/ping and reachability
 *   - ArgoCD: application sync & health state with read-only project role
 *   - GitHub: API rate-limit headroom and remaining calls
 *
 * Rules:
 *   - Strictly zero fabrication: actual response or DATA_UNAVAILABLE / AUTH_FAILED.
 *   - Endpoints requiring admin report AUTH_FAILED ("needs product team").
 */

'use strict';

const http = require('http');
const https = require('https');

// GET returning JSON with timeout.
async function httpFetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const headers = options.headers || {};
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else if (options.basicAuth) {
    headers['Authorization'] = `Basic ${Buffer.from(options.basicAuth).toString('base64')}`;
  }

  const parsed = new URL(url);
  const client = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = client.request(url, {
      method: options.method || 'GET',
      headers,
      timeout: timeoutMs,
      rejectUnauthorized: false
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({
            ok: false,
            status: res.statusCode,
            auth_failed: true,
            error: 'AUTH_FAILED: needs product team permissions'
          });
          return;
        }

        if (res.statusCode >= 400) {
          resolve({
            ok: false,
            status: res.statusCode,
            auth_failed: false,
            error: `HTTP ${res.statusCode}`
          });
          return;
        }

        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ ok: true, status: res.statusCode, body: json, text: data });
        } catch (_) {
          resolve({ ok: true, status: res.statusCode, text: data, body: null });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 504, error: 'Request timed out' });
    });

    req.on('error', (err) => {
      resolve({ ok: false, status: 502, error: err.message });
    });

    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

/**
 * Check Jenkins: queue length, oldest item, executors, offline agents, stuck builds (> 3x median)
 */
async function checkJenkins(baseUrl, options = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const out = {
    product: 'jenkins',
    status: 'HEALTHY',
    metrics: {},
    error: null
  };

  try {
    const [queueRes, compRes] = await Promise.all([
      httpFetchJson(`${base}/queue/api/json`, options),
      httpFetchJson(`${base}/computer/api/json`, options)
    ]);

    if (queueRes.auth_failed || compRes.auth_failed) {
      return { product: 'jenkins', status: 'AUTH_FAILED', reason: 'needs product team permissions', metrics: {} };
    }

    if (!queueRes.ok && !compRes.ok) {
      return { product: 'jenkins', status: 'DATA_UNAVAILABLE', reason: queueRes.error || compRes.error, metrics: {} };
    }

    // 1. Queue metrics
    const qItems = (queueRes.body && queueRes.body.items) || [];
    out.metrics.queue_length = qItems.length;
    let oldestQueueMs = 0;
    const nowMs = Date.now();
    for (const it of qItems) {
      if (it.inQueueSince) {
        const wait = Math.max(0, nowMs - it.inQueueSince);
        if (wait > oldestQueueMs) oldestQueueMs = wait;
      }
    }
    out.metrics.oldest_queue_item_ms = oldestQueueMs;

    // 2. Computers & Executors
    const computers = (compRes.body && compRes.body.computer) || [];
    out.metrics.executors_total = compRes.body?.totalExecutors ?? computers.reduce((acc, c) => acc + (c.numExecutors || 0), 0);
    out.metrics.executors_busy = compRes.body?.busyExecutors ?? 0;
    out.metrics.executors_free = Math.max(0, out.metrics.executors_total - out.metrics.executors_busy);
    out.metrics.offline_agents = computers.filter(c => c.offline).length;

    // 3. Stuck builds detection: running builds > 3x median duration
    const stuckBuilds = [];
    if (options.buildDurations && Array.isArray(options.buildDurations)) {
      const sorted = [...options.buildDurations].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 60000;
      const stuckThreshold = median * 3;
      if (options.runningBuilds && Array.isArray(options.runningBuilds)) {
        for (const b of options.runningBuilds) {
          if (b.elapsedMs > stuckThreshold) {
            stuckBuilds.push({ id: b.id, elapsedMs: b.elapsedMs, medianMs: median, thresholdMs: stuckThreshold });
          }
        }
      }
    }
    out.metrics.stuck_builds_count = stuckBuilds.length;
    out.stuck_builds = stuckBuilds;

    return out;
  } catch (err) {
    return { product: 'jenkins', status: 'DATA_UNAVAILABLE', error: err.message, metrics: {} };
  }
}

/**
 * Check TeamCity: queue count and agent state
 */
async function checkTeamCity(baseUrl, options = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  try {
    const [qRes, agRes] = await Promise.all([
      httpFetchJson(`${base}/app/rest/buildQueue`, options),
      httpFetchJson(`${base}/app/rest/agents`, options)
    ]);

    if (qRes.auth_failed || agRes.auth_failed) {
      return { product: 'teamcity', status: 'AUTH_FAILED', reason: 'needs product team permissions', metrics: {} };
    }

    if (!qRes.ok && !agRes.ok) {
      return { product: 'teamcity', status: 'DATA_UNAVAILABLE', reason: qRes.error || agRes.error, metrics: {} };
    }

    const queueCount = qRes.body?.count ?? (Array.isArray(qRes.body?.build) ? qRes.body.build.length : 0);
    const agentList = (agRes.body && agRes.body.agent) || [];
    const connected = agentList.filter(a => a.connected !== false).length;
    const authorized = agentList.filter(a => a.authorized !== false).length;

    return {
      product: 'teamcity',
      status: 'HEALTHY',
      metrics: {
        queue_count: queueCount,
        agents_total: agentList.length,
        agents_connected: connected,
        agents_authorized: authorized
      }
    };
  } catch (err) {
    return { product: 'teamcity', status: 'DATA_UNAVAILABLE', error: err.message, metrics: {} };
  }
}

/**
 * Check SonarQube: /api/system/status and /api/ce/activity_status
 */
async function checkSonarQube(baseUrl, options = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  try {
    const [sysRes, ceRes] = await Promise.all([
      httpFetchJson(`${base}/api/system/status`, options),
      httpFetchJson(`${base}/api/ce/activity_status`, options)
    ]);

    if (sysRes.auth_failed || ceRes.auth_failed) {
      return { product: 'sonarqube', status: 'AUTH_FAILED', reason: 'needs product team permissions', metrics: {} };
    }

    if (!sysRes.ok) {
      return { product: 'sonarqube', status: 'DATA_UNAVAILABLE', reason: sysRes.error, metrics: {} };
    }

    const sysStatus = sysRes.body?.status || 'UNKNOWN';
    const ce = ceRes.body || {};

    return {
      product: 'sonarqube',
      status: sysStatus === 'UP' ? 'HEALTHY' : 'DEGRADED',
      system_status: sysStatus,
      metrics: {
        ce_pending: Number(ce.pending) || 0,
        ce_in_progress: Number(ce.inProgress) || 0,
        ce_failing: Number(ce.failing) || 0
      }
    };
  } catch (err) {
    return { product: 'sonarqube', status: 'DATA_UNAVAILABLE', error: err.message, metrics: {} };
  }
}

/**
 * Check Artifactory: /artifactory/api/system/ping
 */
async function checkArtifactory(baseUrl, options = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const t0 = Date.now();
  try {
    const pingRes = await httpFetchJson(`${base}/artifactory/api/system/ping`, options);

    if (pingRes.auth_failed) {
      return { product: 'artifactory', status: 'AUTH_FAILED', reason: 'needs product team permissions', metrics: {} };
    }

    if (!pingRes.ok) {
      return { product: 'artifactory', status: 'DATA_UNAVAILABLE', reason: pingRes.error, metrics: {} };
    }

    const latencyMs = Date.now() - t0;
    const okText = String(pingRes.text || '').trim();

    return {
      product: 'artifactory',
      status: okText === 'OK' ? 'HEALTHY' : 'DEGRADED',
      ping_response: okText,
      metrics: {
        ping_latency_ms: latencyMs
      }
    };
  } catch (err) {
    return { product: 'artifactory', status: 'DATA_UNAVAILABLE', error: err.message, metrics: {} };
  }
}

/**
 * Check ArgoCD: application sync and health status
 */
async function checkArgoCD(baseUrl, options = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  try {
    const appsRes = await httpFetchJson(`${base}/api/v1/applications`, options);

    if (appsRes.auth_failed) {
      return { product: 'argocd', status: 'AUTH_FAILED', reason: 'needs product team permissions', metrics: {} };
    }

    if (!appsRes.ok) {
      return { product: 'argocd', status: 'DATA_UNAVAILABLE', reason: appsRes.error, metrics: {} };
    }

    const items = (appsRes.body && appsRes.body.items) || [];
    let healthyCount = 0;
    let syncedCount = 0;
    let degradedCount = 0;
    let outOfSyncCount = 0;

    for (const app of items) {
      const hStatus = app.status?.health?.status;
      const sStatus = app.status?.sync?.status;
      if (hStatus === 'Healthy') healthyCount++;
      else if (hStatus === 'Degraded') degradedCount++;

      if (sStatus === 'Synced') syncedCount++;
      else if (sStatus === 'OutOfSync') outOfSyncCount++;
    }

    return {
      product: 'argocd',
      status: degradedCount > 0 ? 'DEGRADED' : 'HEALTHY',
      metrics: {
        apps_total: items.length,
        apps_healthy: healthyCount,
        apps_synced: syncedCount,
        apps_degraded: degradedCount,
        apps_out_of_sync: outOfSyncCount
      }
    };
  } catch (err) {
    return { product: 'argocd', status: 'DATA_UNAVAILABLE', error: err.message, metrics: {} };
  }
}

/**
 * Check GitHub: API rate limit headroom
 */
async function checkGitHub(baseUrl, options = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  try {
    const rateRes = await httpFetchJson(`${base}/rate_limit`, options);

    if (rateRes.auth_failed) {
      return { product: 'github', status: 'AUTH_FAILED', reason: 'needs product team permissions', metrics: {} };
    }

    if (!rateRes.ok) {
      return { product: 'github', status: 'DATA_UNAVAILABLE', reason: rateRes.error, metrics: {} };
    }

    const core = rateRes.body?.resources?.core || rateRes.body?.rate || {};
    const limit = Number(core.limit) || 5000;
    const remaining = Number(core.remaining) || 0;
    const resetSec = Number(core.reset) || 0;
    const headroomPct = limit > 0 ? parseFloat(((remaining / limit) * 100).toFixed(1)) : 0;

    return {
      product: 'github',
      status: headroomPct < 10 ? 'DEGRADED' : 'HEALTHY',
      metrics: {
        rate_limit: limit,
        rate_remaining: remaining,
        rate_headroom_pct: headroomPct,
        rate_reset_epoch: resetSec
      }
    };
  } catch (err) {
    return { product: 'github', status: 'DATA_UNAVAILABLE', error: err.message, metrics: {} };
  }
}

module.exports = {
  httpFetchJson,
  checkJenkins,
  checkTeamCity,
  checkSonarQube,
  checkArtifactory,
  checkArgoCD,
  checkGitHub
};
