/**
 * synthetics/steps/jenkins.js
 *
 * [Phase Q / Q2] Jenkins canary build step: queue wait and agent allocation from the build API.
 *
 *   1. POST <jenkins>/job/<job>/build (or buildWithParameters) with the journey credential.
 *   2. Read the queue item id from the Location header and poll
 *      <jenkins>/queue/item/<id>/api/json until `executable` appears (or `cancelled`).
 *   3. Read <jenkins>/job/<job>/<n>/api/json:
 *        queue wait ms   = build.timestamp − queueItem.inQueueSince   (both Jenkins epoch ms)
 *        agent           = build.builtOn ('' means the built-in node), executor number when exposed
 *        build duration  = build.duration once building === false (only when wait_for_completion)
 *
 * Every URL is built from the configured Jenkins base: the Location header only contributes the
 * numeric queue id, so a redirect to another host can never receive the credential.
 * Polling is bounded by queue_timeout_ms / build_timeout_ms and sleeps poll_interval_ms between
 * requests. Nothing is estimated: a value Jenkins did not report is null and the step fails with
 * the reason.
 */

const { performance } = require('perf_hooks');

const MIN_POLL_MS = 100;

// Waits.
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** "folder/sub/job" -> "/job/folder/job/sub/job/job" */
function jobPath(job) {
  return String(job).split('/').filter(Boolean).map(seg => `/job/${encodeURIComponent(seg)}`).join('');
}

