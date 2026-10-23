// DEMO FIXTURE — never served outside /api/demo
// Synthetic probes (probe x region), platform dependencies and network paths.
'use strict';
const { wave, count } = require('./console_common');

// History: 12 last runs, p = pass, s = slow (over budget), f = fail. '' = not run from this region.
const P = 'pppppppppppp';
// One sample probe cell (value and run history).
const cell = (value, history) => ({ value, history, last: history ? history.slice(-1) : null });
const REGIONS = ['EMEA', 'APAC', 'AMER'];
// One sample probe across the regions.
const probe = (name, how, budget, cells) => ({ name, how, budget, results: REGIONS.map((region, i) => ({ region, ...cells[i] })) });
const none = cell('—', '');

const probes = [
  probe('SSO login → each tool UI', 'headless browser · 6 tools', '5s', [cell('2.1s', P), cell('3.4s', P), cell('2.8s', P)]),
  probe('Git clone (medium repo)', 'shallow clone via mirror', '8s', [cell('4.1s', P), cell('3.2s', P), cell('2.9s', P)]),
  probe('Git push + webhook → Jenkins', 'push → build starts', '30s', [cell('11s', P), none, none]),
  probe('Docker pull (500 MB image)', 'Artifactory docker-virtual', '40s', [cell('18s', P), cell('71s', 'pppppppsssss'), cell('24s', P)]),
  probe('Maven resolve (cold cache)', 'Artifactory maven-virtual', '60s', [cell('22s', P), cell('49s', 'ppppppppppsp'), cell('31s', P)]),
  probe('Jenkins canary job · per OC', '5 OC × APS/DEV · echo + agent hop', '90s', [cell('9 / 10 OK', 'pppppppsffff'), none, none]),
  probe('TeamCity canary build', 'hello-world on each agent pool', '90s', [cell('38s', P), none, none]),
  probe('Sonar + Nexus IQ API', 'quality gate & policy eval call', '3s', [cell('0.8s', P), none, none]),
  probe('Fortify SSC upload', 'small scan result upload + process', '120s', [cell('146s', 'ppppppssssss'), none, none]),
  probe('Aqua scan API', 'scan small known image', '60s', [cell('41s', P), none, none]),
  probe('Argo CD sync (dry-run)', 'canary app on meta cluster', '45s', [cell('21s', P), none, none]),
  probe('Jump server → K8s API', 'cluster list call · every cluster', '2s', [cell('0.4s', P), none, none])
];

// One sample dependency item.
const it = (name, value, state) => ({ name, value, state });
const dependencies = [
  { app: 'CloudBees Jenkins', state: 'crit', items: [it('JENKINS_HOME volumes', '74–91% full', 'warn'), it('oc03-aps JVM GC', '18% of time', 'crit'), it('K8s operations-centre cluster', 'ready', 'ok'), it('LDAP group lookup', '120ms', 'ok')] },
  { app: 'Artifactory', state: 'warn', items: [it('PostgreSQL primary', '32 connections · 4ms', 'ok'), it('PostgreSQL replica', 'lag 0.4s', 'ok'), it('Filestore', '71% · 9ms', 'ok'), it('WAN EMEA→APAC', '92% utilised', 'warn'), it('VIP certificate', '9 days left', 'crit')] },
  { app: 'Xray', state: 'ok', items: [it('PostgreSQL', '6ms', 'ok'), it('Message queue', 'depth 212', 'warn'), it('Vulnerability DB sync', '2h ago', 'ok')] },
  { app: 'Bitbucket', state: 'ok', items: [it('PostgreSQL', '5ms', 'ok'), it('Shared home (NFS)', 'IO 3ms', 'ok'), it('Search index', 'green · 3 nodes', 'ok'), it('Cluster nodes', '15 / 15', 'ok')] },
  { app: 'SonarQube', state: 'warn', items: [it('Database', '11ms', 'ok'), it('Embedded search', 'heap 82%', 'warn'), it('Nightly backup', 'failed', 'crit')] },
  { app: 'Fortify SSC', state: 'warn', items: [it('SSC database', '14ms', 'ok'), it('ScanCentral controller', 'up', 'ok'), it('Sensors', '16 / 20 online', 'warn')] },
  { app: 'TeamCity', state: 'ok', items: [it('Database', '7ms', 'ok'), it('Data directory', '58% used', 'ok'), it('Agent licences', '100% used', 'warn')] },
  { app: 'Argo CD', state: 'warn', items: [it('Git (Bitbucket)', 'fetch 1.1s', 'ok'), it('Main K8s API', '210ms', 'ok'), it('Redis', 'ok', 'ok'), it('Helm / OCI from Artifactory', 'pull 4s', 'ok')] },
  { app: 'Shared (all platforms)', state: 'warn', items: [it('LDAP / AD bind', '120ms', 'ok'), it('Outbound proxy', 'p95 1.8s', 'warn'), it('Internal DNS', '6ms', 'ok'), it('SMTP relay', 'ok', 'ok'), it('NTP drift', '< 20ms', 'ok')] }
];

