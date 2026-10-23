'use strict';
// P3b: per-controller Jenkins polling. One bad controller must not hide the others.
const assert = require('assert');
const poller = require('../metrics_collection/real/applications/jenkins_topology');

const NOW = Date.parse('2026-10-22T10:00:00Z');
const topology = {
  operations_centers: [
    { id: 'oc-a', region: 'emea', controllers: [{ id: 'a1', flavour: 'APS', url: 'https://a1.test/' }, { id: 'a2', url: 'https://a2.test' }] },
    { id: 'oc-b', region: 'apac', controllers: [{ id: 'b1', url: 'https://b1.test' }, { id: 'no-url' }] }
  ]
};

const ok = (data) => ({ success: true, data, latencyMs: 12 });
function fakeFetch(url) {
  if (url.startsWith('https://a1.test')) {
    return Promise.resolve(url.includes('/queue/')
      ? ok({ items: [{ id: 1, inQueueSince: NOW - 90000 }, { id: 2, inQueueSince: NOW - 30000 }, { id: 3 }] })
      : ok({ totalExecutors: 20, busyExecutors: 15, computer: [
        { displayName: 'Built-In Node', offline: false, numExecutors: 2 },
        { displayName: 'agent-1', offline: false, numExecutors: 4, idle: true },
        { displayName: 'agent-2', offline: true, numExecutors: 4 }] }));
  }
  if (url.startsWith('https://a2.test')) return Promise.resolve({ success: false, authFailed: true, status: 'AUTH_FAILED' });
  return Promise.resolve({ success: false, authFailed: false, error: 'HTTP 503' });
}

(async () => {
  const list = poller.listControllers(topology);
  assert.deepStrictEqual(list.map(c => c.id), ['a1', 'a2', 'b1'], 'controllers without a URL are skipped');
  assert.strictEqual(list[0].url, 'https://a1.test', 'trailing slash trimmed');
  console.log('✔ controllers are read from the manifest topology');

  const snap = await poller.pollAll(topology, { fetchJson: fakeFetch, nowMs: NOW });
  const by = Object.fromEntries(snap.controllers.map(c => [c.id, c]));
  assert.strictEqual(by.a1.status, 'OK');
  assert.deepStrictEqual(by.a1.queue, { length: 3, oldest_wait_s: 90 });
  assert.deepStrictEqual(by.a1.executors, { busy: 15, total: 20 });
  assert.deepStrictEqual(by.a1.agents, { total: 2, offline: 1, online: 1 }, 'built-in node is not counted as an agent');
  assert.strictEqual(by.a2.status, 'AUTH_FAILED');
  assert.strictEqual(by.b1.status, 'DATA_UNAVAILABLE');
  assert.strictEqual(by.a2.queue, null);
  console.log('✔ AUTH_FAILED and DATA_UNAVAILABLE stay distinct per controller; values are null, not zero');

  assert.strictEqual(snap.answered, 1);
  assert.strictEqual(snap.declared, 3);
  assert.strictEqual(snap.auth_failed, 1);
  assert.deepStrictEqual(snap.totals, { queue: 3, executors_busy: 15, executors_total: 20, agents_online: 1, agents_offline: 1 });
  console.log('✔ totals come only from controllers that answered, with answered/declared reported');

  const none = await poller.pollAll(topology, { fetchJson: async () => ({ success: false, error: 'x' }), nowMs: NOW });
  assert.strictEqual(none.totals, null, 'no answers -> no totals');
  const thrower = await poller.pollAll(topology, { fetchJson: async () => { throw new Error('boom'); }, nowMs: NOW });
  assert.ok(thrower.controllers.every(c => c.status === 'DATA_UNAVAILABLE'));
  console.log('✔ no answers gives null totals; a throwing fetch is contained');

  // Collector integration
  const shared = require('../metrics_collection/shared/fetch_with_fallback');
  const realFetch = shared.fetchJsonWithFallback;
  shared.fetchJsonWithFallback = fakeFetch;
  const config = require('@sentinel/config');
  const yamlConfig = require('@sentinel/config/yaml_config');
  const realGetApp = yamlConfig.getApplication;
  yamlConfig.getApplication = (id) => (id === 'cloudbees_jenkins' ? { topology } : realGetApp(id));
  const origUrls = Object.getOwnPropertyDescriptor(config, 'ACTIVE_URLS');
  Object.defineProperty(config, 'ACTIVE_URLS', { configurable: true, get: () => ({ jenkins_master_url: 'https://jenkins.test/job' }) });
  delete require.cache[require.resolve('../metrics_collection/real/applications/jenkins_collector')];
  const collector = require('../metrics_collection/real/applications/jenkins_collector');
  const res = await collector.collect({}, {});
  assert.strictEqual(res.queue, 3);
  assert.strictEqual(res.executors, 20);
  assert.strictEqual(res.busyExecutors, 15);
  assert.strictEqual(res.controllersAnswered, 1);
  assert.strictEqual(res.controllersDeclared, 3);
  assert.ok(poller.getLastSnapshot() && poller.getLastSnapshot().controllers.length === 3);

  shared.fetchJsonWithFallback = async (url) => (url.includes('/queue/') || url.includes('/computer/') ? { success: false, authFailed: true } : { success: false });
  delete require.cache[require.resolve('../metrics_collection/real/applications/jenkins_collector')];
  const denied = await require('../metrics_collection/real/applications/jenkins_collector').collect({}, {});
  assert.strictEqual(denied.status, 'AUTH_FAILED');
  assert.strictEqual(denied.queue, null);
  shared.fetchJsonWithFallback = realFetch; yamlConfig.getApplication = realGetApp;
  if (origUrls) Object.defineProperty(config, 'ACTIVE_URLS', origUrls); else delete config.ACTIVE_URLS;
  console.log('✔ collector aggregates controllers; all-refused is AUTH_FAILED, not zero');

  console.log('PHASE H JENKINS POLLER TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
