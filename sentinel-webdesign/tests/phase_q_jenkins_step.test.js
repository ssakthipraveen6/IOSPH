'use strict';

/**
 * tests/phase_q_jenkins_step.test.js
 *
 * Phase Q / Q2 acceptance: Jenkins canary step against a fake Jenkins API (node http).
 *  - POST /job/<job>/build with the journey credential, follow Location → queue item → build
 *  - queue wait = build.timestamp − queueItem.inQueueSince exactly; builtOn/executor reported
 *  - build duration when finished
 *  - queue never starts → failed step with a reason, no queue-wait value
 *  - missing inQueueSince → null, failed step (no fabricated value)
 *  - Location pointing at another host never receives the credential
 *  - runner dispatches `type: http` + `action: jenkins_build` and emits journey.jenkins.* metrics
 */

const assert = require('assert');
const http = require('http');

const CRED = 'svc-canary:jenkins-api-token-q2';
const EXPECTED_AUTH = `Basic ${Buffer.from(CRED).toString('base64')}`;

const IN_QUEUE_SINCE = 1760000000000;
const BUILD_TS = 1760000004321; // 4321 ms later

function fakeJenkins(scenario) {
  const state = { requests: [], polls: 0, buildPolls: 0 };
  const server = http.createServer((req, res) => {
    state.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || null });
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== EXPECTED_AUTH) return json(401, { error: 'unauthorized' });

    if (req.method === 'POST' && req.url === '/job/canary/job/noop/build') {
      const loc = scenario.location || `http://127.0.0.1:${server.address().port}/queue/item/77/`;
      res.writeHead(201, { Location: loc });
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/queue/item/77/api/json') {
      state.polls++;
      if (scenario.neverStarts || state.polls < 3) {
        return json(200, { id: 77, inQueueSince: IN_QUEUE_SINCE, why: 'Waiting for next available executor', blocked: false });
      }
      const item = { id: 77, executable: { number: 12, url: 'http://elsewhere.invalid/job/canary/job/noop/12/' } };
      if (!scenario.noInQueueSince) item.inQueueSince = IN_QUEUE_SINCE;
      return json(200, item);
    }
    if (req.method === 'GET' && req.url.startsWith('/job/canary/job/noop/12/api/json')) {
      state.buildPolls++;
      const building = state.buildPolls < 2;
      return json(200, {
        number: 12,
        timestamp: BUILD_TS,
        building,
        duration: building ? 0 : 1500,
        result: building ? null : 'SUCCESS',
        builtOn: 'linux-docker-agent-07',
        executor: building ? { number: 2 } : null
      });
    }
    json(404, { error: 'not found', url: req.url });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

function baseStep(base, extra = {}) {
  return {
    id: 'canary_queue_wait', type: 'http', action: 'jenkins_build', layer: 'app',
    jenkins_url: base, job: 'canary/noop', auth_type: 'basic',
    poll_interval_ms: 100, queue_timeout_ms: 3000, build_timeout_ms: 3000,
    ...extra
  };
}

