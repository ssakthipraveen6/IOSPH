// DEMO FIXTURE — never served outside /api/demo
// Estate overview: all 17 monitored applications. Totals are derived where possible.
'use strict';
const { wave, worst, count, JENKINS, controllerState, jenkinsTotals } = require('./console_common');

const jt = jenkinsTotals();
const jenkinsState = worst(JENKINS.controllers.map(controllerState));

// [id, name, scope, state, metric, kpi1, kpi2, trend seed, trend, drill]
const A = (id, name, scope, state, m, k1, k2, seed, trend = 0, drill = null) => ({
  id, name, scope, state,
  metric: { label: m[0], value: m[1] },
  k1: { label: k1[0], value: k1[1] },
  k2: { label: k2[0], value: k2[1] },
  trend: wave(24, 17, 6, seed, -trend * 12),
  drill
});

// Sample application groups shown on the overview.
const groups = [
  { title: 'CI / CD orchestration', apps: [
    A('cloudbees_jenkins', 'CloudBees Jenkins', `5 OC · ${jt.controllers} controllers · ${jt.staticTotal} static agents`, jenkinsState, ['Build queue', String(jt.queue)], ['Queue wait p95', '6m 40s'], ['Static agents online', `${jt.staticOnline} / ${jt.staticTotal}`], 1, -1, 'console-jenkins'),
    A('jetbrains_teamcity', 'JetBrains TeamCity', 'Multi-project · 100 agents (Win + Unix)', 'ok', ['Builds running', '61'], ['Queue wait p95', '48s'], ['Agents online', '97 / 100'], 2),
    A('argocd', 'Argo CD', 'Meta cluster → main K8s', 'warn', ['Apps OutOfSync', '7'], ['Sync p95', '1m 30s'], ['Degraded apps', '2'], 3, 0.4),
    A('argoworkflows', 'Argo Workflows', '1 internal project', 'ok', ['Workflows running', '4'], ['Failed 24h', '1'], ['Avg duration', '9m 12s'], 4)
  ] },
  { title: 'Source & artifacts', apps: [
    A('bitbucket', 'Atlassian Bitbucket', 'EMEA 15 nodes · APAC/AMER mirrors (5 each)', 'ok', ['Git clone p95', '4.1s'], ['Mirror sync lag', '42s max'], ['Hosting tickets', '12% used'], 5, 0, 'console-geo'),
    A('bitbucket_external', 'Bitbucket (external)', 'Vendor-facing instance', 'ok', ['Git clone p95', '5.3s'], ['Open sessions', '38'], ['Auth failures 24h', '3'], 6),
    A('github', 'GitHub', 'Public mirror & integrations', 'ok', ['API rate limit left', '88%'], ['Webhook delivery', '99.7%'], ['Failed hooks 24h', '4'], 7),
    A('jfrog_artifactory', 'JFrog Artifactory + Xray', 'EMEA 4 app + 2 Xray · APAC/AMER 2 + 2', 'warn', ['Repl. lag (APAC)', '14m'], ['Download p95', '380ms'], ['Xray queue', '212'], 8, 0.8, 'console-geo')
  ] },
  { title: 'Code quality & security', apps: [
    A('sonarqube', 'SonarQube', 'Quality gates', 'ok', ['CE queue', '12'], ['Analysis p95', '3m 05s'], ['Gate failures 24h', '38'], 9),
    A('fortify', 'Fortify SAST', '1 SSC · 20 ScanCentral sensors', 'warn', ['Scan queue', '31'], ['Sensors online', '16 / 20'], ['Offline sensors', '4'], 10, 0.6),
    A('nexusiq', 'Sonatype Nexus IQ', 'Policy evaluation', 'ok', ['Eval p95', '38s'], ['Policy violations', '17 new'], ['API errors', '0.1%'], 11),
    A('aquasec', 'Aqua Security', 'Container image scanning', 'ok', ['Scan p95', '2m 10s'], ['Images scanned 24h', '1,284'], ['Critical CVEs', '9'], 12)
  ] },
  { title: 'Quality engineering & platform tools', apps: [
    A('performance_center', 'Performance Center', 'Load testing', 'ok', ['Runs today', '6'], ['Controllers busy', '2 / 4'], ['Licence VUsers', '40% used'], 13),
    A('otkr', 'OTKR', 'Local obsolescence tracker', 'ok', ['Past EOL in prod', '23'], ['EOL in 90 days', '41'], ['Last sync', '06:00'], 14)
  ] },
  { title: 'AI helper services', apps: [
    A('code_review_service', 'Code review service', 'K8s', 'ok', ['Requests / min', '31'], ['Latency p95', '2.4s'], ['Reviews 24h', '1,020'], 15),
    A('mcp_server_k8s', 'MCP server', 'K8s', 'ok', ['Requests / min', '38'], ['Latency p95', '0.9s'], ['Tool-call errors', '0.3%'], 16),
    A('auto_remediation_service', 'Auto-remediation', 'K8s', 'ok', ['Requests / min', '15'], ['Fixes auto-merged', '7 today'], ['Pending approval', '2'], 17)
  ] }
].map(g => ({ ...g, state: worst(g.apps.map(a => a.state)) }));

// All sample applications.
const allApps = groups.flatMap(g => g.apps);

