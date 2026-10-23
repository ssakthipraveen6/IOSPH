/**
 * synthetics/runner.js
 *
 * Golden Journey Synthetics Runner & Scheduler.
 * Measures every toolchain product end-to-end as a normal user.
 * Strictly leader-only with bounded concurrency (max 4).
 */

const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { generateTraceId, generateSpanId, createSpan } = require('./trace');
const { executeHttpStep } = require('./steps/http');
const { executeBrowserStep } = require('./steps/browser');
const { executeGitStep } = require('./steps/git');
const { executeUploadDownloadStep } = require('./steps/upload_download');
const { executeJenkinsStep } = require('./steps/jenkins');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let leaderLock = null;
try {
  leaderLock = require('@sentinel/database/leader_lock');
} catch (_) {
  try { leaderLock = require('../../database/leader_lock'); } catch (__) {}
}

let clickhouse = null;
try {
  clickhouse = require('@sentinel/database/clickhouse');
} catch (_) {
  try { clickhouse = require('../../database/clickhouse'); } catch (__) {}
}

let db = null;
try {
  db = require('@sentinel/database');
} catch (_) {
  try { db = require('../../database/db'); } catch (__) {}
}

let credentialProvider = null;
try {
  credentialProvider = require('@sentinel/config/cyberark/credential_provider');
} catch (_) {
  try { credentialProvider = require('../../backend/config/cyberark/credential_provider'); } catch (__) {}
}

let yamlConfig = null;
try {
  yamlConfig = require('@sentinel/config/yaml_config');
} catch (_) {
  try { yamlConfig = require('../../backend/config/yaml_config'); } catch (__) {}
}

// Runs golden journeys and health checks on their schedules (leader only) and keeps their history.
class JourneyRunner {
  // Creates the runner.
  constructor(options = {}) {
    this.maxConcurrency = options.maxConcurrency || 4;
    this.runningCount = 0;
    this.activeIntervals = new Map(); // journeyKey -> intervalTimer
    this.history = new Map();         // appId -> array of run objects (max 100 per app)
    this.isLeaderCheck = options.isLeaderCheck || (() => (leaderLock ? leaderLock.isLeader() : true));
    this.clickhouseClient = options.clickhouseClient || clickhouse;
    this.dbManager = options.dbManager || db;
    this.credentialProvider = options.credentialProvider || credentialProvider;
    this.yamlConfigLoader = options.yamlConfigLoader || yamlConfig;
    this.activeJourneys = new Map(); // key -> { appId, journey, env }
    this.healthCheckHistory = new Map(); // checkId -> array of run objects (max 100)
    this.started = false;
  }

  // Starts the schedules.
  start() {
    if (this.started) return;
    this.started = true;
    this.scheduleFromConfig();
  }

  // Stops the schedules.
  stop() {
    this.started = false;
    for (const [key, timer] of this.activeIntervals.entries()) {
      clearInterval(timer);
      this.activeIntervals.delete(key);
    }
  }

  // Schedules every journey from the manifests.
  scheduleFromConfig() {
    if (!this.yamlConfigLoader) return;
    const apps = this.yamlConfigLoader.loadAllApplications() || {};
    const env = process.env.ENVIRONMENT || 'staging';

    for (const [appId, app] of Object.entries(apps)) {
      if (!app || !app.enabled || !Array.isArray(app.journeys)) continue;
      for (const journey of app.journeys) {
        if (!journey || journey.enabled === false) continue;
        this.registerJourney(appId, journey, env);
      }
    }
  }

