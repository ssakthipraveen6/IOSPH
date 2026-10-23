// DEMO FIXTURE — never served outside /api/demo
// Expiry, versions (N / N-1 / N-2), controller drift, backup & restore-tested DR.
'use strict';
const { inDays, count } = require('./console_common');

// One sample expiry row.
const ex = (item, type, app, days, owner, ticket) => ({ item, type, app, date: inDays(days), days_left: days, owner, ticket });
const expiry = [
  ex('artifactory VIP certificate', 'Certificate', 'Artifactory', 9, 'Artifact Mgmt', 'No ticket'),
  ex('Jenkins ↔ Bitbucket service token', 'Token', 'Bitbucket ↔ Jenkins', 12, 'CI Platform', 'Change raised'),
  ex('Fortify SSC licence', 'Licence', 'Fortify', 25, 'AppSec Tooling', 'PO in approval'),
  ex('SonarQube VIP certificate', 'Certificate', 'SonarQube', 28, 'Code Quality', 'Change raised'),
  ex('Argo CD meta ingress certificate', 'Certificate', 'Argo CD', 44, 'CD Platform', 'Auto-renew'),
  ex('TeamCity agent licence pack', 'Licence', 'TeamCity', 60, 'CI Platform', 'Not started'),
  ex('Aqua API key (CI scanner)', 'Token', 'Aqua', 76, 'AppSec Tooling', 'Not started'),
  ex('Bitbucket APAC mirror certificate', 'Certificate', 'Bitbucket', 83, 'SCM Platform', 'Auto-renew')
];

// One sample licence row.
const lic = (name, unit, used, cap) => ({ name, unit, used, cap, pct: Math.round(used / cap * 100) });
const licences = [
  lic('TeamCity', 'build agents', 100, 100),
  lic('Bitbucket Data Center', 'users', 4610, 5000),
  lic('CloudBees CI', 'users', 2140, 2500),
  lic('Fortify ScanCentral', 'sensors', 20, 25),
  lic('Performance Center', 'virtual users', 2000, 5000),
  lic('Aqua', 'scanned images / month', 31000, 50000),
  lic('SonarQube', 'lines of code (millions)', 41, 50)
];

// Versions of every monitored application: N = latest approved, N-1, N-2.
const ver = (app, running, support, cves, os, next) => ({ app, running, vendor_support: support, tool_cves: { critical: cves[0], high: cves[1] }, os_baseline: os, next_window: next });
const versions = [
  ver('CloudBees Jenkins', 'N (OC-05: N-1)', 'Supported', [0, 2], 'Container base OK', inDays(18)),
  ver('JetBrains TeamCity', 'N', 'Supported', [0, 0], 'RHEL baseline OK', null),
  ver('Argo CD', 'N', 'Supported', [0, 0], 'Container base OK', null),
  ver('Argo Workflows', 'N-2', 'Supported', [0, 0], 'Container base OK', inDays(52)),
  ver('Atlassian Bitbucket', 'N', 'Supported', [0, 1], 'RHEL baseline OK', null),
  ver('Bitbucket (external)', 'N-1', 'Supported', [0, 0], 'RHEL baseline OK', inDays(40)),
  ver('GitHub', 'SaaS / vendor managed', 'Supported', [0, 0], 'n/a', null),
  ver('JFrog Artifactory', 'N-1', 'Supported', [1, 2], 'RHEL baseline OK', inDays(25)),
  ver('JFrog Xray', 'N-1', 'Supported', [0, 1], 'RHEL baseline OK', inDays(25)),
  ver('SonarQube', 'N-2', 'Ended', [1, 3], 'Patch pending', inDays(32)),
  ver('Fortify SSC + sensors', 'N-1', 'Supported', [0, 0], 'Windows update missing on 4 sensors', inDays(46)),
  ver('Sonatype Nexus IQ', 'N', 'Supported', [0, 0], 'RHEL baseline OK', null),
  ver('Aqua Security', 'N', 'Supported', [0, 0], 'Container base OK', null),
  ver('Performance Center', 'N-1', 'Supported', [0, 0], 'Windows baseline OK', inDays(70)),
  ver('OTKR', 'internal', 'Internal', [0, 0], 'Container base OK', null),
  ver('AI helper services', 'internal', 'Internal', [0, 0], 'Container base OK', null)
];

