// DEMO FIXTURE — never served outside /api/demo
// SLOs, DORA and management summary for the last 30 days. Sample values.
'use strict';
const { count } = require('./console_common');

// One sample SLO row.
const slo = (app, sli, target, actual, budget_pct, burn) => ({
  app, sli, target, actual, budget_pct, burn,
  state: budget_pct <= 0 ? 'crit' : (budget_pct < 30 ? 'warn' : 'ok'),
  status: budget_pct <= 0 ? 'Breached' : (budget_pct < 30 ? 'At risk' : 'Met')
});

const slos = [
  slo('CloudBees Jenkins', 'Canary job starts < 90s', '99.90%', '99.71%', 12, 2.4),
  slo('JetBrains TeamCity', 'Canary build starts < 90s', '99.90%', '99.96%', 64, 0.4),
  slo('Argo CD', 'Sync completes < 5 min', '99.50%', '99.70%', 44, 0.6),
  slo('Argo Workflows', 'Workflow scheduled < 60s', '99.00%', '99.60%', 61, 0.4),
  slo('Atlassian Bitbucket', 'Clone/push success < 10s', '99.95%', '99.98%', 71, 0.3),
  slo('Bitbucket (external)', 'Clone/push success < 10s', '99.50%', '99.80%', 58, 0.5),
  slo('GitHub', 'API success', '99.50%', '99.90%', 80, 0.2),
  slo('JFrog Artifactory', 'Download success & p95 < 1s', '99.95%', '99.96%', 31, 0.9),
  slo('SonarQube', 'Analysis accepted & gate < 5 min', '99.50%', '98.90%', -20, 3.1),
  slo('Fortify SAST', 'Scan completes < 60 min', '99.00%', '99.20%', 22, 1.4),
  slo('Sonatype Nexus IQ', 'Policy evaluation < 60s', '99.50%', '99.90%', 80, 0.2),
  slo('Aqua Security', 'Scan result < 5 min', '99.50%', '99.80%', 66, 0.4),
  slo('Performance Center', 'Test run starts on schedule', '99.00%', '99.50%', 50, 0.5),
  slo('OTKR', 'Daily sync completes', '99.00%', '99.70%', 70, 0.3),
  slo('Code review service', 'Review returned < 2 min', '98.00%', '99.10%', 55, 0.5),
  slo('MCP server', 'Tool call < 5s', '98.00%', '99.30%', 60, 0.4),
  slo('Auto-remediation', 'Action starts < 60s', '98.00%', '99.00%', 48, 0.5)
];

// Day marks per app (day number 1..30 -> 'degraded' | 'outage' | 'maintenance'); everything else met the SLO.
const marks = {
  'CloudBees Jenkins': { 8: 'degraded', 9: 'outage', 14: 'maintenance', 21: 'degraded', 22: 'degraded' },
  'JetBrains TeamCity': { 14: 'maintenance' },
  'JFrog Artifactory': { 5: 'maintenance', 27: 'degraded' },
  'Atlassian Bitbucket': { 19: 'maintenance' },
  'SonarQube': { 16: 'outage', 17: 'degraded' },
  'Fortify SAST': { 3: 'degraded', 11: 'degraded' },
  'Aqua Security': { 24: 'maintenance' },
  'Argo CD': { 12: 'degraded' },
  'Performance Center': { 26: 'maintenance' },
  'Code review service': { 7: 'degraded' }
};
// Sample 30-day availability calendar.
const calendar = slos.map(s => ({
  app: s.app, availability: s.actual, state: s.state,
  days: Array.from({ length: 30 }, (_, i) => ({ day: i + 1, state: (marks[s.app] || {})[i + 1] || 'met' }))
}));

const dora = [
  { key: 'deployment_frequency', label: 'Deployment frequency', value: '312 / week', band: 'High', trend: [210, 236, 251, 270, 288, 312], note: 'Argo CD syncs to production', better: 'higher' },
  { key: 'lead_time', label: 'Lead time for changes', value: '2.6 days', band: 'High', trend: [4.1, 3.8, 3.5, 3.1, 2.9, 2.6], note: 'Commit → production (lower is better)', better: 'lower' },
  { key: 'change_failure_rate', label: 'Change failure rate', value: '7.8%', band: 'High', trend: [11, 10.2, 9.4, 9.9, 8.6, 7.8], note: 'Deploys needing rollback or hotfix', better: 'lower' },
  { key: 'time_to_restore', label: 'Time to restore', value: '48 min', band: 'High', trend: [95, 88, 71, 80, 72, 48], note: 'Platform incidents P1–P3', better: 'lower' }
];

const rootCauses = [
  { name: 'Capacity / saturation', count: 4 }, { name: 'Change or upgrade', count: 3 },
  { name: 'Dependency (database, storage, network)', count: 3 }, { name: 'Certificate / credential', count: 2 },
  { name: 'Vendor defect', count: 1 }, { name: 'Unknown', count: 1 }
];

// One sample capacity forecast row.
const cap = (name, now, projected, threshold, when) => ({ name, now_pct: now, projected_pct: projected, threshold_pct: threshold, when, state: now >= threshold ? 'crit' : (projected >= threshold ? 'warn' : 'ok') });
const capacity = [
  cap('Artifactory EMEA filestore', 71, 92, 85, '85% in about 7 weeks'),
  cap('Bitbucket shared home', 62, 70, 85, 'more than 6 months'),
  cap('K8s CI build cluster · node CPU', 81, 95, 85, 'at peak already'),
  cap('TeamCity agent licences', 100, 100, 95, 'at limit now'),
  cap('Windows agent utilisation', 70, 74, 85, 'more than 6 months'),
  cap('Bitbucket users vs licence', 92, 97, 95, '95% in about 10 weeks')
];

// Number of SLOs met.
const met = count(slos, s => s.state === 'ok');
const lowest = [...slos].sort((a, b) => a.budget_pct - b.budget_pct)[0];

module.exports = {
  note: 'All figures are sample values.',
  summary: `The estate met ${met} of ${slos.length} SLOs this month. Jenkins queue wait and the SonarQube analysis gate drove most of the error budget burn; Artifactory replication to APAC and the Windows build agents are the capacity risks to watch.`,
  kpis: [
    { label: 'Estate availability', value: '99.87%', note: `SLA 99.90% · ${met} / ${slos.length} SLOs met`, state: 'warn' },
    { label: 'Incidents', value: '14', note: 'P1 0 · P2 3 · P3 8 · P4 3', state: 'ok' },
    { label: 'Mean time to detect', value: '6 m', note: 'down from 11 m last month', state: 'ok' },
    { label: 'Mean time to restore', value: '48 m', note: 'down from 1 h 12 m', state: 'ok' },
    { label: 'Platform change success', value: '96.8%', note: '62 changes · 2 rolled back', state: 'ok' },
    { label: 'Lowest error budget', value: `${Math.max(0, lowest.budget_pct)}%`, note: `${lowest.app}${lowest.budget_pct <= 0 ? ' (breached)' : ''}`, state: lowest.budget_pct <= 0 ? 'crit' : 'warn' }
  ],
  slos, calendar, dora, root_causes: rootCauses, capacity
};
