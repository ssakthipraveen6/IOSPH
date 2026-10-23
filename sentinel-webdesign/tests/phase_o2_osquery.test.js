/**
 * tests/phase_o2_osquery.test.js
 *
 * Acceptance test for Phase O2 osquery packs generator:
 * - O2.3: osquery packs contain the required queries:
 *   processes, services, certificates, deb_packages, rpm_packages, programs, process_open_files
 *   Schedule: 300 s
 *   Paths come from manifests only
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildPacks, loadWatchPaths, loadCertificatePaths } = require('../scripts/generate_osquery_pack');

async function run() {
  console.log('--- Phase O2: osquery Packs Generator Tests ---');

  const watchPaths = loadWatchPaths();
  const certPaths = loadCertificatePaths();
  const packs = buildPacks(watchPaths, certPaths);

  assert(packs['system-inventory.conf'], 'system-inventory.conf (Linux) must be generated');
  assert(packs['system-inventory-windows.conf'], 'system-inventory-windows.conf (Windows) must be generated');
  assert(packs['file-changes.conf'], 'file-changes.conf must be generated');
  assert(packs['file-changes-windows.conf'], 'file-changes-windows.conf must be generated');

  // Linux inventory pack checks
  const linuxInv = JSON.parse(packs['system-inventory.conf']);
  assert.strictEqual(linuxInv.platform, 'linux');
  const lQueries = linuxInv.queries;
  assert(lQueries.processes, 'processes query must exist on Linux');
  assert(lQueries.processes.query.includes('parent AS ppid'), 'processes query must include ppid');
  assert(lQueries.processes.query.includes('cmdline_hash'), 'processes query must include cmdline hash');
  assert.strictEqual(lQueries.processes.interval, 300, 'processes query interval must be 300s');

  assert(lQueries.certificates, 'certificates query must exist on Linux');
  assert(lQueries.certificates.query.includes('/etc/ssl/certs'), 'certificates query must include /etc/ssl/certs');
  assert.strictEqual(lQueries.certificates.interval, 300, 'certificates query interval must be 300s');

  assert(lQueries.deb_packages, 'deb_packages query must exist on Linux');
  assert.strictEqual(lQueries.deb_packages.interval, 300, 'deb_packages interval must be 300s');

  assert(lQueries.rpm_packages, 'rpm_packages query must exist on Linux');
  assert.strictEqual(lQueries.rpm_packages.interval, 300, 'rpm_packages interval must be 300s');

  assert(lQueries.process_open_files, 'process_open_files query must exist on Linux');
  assert(lQueries.process_open_files.query.includes('(deleted)'), 'process_open_files must be limited to deleted files');
  assert.strictEqual(lQueries.process_open_files.interval, 300, 'process_open_files interval must be 300s');

  // Windows inventory pack checks
  const winInv = JSON.parse(packs['system-inventory-windows.conf']);
  assert.strictEqual(winInv.platform, 'windows');
  const wQueries = winInv.queries;
  assert(wQueries.processes, 'processes query must exist on Windows');
  assert.strictEqual(wQueries.processes.interval, 300);

  assert(wQueries.services, 'services query must exist on Windows');
  assert(wQueries.services.query.includes('start_type') && wQueries.services.query.includes('status'), 'services query must check start_type and status');
  assert.strictEqual(wQueries.services.interval, 300);

  assert(wQueries.certificates, 'certificates query must exist on Windows');
  assert(wQueries.certificates.query.includes("'My'") && wQueries.certificates.query.includes("'Root'"), 'certificates query must check My and Root stores');
  assert.strictEqual(wQueries.certificates.interval, 300);

  assert(wQueries.programs, 'programs query must exist on Windows for SBOM');
  assert.strictEqual(wQueries.programs.interval, 300);

  assert(wQueries.process_open_files, 'process_open_files query must exist on Windows');
  assert(wQueries.process_open_files.query.includes('(deleted)'));
  assert.strictEqual(wQueries.process_open_files.interval, 300);

  // Test that paths come strictly from manifests
  const customCertPaths = ['/opt/custom/certs', '/var/app/ssl'];
  const customPacks = buildPacks({ linux: {}, windows: {} }, customCertPaths);
  const customLinuxInv = JSON.parse(customPacks['system-inventory.conf']);
  const customCertQuery = customLinuxInv.queries.certificates.query;
  assert(customCertQuery.includes('/opt/custom/certs'), 'Custom cert path 1 must be present in query');
  assert(customCertQuery.includes('/var/app/ssl'), 'Custom cert path 2 must be present in query');
  assert(!customCertQuery.includes('/unwanted/path'), 'Arbitrary paths not in manifest must not be present');

  console.log('  ✓ O2.3: osquery pack generator verified (all queries, 300s schedule, manifest paths only)');
  console.log('All Phase O2 osquery tests passed!\n');
}

run().catch(err => {
  console.error('[TEST FAILURE]', err);
  process.exit(1);
});