// Hours 0-23 for the sample chart.
const hours = Array.from({ length: 24 }, (_, h) => h);
// Sample builds per hour.
const builds = hours.map(h => Math.round(60 + Math.sin(h / 3.8) * 22 + (h > 8 && h < 19 ? 40 : 0)));
// Sample queue wait per hour.
const queueWaitMin = hours.map(h => Math.round((h > 14 ? 5 + (h - 14) * 0.6 : 1.2 + Math.abs(Math.sin(h)) * 0.8) * 10) / 10);

const kpis = [
  { label: 'Platform availability', value: '99.82%', note: 'SLO 99.90% · budget 41% left', state: 'warn' },
  { label: 'Open incidents', value: '6', note: '2 × P2 · 3 × P3 · 1 × P4', state: 'ok' },
  { label: 'CI build queue', value: String(jt.queue + 44), note: 'Jenkins + TeamCity · 2.1× vs 7-day baseline', state: 'crit' },
  { label: 'Agents online', value: `${jt.staticOnline + 97 + 16} / ${jt.staticTotal + 100 + 20}`, note: 'Jenkins static + TeamCity + Fortify sensors', state: 'warn' },
  { label: 'Deploy success · 24h', value: '97.4%', note: 'Argo CD · 312 syncs', state: 'ok' },
  { label: 'Security scan backlog', value: '58', note: 'Fortify 31 · Xray 212 artefacts', state: 'ok' }
];

const chain = [
  { name: 'Bitbucket', sub: 'push → webhook', p95: '1.2s', state: 'ok' },
  { name: 'Jenkins / TeamCity', sub: 'queue + build', p95: '14m 20s', state: 'crit' },
  { name: 'Sonar · Fortify · IQ', sub: 'quality & SAST gates', p95: '6m 05s', state: 'warn' },
  { name: 'Aqua', sub: 'image scan', p95: '2m 10s', state: 'ok' },
  { name: 'Artifactory + Xray', sub: 'publish & promote', p95: '48s', state: 'warn' },
  { name: 'Argo CD → K8s', sub: 'sync & rollout', p95: '1m 30s', state: 'ok' }
];

const regionHealth = [
  { name: 'EMEA', role: 'Primary', state: 'ok', rows: [
    { k: 'Artifactory 4 app + 2 Xray', v: '6 / 6 up', state: 'ok' },
    { k: 'Bitbucket cluster', v: '15 / 15 up', state: 'ok' },
    { k: 'Jenkins OC + controllers', v: `${JENKINS.controllers.filter(c => controllerState(c) !== 'ok').length} need attention`, state: 'warn' }
  ] },
  { name: 'APAC', role: 'Mirror', state: 'warn', rows: [
    { k: 'Artifactory 2 app + 2 Xray', v: 'lag 14m', state: 'warn' },
    { k: 'Bitbucket mirrors', v: '5 / 5 · 42s', state: 'ok' },
    { k: 'CD APAC build agents (K8s)', v: '18 pods running', state: 'ok' }
  ] },
  { name: 'AMER', role: 'Mirror', state: 'ok', rows: [
    { k: 'Artifactory 2 app + 2 Xray', v: 'lag 3m', state: 'ok' },
    { k: 'Bitbucket mirrors', v: '5 / 5 · 35s', state: 'ok' },
    { k: 'CD AMER build agents (K8s)', v: '16 pods running', state: 'ok' }
  ] }
];

const alerts = [
  { sev: 'P2', state: 'crit', service: 'Jenkins · oc03-aps', signal: 'Queue wait p95 > 5m for 20m (executors 80 / 80)', region: 'EMEA', age: '22m', owner: 'CI Platform', route: 'ServiceNow: CI Platform queue' },
  { sev: 'P2', state: 'crit', service: 'Artifactory · APAC mirror', signal: 'Replication lag 14m (threshold 10m)', region: 'APAC', age: '41m', owner: 'Artifact Mgmt', route: 'ServiceNow: Artifact Mgmt queue' },
  { sev: 'P3', state: 'warn', service: 'Fortify ScanCentral', signal: '4 of 20 sensors offline · queue 31', region: 'EMEA', age: '1h 12m', owner: 'AppSec Tooling', route: 'ServiceNow: AppSec queue' },
  { sev: 'P3', state: 'warn', service: 'Argo CD meta cluster', signal: '7 apps OutOfSync > 30m', region: 'EMEA', age: '35m', owner: 'CD Platform', route: 'ServiceNow: CD Platform queue' },
  { sev: 'P3', state: 'warn', service: 'Windows build agents', signal: `${200 - jt.winOnline} of 200 offline (pool WIN-B)`, region: 'EMEA', age: '2h 05m', owner: 'CI Platform', route: 'ServiceNow: CI Platform queue' },
  { sev: 'P4', state: 'ok', service: 'OTKR', signal: '23 components past EOL in prod images', region: 'Global', age: '1d', owner: 'Platform Eng', route: 'ServiceNow: Platform Eng queue' }
];

module.exports = {
  app_count: allApps.length,
  regions: ['All', 'EMEA', 'APAC', 'AMER'],
  kpis,
  chain,
  groups,
  chart: {
    hours, builds, queue_wait_min: queueWaitMin,
    change_event: { hour: 14, label: 'Controller plugin upgrade (oc03-aps)' }
  },
  region_health: regionHealth,
  alerts
};