  // Schedules one journey.
  registerJourney(appId, journey, env = 'staging') {
    const key = `${appId}:${journey.id}:${env}`;
    if (this.activeIntervals.has(key)) {
      clearInterval(this.activeIntervals.get(key));
    }

    this.activeJourneys.set(key, { appId, journey, env });

    const intervalSec = Math.max(30, journey.interval_seconds || 60);
    const intervalMs = intervalSec * 1000;

    // Initial run with cryptographically secure jitter to prevent thundering herd
    const initialJitterMs = crypto.randomInt(500, Math.min(intervalMs, 5000));
    setTimeout(() => {
      if (this.started) {
        this.runJourney(appId, journey, env).catch(() => {});
      }
    }, initialJitterMs).unref?.();

    const timer = setInterval(() => {
      if (!this.started) return;
      // Per-tick jitter
      const tickJitter = crypto.randomInt(0, 2000);
      setTimeout(() => {
        this.runJourney(appId, journey, env).catch(() => {});
      }, tickJitter).unref?.();
    }, intervalMs);

    if (timer.unref) timer.unref();
    this.activeIntervals.set(key, timer);
  }

  // Runs one journey step by step and records the result.
  async runJourney(appId, journey, env = 'staging', options = {}) {
    // 1. Leader-only check
    if (!this.isLeaderCheck()) {
      return { skipped: true, reason: 'NOT_LEADER' };
    }

    // 2. Concurrency ceiling (max 4)
    if (this.runningCount >= this.maxConcurrency) {
      return { skipped: true, reason: 'CONCURRENCY_LIMIT' };
    }

    this.runningCount++;
    const t0 = performance.now();
    const traceId = generateTraceId();
    const rootSpanId = generateSpanId();
    const runStartTs = new Date().toISOString();

    const isVantage = Boolean(options && (options.vantage_host || options.vantage)) || Boolean(journey.vantage_hosts && journey.vantage_hosts.length > 0);
    const vantageHost = (options && options.vantage_host) || (journey.vantage_hosts && journey.vantage_hosts[0]) || (isVantage ? 'agent-vantage-01' : null);

    // 3. Resolve credential if journey specifies purpose
    let credential = null;
    if (journey.credentials_purpose && this.credentialProvider) {
      try {
        credential = await this.credentialProvider.getCredential(appId, journey.credentials_purpose, { env });
      } catch (err) {
        // Credential resolution failed
        console.warn(`[SYNTHETICS] Could not resolve credential for journey ${journey.id} (${appId}): ${err.message}`);
      }
    }

    const context = {
      appId,
      env,
      traceId,
      rootSpanId,
      credential,
      vantage: isVantage,
      vantage_host: vantageHost,
      baseUrl: journey.base_url || '',
      stepTimeoutMs: (journey.timeout_seconds || 30) * 1000
    };

    const stepResults = [];
    const stepSpans = [];
    const metricsBatch = [];
    let runFailed = false;
    let failingStepId = null;
    let failingError = null;

    try {
      const steps = Array.isArray(journey.steps) ? journey.steps : [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepSpanId = generateSpanId();
        const stepStartTs = new Date().toISOString();

        if (runFailed) {
          // If previous step failed, subsequent steps are marked SKIPPED
          stepResults.push({
            id: step.id,
            name: step.name || step.id,
            layer: step.layer || 'app',
            status: 'SKIPPED',
            durationMs: 0,
            success: false
          });

          stepSpans.push(createSpan({
            traceId,
            spanId: stepSpanId,
            parentSpanId: rootSpanId,
            name: `step:${step.id}`,
            service: appId,
            env,
            startTs: stepStartTs,
            durationMs: 0,
            status: 'SKIPPED',
            attributes: {
              journey: journey.id,
              step: step.id,
              layer: step.layer || 'app',
              ...(isVantage ? { vantage: true, vantage_host: vantageHost } : {})
            }
          }));

          continue;
        }

        // Execute step based on type
        let res;
        try {
          if (step.type === 'jenkins' || (step.type === 'http' && step.action === 'jenkins_build')) {
            // [Q2] `type: http` + `action: jenkins_build` is the manifest spelling that every
            // validator accepts; `type: jenkins` is the same step.
            res = await executeJenkinsStep(step, context);
          } else if (step.type === 'http') {
            res = await executeHttpStep(step, context);
          } else if (step.type === 'browser') {
            res = await executeBrowserStep(step, context);
          } else if (step.type === 'git') {
            res = await executeGitStep(step, context);
          } else if (step.type === 'upload_download') {
            res = await executeUploadDownloadStep(step, context);
          } else {
            res = {
              success: false,
              status: 'ERROR',
              durationMs: 0,
              error: `Unknown step type: ${step.type}`
            };
          }
        } catch (execErr) {
          res = {
            success: false,
            status: 'ERROR',
            durationMs: 0,
            error: execErr.message
          };
        }

        const success = res.success && res.status === 'OK';
        if (!success) {
          runFailed = true;
          failingStepId = step.id;
          failingError = res.error || 'Step assertion failed';
        }

        stepResults.push({
          id: step.id,
          name: step.name || step.id,
          layer: step.layer || 'app',
          status: success ? 'OK' : 'FAILED',
          durationMs: res.durationMs,
          error: res.error || null,
          screenshotPath: res.screenshotPath || null,
          metrics: stepMetricValues(res),
          attributes: { ...stepAttributes(res), ...stepAttributes(res, 'details') },
          success
        });

        stepSpans.push(createSpan({
          traceId,
          spanId: stepSpanId,
          parentSpanId: rootSpanId,
          name: `step:${step.id}`,
          service: appId,
          env,
          startTs: stepStartTs,
          durationMs: res.durationMs,
          status: success ? 'OK' : 'ERROR',
          attributes: {
            journey: journey.id,
            step: step.id,
            layer: step.layer || 'app',
            error: res.error || '',
            ...(isVantage ? { vantage: true, vantage_host: vantageHost } : {}),
            ...stepAttributes(res),
            ...stepAttributes(res, 'details')
          }
        }));

        // Emit step metrics through addMetricBatch
        metricsBatch.push({
          component: appId,
          metricName: 'journey.step.duration_ms',
          value: res.durationMs,
          source: 'probe',
          env,
          attributes: {
            journey: journey.id,
            step: step.id,
            layer: step.layer || 'app',
            ...(isVantage ? { vantage: true, vantage_host: vantageHost } : {})
          }
        });

        // [Q1/Q2] Step-specific measurements (e.g. journey.git.push_ms, journey.jenkins.queue_wait_ms).
        // Only real numbers are emitted; a value the step could not measure is null and skipped.
        for (const [metricName, value] of Object.entries(stepMetricValues(res))) {
          if (value === null) continue;
          metricsBatch.push({
            component: appId,
            metricName,
            value,
            source: 'probe',
            env,
            attributes: {
              journey: journey.id,
              step: step.id,
              layer: step.layer || 'app',
              ...stepAttributes(res)
            }
          });
        }

        metricsBatch.push({
          component: appId,
          metricName: 'journey.success',
          value: success ? 1 : 0,
          source: 'probe',
          env,
          attributes: {
            journey: journey.id,
            step: step.id,
            layer: step.layer || 'app'
          }
        });
      }

      // Execute cleanup steps if defined
      if (Array.isArray(journey.cleanup)) {
        for (const cleanStep of journey.cleanup) {
          try {
            if (cleanStep.type === 'http') await executeHttpStep(cleanStep, context);
          } catch (_) {}
        }
      }
    } finally {
      this.runningCount--;
    }

    const totalDurationMs = performance.now() - t0;
    const overallSuccess = !runFailed;

    // Journey root span
    const rootSpan = createSpan({
      traceId,
      spanId: rootSpanId,
      parentSpanId: '',
      name: journey.name || `journey:${journey.id}`,
      service: appId,
      env,
      startTs: runStartTs,
      durationMs: totalDurationMs,
      status: overallSuccess ? 'OK' : 'ERROR',
      attributes: {
        journey: journey.id,
        failing_step: failingStepId || '',
        error: failingError || '',
        ...(isVantage ? { vantage: true, vantage_host: vantageHost } : {})
      }
    });

    // Record spans in ClickHouse
    const allSpans = [rootSpan, ...stepSpans];
    if (this.clickhouseClient && typeof this.clickhouseClient.insertSpans === 'function') {
      try {
        await this.clickhouseClient.insertSpans(allSpans);
      } catch (err) {
        console.warn(`[SYNTHETICS] ClickHouse insertSpans failed: ${err.message}`);
      }
    }

    // Record metrics in datastore
    if (this.dbManager && typeof this.dbManager.addMetricBatch === 'function') {
      try {
        this.dbManager.addMetricBatch(metricsBatch, env);
      } catch (err) {
        console.warn(`[SYNTHETICS] db.addMetricBatch failed: ${err.message}`);
      }
    }

    // Keep execution in memory history
    const runRecord = {
      traceId,
      appId,
      journeyId: journey.id,
      journeyName: journey.name || journey.id,
      env,
      startedAt: runStartTs,
      durationMs: totalDurationMs,
      success: overallSuccess,
      failingStepId,
      failingError,
      vantage: isVantage,
      vantage_host: vantageHost,
      steps: stepResults,
      spans: allSpans
    };

    if (!this.history.has(appId)) {
      this.history.set(appId, []);
    }
    const appHistory = this.history.get(appId);
    appHistory.unshift(runRecord);
    if (appHistory.length > 100) {
      appHistory.pop();
    }

    return runRecord;
  }