const paths = [
  { path: 'EMEA ↔ APAC (WAN)', rtt_ms: 238, rtt_hot: true, loss_pct: 0.4, loss_hot: true, throughput: '92% utilised' },
  { path: 'EMEA ↔ AMER (WAN)', rtt_ms: 96, rtt_hot: false, loss_pct: 0.0, loss_hot: false, throughput: '48% utilised' },
  { path: 'Windows agents → Artifactory', rtt_ms: 3, rtt_hot: false, loss_pct: 0.0, loss_hot: false, throughput: '1.4 Gb/s' },
  { path: 'K8s CI agents → Artifactory', rtt_ms: 2, rtt_hot: false, loss_pct: 0.0, loss_hot: false, throughput: '2.1 Gb/s' },
  { path: 'K8s CI agents → Bitbucket', rtt_ms: 2, rtt_hot: false, loss_pct: 0.0, loss_hot: false, throughput: '0.6 Gb/s' },
  { path: 'Jump servers → K8s APIs', rtt_ms: 4, rtt_hot: false, loss_pct: 0.0, loss_hot: false, throughput: '—' },
  { path: 'All tools → outbound proxy', rtt_ms: 1800, rtt_hot: true, loss_pct: 0.1, loss_hot: false, throughput: '—' }
];

// Sample WAN utilisation series.
const util = wave(37, 0.55, 0.05).map((v, i) => Math.round((v + (i > 22 ? (i - 22) * 0.027 : 0)) * 1000) / 10);   // % utilisation
// Sample WAN round-trip series.
const rtt = wave(37, 160, 6).map((v, i) => Math.round(v + (i > 22 ? (i - 22) * 5.6 : 0)));

// Probe cells with a last result.
const cells = probes.flatMap(p => p.results).filter(r => r.last);
// Number of passing probes.
const passing = count(cells, r => r.last === 'p');
const degradedDeps = dependencies.flatMap(d => d.items).filter(i => i.state === 'crit').length;

module.exports = {
  note: 'Probe results, latencies and dependency states are sample values.',
  regions: REGIONS,
  kpis: [
    { label: 'Probes passing', value: `${passing} / ${cells.length}`, note: 'probe × region, last run', state: 'warn' },
    { label: 'Dependencies critical', value: String(degradedDeps), note: 'certificate · backup · JVM GC', state: 'crit' },
    { label: 'EMEA ↔ APAC RTT', value: '238 ms', note: 'up from 160 ms baseline', state: 'warn' },
    { label: 'LDAP bind p95', value: '120 ms', note: 'within 250 ms budget', state: 'ok' },
    { label: 'Outbound proxy p95', value: '1.8 s', note: 'slows plugin and vulnerability-DB updates', state: 'warn' },
    { label: 'Load balancer 5xx', value: '0.04%', note: 'all VIPs, 1 h', state: 'ok' }
  ],
  probes,
  dependencies,
  network_paths: paths,
  wan_chart: { util_pct: util, rtt_ms: rtt, baseline_rtt_ms: 160 }
};
