/**
 * tests/phase_o9_product_jvm.test.js
 *
 * Phase O9 Acceptance Tests:
 * - O9.1: Per-product synthetic checks:
 *   - Jenkins (queue length, wait time, executors, offline agents, stuck builds > 3x median)
 *   - TeamCity (queue length, connected/authorized agents)
 *   - SonarQube (/api/system/status and CE queue pending/inProgress/failing)
 *   - Artifactory (/artifactory/api/system/ping, latency)
 *   - ArgoCD (application sync & health states)
 *   - GitHub (API rate limit headroom % and remaining calls)
 *   - AUTH_FAILED ("needs product team permissions") on 401 / 403
 *   - DATA_UNAVAILABLE on unreachable endpoints
 * - O9.2: config/README.md covers all 17 manifests with the required columns
 * - O9.3: JVM telemetry component catalogue queries & GET /api/products jvm flags
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');

const {
  checkJenkins,
  checkTeamCity,
  checkSonarQube,
  checkArtifactory,
  checkArgoCD,
  checkGitHub
} = require('../synthetics/steps/product_checks');

const componentRoutes = require('../backend/routes/componentRoutes');
const productRoutes = require('../backend/routes/productRoutes');

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

async function fetchJson(url, options = {}) {
  const parsed = new URL(url);
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? JSON.stringify(options.body) : null;
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const closers = [];

  try {
    // 1. Setup mock product server
    const mockServer = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1`);

      // Auth failure mock
      if (req.headers['authorization'] === 'Bearer fail-token') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      if (req.headers['authorization'] === 'Bearer unauth-token') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // Jenkins endpoints
      if (u.pathname === '/queue/api/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          items: [
            { id: 1, inQueueSince: Date.now() - 45000, why: 'Waiting for executor' },
            { id: 2, inQueueSince: Date.now() - 15000, why: 'In queue' }
          ]
        }));
        return;
      }
      if (u.pathname === '/computer/api/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          totalExecutors: 12,
          busyExecutors: 4,
          computer: [
            { displayName: 'master', offline: false, numExecutors: 2 },
            { displayName: 'agent-1', offline: false, numExecutors: 4 },
            { displayName: 'agent-2', offline: true, numExecutors: 4 },
            { displayName: 'agent-3', offline: false, numExecutors: 2 }
          ]
        }));
        return;
      }

      // TeamCity endpoints
      if (u.pathname === '/app/rest/buildQueue') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          count: 5,
          build: [{ id: 101 }, { id: 102 }, { id: 103 }, { id: 104 }, { id: 105 }]
        }));
        return;
      }
      if (u.pathname === '/app/rest/agents') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          agent: [
            { id: 1, name: 'tc-agent-1', connected: true, authorized: true },
            { id: 2, name: 'tc-agent-2', connected: true, authorized: true },
            { id: 3, name: 'tc-agent-3', connected: false, authorized: true },
            { id: 4, name: 'tc-agent-4', connected: false, authorized: false }
          ]
        }));
        return;
      }

      // SonarQube endpoints
      if (u.pathname === '/api/system/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'UP', version: '10.3.0' }));
        return;
      }
      if (u.pathname === '/api/ce/activity_status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pending: 3, inProgress: 1, failing: 0 }));
        return;
      }

      // Artifactory endpoint
      if (u.pathname === '/artifactory/api/system/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }

      // ArgoCD endpoint
      if (u.pathname === '/api/v1/applications') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          items: [
            { metadata: { name: 'app-1' }, status: { health: { status: 'Healthy' }, sync: { status: 'Synced' } } },
            { metadata: { name: 'app-2' }, status: { health: { status: 'Healthy' }, sync: { status: 'Synced' } } },
            { metadata: { name: 'app-3' }, status: { health: { status: 'Degraded' }, sync: { status: 'OutOfSync' } } }
          ]
        }));
        return;
      }

      // GitHub endpoint
      if (u.pathname === '/rate_limit') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          resources: {
            core: { limit: 5000, remaining: 4250, reset: 1776000000, used: 750 }
          }
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    const mockPort = await listen(mockServer);
    const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
    closers.push(mockServer);

    // 2. Setup backend express server for API routes
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, res, next) => {
      req.sentinelEnv = 'staging';
      next();
    });
    testApp.use('/api/v2/components', componentRoutes);
    testApp.use('/api/products', productRoutes);

    const testServer = http.createServer(testApp);
    const testPort = await listen(testServer);
    closers.push(testServer);

    // O9.1: Synthetic Checks per Product
    const resJenkins = await checkJenkins(mockBaseUrl, {
      buildDurations: [30000, 45000, 60000, 65000, 80000], // median ~ 60000 -> stuck threshold = 180000ms
      runningBuilds: [
        { id: 'job-1 #10', elapsedMs: 50000 },
        { id: 'job-2 #54', elapsedMs: 250000 } // > 180000ms -> STUCK
      ]
    });
    assert.strictEqual(resJenkins.product, 'jenkins');
    assert.strictEqual(resJenkins.status, 'HEALTHY');
    assert.strictEqual(resJenkins.metrics.queue_length, 2);
    assert.ok(resJenkins.metrics.oldest_queue_item_ms >= 40000, 'oldest queue wait time should be ~45s');
    assert.strictEqual(resJenkins.metrics.executors_total, 12);
    assert.strictEqual(resJenkins.metrics.executors_busy, 4);
    assert.strictEqual(resJenkins.metrics.executors_free, 8);
    assert.strictEqual(resJenkins.metrics.offline_agents, 1);
    assert.strictEqual(resJenkins.metrics.stuck_builds_count, 1);
    assert.strictEqual(resJenkins.stuck_builds[0].id, 'job-2 #54');
    console.log('✓ O9.1: Jenkins checks passed.');

    const resJenkinsAuth = await checkJenkins(mockBaseUrl, { token: 'fail-token' });
    assert.strictEqual(resJenkinsAuth.status, 'AUTH_FAILED');
    assert.strictEqual(resJenkinsAuth.reason, 'needs product team permissions');
    console.log('✓ O9.1: Jenkins AUTH_FAILED check passed.');

    const resTc = await checkTeamCity(mockBaseUrl);
    assert.strictEqual(resTc.product, 'teamcity');
    assert.strictEqual(resTc.status, 'HEALTHY');
    assert.strictEqual(resTc.metrics.queue_count, 5);
    assert.strictEqual(resTc.metrics.agents_total, 4);
    assert.strictEqual(resTc.metrics.agents_connected, 2);
    assert.strictEqual(resTc.metrics.agents_authorized, 3);
    console.log('✓ O9.1: TeamCity checks passed.');

    const resTcAuth = await checkTeamCity(mockBaseUrl, { token: 'fail-token' });
    assert.strictEqual(resTcAuth.status, 'AUTH_FAILED');
    assert.strictEqual(resTcAuth.reason, 'needs product team permissions');
    console.log('✓ O9.1: TeamCity AUTH_FAILED check passed.');

    const resSonar = await checkSonarQube(mockBaseUrl);
    assert.strictEqual(resSonar.product, 'sonarqube');
    assert.strictEqual(resSonar.status, 'HEALTHY');
    assert.strictEqual(resSonar.system_status, 'UP');
    assert.strictEqual(resSonar.metrics.ce_pending, 3);
    assert.strictEqual(resSonar.metrics.ce_in_progress, 1);
    assert.strictEqual(resSonar.metrics.ce_failing, 0);
    console.log('✓ O9.1: SonarQube checks passed.');

    const resSonarAuth = await checkSonarQube(mockBaseUrl, { token: 'unauth-token' });
    assert.strictEqual(resSonarAuth.status, 'AUTH_FAILED');
    console.log('✓ O9.1: SonarQube AUTH_FAILED check passed.');

    const resArt = await checkArtifactory(mockBaseUrl);
    assert.strictEqual(resArt.product, 'artifactory');
    assert.strictEqual(resArt.status, 'HEALTHY');
    assert.strictEqual(resArt.ping_response, 'OK');
    assert.ok(typeof resArt.metrics.ping_latency_ms === 'number');
    console.log('✓ O9.1: Artifactory checks passed.');

    const resArtAuth = await checkArtifactory(mockBaseUrl, { token: 'fail-token' });
    assert.strictEqual(resArtAuth.status, 'AUTH_FAILED');
    console.log('✓ O9.1: Artifactory AUTH_FAILED check passed.');

    const resArgo = await checkArgoCD(mockBaseUrl);
    assert.strictEqual(resArgo.product, 'argocd');
    assert.strictEqual(resArgo.status, 'DEGRADED', 'one app is degraded');
    assert.strictEqual(resArgo.metrics.apps_total, 3);
    assert.strictEqual(resArgo.metrics.apps_healthy, 2);
    assert.strictEqual(resArgo.metrics.apps_degraded, 1);
    assert.strictEqual(resArgo.metrics.apps_synced, 2);
    assert.strictEqual(resArgo.metrics.apps_out_of_sync, 1);
    console.log('✓ O9.1: ArgoCD checks passed.');

    const resArgoAuth = await checkArgoCD(mockBaseUrl, { token: 'unauth-token' });
    assert.strictEqual(resArgoAuth.status, 'AUTH_FAILED');
    console.log('✓ O9.1: ArgoCD AUTH_FAILED check passed.');

    const resGh = await checkGitHub(mockBaseUrl);
    assert.strictEqual(resGh.product, 'github');
    assert.strictEqual(resGh.status, 'HEALTHY');
    assert.strictEqual(resGh.metrics.rate_limit, 5000);
    assert.strictEqual(resGh.metrics.rate_remaining, 4250);
    assert.strictEqual(resGh.metrics.rate_headroom_pct, 85);
    console.log('✓ O9.1: GitHub checks passed.');

    const resGhAuth = await checkGitHub(mockBaseUrl, { token: 'fail-token' });
    assert.strictEqual(resGhAuth.status, 'AUTH_FAILED');
    console.log('✓ O9.1: GitHub AUTH_FAILED check passed.');

    const resUnreach = await checkJenkins('http://127.0.0.1:59999');
    assert.strictEqual(resUnreach.status, 'DATA_UNAVAILABLE');
    console.log('✓ O9.1: Unreachable endpoint DATA_UNAVAILABLE check passed.');

    // O9.2: config/README.md Requirements Coverage
    const readmePath = path.resolve(__dirname, '../config/README.md');
    const content = fs.readFileSync(readmePath, 'utf8');

    const expectedApps = [
      'bitbucket',
      'bitbucket_external',
      'github',
      'cloudbees_jenkins',
      'jetbrains_teamcity',
      'jfrog_artifactory',
      'sonarqube',
      'fortify',
      'nexusiq',
      'argocd',
      'argoworkflows',
      'otkr',
      'performance_center',
      'aquasec',
      'mcp_server_k8s',
      'auto_remediation_service',
      'code_review_service'
    ];

    for (const appId of expectedApps) {
      assert.ok(content.includes(`(${appId})`) || content.includes(`\`${appId}\``), `README.md should include row for ${appId}`);
    }

    assert.ok(content.includes('JMX local port (optional)'));
    assert.ok(content.includes('Licence read rights'));
    assert.ok(content.includes('Executor / queue read rights'));
    assert.ok(content.includes('ServiceNow read-only user'));
    console.log('✓ O9.2: config/README.md 17-manifest table and 4 required columns verified.');

    // O9.3: JVM Telemetry & Metadata Endpoints
    const resJvmMetrics = await fetchJson(`http://127.0.0.1:${testPort}/api/v2/components/jvm/bitbucket-node-01/metrics`);
    assert.strictEqual(resJvmMetrics.status, 200);
    assert.strictEqual(resJvmMetrics.body.kind, 'jvm');
    assert.strictEqual(resJvmMetrics.body.id, 'bitbucket-node-01');
    assert.ok(Array.isArray(resJvmMetrics.body.charts), 'should return JVM charts defined in catalogue');

    const chartIds = resJvmMetrics.body.charts.map(c => c.id);
    assert.ok(chartIds.includes('heap_memory'), 'must include heap_memory chart');
    assert.ok(chartIds.includes('non_heap_memory'), 'must include non_heap_memory chart');
    assert.ok(chartIds.includes('gc_pause'), 'must include gc_pause chart');
    assert.ok(chartIds.includes('threads'), 'must include threads chart');
    console.log('✓ O9.3: JVM component metrics route and catalogue charts verified.');

    const resProducts = await fetchJson(`http://127.0.0.1:${testPort}/api/products`);
    assert.strictEqual(resProducts.status, 200);
    assert.ok(Array.isArray(resProducts.body));

    const bb = resProducts.body.find(p => p.id === 'bitbucket');
    assert.ok(bb, 'bitbucket should be present');
    assert.strictEqual(bb.has_jvm, true, 'bitbucket has JVM configured');
    assert.strictEqual(bb.jvm_jmx_port, 3333);

    const jenkins = resProducts.body.find(p => p.id === 'cloudbees_jenkins');
    assert.ok(jenkins, 'jenkins should be present');
    assert.strictEqual(jenkins.has_jvm, true, 'jenkins has JVM configured');
    assert.strictEqual(jenkins.jvm_jmx_port, 5000);
    console.log('✓ O9.3: /api/products exposes jvm and has_jvm flags correctly.');

    console.log('\n=== ALL PHASE O9 ACCEPTANCE TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    for (const c of closers) {
      try { c.close(); } catch (_) {}
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Test failure:', err);
    process.exit(1);
  });
}

module.exports = { main };