  // Recent runs of an application.
  getJourneyRuns(appId, { limit = 10, env = null } = {}) {
    const list = this.history.get(appId) || [];
    let filtered = list;
    if (env) filtered = filtered.filter(r => r.env === env);
    return filtered.slice(0, limit);
  }

  // Run statistics of an application.
  getJourneyStats(appId, { env = 'staging', hours = 24 } = {}) {
    const list = (this.history.get(appId) || []).filter(r => r.env === env);
    if (list.length === 0) {
      // No runs is "no data", never a 100% success rate (U1).
      return { status: 'DATA_UNAVAILABLE', totalRuns: 0, successRate: null, p50Ms: null, p95Ms: null, steps: {} };
    }

    const successCount = list.filter(r => r.success).length;
    const durations = list.map(r => r.durationMs).sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] || 0;

    // Per-step stats
    const stepStats = {};
    for (const run of list) {
      for (const st of run.steps || []) {
        if (!stepStats[st.id]) {
          stepStats[st.id] = { name: st.name, layer: st.layer, durations: [], successes: 0, total: 0 };
        }
        stepStats[st.id].total++;
        if (st.success) stepStats[st.id].successes++;
        if (st.durationMs > 0) stepStats[st.id].durations.push(st.durationMs);
      }
    }

    const stepsOut = {};
    for (const [stepId, s] of Object.entries(stepStats)) {
      s.durations.sort((a, b) => a - b);
      stepsOut[stepId] = {
        name: s.name,
        layer: s.layer,
        successRate: s.total > 0 ? (s.successes / s.total) * 100 : null,
        p50Ms: s.durations.length ? s.durations[Math.floor(s.durations.length * 0.5)] : null,
        p95Ms: s.durations.length ? s.durations[Math.floor(s.durations.length * 0.95)] : null
      };
    }

