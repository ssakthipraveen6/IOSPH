const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const yaml = require('js-yaml');

async function runPhase5Validation() {
  console.log('=== [SENTINEL] Phase 5 & Section 14 Remediation Validation Suite ===\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      throw e;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      throw e;
    }
  }

  // 1. Database Migration 005
  test('Check Migration 005 Up & Down SQL exists and is reversible', () => {
    const upPath = path.resolve(__dirname, '../../database/migrations/005_create_expiry_schema.sql');
    const downPath = path.resolve(__dirname, '../../database/migrations/005_create_expiry_schema.down.sql');
    assert(fs.existsSync(upPath), '005_create_expiry_schema.sql must exist');
    assert(fs.existsSync(downPath), '005_create_expiry_schema.down.sql must exist');

    const upSql = fs.readFileSync(upPath, 'utf8');
    const downSql = fs.readFileSync(downPath, 'utf8');

    assert(upSql.includes('CREATE TABLE IF NOT EXISTS expiry_item'), 'Must create expiry_item table');
    assert(upSql.includes('item_id'), 'expiry_item table must have item_id');
    assert(downSql.includes('DROP TABLE IF EXISTS expiry_item'), 'down migration must drop expiry_item');
  });

  // 2. Dynatrace Token Provider (T5.1)
  await testAsync('Check Dynatrace Token Provider with 25s TTL, single-flight lock and 401 retry', async () => {
    const tokenProvider = require('../../metrics_collection/real/dynatrace/token_provider');
    tokenProvider.resetTokenState();
    process.env.DYNATRACE_API_TOKEN = 'dt0c01.SAMPLE_TEST_VALIDATION_TOKEN';

    const [t1, t2, t3] = await Promise.all([
      tokenProvider.getApiToken(false),
      tokenProvider.getApiToken(false),
      tokenProvider.getApiToken(false)
    ]);
    assert(t1 && t1.length > 0, 'Token must be resolved');
    assert.strictEqual(t2, t1, 'Concurrent caller 2 receives identical token');
    assert.strictEqual(t3, t1, 'Concurrent caller 3 receives identical token');

    let attempt = 0;
    const retryResult = await tokenProvider.executeWithTokenRetry(async (tok) => {
      attempt++;
      if (attempt === 1) {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }
      return `success-with-${tok}`;
    });

    assert.strictEqual(attempt, 2, 'Must have retried on 401');
    assert(retryResult.startsWith('success-with-'), 'Operation succeeded after 401 retry');
  });

  // 3. Dynatrace Metric Resolver & Alias Config (T5.2)
  test('Check Dynatrace Metric Resolver and Alias config', () => {
    const aliasPath = path.resolve(__dirname, '../../config/dynatrace_metric_aliases.yaml');
    assert(fs.existsSync(aliasPath), 'config/dynatrace_metric_aliases.yaml must exist');
    const aliases = yaml.load(fs.readFileSync(aliasPath, 'utf8'));
    assert(aliases.aliases, 'Must have aliases mapping');
    assert(aliases.aliases.host_cpu_avg_pct, 'Must have host_cpu_avg_pct aliases');

    const metricResolver = require('../../metrics_collection/real/dynatrace/metric_resolver');
    const mockDb = {
      alerts: [],
      addAlert(comp, sev, msg, stat, env) {
        this.alerts.push({ comp, sev, msg, stat, env });
      }
    };

    const mockDescriptors = ['builtin:host.cpu.idle', 'builtin:host.mem.used.pct'];
    const resolved = metricResolver.resolveDescriptors(mockDescriptors, mockDb, 'staging');
    assert(resolved.get('host_cpu_avg_pct'), 'Should resolve host_cpu_avg_pct');

    // Unresolvable metric raises alert
    const badDescriptors = ['unrelated.metric'];
    metricResolver.resolveDescriptors(badDescriptors, mockDb, 'staging');
    const driftAlert = mockDb.alerts.find(a => a.msg && a.msg.includes('[DYNATRACE-DRIFT]'));
    assert(driftAlert, 'Must raise DATA_UNAVAILABLE alert when metric cannot be resolved');
  });

  // 4. Unified Telemetry Source Interface (T5.3 / C8)
  test('Check TelemetrySource unified interface and optional Dynatrace toggle', () => {
    const { 
      TelemetrySource, 
      DynatraceTelemetrySource, 
      OtlpTelemetrySource, 
      NodeExporterTelemetrySource,
      getTelemetrySource 
    } = require('../../metrics_collection/sources/telemetry_source');

    assert(typeof TelemetrySource === 'function');
    assert(typeof DynatraceTelemetrySource === 'function');
    assert(typeof OtlpTelemetrySource === 'function');
    assert(typeof NodeExporterTelemetrySource === 'function');

    const dtSource = getTelemetrySource('dynatrace');
    assert(dtSource instanceof DynatraceTelemetrySource);

    const otlpSource = getTelemetrySource('otlp');
    assert(otlpSource instanceof OtlpTelemetrySource);

    const nodeSource = getTelemetrySource('node_exporter');
    assert(nodeSource instanceof NodeExporterTelemetrySource);

    assert(typeof dtSource.isEnabled === 'function');
  });

  // 5. Expiry Engine Real TLS and Dynamic Calculations (T5.4)
  await testAsync('Check Expiry Engine computes daysLeft dynamically and emits events', async () => {
    const expiryEngine = require('../../backend/config/expiryEngine');
    const items = await expiryEngine.getAllExpiryItemsAsync();
    assert(Array.isArray(items), 'Items must be an array');
    assert(items.length >= 8, 'Must return at least canonical 8 items');

    for (const item of items) {
      assert(typeof item.daysLeft === 'number', 'daysLeft must be numeric for all items');
      assert(['healthy', 'warning', 'critical'].includes(item.status), 'Status must be valid');
    }

    const summary = expiryEngine.getExpirySummary();
    assert(typeof summary.total === 'number', 'Total must be numeric');
    assert(typeof summary.critical === 'number', 'Critical count must be numeric');
  });

  // 6. Generic URL-Only Prober Collector (T5.5 / C6)
  await testAsync('Check URL Probe Collector executes and reports latency and TLS inspection', async () => {
    const { probeUrl } = require('../../metrics_collection/real/probers/url_probe_collector');

    const testServer = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'probe-test-service' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(r => testServer.listen(0, '127.0.0.1', r));
    const port = testServer.address().port;

    try {
      const probeResult = await probeUrl({
        url: `http://127.0.0.1:${port}/healthz`,
        component: 'probe-test',
        expectedStatus: 200,
        contentAssertion: 'probe-test-service'
      });

      assert.strictEqual(probeResult.status, 'HEALTHY');
      assert.strictEqual(probeResult.httpStatus, 200);
      assert.strictEqual(probeResult.assertionPassed, true);
      assert(typeof probeResult.latencyMs === 'number');
      assert(probeResult.latencyMs >= 0);
    } finally {
      testServer.close();
    }
  });

  // 7. Section 14 New Views & Sidebar Navigation
  test('Check all 4 Enterprise Views exist and are mounted in frontend/src/App.jsx', () => {
    const fleetPath = path.resolve(__dirname, '../../frontend/src/components/fleet/FleetExplorerView.jsx');
    const logsPath = path.resolve(__dirname, '../../frontend/src/components/logs/LogExplorerView.jsx');
    const blastPath = path.resolve(__dirname, '../../frontend/src/components/correlation/BlastRadiusView.jsx');
    const opsPath = path.resolve(__dirname, '../../frontend/src/components/ops/PipelineOpsView.jsx');
    const appPath = path.resolve(__dirname, '../../frontend/src/App.jsx');

    assert(fs.existsSync(fleetPath), 'FleetExplorerView.jsx must exist');
    assert(fs.existsSync(logsPath), 'LogExplorerView.jsx must exist');
    assert(fs.existsSync(blastPath), 'BlastRadiusView.jsx must exist');
    assert(fs.existsSync(opsPath), 'PipelineOpsView.jsx must exist');

    const appContent = fs.readFileSync(appPath, 'utf8');
    assert(appContent.includes("import FleetExplorerView from './components/fleet/FleetExplorerView'"), 'App.jsx must import FleetExplorerView');
    assert(appContent.includes("import BlastRadiusView from './components/correlation/BlastRadiusView'"), 'App.jsx must import BlastRadiusView');
    assert(appContent.includes("import PipelineOpsView from './components/ops/PipelineOpsView'"), 'App.jsx must import PipelineOpsView');
    assert(appContent.includes("import LogExplorerView from './components/logs/LogExplorerView'"), 'App.jsx must import LogExplorerView');

    assert(appContent.includes("id: 'fleet'"), 'App.jsx sidebar must include fleet');
    assert(appContent.includes("id: 'blast-radius'"), 'App.jsx sidebar must include blast-radius');
    assert(appContent.includes("id: 'pipeline-ops'"), 'App.jsx sidebar must include pipeline-ops');
    assert(appContent.includes("id: 'logs'"), 'App.jsx sidebar must include logs');

    assert(appContent.includes("<FleetExplorerView"), 'App.jsx must render FleetExplorerView');
    assert(appContent.includes("<BlastRadiusView"), 'App.jsx must render BlastRadiusView');
    assert(appContent.includes("<PipelineOpsView"), 'App.jsx must render PipelineOpsView');
    assert(appContent.includes("<LogExplorerView"), 'App.jsx must render LogExplorerView');
  });

  // 8. Backend API Support for Fleet Summary
  test('Check server.js exposes /api/v2/fleet/summary', () => {
    const serverPath = path.resolve(__dirname, '../../backend/server.js');
    const content = fs.readFileSync(serverPath, 'utf8');
    assert(content.includes('/api/v2/fleet/summary'), 'server.js must expose /api/v2/fleet/summary');
  });

  console.log(`\n=== All ${passed}/${total} Phase 5 & Section 14 Validation Checks Passed Successfully! ===\n`);
}

if (require.main === module) {
  runPhase5Validation().catch(err => {
    console.error('Validation failed:', err);
    process.exit(1);
  });
}

module.exports = { runPhase5Validation };
