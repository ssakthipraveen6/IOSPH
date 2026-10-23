'use strict';
/**
 * jenkins_topology.js - per-controller Jenkins polling (P3b).
 *
 * The manifest declares the operations centres and their controllers. Each controller is
 * polled on its own so one slow or locked-out controller cannot hide the others. Every
 * controller reports one of:
 *   OK                - both endpoints answered
 *   AUTH_FAILED       - the service account was refused (never reported as "no data")
 *   DATA_UNAVAILABLE  - unreachable, timed out, or an unusable answer
 * Totals are computed only from controllers that answered, and say how many did.
 */

const QUEUE_PATH = '/queue/api/json?tree=items[id,inQueueSince,why,task[name]]';
const COMPUTER_PATH = '/computer/api/json?tree=totalExecutors,busyExecutors,computer[displayName,offline,temporarilyOffline,numExecutors,idle]';
const BUILT_IN = new Set(['Built-In Node', 'master', '(built-in)']);

/** Flattens topology.operations_centers into [{ id, oc, region, flavour, url }] (controllers without a URL are skipped). */
function listControllers(topology) {
  const out = [];
  for (const oc of (topology && topology.operations_centers) || []) {
    for (const c of oc.controllers || []) {
      if (!c || !c.id || !c.url) continue;
      out.push({ id: c.id, oc: oc.id, region: oc.region || null, flavour: c.flavour || null, url: String(c.url).replace(/\/+$/, '') });
    }
  }
  return out;
}

// Controller result when it cannot be read.
function unavailable(ctrl, status, error) {
  return { id: ctrl.id, oc: ctrl.oc, region: ctrl.region, flavour: ctrl.flavour, status, error, queue: null, executors: null, agents: null, computers: [] };
}

// Reads the queue and computers of one controller.
async function pollController(ctrl, fetchJson, nowMs) {
  const [q, c] = await Promise.all([
    fetchJson(`${ctrl.url}${QUEUE_PATH}`, { headers: { Accept: 'application/json' }, appId: 'cloudbees_jenkins' }, 5000),
    fetchJson(`${ctrl.url}${COMPUTER_PATH}`, { headers: { Accept: 'application/json' }, appId: 'cloudbees_jenkins' }, 5000)
  ]);
  if ((q && q.authFailed) || (c && c.authFailed)) return unavailable(ctrl, 'AUTH_FAILED', 'AUTH_FAILED');
  if (!q || !q.success || !q.data || !Array.isArray(q.data.items)) return unavailable(ctrl, 'DATA_UNAVAILABLE', (q && q.error) || 'queue unavailable');
  if (!c || !c.success || !c.data || !Array.isArray(c.data.computer)) return unavailable(ctrl, 'DATA_UNAVAILABLE', (c && c.error) || 'computer list unavailable');

  const waits = q.data.items.map(i => (Number.isFinite(i.inQueueSince) ? Math.max(0, Math.round((nowMs - i.inQueueSince) / 1000)) : null)).filter(w => w !== null);
  const computers = c.data.computer
    .filter(x => x && x.displayName && !BUILT_IN.has(x.displayName))
    .map(x => ({
      name: x.displayName,
      offline: !!x.offline,
      temporarily_offline: !!x.temporarilyOffline,
      num_executors: Number.isFinite(x.numExecutors) ? x.numExecutors : null,
      idle: !!x.idle,
      region: ctrl.region
    }));
  const offline = computers.filter(x => x.offline).length;
  return {
    id: ctrl.id, oc: ctrl.oc, region: ctrl.region, flavour: ctrl.flavour, status: 'OK', error: null,
    queue: { length: q.data.items.length, oldest_wait_s: waits.length ? Math.max(...waits) : 0 },
    executors: Number.isFinite(c.data.totalExecutors) && Number.isFinite(c.data.busyExecutors)
      ? { busy: c.data.busyExecutors, total: c.data.totalExecutors } : null,
    agents: { total: computers.length, offline, online: computers.length - offline },
    computers,
    latency_ms: Math.max(q.latencyMs || 0, c.latencyMs || 0) || null
  };
}

/** Polls every declared controller, a few at a time. */
async function pollAll(topology, { fetchJson, nowMs = Date.now(), concurrency = 5 } = {}) {
  const list = listControllers(topology);
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      try { results[i] = await pollController(list[i], fetchJson, nowMs); }
      catch (err) { results[i] = unavailable(list[i], 'DATA_UNAVAILABLE', err.message); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));

  const ok = results.filter(r => r.status === 'OK');
  const sum = (f) => ok.reduce((n, r) => n + (f(r) || 0), 0);
  return {
    polled_at: new Date(nowMs).toISOString(),
    controllers: results,
    answered: ok.length,
    declared: list.length,
    auth_failed: results.filter(r => r.status === 'AUTH_FAILED').length,
    totals: ok.length ? {
      queue: sum(r => r.queue && r.queue.length),
      executors_busy: sum(r => r.executors && r.executors.busy),
      executors_total: sum(r => r.executors && r.executors.total),
      agents_online: sum(r => r.agents && r.agents.online),
      agents_offline: sum(r => r.agents && r.agents.offline)
    } : null
  };
}

let lastSnapshot = null;
// Last topology poll.
const getLastSnapshot = () => lastSnapshot;
// Stores the last topology poll.
const setLastSnapshot = (s) => { lastSnapshot = s; };

module.exports = { listControllers, pollController, pollAll, getLastSnapshot, setLastSnapshot };