async function main() {
  const { executeJenkinsStep } = require('../synthetics/steps/jenkins');

  // 1. Happy path.
  console.log('[Q2] queue wait, agent allocation, build duration');
  let f = await fakeJenkins({});
  let res = await executeJenkinsStep(baseStep(f.base), { credential: CRED });
  assert.strictEqual(res.success, true, res.error);
  assert.strictEqual(res.status, 'OK');
  assert.strictEqual(res.metrics['journey.jenkins.queue_wait_ms'], BUILD_TS - IN_QUEUE_SINCE);
  assert.strictEqual(res.metrics['journey.jenkins.queue_wait_ms'], 4321);
  assert.strictEqual(res.metrics['journey.jenkins.build_duration_ms'], 1500);
  assert.strictEqual(typeof res.metrics['journey.jenkins.trigger_ms'], 'number');
  assert.strictEqual(res.attributes['jenkins.built_on'], 'linux-docker-agent-07');
  assert.strictEqual(res.attributes['jenkins.executor'], '2');
  assert.strictEqual(res.attributes['jenkins.result'], 'SUCCESS');
  assert.strictEqual(res.details['jenkins.build_number'], '12');
  assert.strictEqual(f.state.polls, 3, 'queue item polled until executable appeared');
  assert(f.state.requests.every(r => r.auth === EXPECTED_AUTH), 'credential sent on every request');
  assert(!f.state.requests.some(r => r.url.includes('elsewhere')));
  f.server.close();
  console.log('  -> PASSED: queue wait = timestamp − inQueueSince = 4321ms, builtOn linux-docker-agent-07, executor 2, duration 1500ms');

  // 2. Queue never starts → failed step with reason, no fabricated value.
  console.log('[Q2] queue timeout');
  f = await fakeJenkins({ neverStarts: true });
  const t0 = Date.now();
  res = await executeJenkinsStep(baseStep(f.base, { queue_timeout_ms: 600, poll_interval_ms: 150 }), { credential: CRED });
  const elapsed = Date.now() - t0;
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.status, 'ERROR');
  assert(/not started within 600ms/.test(res.error), res.error);
  assert(/Waiting for next available executor/.test(res.error), 'reason carries Jenkins "why"');
  assert(!('journey.jenkins.queue_wait_ms' in res.metrics), 'no queue wait value on timeout');
  assert(!('jenkins.built_on' in res.attributes));
  assert(elapsed >= 550 && elapsed < 2500, `bounded by queue_timeout_ms (took ${elapsed}ms)`);
  assert(f.state.polls >= 2 && f.state.polls <= 8, `polls spaced by poll_interval_ms, not a busy loop (${f.state.polls})`);
  f.server.close();
  console.log(`  -> PASSED: timeout reported as failed step after ${elapsed}ms with ${f.state.polls} polls`);

  // 3. inQueueSince missing → null, failed.
  console.log('[Q2] missing inQueueSince');
  f = await fakeJenkins({ noInQueueSince: true });
  res = await executeJenkinsStep(baseStep(f.base), { credential: CRED });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.metrics['journey.jenkins.queue_wait_ms'], null);
  assert(/queue wait unavailable \(inQueueSince=missing/.test(res.error), res.error);
  assert.strictEqual(res.attributes['jenkins.built_on'], 'linux-docker-agent-07', 'real values still reported');
  f.server.close();
  console.log('  -> PASSED: missing inQueueSince → null + failed step');

  // 4. Location on another host: only the queue id is used, credential stays on the Jenkins base.
  console.log('[Q2] foreign Location host');
  let foreignHits = 0;
  const foreign = http.createServer((req, r) => { foreignHits++; r.end('{}'); });
  await new Promise(r => foreign.listen(0, '127.0.0.1', r));
  f = await fakeJenkins({ location: `http://localhost:${foreign.address().port}/queue/item/77/` });
  res = await executeJenkinsStep(baseStep(f.base), { credential: CRED });
  assert.strictEqual(res.success, true, res.error);
  assert.strictEqual(foreignHits, 0, 'credential never sent to the Location host');
  f.server.close();
  foreign.close();
  console.log('  -> PASSED: queue followed on configured base only');

  // 5. Bad credential → AUTH_FAILED, distinct from data unavailable.
  f = await fakeJenkins({});
  res = await executeJenkinsStep(baseStep(f.base), { credential: 'wrong:token' });
  assert.strictEqual(res.success, false);
  assert(/^AUTH_FAILED/.test(res.error));
  assert.strictEqual(res.authFailed, true);
  f.server.close();
  console.log('  -> PASSED: 401 surfaces as AUTH_FAILED');

  // 6. Runner integration.
  console.log('[Q2] runner dispatch + metric emission');
  const { JourneyRunner } = require('../synthetics/runner');
  f = await fakeJenkins({});
  const metrics = [];
  const spans = [];
  const runner = new JourneyRunner({
    isLeaderCheck: () => true,
    clickhouseClient: { insertSpans: async s => { spans.push(...s); } },
    dbManager: { addMetricBatch: m => metrics.push(...m) },
    credentialProvider: { getCredential: async () => CRED }
  });
  const run = await runner.runJourney('cloudbees_jenkins', {
    id: 'jenkins_canary_pipeline', credentials_purpose: 'api_token',
    steps: [baseStep(f.base)]
  }, 'staging');
  assert.strictEqual(run.success, true, run.failingError);
  const qw = metrics.find(m => m.metricName === 'journey.jenkins.queue_wait_ms');
  assert(qw, 'journey.jenkins.queue_wait_ms emitted');
  assert.strictEqual(qw.value, 4321);
  assert.strictEqual(qw.attributes['jenkins.built_on'], 'linux-docker-agent-07');
  assert.strictEqual(qw.attributes.step, 'canary_queue_wait');
  assert(!('jenkins.build_number' in qw.attributes), 'per-run build number not a metric attribute');
  assert(metrics.some(m => m.metricName === 'journey.jenkins.build_duration_ms' && m.value === 1500));
  assert.strictEqual(run.steps[0].metrics['journey.jenkins.queue_wait_ms'], 4321);
  assert.strictEqual(run.steps[0].attributes['jenkins.build_number'], '12');
  const stepSpan = spans.find(s => JSON.stringify(s).includes('linux-docker-agent-07'));
  assert(stepSpan, 'step span carries jenkins.built_on');
  f.server.close();

  // Runner with a timed-out step: failed, no queue_wait metric point.
  f = await fakeJenkins({ neverStarts: true });
  metrics.length = 0;
  const failed = await runner.runJourney('cloudbees_jenkins', {
    id: 'jenkins_canary_pipeline', credentials_purpose: 'api_token',
    steps: [baseStep(f.base, { queue_timeout_ms: 300 })]
  }, 'staging');
  assert.strictEqual(failed.success, false);
  assert.strictEqual(failed.steps[0].status, 'FAILED');
  assert(!metrics.some(m => m.metricName === 'journey.jenkins.queue_wait_ms'));
  assert(metrics.some(m => m.metricName === 'journey.success' && m.value === 0));
  f.server.close();
  console.log('  -> PASSED: runner emits journey.jenkins.* metrics; timeout is a FAILED step with no value');

  console.log('\nphase_q_jenkins_step: ALL PASSED');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());
