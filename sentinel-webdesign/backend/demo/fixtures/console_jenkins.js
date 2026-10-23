// DEMO FIXTURE — never served outside /api/demo
// CloudBees Jenkins drill-down. Aggregates are derived from the detail rows.
'use strict';
const { STATE_LABEL, worst, JENKINS, controllerState, jenkinsTotals } = require('./console_common');

const t = jenkinsTotals();

// Sample controllers with state.
const controllers = JENKINS.controllers.map(c => ({
  id: c.id, oc: c.oc, env: c.env,
  state: controllerState(c),
  executors: { busy: c.busy, total: c.total },
  queue: c.queue, heap_pct: c.heapPct, success_pct: c.successPct
}));

// Sample operations centres with their controllers.
const operationsCenters = [...new Set(JENKINS.controllers.map(c => c.oc))].map((oc, i) => {
  const ctrls = controllers.filter(c => c.oc === oc);
  const off = JENKINS.ubuntuOffline[oc] || 0;
  const ubuntuState = off >= 2 ? 'warn' : (off === 1 ? 'warn' : 'ok');
  return {
    id: oc,
    owner_team: `[Business line ${String.fromCharCode(65 + i)}]`,
    state: worst([...ctrls.map(c => c.state), ubuntuState === 'warn' ? 'warn' : 'ok']),
    ubuntu_agents: { online: 10 - off, total: 10 },
    controllers: ctrls
  };
});

// Sample Kubernetes build clusters.
const buildClusters = [
  { id: 'k8s-ci-build', purpose: 'CI', region: 'EMEA', running: 96, pending: 14, capacity: 140, pod_start_p95_s: 74, image_pull_p95_s: 22, node_cpu_pct: 81 },
  { id: 'k8s-cd-build', purpose: 'CD', region: 'EMEA', running: 38, pending: 2, capacity: 80, pod_start_p95_s: 21, image_pull_p95_s: 9, node_cpu_pct: 54 },
  { id: 'k8s-cd-apac-build', purpose: 'CD', region: 'APAC', running: 18, pending: 0, capacity: 40, pod_start_p95_s: 19, image_pull_p95_s: 31, node_cpu_pct: 41 },
  { id: 'k8s-cd-amer-build', purpose: 'CD', region: 'AMER', running: 16, pending: 1, capacity: 40, pod_start_p95_s: 23, image_pull_p95_s: 12, node_cpu_pct: 46 }
].map(k => ({
  ...k,
  state: k.pending > 8 || k.node_cpu_pct > 80 ? 'warn' : 'ok'
}));

// Ubuntu docker agents: 10 per OC. Offline ones come from JENKINS.ubuntuOffline.
const ubuntuAgents = [...new Set(JENKINS.controllers.map(c => c.oc))].map((oc, r) => {
  const off = JENKINS.ubuntuOffline[oc] || 0;
  const cells = [];
  for (let i = 0; i < 10; i++) {
    let s;
    if (i >= 10 - off) s = 'offline';            // last `off` agents of the OC are offline
    else if ((r * 3 + i) % 7 === 0) s = 'maintenance';
    else if ((r + i) % 3 === 0) s = 'idle';
    else s = 'busy';
    cells.push({ name: `${oc.toLowerCase()}-ubu-${String(i + 1).padStart(2, '0')}`, state: s });
  }
  return { oc, cells };
});

// Windows agents: 4 pools of 50 (grouping is an assumption in the sample).
const windowsPools = JENKINS.windowsPools.map((p, r) => {
  const cells = [];
  for (let i = 0; i < 50; i++) {
    let s;
    if (i >= 50 - p.offline) s = 'offline';
    else if (i < p.maintenance) s = 'maintenance';
    else s = ((i * 7 + r * 3) % 11 < 3) ? 'idle' : 'busy';
    cells.push({ name: `${p.id.toLowerCase()}-${String(i + 1).padStart(2, '0')}`, state: s });
  }
  return { id: p.id, online: cells.filter(c => c.state !== 'offline').length, total: 50, cells };
});

const jumpServers = [
  { id: 'jump-01', state: 'ok', ssh_sessions: 14, k8s_api_reachable: 9, k8s_api_total: 9, cpu_pct: 22, mem_pct: 61 },
  { id: 'jump-02', state: 'ok', ssh_sessions: 9, k8s_api_reachable: 9, k8s_api_total: 9, cpu_pct: 18, mem_pct: 58 }
];

const queue = [
  { job: 'payments/core-api/main', controller: 'oc03-aps', wait_s: 1092, label: 'k8s-maven-jdk17', reason: 'Controller executor slots exhausted (80 / 80)', hot: true },
  { job: 'payments/ledger-ui/PR-412', controller: 'oc03-aps', wait_s: 940, label: 'k8s-node20', reason: 'Controller executor slots exhausted (80 / 80)', hot: true },
  { job: 'trade/fx-gateway/release', controller: 'oc05-aps', wait_s: 545, label: 'win-msbuild-2022', reason: 'WIN-B pool: 12 agents offline', hot: true },
  { job: 'risk/calc-engine/develop', controller: 'oc03-dev', wait_s: 453, label: 'docker-ubuntu', reason: 'oc03-ubu-10 offline; remaining agents busy', hot: false },
  { job: 'channels/mobile-bff/main', controller: 'oc02-aps', wait_s: 290, label: 'k8s-maven-jdk17', reason: 'Pod pending: k8s-ci-build node CPU 81%', hot: false }
];

const kpis = [
  { label: 'Controllers up', value: `${t.controllers} / ${t.controllers}`, note: `${controllers.filter(c => c.state === 'crit').length} degraded · ${controllers.filter(c => c.state === 'warn').length} warning`, state: controllers.some(c => c.state === 'crit') ? 'crit' : 'warn' },
  { label: 'Executors busy', value: `${t.executorsBusy} / ${t.executorsTotal}`, note: `${Math.round(t.executorsBusy / t.executorsTotal * 100)}% utilisation`, state: 'ok' },
  { label: 'Build queue', value: String(t.queue), note: 'p95 wait 6m 40s', state: 'crit' },
  { label: 'Builds / hour', value: '1,240', note: 'flat vs baseline', state: 'ok' },
  { label: 'Success · 24h', value: '93.6%', note: 'infra failures 1.8%', state: 'ok' },
  { label: 'Static agents online', value: `${t.staticOnline} / ${t.staticTotal}`, note: `Windows ${t.winOnline} / ${t.winTotal} · Ubuntu ${t.ubuntuOnline} / ${t.ubuntuTotal}`, state: 'warn' }
];

module.exports = {
  note: 'Windows pool grouping (4 x 50) is an assumption; confirm the real pools before using this layout.',
  state_labels: STATE_LABEL,
  kpis,
  operations_centers: operationsCenters,
  build_clusters: buildClusters,
  ubuntu_agents: ubuntuAgents,
  windows_pools: windowsPools,
  jump_servers: jumpServers,
  queue
};
