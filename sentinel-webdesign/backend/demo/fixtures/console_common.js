// DEMO FIXTURE HELPERS — never served outside /api/demo
// Shared by the observability-console demo fixtures. All numbers are sample values.
'use strict';

const STATE_LABEL = { ok: 'Healthy', warn: 'Warning', crit: 'Degraded' };

/** Deterministic smooth series (no randomness) so every fetch returns the same picture. */
function wave(n, base, amp, phase = 0, drift = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = base + Math.sin(i * 0.7 + phase) * amp + Math.sin(i * 1.9 + phase * 2) * (amp / 2) + drift * (i / Math.max(1, n - 1));
    out.push(Math.round(v * 100) / 100);
  }
  return out;
}

/** Worst of a list of states: crit > warn > ok. */
function worst(states) {
  if (states.includes('crit')) return 'crit';
  if (states.includes('warn')) return 'warn';
  return 'ok';
}

/** ISO date `days` from now (date part only). */
function inDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

// Number of items matching a test.
function count(list, pred) {
  return list.filter(pred).length;
}

/**
 * Sample estate shared by every console screen, so totals agree between screens.
 * Jenkins: 5 operations centres, 10 controllers (APS + DEV each), 200 Windows
 * agents (pool grouping is an assumption), 50 Ubuntu docker agents (10 per OC).
 */
const JENKINS = {
  controllers: [
    { id: 'oc01-aps', oc: 'OC-01', env: 'APS', busy: 58, total: 80, queue: 6, heapPct: 62, successPct: 96.1 },
    { id: 'oc01-dev', oc: 'OC-01', env: 'DEV', busy: 31, total: 60, queue: 2, heapPct: 55, successPct: 92.4 },
    { id: 'oc02-aps', oc: 'OC-02', env: 'APS', busy: 64, total: 80, queue: 11, heapPct: 70, successPct: 95.3 },
    { id: 'oc02-dev', oc: 'OC-02', env: 'DEV', busy: 40, total: 60, queue: 4, heapPct: 58, successPct: 90.8 },
    { id: 'oc03-aps', oc: 'OC-03', env: 'APS', busy: 80, total: 80, queue: 74, heapPct: 91, successPct: 88.2 },
    { id: 'oc03-dev', oc: 'OC-03', env: 'DEV', busy: 52, total: 60, queue: 19, heapPct: 78, successPct: 89.9 },
    { id: 'oc04-aps', oc: 'OC-04', env: 'APS', busy: 47, total: 80, queue: 3, heapPct: 60, successPct: 97.0 },
    { id: 'oc04-dev', oc: 'OC-04', env: 'DEV', busy: 22, total: 60, queue: 1, heapPct: 49, successPct: 93.5 },
    { id: 'oc05-aps', oc: 'OC-05', env: 'APS', busy: 70, total: 80, queue: 21, heapPct: 77, successPct: 94.0 },
    { id: 'oc05-dev', oc: 'OC-05', env: 'DEV', busy: 28, total: 60, queue: 1, heapPct: 52, successPct: 91.7 }
  ],
  // Offline Ubuntu agents by OC index (10 agents per OC)
  ubuntuOffline: { 'OC-03': 1, 'OC-05': 2 },
  // Windows pools: 4 x 50 (grouping assumed), offline counts per pool
  windowsPools: [
    { id: 'WIN-A', offline: 0, maintenance: 0 },
    { id: 'WIN-B', offline: 12, maintenance: 0 },
    { id: 'WIN-C', offline: 0, maintenance: 3 },
    { id: 'WIN-D', offline: 0, maintenance: 3 }
  ]
};

// Sample state of a Jenkins controller from its load.
function controllerState(c) {
  const exec = c.busy / c.total;
  if (c.queue > 40 || c.heapPct > 85) return 'crit';
  if (c.queue > 15 || c.heapPct > 75 || exec >= 0.95) return 'warn';
  return 'ok';
}

// Sample Jenkins totals (agents, executors).
function jenkinsTotals() {
  const ubuntuTotal = 50;
  const ubuntuOffline = Object.values(JENKINS.ubuntuOffline).reduce((a, b) => a + b, 0);
  const winTotal = JENKINS.windowsPools.length * 50;
  const winOffline = JENKINS.windowsPools.reduce((a, p) => a + p.offline, 0);
  return {
    controllers: JENKINS.controllers.length,
    executorsBusy: JENKINS.controllers.reduce((a, c) => a + c.busy, 0),
    executorsTotal: JENKINS.controllers.reduce((a, c) => a + c.total, 0),
    queue: JENKINS.controllers.reduce((a, c) => a + c.queue, 0),
    winTotal, winOnline: winTotal - winOffline,
    ubuntuTotal, ubuntuOnline: ubuntuTotal - ubuntuOffline,
    staticTotal: winTotal + ubuntuTotal,
    staticOnline: winTotal - winOffline + ubuntuTotal - ubuntuOffline
  };
}

module.exports = { STATE_LABEL, wave, worst, inDays, count, JENKINS, controllerState, jenkinsTotals };
