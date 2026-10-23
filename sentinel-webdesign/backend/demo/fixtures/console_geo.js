// DEMO FIXTURE — never served outside /api/demo
// Artifactory & Bitbucket replication across EMEA (primary), APAC and AMER (mirrors).
'use strict';
const { wave, worst } = require('./console_common');

// One sample Artifactory node.
const node = (id, state, cpu, heap, p95) => ({ id, state, cpu_pct: cpu, heap_pct: heap, p95_ms: p95 });
// Sample mirror list for a region.
const mirrors = (prefix, n, warnIdx = []) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(2, '0')}`,
    state: warnIdx.includes(i) ? 'warn' : 'ok',
    note: warnIdx.includes(i) ? 'high GC' : 'healthy'
  }));

// Sample regions with their nodes and mirrors.
const regions = [
  { id: 'EMEA', role: 'Primary', artifactory: { app: [node('art-emea-01', 'ok', 41, 63, 210), node('art-emea-02', 'ok', 44, 66, 230), node('art-emea-03', 'ok', 39, 61, 205), node('art-emea-04', 'warn', 72, 84, 410)], xray: [node('xray-emea-01', 'ok', 58, 70, null), node('xray-emea-02', 'ok', 55, 68, null)], xray_queue: 212, storage_pct: 71, cache_hit_pct: null },
    bitbucket: { title: 'Bitbucket Data Center · 15 nodes', nodes: mirrors('bb-emea', 15, [9]), clone_p95_s: 4.1, ops_per_min: 3480, third: { label: 'Hosting tickets', value: '12% used' } } },
  { id: 'APAC', role: 'Mirror', artifactory: { app: [node('art-apac-01', 'warn', 66, 79, 520), node('art-apac-02', 'ok', 48, 64, 380)], xray: [node('xray-apac-01', 'ok', 37, 58, null), node('xray-apac-02', 'ok', 35, 57, null)], xray_queue: 64, storage_pct: 58, cache_hit_pct: 81 },
    bitbucket: { title: 'Bitbucket smart mirrors · 5', nodes: mirrors('bb-apac', 5), clone_p95_s: 3.2, ops_per_min: 920, third: { label: 'Mirror sync lag', value: '42s' } } },
  { id: 'AMER', role: 'Mirror', artifactory: { app: [node('art-amer-01', 'ok', 34, 60, 240), node('art-amer-02', 'ok', 31, 59, 250)], xray: [node('xray-amer-01', 'ok', 29, 55, null), node('xray-amer-02', 'ok', 30, 54, null)], xray_queue: 18, storage_pct: 49, cache_hit_pct: 93 },
    bitbucket: { title: 'Bitbucket smart mirrors · 5', nodes: mirrors('bb-amer', 5), clone_p95_s: 2.9, ops_per_min: 760, third: { label: 'Mirror sync lag', value: '35s' } } }
].map(r => ({
  ...r,
  state: worst([...r.artifactory.app, ...r.artifactory.xray, ...r.bitbucket.nodes].map(n => n.state)),
  artifactory: { ...r.artifactory, up: `${[...r.artifactory.app, ...r.artifactory.xray].length} / ${[...r.artifactory.app, ...r.artifactory.xray].length}` },
  bitbucket: { ...r.bitbucket, up: `${r.bitbucket.nodes.length} / ${r.bitbucket.nodes.length}` }
}));

const links = [
  { from: 'EMEA', to: 'AMER', artifactory_lag: '3m', bitbucket_lag: '35s', wan_util_pct: 48, state: 'ok' },
  { from: 'EMEA', to: 'APAC', artifactory_lag: '14m', bitbucket_lag: '42s', wan_util_pct: 92, state: 'warn' }
];

// Replication lag over the last 48 half-hour points (minutes).
const apac = wave(49, 2.6, 0.8, 0).map((v, i) => Math.round((v + (i > 40 ? (i - 40) * 1.45 : 0)) * 10) / 10);
const amer = wave(49, 2.6, 0.6, 1);

const repos = [
  { name: 'docker-release-local', platform: 'Artifactory', region: 'EMEA→APAC', req_per_min: 1920, p95: '610ms', state: 'warn', replication: 'lag 14m' },
  { name: 'maven-remote (cache)', platform: 'Artifactory', region: 'EMEA', req_per_min: 4310, p95: '180ms', state: 'ok', replication: 'n/a · remote' },
  { name: 'npm-virtual', platform: 'Artifactory', region: 'AMER', req_per_min: 1150, p95: '240ms', state: 'ok', replication: 'lag 2m' },
  { name: 'nuget-release-local', platform: 'Artifactory', region: 'EMEA→AMER', req_per_min: 620, p95: '290ms', state: 'ok', replication: 'lag 3m' },
  { name: 'PAY / core-api', platform: 'Bitbucket', region: 'EMEA', req_per_min: 310, p95: '3.8s', state: 'ok', replication: 'mirrors in sync' },
  { name: 'TRD / fx-gateway', platform: 'Bitbucket', region: 'APAC', req_per_min: 140, p95: '3.4s', state: 'ok', replication: 'sync 42s' }
];

module.exports = {
  note: 'Repository and project names are sample values.',
  lag_threshold_min: 10,
  regions,
  links,
  lag_series: { points: apac.length, apac, amer },
  repos
};
