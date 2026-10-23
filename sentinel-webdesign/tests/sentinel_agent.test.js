/**
 * tests/sentinel_agent.test.js
 *
 * Comprehensive Milestone M4 Unit & Integration Tests:
 * 1. sentinel-probe timing, NAS operations, and OTLP payload formatting
 * 2. Dynamic agent config endpoint, scope enforcement, and per-host rendering
 * 3. Heartbeat, silent host alerting, and config drift detection
 * 4. AVI path overhead computation and rule 3.3(b) evaluation
 * 5. File change monitoring and change window matching
 * 6. Package and CVE scanning, EOL classification, and inert blank-mirror path
 * 7. Database and Kubernetes routes validation
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Modules under test
const prober = require('../agent/probe');
const { app } = require('../backend/server');
const inventory = require('../inventory/store');
const db = require('../database/db');
const { hashKey } = require('../backend/auth/ingest_keys');
const { isWithinChangeWindow, recordFileChangeEvent } = require('../backend/routes/changeRoutes');
const securityScanner = require('../security');
const { diagnoseLayer } = require('../correlation');

async function runTests() {
  console.log('=== RUNNING MILESTONE M4: SENTINEL AGENT TESTS ===');

  let server;
  let testPort;

  // Start test HTTP server
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: sentinel-probe local & NAS operations
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing sentinel-probe local health and NAS share latency...');

    // 1.1 Local health probe against a running server
    const localResult = await prober.probeLocalHealth(`http://127.0.0.1:${testPort}/api/health`);
    assert.strictEqual(localResult.status, 'HEALTHY');
    assert.ok(typeof localResult.latency_ms === 'number' && localResult.latency_ms >= 0);
    assert.strictEqual(localResult.httpStatus, 200);

    // 1.2 Local health probe against unreachable port
    const unreachableResult = await prober.probeLocalHealth('http://127.0.0.1:54321/unreachable');
    assert.strictEqual(unreachableResult.status, 'DATA_UNAVAILABLE');
    assert.strictEqual(unreachableResult.latency_ms, null);

    // 1.3 NAS share probe against temporary directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-nas-test-'));
    try {
      const nasResult = await prober.probeNasShare(tempDir);
      assert.strictEqual(nasResult.status, 'HEALTHY');
      assert.ok(nasResult.stat_ms >= 0);
      assert.ok(nasResult.list_ms >= 0);
      assert.ok(nasResult.write_ms >= 0);
      assert.ok(nasResult.read_ms >= 0);
      assert.strictEqual(nasResult.error, null);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // 1.4 NAS probe against non-existent directory
    const badNasResult = await prober.probeNasShare(path.join(os.tmpdir(), 'non-existent-share-xyz'));
    assert.strictEqual(badNasResult.status, 'DATA_UNAVAILABLE');
    assert.ok(badNasResult.error);

    // 1.5 OTLP Payload formatting
    const otlpPayload = prober.buildOtlpPayload([
      { name: 'nas.read_latency_ms', value: 4.2, attributes: { share: '/mnt/artifactory' } },
      { name: 'nas.write_latency_ms', value: 12.5, attributes: { share: '/mnt/artifactory' } }
    ], { 'host.name': 'toolchain-node-01' });

    assert.ok(otlpPayload.resourceMetrics);
    assert.strictEqual(otlpPayload.resourceMetrics[0].scopeMetrics[0].metrics.length, 2);
    console.log('✔ Test 1 Passed: sentinel-probe local & NAS operations verified.');

    // -------------------------------------------------------------------------
    // SECTION 2: Dynamic Agent Configuration Endpoint
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing GET /api/v2/agent/config endpoint...');

    // Set up test ingest keys in environment
    const rawAgentKey = 'snk_test_agent_key_valid';
    const agentKeyHash = hashKey(rawAgentKey);
    process.env.SENTINEL_INGEST_API_KEYS = `test_agent:production:${agentKeyHash}:agent;metrics;logs;heartbeat`;
    process.env.SENTINEL_INGEST_AUTH_MODE = 'enforce';

    // 2.1 Request config with valid agent key for a host that runs artifactory
    const cfgRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/agent/config?host=jfrog-artifactory-node-01.internal.corp`, {
      headers: { 'X-Sentinel-Api-Key': rawAgentKey }
    });
    assert.strictEqual(cfgRes.status, 200);
    const cfgData = await cfgRes.json();
    assert.strictEqual(cfgData.host, 'jfrog-artifactory-node-01.internal.corp');
    assert.ok(cfgData.config_hash && cfgData.config_hash.length === 64);
    assert.ok(cfgData.collector_config);
    // [F7] Without a reported version the config must not carry an invented one.
    assert.ok(!cfgData.config_yaml.includes('sentinel.agent.version'), 'No agent version may be invented');
    const cfgVerRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/agent/config?host=jfrog-artifactory-node-01.internal.corp&agent_version=2.4.0`, {
      headers: { 'X-Sentinel-Api-Key': rawAgentKey }
    });
    const cfgVerData = await cfgVerRes.json();
    assert.ok(cfgVerData.config_yaml.includes('sentinel.agent.version'), 'Reported version is passed through');
    assert.ok(cfgVerData.config_yaml.includes('2.4.0'));

    // Verify apps mapped
    assert.ok(cfgData.apps.some(a => a.id === 'jfrog_artifactory'));
    assert.ok(cfgData.shares.length > 0);

    // 2.2 Reject request with invalid key
    const badKeyRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/agent/config?host=lon-artifactory-app-01`, {
      headers: { 'X-Sentinel-Api-Key': 'snk_invalid_key' }
    });
    assert.strictEqual(badKeyRes.status, 401);
    console.log('✔ Test 2 Passed: Dynamic agent config and key scope authorization verified.');

    // -------------------------------------------------------------------------
    // SECTION 3: Heartbeat, Silent Host Alerting & Config Drift
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing heartbeat, silent host alert, and config drift...');

    const expectedHash = cfgData.config_hash;
    const testHost = 'lon-build-runner-42';

    // 3.1 Send heartbeat with matching config hash
    const hbRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/shipper/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentinel-Api-Key': rawAgentKey
      },
      body: JSON.stringify({
        host: testHost,
        version: '2.4.0',
        agent_version: '2.4.0',
        config_hash: expectedHash,
        os: 'linux',
        environment: 'production'
      })
    });
    if (hbRes.status !== 200) {
      console.error('HEARTBEAT ERROR BODY:', await hbRes.text());
    }
    assert.strictEqual(hbRes.status, 200);

    const storedEntity = await inventory.getEntity(`host:${testHost}`);
    assert.ok(storedEntity);
    assert.strictEqual(storedEntity.labels.agent_version, '2.4.0');
    assert.strictEqual(storedEntity.labels.config_hash, expectedHash);

    // 3.2 Detect config drift (when running agent sends unexpected hash)
    const driftedHost = 'lon-build-runner-43';
    const unexpectedHash = 'deadbeef0000111122223333444455556666777788889999aaaabbbbccccdddd';
    await fetch(`http://127.0.0.1:${testPort}/api/v2/shipper/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentinel-Api-Key': rawAgentKey
      },
      body: JSON.stringify({
        host: driftedHost,
        agent_version: '2.4.0',
        config_hash: unexpectedHash,
        os: 'linux',
        environment: 'production'
      })
    });

    const driftedEntity = await inventory.getEntity(`host:${driftedHost}`);
    const isDrifted = driftedEntity.labels.config_hash !== expectedHash;
    assert.strictEqual(isDrifted, true);

    // 3.3 Silent host detection through the P10 fleet-health job (> 5 min → one deduplicated alert)
    const { runFleetHealth } = require('../backend/jobs/fleet_health');
    const silentHost = 'lon-silent-worker-' + Date.now();
    await inventory.upsertEntity({
      entity_id: `host:${silentHost}`,
      kind: 'host',
      name: silentHost,
      environment: 'staging',
      labels: { last_heartbeat: new Date(Date.now() - 6 * 60 * 1000).toISOString() }
    });
    await runFleetHealth({ environments: ['staging'] });
    await runFleetHealth({ environments: ['staging'] });
    const silentAlerts = db.getAlerts('staging').filter(a => a.component === silentHost && a.status === 'Active');
    assert.strictEqual(silentAlerts.length, 1, 'one deduplicated silent-host alert');
    assert.strictEqual(silentAlerts[0].count, 2);
    console.log('✔ Test 3 Passed: Heartbeat, silent host alerting, and config drift verified.');

    // -------------------------------------------------------------------------
    // SECTION 4: AVI Path Overhead & Rule 3.3(b)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing AVI overhead computation and diagnosis rule 3.3(b)...');

    // P2 job: VIP total 240 ms and agent localhost 8 ms in the same minute (fake ClickHouse rows) → 232 ms
    const { runAviOverhead } = require('../backend/jobs/avi_overhead');
    const minuteMs = Date.UTC(2026, 9, 12, 10, 0, 0);
    const chServer = http.createServer((req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ component: 'jfrog_artifactory', minute_ms: minuteMs, vip_ms: 240, local_ms: 8, n_vip: 1, n_local: 1 }) + '\n');
    });
    await new Promise(r => chServer.listen(0, '127.0.0.1', r));
    const prevCh = process.env.CLICKHOUSE_URL;
    process.env.CLICKHOUSE_URL = `http://127.0.0.1:${chServer.address().port}`;
    const overheadPoints = [];
    await runAviOverhead({ environments: ['staging'], store: { addMetricBatch: b => overheadPoints.push(...b) }, nowMs: minuteMs + 120000 });
    if (prevCh === undefined) delete process.env.CLICKHOUSE_URL; else process.env.CLICKHOUSE_URL = prevCh;
    chServer.closeAllConnections();
    chServer.close();
    assert.strictEqual(overheadPoints.length, 1);
    assert.strictEqual(overheadPoints[0].value, 232);

    // Test correlation rule (b): VIP total slow but agent localhost timing normal -> AVI/path
    const aviPathFixture = require('./fixtures/rule_b_avi_path.json');
    const hypotheses = diagnoseLayer(aviPathFixture);
    const topHypothesis = hypotheses[0];
    assert.ok(topHypothesis);
    assert.strictEqual(topHypothesis.rule_id, 'rule_avi_path');
    assert.strictEqual(topHypothesis.layer, 'AVI/path');
    assert.ok(topHypothesis.confidence >= 0.8);
    console.log('✔ Test 4 Passed: AVI overhead computation and Rule 3.3(b) verified.');

    // -------------------------------------------------------------------------
    // SECTION 5: File Change Monitoring & Change Window Matching
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing file changes and change window matching...');

    // 5.1 Create change window for artifactory
    const session = require('../backend/auth/session');
    session.setJwtSecret('sentinel_jwt_secret_at_least_32_characters_long_12345');
    const adminToken = session.generateToken({ username: 'lead.sre@enterprise.corp', role: 'SRE Lead', environment: 'prod' });
    // Change windows live in PostgreSQL only (Phase S1); use the in-memory fake pool.
    const { fakeChangeWindowPool } = require('./helpers/fake_change_window_pool');
    require('../backend/routes/changeRoutes').setPool(fakeChangeWindowPool());

    const now = Date.now();
    const winRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/changes/windows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        title: 'Artifactory Config Upgrade',
        productId: 'jfrog_artifactory',
        host: 'lon-artifactory-app-01',
        startTime: new Date(now - 10 * 60 * 1000).toISOString(),
        endTime: new Date(now + 50 * 60 * 1000).toISOString(),
        createdBy: 'lead_sre'
      })
    });
    assert.strictEqual(winRes.status, 201);
    const winData = await winRes.json();
    assert.ok(winData.window.id.startsWith('CW-'));
    assert.strictEqual(winData.window.environment, 'prod', 'environment from the session');
    assert.strictEqual(winData.window.created_by, 'lead.sre@enterprise.corp', 'creator from the session');

    // 5.2 Record file change during window -> must be is_approved: true
    const approvedEvent = await recordFileChangeEvent({
      environment: 'prod',
      productId: 'jfrog_artifactory',
      host: 'lon-artifactory-app-01',
      path: '/etc/artifactory/binarystore.xml',
      beforeHash: 'aaa111',
      afterHash: 'bbb222',
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(approvedEvent.is_approved, true);
    assert.strictEqual(approvedEvent.severity, 'info');

    // 5.3 Record file change on unapproved host / time -> must be is_approved: false
    const unapprovedEvent = await recordFileChangeEvent({
      environment: 'prod',
      productId: 'bitbucket',
      host: 'lon-bitbucket-app-01',
      path: '/etc/bitbucket/bitbucket.properties',
      beforeHash: 'ccc333',
      afterHash: 'ddd444',
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(unapprovedEvent.is_approved, false);
    assert.strictEqual(unapprovedEvent.severity, 'warning');
    assert.ok(unapprovedEvent.title.includes('UNAPPROVED'));
    console.log('✔ Test 5 Passed: File change monitoring and change window matching verified.');

    // -------------------------------------------------------------------------
    // SECTION 6: Package & CVE Scanner (@sentinel/security)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing @sentinel/security and Trivy report parsing...');

    // 6.1 Scanner is inert when mirror path is blank
    const inertResult = await securityScanner.runSecurityScan({ mirrorPath: '' });
    assert.strictEqual(inertResult.status, 'SKIPPED');
    assert.ok(inertResult.reason.includes('blank'));

    // 6.2 Parse fixture Trivy report
    const mockTrivyReport = {
      Results: [
        {
          Target: "packages-manifest",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2026-4444",
              PkgName: "log4j-core",
              InstalledVersion: "2.14.1",
              FixedVersion: "2.17.1",
              Severity: "CRITICAL",
              CVSS: { nvd: { V3Score: 10.0 } },
              Title: "Remote Code Execution Vulnerability in log4j"
            },
            {
              VulnerabilityID: "CVE-2026-1234",
              PkgName: "openssl",
              InstalledVersion: "1.1.1k",
              FixedVersion: "1.1.1w",
              Severity: "HIGH",
              Score: 7.5,
              Title: "Buffer overflow vulnerability"
            }
          ]
        }
      ]
    };

    const eolDataset = {
      'openssl': { eol: '2023-09-11' } // OpenSSL 1.1.1 reached EOL
    };

    const scanResult = await securityScanner.runSecurityScan({
      trivyReport: mockTrivyReport,
      host: 'lon-artifactory-app-01',
      productId: 'jfrog_artifactory',
      env: 'production',
      eolDataset
    });

    assert.strictEqual(scanResult.status, 'SUCCESS');
    assert.strictEqual(scanResult.critical, 1);
    assert.strictEqual(scanResult.high, 1);
    assert.strictEqual(scanResult.findings.length, 2);

    const opensslFinding = scanResult.findings.find(f => f.package_name === 'openssl');
    assert.ok(opensslFinding);
    assert.strictEqual(opensslFinding.is_eol, 1);
    console.log('✔ Test 6 Passed: @sentinel/security, Trivy parsing, and EOL detection verified.');

    // -------------------------------------------------------------------------
    // SECTION 7: Database & Kubernetes Endpoints Verification
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing database and Kubernetes route responses...');

    // 7.1 Normal routes reject ?environment=demo with 400; /api/demo/databases serves sample data
    const dbDemoNormalRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/databases/overview?environment=demo`);
    assert.strictEqual(dbDemoNormalRes.status, 400);

    const dbDemoRes = await fetch(`http://127.0.0.1:${testPort}/api/demo/databases`);
    assert.strictEqual(dbDemoRes.status, 200);
    const dbDemoData = await dbDemoRes.json();
    assert.strictEqual(dbDemoData.demo, true);
    assert.strictEqual(Array.isArray(dbDemoData.data.databases), true);

    // 7.2 Database overview prod returns DATA_UNAVAILABLE when no real metrics collected
    const dbProdRes = await fetch(`http://127.0.0.1:${testPort}/api/v2/databases/overview?environment=prod`);
    assert.strictEqual(dbProdRes.status, 200);
    const dbProdData = await dbProdRes.json();
    assert.strictEqual(dbProdData.prototype, false);
    assert.strictEqual(dbProdData.status, 'DATA_UNAVAILABLE');

    // 7.3 Kubernetes mesh prod returns DATA_UNAVAILABLE when no daemonset nodes present
    const k8sProdRes = await fetch(`http://127.0.0.1:${testPort}/api/k8s/mesh?environment=prod`);
    assert.strictEqual(k8sProdRes.status, 200);
    const k8sProdData = await k8sProdRes.json();
    assert.strictEqual(k8sProdData.status, 'DATA_UNAVAILABLE');
    assert.strictEqual(k8sProdData.nodes, undefined);
    console.log('✔ Test 7 Passed: Database and Kubernetes routes clean data isolation verified.');

    console.log('\n======================================================');
    console.log('🎉 ALL MILESTONE M4 TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
  } finally {
    server.close();
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n✘ M4 Test Failed:', err);
  process.exit(1);
});