// Sample controller configuration drift.
const drift = [
  ['oc01-aps', 'N', 0, 'in_sync'], ['oc01-dev', 'N', 0, 'in_sync'],
  ['oc02-aps', 'N', 0, 'in_sync'], ['oc02-dev', 'N', 2, 'in_sync'],
  ['oc03-aps', 'N', 9, 'drifted'], ['oc03-dev', 'N', 4, 'drifted'],
  ['oc04-aps', 'N', 0, 'in_sync'], ['oc04-dev', 'N', 0, 'in_sync'],
  ['oc05-aps', 'N-1', 0, 'in_sync'], ['oc05-dev', 'N-1', 1, 'in_sync']
].map(([controller, core, plugin_diffs, casc]) => ({ controller, core, plugin_diffs, casc }));

// One sample disaster-recovery row.
const dr = (app, data, backup_ok, backup_at, restore_days, rpo, rto, site) => ({ app, data, backup_ok, backup_at, last_restore_test_days_ago: restore_days, rpo_target_h: rpo[0], rpo_measured_h: rpo[1], rto_target_h: rto[0], rto_measured_h: rto[1], standby: site });
const disasterRecovery = [
  dr('CloudBees Jenkins', 'JENKINS_HOME (10 controllers)', true, '02:10', 41, [24, 24], [8, 6.5], 'Cold standby (K8s manifests in Git)'),
  dr('JetBrains TeamCity', 'Data directory + database', true, '01:30', 35, [24, 24], [8, 5], 'Cold standby'),
  dr('Atlassian Bitbucket', 'Shared home + database', true, '03:00', 28, [4, 4], [4, 3.5], 'Smart mirrors (read-only)'),
  dr('JFrog Artifactory', 'Filestore + database', true, '02:40', 64, [4, 4], [4, 6], 'Replication to APAC / AMER'),
  dr('SonarQube', 'Database', false, '—', 130, [24, null], [8, null], 'None'),
  dr('Fortify SSC', 'Database + scan artefacts', true, '04:00', 52, [24, 24], [12, 9], 'Cold standby'),
  dr('Argo CD', 'Git (declarative)', true, 'continuous', 20, [1, 1], [2, 1], 'Rebuild from Git'),
  dr('Nexus IQ', 'Database', true, '01:50', 88, [24, 24], [8, 7], 'Cold standby')
];

const controllersOffBaseline = drift.filter(d => d.plugin_diffs > 0 || d.casc === 'drifted').length;
// Number of applications with a recent successful restore test.
const restoreOk = count(disasterRecovery, d => d.backup_ok && d.last_restore_test_days_ago <= 90);

const kpis = [
  { label: 'Expiring ≤ 30 days', value: String(count(expiry, e => e.days_left <= 30)), note: ['Certificate', 'Licence', 'Token'].map(t => `${count(expiry, e => e.days_left <= 30 && e.type === t)} ${t.toLowerCase()}`).join(' · '), state: 'crit' },
  { label: 'Licences ≥ 85% used', value: String(count(licences, l => l.pct >= 85)), note: 'TeamCity agents at 100%', state: 'warn' },
  { label: 'Platforms on N-2 or older', value: `${count(versions, v => v.running.startsWith('N-2'))} / ${versions.length}`, note: `${count(versions, v => v.vendor_support === 'Ended')} past vendor support`, state: 'warn' },
  { label: 'Critical tool CVEs', value: String(versions.reduce((a, v) => a + v.tool_cves.critical, 0)), note: `${versions.reduce((a, v) => a + v.tool_cves.high, 0)} high`, state: 'crit' },
  { label: 'Controllers off baseline', value: `${controllersOffBaseline} / ${drift.length}`, note: 'plugin or CasC drift', state: 'warn' },
  { label: 'Restore tests ≤ 90 days', value: `${restoreOk} / ${disasterRecovery.length}`, note: `${disasterRecovery.length - restoreOk} overdue or no backup`, state: 'warn' }
];

module.exports = {
  note: 'Dates, owners and licence numbers are sample values.',
  kpis, expiry, licences, versions, controller_drift: drift, disaster_recovery: disasterRecovery
};
