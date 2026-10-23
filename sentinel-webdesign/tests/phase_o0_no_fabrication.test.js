/**
 * tests/phase_o0_no_fabrication.test.js
 *
 * Acceptance tests for Phase O0:
 * - O0.1: K8s mesh returns real ClickHouse numbers or null per field with DATA_UNAVAILABLE (no zeroes).
 * - O0.2: backend/config/expiryEngine.js removed; cert-bb-tls and lic-ghe only in backend/demo/.
 * - O0.3: DaemonSet agent/config/collector-k8s.yaml has no k8s_cluster; Helm cluster Deployment does.
 * - O0.4: Custom checks has no hard-coded latency=12; returns stored results or DATA_UNAVAILABLE.
 * - O0.5: ServiceNow-named endpoints carry source: 'sentinel', deprecated: true, no fabricated numbers.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

process.env.SENTINEL_ALLOW_LOCALHOST_CORS = 'true';
const { app } = require('../backend/server');
const clickhouse = require('../database/clickhouse');

async function runTests() {
  console.log('=== RUNNING PHASE O0: NO-FABRICATION ACCEPTANCE TESTS ===');

  let server;
  let testPort;

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // O0.1: Kubernetes Mesh - Real ClickHouse rows -> numbers, no rows -> nulls
    // -------------------------------------------------------------------------
    console.log('\n[TEST O0.1] Kubernetes mesh route zero-fabrication check...');
    
    // Case A: No rows in ClickHouse -> all fields null, status DATA_UNAVAILABLE
    const origQuery = clickhouse.query;
    const origIsConfigured = clickhouse.isConfigured;
    clickhouse.isConfigured = () => true;
    clickhouse.query = async () => [];

    const resEmpty = await fetch(`http://127.0.0.1:${testPort}/api/k8s/mesh?environment=staging`);
    const dataEmpty = await resEmpty.json();

    assert.strictEqual(dataEmpty.status, 'DATA_UNAVAILABLE', 'Expected DATA_UNAVAILABLE when no rows');
    assert.strictEqual(dataEmpty.coresAllocated, null, 'coresAllocated must be null when uncollected');
    assert.strictEqual(dataEmpty.coresTotal, null, 'coresTotal must be null when uncollected');
    assert.strictEqual(dataEmpty.memoryCommittedTb, null, 'memoryCommittedTb must be null when uncollected');
    assert.strictEqual(dataEmpty.memoryTotalTb, null, 'memoryTotalTb must be null when uncollected');
    assert.strictEqual(dataEmpty.objectCounts.namespaces, null, 'namespaces count must be null');
    assert.strictEqual(dataEmpty.objectCounts.deployments, null, 'deployments count must be null');
    assert.strictEqual(dataEmpty.objectCounts.runningPods, null, 'runningPods count must be null');

    // Case B: With fake ClickHouse rows -> real numbers
    clickhouse.query = async () => [
      { metric_name: 'k8s.cluster.cpu.requests', value: 36 },
      { metric_name: 'k8s.cluster.cpu.allocatable', value: 96 },
      { metric_name: 'k8s_memory_committed_tb', value: 1.5 },
      { metric_name: 'k8s_memory_total_tb', value: 4.0 },
      { metric_name: 'k8s.namespace.count', value: 12 },
      { metric_name: 'k8s.deployment.count', value: 45 },
      { metric_name: 'k8s.pod.count', value: 130 }
    ];

    const resData = await fetch(`http://127.0.0.1:${testPort}/api/k8s/mesh?environment=staging`);
    const dataWithMetrics = await resData.json();

    assert.strictEqual(dataWithMetrics.status, 'OK');
    assert.strictEqual(dataWithMetrics.coresAllocated, 36);
    assert.strictEqual(dataWithMetrics.coresTotal, 96);
    assert.strictEqual(dataWithMetrics.memoryCommittedTb, 1.5);
    assert.strictEqual(dataWithMetrics.memoryTotalTb, 4.0);
    assert.strictEqual(dataWithMetrics.objectCounts.namespaces, 12);
    assert.strictEqual(dataWithMetrics.objectCounts.deployments, 45);
    assert.strictEqual(dataWithMetrics.objectCounts.runningPods, 130);

    clickhouse.query = origQuery;
    clickhouse.isConfigured = origIsConfigured;
    console.log('✔ Test O0.1 Passed: K8s mesh returns real numbers when present, nulls with DATA_UNAVAILABLE when missing.');

    // -------------------------------------------------------------------------
    // O0.2: Remove hard-coded sample certs/licences from backend
    // -------------------------------------------------------------------------
    console.log('\n[TEST O0.2] Sample certificates & licences removed from runtime...');
    const expiryEnginePath = path.resolve(__dirname, '../backend/config/expiryEngine.js');
    assert.strictEqual(fs.existsSync(expiryEnginePath), false, 'backend/config/expiryEngine.js must be deleted');

    // Verify cert-bb-tls and lic-ghe only exist in backend/demo
    function scanDirForSampleIds(dirPath) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const hits = [];
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          hits.push(...scanDirForSampleIds(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.json') || entry.name.endsWith('.yaml'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes('cert-bb-tls') || content.includes('lic-ghe')) {
            hits.push(fullPath.replace(/\\/g, '/'));
          }
        }
      }
      return hits;
    }

    const backendHits = scanDirForSampleIds(path.resolve(__dirname, '../backend'));
    const invalidHits = backendHits.filter(h => !h.includes('/backend/demo/'));
    assert.deepStrictEqual(invalidHits, [], `Sample IDs cert-bb-tls or lic-ghe found outside backend/demo/: ${invalidHits.join(', ')}`);
    console.log('✔ Test O0.2 Passed: Sample certs/licences isolated strictly to backend/demo/.');

    // -------------------------------------------------------------------------
    // O0.3: k8s_cluster removed from DaemonSet collector config
    // -------------------------------------------------------------------------
    console.log('\n[TEST O0.3] k8s_cluster removed from collector-k8s.yaml DaemonSet...');
    const daemonsetConfig = fs.readFileSync(path.resolve(__dirname, '../agent/config/collector-k8s.yaml'), 'utf8');
    assert.strictEqual(daemonsetConfig.includes('k8s_cluster:'), false, 'DaemonSet config must not define k8s_cluster receiver');
    assert.strictEqual(/receivers:\s*\[[^\]]*k8s_cluster[^\]]*\]/.test(daemonsetConfig), false, 'DaemonSet pipeline must not include k8s_cluster');

    const helmDeployment = fs.readFileSync(path.resolve(__dirname, '../deployments/k8s/sentinel-agent/templates/cluster-deployment.yaml'), 'utf8');
    assert.ok(helmDeployment.includes('k8s_cluster'), 'Helm cluster Deployment must retain k8s_cluster');
    console.log('✔ Test O0.3 Passed: DaemonSet has no k8s_cluster, Helm deployment does.');

    // -------------------------------------------------------------------------
    // O0.4: Custom checks without hard-coded latency = 12
    // -------------------------------------------------------------------------
    console.log('\n[TEST O0.4] Custom checks no simulation-only latency=12 fabrication...');
    const customChecks = require('../remediation/custom_checks');
    const directResults = customChecks.runCustomChecks({});
    for (const check of directResults) {
      assert.notStrictEqual(check.latencyMs, 12, `Check ${check.id} has hardcoded latency 12`);
      assert.strictEqual(check.status, 'UNKNOWN', `Unrun check ${check.id} must be UNKNOWN`);
      assert.strictEqual(check.lastRunValue, 'DATA_UNAVAILABLE', `Unrun check ${check.id} must be DATA_UNAVAILABLE`);
    }

    const resCc = await fetch(`http://127.0.0.1:${testPort}/api/custom-checks`);
    const ccData = await resCc.json();
    assert.ok(Array.isArray(ccData), 'API response must be an array');
    for (const check of ccData) {
      assert.notStrictEqual(check.latencyMs, 12, `API check ${check.id} returned hardcoded latency 12`);
    }
    console.log('✔ Test O0.4 Passed: Custom checks report DATA_UNAVAILABLE/null latency when not executed.');

    // -------------------------------------------------------------------------
    // O0.5: Deprecated ServiceNow endpoints return source: 'sentinel', no fake IDs
    // -------------------------------------------------------------------------
    console.log('\n[TEST O0.5] Deprecated ServiceNow endpoints marked with source: sentinel...');
    const resInfra = await fetch(`http://127.0.0.1:${testPort}/api/infra-tickets?environment=staging`);
    const dataInfra = await resInfra.json();
    assert.strictEqual(dataInfra.source, 'sentinel');
    assert.strictEqual(dataInfra.deprecated, true);

    const resSnow = await fetch(`http://127.0.0.1:${testPort}/api/servicenow/active-incidents?environment=staging`);
    const dataSnow = await resSnow.json();
    assert.strictEqual(dataSnow.source, 'sentinel');
    assert.strictEqual(dataSnow.deprecated, true);
    for (const inc of dataSnow.incidents) {
      assert.strictEqual(inc.source, 'sentinel');
      assert.strictEqual(inc.incident_number, null, 'Must never invent a ServiceNow incident number');
    }

    const resItsm = await fetch(`http://127.0.0.1:${testPort}/api/itsm/tickets?environment=staging`);
    const dataItsm = await resItsm.json();
    assert.strictEqual(dataItsm.source, 'sentinel');
    assert.strictEqual(dataItsm.deprecated, true);
    for (const t of dataItsm.tickets) {
      assert.strictEqual(t.source, 'sentinel');
    }
    console.log('✔ Test O0.5 Passed: ServiceNow endpoints return source: sentinel, deprecated: true, no fabricated incident numbers.');

    console.log('\n======================================================');
    console.log('🎉 ALL PHASE O0 TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    setTimeout(() => process.exit(0), 50);
  }
}

runTests().catch(err => {
  console.error('\n✘ Phase O0 Test Failed:', err);
  process.exit(1);
});