// Auth headers.
function authHeaders(step, credential) {
  const headers = {};
  if (!credential) return headers;
  if (step.auth_type === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(String(credential)).toString('base64')}`;
  } else if (step.auth_type === 'header' && step.auth_header) {
    headers[step.auth_header] = credential;
  } else {
    headers.Authorization = `Bearer ${credential}`;
  }
  return headers;
}

// HTTP request with timeout.
async function request(url, { method = 'GET', headers, timeoutMs, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal, redirect: 'manual' });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${method} ${new URL(url).pathname} timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// GET returning JSON.
async function getJson(url, opts) {
  const res = await request(url, opts);
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`AUTH_FAILED: ${new URL(url).pathname} returned HTTP ${res.status}`);
    e.authFailed = true;
    throw e;
  }
  if (res.status !== 200) throw new Error(`${new URL(url).pathname} returned HTTP ${res.status}`);
  try {
    return JSON.parse(res.text);
  } catch (_) {
    throw new Error(`${new URL(url).pathname} returned non-JSON body`);
  }
}

// Number or null.
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Runs a Jenkins step (trigger a job and wait).
async function executeJenkinsStep(step, context = {}) {
  const t0 = performance.now();
  const metrics = {};
  const attributes = {};
  const details = {}; // per-run ids: span/step record only, never metric attributes
  const result = (error, extra = {}) => ({
    success: !error,
    status: error ? 'ERROR' : 'OK',
    durationMs: performance.now() - t0,
    error: error || undefined,
    metrics,
    attributes,
    details,
    ...extra
  });

  const base = String(step.jenkins_url || context.baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return result('Jenkins step requires jenkins_url (or journey base_url)');
  if (!step.job || typeof step.job !== 'string') return result('Jenkins step requires job');
  attributes['jenkins.job'] = step.job;

  const jp = jobPath(step.job);
  const headers = authHeaders(step, context.credential);
  const requestTimeoutMs = step.request_timeout_ms || 10000;
  const pollMs = Math.max(MIN_POLL_MS, step.poll_interval_ms || 2000);
  const queueTimeoutMs = step.queue_timeout_ms || 120000;
  const buildTimeoutMs = step.build_timeout_ms || 600000;
  const waitForCompletion = step.wait_for_completion !== false;
  const expectResult = step.expect_result === undefined ? 'SUCCESS' : step.expect_result;

  let build = null;
  let startTs = null;
  let inQueueSince = null;
  const finish = (pending) => {
    const problems = [];
    if (pending) problems.push(pending);
    if (metrics['journey.jenkins.queue_wait_ms'] === null) {
      problems.push(`queue wait unavailable (inQueueSince=${inQueueSince === null ? 'missing' : 'ok'}, timestamp=${startTs === null ? 'missing' : 'ok'})`);
    }
    if (attributes['jenkins.built_on'] === undefined) problems.push('builtOn not reported by build API');
    if (!pending && waitForCompletion) {
      if (metrics['journey.jenkins.build_duration_ms'] === null) problems.push('build duration not reported');
      if (expectResult && build.result !== expectResult) problems.push(`build result ${build.result || 'missing'} (expected ${expectResult})`);
    }
    if (!problems.length && step.assert && step.assert.max_queue_wait_ms !== undefined
      && metrics['journey.jenkins.queue_wait_ms'] > step.assert.max_queue_wait_ms) {
      problems.push(`queue wait ${metrics['journey.jenkins.queue_wait_ms']}ms > ${step.assert.max_queue_wait_ms}ms`);
    }
    return result(problems.length ? problems.join('; ') : null);
  };

  try {
    // 1. trigger
    const params = step.parameters && typeof step.parameters === 'object' ? step.parameters : null;
    const triggerUrl = `${base}${jp}/${params ? 'buildWithParameters' : 'build'}`;
    let body;
    const postHeaders = { ...headers };
    if (params) {
      body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
      postHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const tTrigger = performance.now();
    const trig = await request(triggerUrl, { method: 'POST', headers: postHeaders, timeoutMs: requestTimeoutMs, body });
    metrics['journey.jenkins.trigger_ms'] = performance.now() - tTrigger;
    if (trig.status === 401 || trig.status === 403) return result(`AUTH_FAILED: trigger returned HTTP ${trig.status}`, { authFailed: true });
    if (trig.status !== 201 && trig.status !== 200) return result(`Trigger returned HTTP ${trig.status}`);
    const location = trig.headers.get('location') || '';
    const m = /\/queue\/item\/(\d+)\/?$/.exec(location);
    if (!m) return result('Trigger response has no queue item Location header');
    const queueId = m[1];
    details['jenkins.queue_id'] = queueId;

    // 2. follow the queue item
    const queueUrl = `${base}/queue/item/${queueId}/api/json`;
    const queueDeadline = Date.now() + queueTimeoutMs;
    let item = null;
    for (;;) {
      const remaining = queueDeadline - Date.now();
      if (remaining <= 0) {
        return result(`Queue item ${queueId} not started within ${queueTimeoutMs}ms${item && item.why ? ` (${item.why})` : ''}`);
      }
      item = await getJson(queueUrl, { headers, timeoutMs: Math.min(requestTimeoutMs, remaining) });
      if (item.cancelled) return result(`Queue item ${queueId} was cancelled`);
      if (item.executable && Number.isInteger(item.executable.number)) break;
      await sleep(Math.min(pollMs, Math.max(0, queueDeadline - Date.now())));
    }
    const buildNumber = item.executable.number;
    details['jenkins.build_number'] = String(buildNumber);
    inQueueSince = num(item.inQueueSince);

    // 3. read the build
    const buildUrl = `${base}${jp}/${buildNumber}/api/json`;
    const buildDeadline = Date.now() + buildTimeoutMs;
    build = await getJson(buildUrl, { headers, timeoutMs: requestTimeoutMs });
    startTs = num(build.timestamp);

    metrics['journey.jenkins.queue_wait_ms'] = startTs !== null && inQueueSince !== null ? startTs - inQueueSince : null;
    if (build.builtOn !== undefined && build.builtOn !== null) {
      attributes['jenkins.built_on'] = build.builtOn === '' ? 'built-in' : String(build.builtOn);
    }
    if (build.executor && Number.isInteger(build.executor.number)) {
      attributes['jenkins.executor'] = String(build.executor.number);
    }

    if (waitForCompletion) {
      while (build.building !== false) {
        const remaining = buildDeadline - Date.now();
        if (remaining <= 0) {
          return finish(`Build #${buildNumber} still running after ${buildTimeoutMs}ms`);
        }
        await sleep(Math.min(pollMs, remaining));
        build = await getJson(buildUrl, { headers, timeoutMs: Math.min(requestTimeoutMs, Math.max(1, buildDeadline - Date.now())) });
        if (attributes['jenkins.built_on'] === undefined && typeof build.builtOn === 'string') {
          attributes['jenkins.built_on'] = build.builtOn === '' ? 'built-in' : build.builtOn;
        }
      }
      metrics['journey.jenkins.build_duration_ms'] = num(build.duration);
      if (build.result) attributes['jenkins.result'] = String(build.result);
    }

    return finish(null);
  } catch (err) {
    return result(err.message, err.authFailed ? { authFailed: true } : {});
  }
}

module.exports = {
  executeJenkinsStep,
  _jobPath: jobPath
};