    return {
      totalRuns: list.length,
      successRate: (successCount / list.length) * 100,
      p50Ms: p50,
      p95Ms: p95,
      steps: stepsOut
    };
  }

  // Health checks from the manifests.
  loadAllHealthCheckDefinitions() {
    const list = [];
    // 1. From config/custom_checks.yaml
    try {
      const cfgPath = path.resolve(__dirname, '../config/custom_checks.yaml');
      if (fs.existsSync(cfgPath)) {
        const parsed = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
        if (parsed && Array.isArray(parsed.checks)) {
          for (const c of parsed.checks) {
            list.push({
              id: c.id,
              name: c.name || c.id,
              type: c.type || 'http',
              endpoint: c.endpoint || c.url,
              expectedState: c.expectedState || 'UP',
              expect_status: c.expect_status || (c.expectedState === 'SUCCESS' ? 200 : 200),
              app_id: c.app_id || 'platform',
              source: 'custom_checks'
            });
          }
        }
      }
    } catch (_) {}

    // 2. From manifests' health_checks blocks
    try {
      if (this.yamlConfigLoader && typeof this.yamlConfigLoader.loadAllApplications === 'function') {
        const apps = this.yamlConfigLoader.loadAllApplications() || {};
        for (const [appId, app] of Object.entries(apps)) {
          if (app && Array.isArray(app.health_checks)) {
            for (const hc of app.health_checks) {
              list.push({
                id: hc.id || `${appId}_health`,
                name: hc.name || `${app.name || appId} Health`,
                type: hc.type || 'app_api',
                endpoint: hc.url || hc.endpoint,
                expectedState: hc.expect_status || 200,
                expect_status: hc.expect_status || 200,
                expect_json: hc.expect_json || null,
                app_id: appId,
                source: 'manifest'
              });
            }
          }
        }
      }
    } catch (_) {}

    return list;
  }

  // Runs one health check.
  async runHealthCheck(checkDef, env = 'staging') {
    if (!this.isLeaderCheck()) {
      return { skipped: true, reason: 'NOT_LEADER' };
    }

    const t0 = performance.now();
    let success = false;
    let statusCode = null;
    let latencyMs = 0;
    let errorMsg = null;

    try {
      if (checkDef.type === 'jenkins_job' && checkDef.endpoint) {
        const jenkinsStep = {
          name: checkDef.name,
          url: checkDef.endpoint,
          expected_state: checkDef.expectedState || 'SUCCESS'
        };
        const res = await executeJenkinsStep(jenkinsStep, { baseUrl: checkDef.endpoint });
        latencyMs = performance.now() - t0;
        success = res.success === true;
        statusCode = res.status_code || (success ? 200 : 500);
        if (!success) errorMsg = res.error || 'Jenkins job state mismatch';
      } else {
        const targetUrl = checkDef.endpoint || checkDef.url;
        const httpStep = {
          url: targetUrl,
          method: 'GET',
          assert: { status: checkDef.expect_status || 200 }
        };
        const res = await executeHttpStep(httpStep, { baseUrl: targetUrl });
        latencyMs = performance.now() - t0;
        success = res.success === true;
        statusCode = res.status_code || (success ? 200 : 500);

        if (success && checkDef.expect_json && res.body) {
          try {
            const parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
            for (const [k, v] of Object.entries(checkDef.expect_json)) {
              if (parsed[k] !== v) {
                success = false;
                errorMsg = `JSON field mismatch: ${k}=${parsed[k]} expected ${v}`;
                break;
              }
            }
          } catch (e) {
            success = false;
            errorMsg = `Failed to parse JSON body: ${e.message}`;
          }
        }
        if (!success && !errorMsg) errorMsg = res.error || 'Status assertion failed';
      }
    } catch (err) {
      latencyMs = performance.now() - t0;
      success = false;
      errorMsg = err.message;
    }

    const runRecord = {
      id: `hc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      check_id: checkDef.id,
      name: checkDef.name,
      endpoint: checkDef.endpoint || checkDef.url,
      app_id: checkDef.app_id || 'platform',
      env,
      success,
      status: success ? 'UP' : 'DOWN',
      latency: Math.round(latencyMs * 10) / 10,
      latency_ms: Math.round(latencyMs * 10) / 10,
      status_code: statusCode,
      error: errorMsg,
      timestamp: new Date().toISOString()
    };

    if (!this.healthCheckHistory.has(checkDef.id)) {
      this.healthCheckHistory.set(checkDef.id, []);
    }
    const history = this.healthCheckHistory.get(checkDef.id);
    history.unshift(runRecord);
    if (history.length > 100) history.pop();

    return runRecord;
  }

  // Runs every health check.
  async runAllHealthChecks(env = 'staging') {
    const checks = this.loadAllHealthCheckDefinitions();
    const results = [];
    for (const chk of checks) {
      try {
        const res = await this.runHealthCheck(chk, env);
        results.push(res);
      } catch (err) {
        results.push({ check_id: chk.id, success: false, error: err.message });
      }
    }
    return results;
  }

  // Summary of every health check.
  getHealthCheckSummary(env = 'staging') {
    const checks = this.loadAllHealthCheckDefinitions();
    return checks.map(c => {
      const history = (this.healthCheckHistory.get(c.id) || []).filter(r => r.env === env);
      const latest = history[0] || null;
      const lastFailure = history.find(r => !r.success) || null;
      const successCount = history.filter(r => r.success).length;

      return {
        id: c.id,
        name: c.name,
        type: c.type,
        endpoint: c.endpoint,
        app_id: c.app_id,
        status: latest ? (latest.success ? 'HEALTHY' : 'CRITICAL') : 'DATA_UNAVAILABLE',
        latency: latest ? latest.latency : null,
        last_run: latest ? latest.timestamp : null,
        last_failure: lastFailure ? lastFailure.timestamp : null,
        total_runs: history.length,
        success_rate: history.length > 0 ? Math.round((successCount / history.length) * 100) : null,
        history_24h: history.slice(0, 24).map(r => ({
          status: r.success ? 'SUCCESS' : 'FAILED',
          latency: r.latency,
          timestamp: r.timestamp
        }))
      };
    });
  }

  // Recent runs of a check.
  getHealthCheckRuns(checkId, { env = null, limit = 50 } = {}) {
    const history = this.healthCheckHistory.get(checkId) || [];
    let filtered = history;
    if (env) filtered = filtered.filter(r => r.env === env);
    return filtered.slice(0, limit);
  }
}

/** A step's own numeric measurements, keyed by metric name; non-finite values become null. */
function stepMetricValues(res) {
  const out = {};
  if (!res || !res.metrics || typeof res.metrics !== 'object') return out;
  for (const [name, value] of Object.entries(res.metrics)) {
    if (!/^journey\.[a-z0-9_.]+$/.test(name)) continue;
    out[name] = typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return out;
}

/**
 * A step's descriptive attributes (strings only), e.g. jenkins.built_on, git.reset. Metric points
 * get `attributes` (low cardinality); spans and the step record also get `details` (per-run ids).
 */
function stepAttributes(res, field = 'attributes') {
  const out = {};
  if (!res || !res[field] || typeof res[field] !== 'object') return out;
  for (const [k, v] of Object.entries(res[field])) {
    if (/^[a-z0-9_.]+$/.test(k) && v !== null && v !== undefined) out[k] = String(v);
  }
  return out;
}

let globalRunner = null;
// Shared runner instance.
function getGlobalRunner() {
  if (!globalRunner) {
    globalRunner = new JourneyRunner();
  }
  return globalRunner;
}

module.exports = {
  JourneyRunner,
  SyntheticsRunner: JourneyRunner,
  getGlobalRunner,
  loadAllHealthCheckDefinitions: (...args) => getGlobalRunner().loadAllHealthCheckDefinitions(...args),
  runHealthCheck: (...args) => getGlobalRunner().runHealthCheck(...args),
  runAllHealthChecks: (...args) => getGlobalRunner().runAllHealthChecks(...args),
  getHealthCheckSummary: (...args) => getGlobalRunner().getHealthCheckSummary(...args),
  getHealthCheckRuns: (...args) => getGlobalRunner().getHealthCheckRuns(...args)
};
