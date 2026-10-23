/**
 * tests/phase_o8_processes_capacity.test.js
 *
 * Phase O8 Acceptance Tests:
 * - O8.1: Top processes per host (GET /api/v2/infra/hosts/:host/processes)
 * - O8.2 & O8.6: Alert rules (runaway CPU, FD saturation, trend, disk runway)
 * - O8.3: Stale process detector covering all 10 failure patterns
 * - O8.4: Capture dump request and evidence attachment storage
 * - O8.5: Capacity & runway roll-up sorted by days-to-full (AVI strictly DATA_UNAVAILABLE)
 * - O8.7: SMB/CIFS share probe and storageRoutes marking
 * - O8.8: SBOM package queries and vulnerable host lookups
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');

const infraRoutes = require('../backend/routes/infraRoutes');
const componentRoutes = require('../backend/routes/componentRoutes');
const storageRoutes = require('../backend/routes/storageRoutes');
const securityRoutes = require('../backend/routes/securityRoutes');
const evidenceRoutes = require('../backend/routes/evidenceRoutes');
const { detectStaleProcesses } = require('../backend/jobs/stale_processes');
const alertEngine = require('../ai_analysis/alert_engine');
const forecast = require('../analytics/forecast');
const { probeSmbShare } = require('../agent/probe/index');

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
  console.log('=== PHASE O8 ACCEPTANCE TESTS: PROCESSES, CAPACITY & RUNWAY ===');
  const closers = [];

  try {
    // -------------------------------------------------------------------------
    // O8.1: Top processes per host
    // -------------------------------------------------------------------------
    console.log('[1/7] Testing O8.1: Top processes per host API...');
    const appInfra = express();
    appInfra.use(express.json());
    appInfra.use((req, res, next) => {
      req.sentinelEnv = 'prod';
      req.processProvider = {
        getProcesses: async (env, host) => [
          { pid: 101, name: 'java', cpu_pct: 92.5, memory_rss_bytes: 4294967296, fds: 120, fd_limit: 1024, threads: 84 },
          { pid: 102, name: 'postgres', cpu_pct: 45.0, memory_rss_bytes: 2147483648, fds: 80, fd_limit: 1024, threads: 12 },
          { pid: 103, name: 'node', cpu_pct: 12.0, memory_rss_bytes: 536870912, fds: 45, fd_limit: 1024, threads: 6 },
          { pid: 104, name: 'sentinel-agent', cpu_pct: 1.5, memory_rss_bytes: 134217728, fds: 22, fd_limit: 1024, threads: 4 },
          { pid: 105, name: 'osqueryd', cpu_pct: 0.8, memory_rss_bytes: 67108864, fds: 15, fd_limit: 1024, threads: 2 },
          { pid: 106, name: 'sshd', cpu_pct: 0.1, memory_rss_bytes: 16777216, fds: 8, fd_limit: 1024, threads: 1 }
        ]
      };
      next();
    });
    appInfra.use('/api/v2/infra', infraRoutes);

    const srvInfra = http.createServer(appInfra);
    const portInfra = await listen(srvInfra);
    closers.push(srvInfra);

    const resProc = await fetchJson(`http://127.0.0.1:${portInfra}/api/v2/infra/hosts/host-prod-01/processes?limit=5&sort=cpu`);
    assert.strictEqual(resProc.status, 200);
    assert.strictEqual(resProc.body.host, 'host-prod-01');
    assert.strictEqual(resProc.body.processes.length, 5);
    assert.strictEqual(resProc.body.processes[0].pid, 101);
    assert.strictEqual(resProc.body.processes[0].cpu_pct, 92.5);
    console.log('✓ O8.1 passed: Top 5 processes returned sorted by CPU.');

    // -------------------------------------------------------------------------
    // O8.2 & O8.6: Alert rules (Runaway CPU, FD Saturation, Memory Trend, Runway)
    // -------------------------------------------------------------------------
    console.log('[2/7] Testing O8.2 & O8.6: Alert rules evaluation...');
    // 1. Runaway CPU (> 85% for 300s)
    const cpuRule = {
      id: 'rule_runaway_cpu',
      name: 'Runaway Process CPU Utilization',
      type: 'threshold',
      metric: 'process.cpu.utilization',
      operator: '>',
      threshold: 85.0,
      severity: 'critical'
    };
    const cpuTriggered = await alertEngine.evaluateRule(cpuRule, {
      env: 'prod',
      component: 'app_backend',
      values: { 'process.cpu.utilization': 91.2 }
    });
    assert.ok(cpuTriggered, 'Runaway CPU rule should trigger at 91.2%');
    assert.strictEqual(cpuTriggered.severity, 'critical');

    // 2. FD saturation (> 90%)
    const fdRule = {
      id: 'rule_process_fd_saturation',
      name: 'Process File Descriptor Saturation',
      type: 'threshold',
      metric: 'process.open_file_descriptors.pct',
      operator: '>',
      threshold: 90.0,
      severity: 'critical'
    };
    const fdTriggered = await alertEngine.evaluateRule(fdRule, {
      env: 'prod',
      component: 'app_backend',
      values: { 'process.open_file_descriptors.pct': 94.5 }
    });
    assert.ok(fdTriggered, 'FD saturation rule should trigger at 94.5%');

    // 3. Memory trend over 24h
    const trendRule = {
      id: 'rule_process_memory_growth_24h',
      name: 'Process Memory Steady Growth Trend (24h)',
      type: 'trend',
      metric: 'process.memory.rss',
      growth_pct_threshold: 20,
      r2_threshold: 0.8,
      severity: 'warning'
    };
    const t0 = Date.now() - 86400 * 1000;
    const trendPoints = [
      { ts: t0, value: 1000 },
      { ts: t0 + 6 * 3600 * 1000, value: 1075 },
      { ts: t0 + 12 * 3600 * 1000, value: 1150 },
      { ts: t0 + 18 * 3600 * 1000, value: 1225 },
      { ts: t0 + 24 * 3600 * 1000, value: 1300 }
    ];
    const trendTriggered = await alertEngine.evaluateRule(trendRule, {
      env: 'prod',
      component: 'app_backend',
      points: trendPoints
    });
    assert.ok(trendTriggered, 'Memory trend rule should trigger with 30% growth and R2 >= 0.8');
    assert.strictEqual(trendTriggered.severity, 'warning');

    // 4. Runway depletion (< 7 days)
    const runwayRule = {
      id: 'rule_disk_runway_7d',
      name: 'Disk Runway Depletion (< 7 Days)',
      type: 'runway',
      metric: 'system.filesystem.utilization',
      limit_days: 7,
      limit: 100,
      severity: 'critical'
    };
    const diskPoints = [
      { ts: t0 + 20 * 3600 * 1000, value: 86 },
      { ts: t0 + 22 * 3600 * 1000, value: 88 },
      { ts: t0 + 24 * 3600 * 1000, value: 90 }
    ];
    const runwayTriggered = await alertEngine.evaluateRule(runwayRule, {
      env: 'prod',
      component: 'host-01',
      points: diskPoints
    });
    assert.ok(runwayTriggered, 'Runway rule should trigger when projected full < 7 days');
    assert.strictEqual(runwayTriggered.severity, 'critical');
    console.log('✓ O8.2 & O8.6 passed: Alert engine evaluates runaway, trend, and runway rules.');

    // -------------------------------------------------------------------------
    // O8.3: Stale process detector covering all 10 failure patterns
    // -------------------------------------------------------------------------
    console.log('[3/7] Testing O8.3: Stale process detector...');
    const nowSec = 1700000000;
    const manifest = {
      processes: {
        names: ['java', 'node', 'app_worker'],
        max_age_hours: 24,
        expected_instances: 2
      }
    };
    const osquerySamples = [
      { pid: 201, name: 'zombie_proc', state: 'Z', start_time: nowSec - 100, on_disk: 1, host: 'h1' },
      { pid: 202, name: 'nfs_wait', state: 'D', duration_d_sec: 75, host: 'h1' },
      { pid: 203, name: 'app_worker', ppid: 1, is_service: 0, uid: 1001, host: 'h1' },
      { pid: 204, name: 'java', start_time: nowSec - (25 * 3600), host: 'h1' },
      { pid: 205, name: 'maven', ppid: 9999, jenkins_agent_alive: false, age_hours: 7.5, host: 'h1' },
      { pid: 206, name: 'old_bin', on_disk: 0, start_time: nowSec - 500, host: 'h1' },
      { pid: 207, name: 'updated_bin', binary_mtime: nowSec - 100, start_time: nowSec - 500, on_disk: 1, host: 'h1' },
      { pid: 208, name: 'app_worker', host: 'h1' },
      { pid: 209, name: 'app_worker', host: 'h1' },
      { pid: 210, name: 'app_worker', host: 'h1' },
      { pid: 211, name: 'leaker', deleted_files_count: 3, host: 'h1' },
      { pid: 0, service_name: 'AppAutoService', start_type: 'Automatic', status: 'STOPPED', host: 'win1' },
      { pid: 212, db_session: true, idle_in_transaction_sec: 2100, locks_held: 4, host: 'db1' }
    ];

    const findings = await detectStaleProcesses({ osqueryRows: osquerySamples, manifest, nowSec });
    assert.ok(findings.length >= 10, `Expected >= 10 findings, got ${findings.length}`);
    const rulesHit = new Set(findings.map(f => f.rule));
    assert.ok(rulesHit.has('zombie'), 'Should hit zombie');
    assert.ok(rulesHit.has('d_state'), 'Should hit d_state');
    assert.ok(rulesHit.has('orphaned_product'), 'Should hit orphaned_product');
    assert.ok(rulesHit.has('max_age_exceeded'), 'Should hit max_age_exceeded');
    assert.ok(rulesHit.has('orphaned_build_tool'), 'Should hit orphaned_build_tool');
    assert.ok(rulesHit.has('deleted_binary') || rulesHit.has('binary_replaced'), 'Should hit old code');
    assert.ok(rulesHit.has('instances_exceeded'), 'Should hit instances_exceeded');
    assert.ok(rulesHit.has('holding_deleted_files'), 'Should hit holding_deleted_files');
    assert.ok(rulesHit.has('windows_service_failure'), 'Should hit windows_service_failure');
    assert.ok(rulesHit.has('db_idle_transaction'), 'Should hit db_idle_transaction');
    console.log(`✓ O8.3 passed: Stale process detector flagged ${findings.length} findings across all 10 rules.`);

    // -------------------------------------------------------------------------
    // O8.4: Capture dump request and evidence attachment storage
    // -------------------------------------------------------------------------
    console.log('[4/7] Testing O8.4: Capture dump action...');
    const resDump = await fetchJson(`http://127.0.0.1:${portInfra}/api/v2/infra/hosts/host-01/processes/1024/dump`, {
      method: 'POST',
      body: { tool: 'jcmd' }
    });
    assert.strictEqual(resDump.status, 200);
    assert.strictEqual(resDump.body.host, 'host-01');
    assert.strictEqual(resDump.body.pid, 1024);
    assert.ok(resDump.body.attachment_id);
    console.log('✓ O8.4 passed: Capture dump accepted without approval and stored as evidence attachment.');

    // -------------------------------------------------------------------------
    // O8.5: Capacity & Runway Roll-up sorted by days-to-full
    // -------------------------------------------------------------------------
    console.log('[5/7] Testing O8.5: Capacity & Runway Roll-up API...');
    const appCap = express();
    appCap.use(express.json());
    appCap.use((req, res, next) => {
      req.sentinelEnv = 'prod';
      req.user = { role: 'viewer' };
      req.capacityProvider = {
        getCapacityItems: async (env) => [
          { id: 'host-storage-mnt', kind: 'share', total: 1000, used: 850, days_to_full_7d: 12, days_to_full_30d: 14 },
          { id: 'db-tablespace-data', kind: 'db', total: 500, used: 480, days_to_full_7d: 4, days_to_full_30d: 5 },
          { id: 'k8s-cluster-mem', kind: 'k8s', total: 128, used: 64, days_to_full_7d: 45, days_to_full_30d: 50 },
          { id: 'avi-vip-pool', kind: 'avi', total: 100, used: 20 }
        ]
      };
      next();
    });
    appCap.use('/api/v2/capacity', componentRoutes.capacityRouter);

    const srvCap = http.createServer(appCap);
    const portCap = await listen(srvCap);
    closers.push(srvCap);

    const resCap = await fetchJson(`http://127.0.0.1:${portCap}/api/v2/capacity`);
    assert.strictEqual(resCap.status, 200);
    assert.strictEqual(resCap.body.count, 4);
    // Shortest runway first: db (4d), then share (12d), then k8s (45d)
    assert.strictEqual(resCap.body.items[0].id, 'db-tablespace-data');
    assert.strictEqual(resCap.body.items[0].min_days_to_full, 4);
    assert.strictEqual(resCap.body.items[1].id, 'host-storage-mnt');
    assert.strictEqual(resCap.body.items[1].min_days_to_full, 12);
    assert.strictEqual(resCap.body.items[2].id, 'k8s-cluster-mem');

    // AVI strictly DATA_UNAVAILABLE "not collected"
    const aviItem = resCap.body.items.find(i => i.kind === 'avi');
    assert.ok(aviItem);
    assert.strictEqual(aviItem.status, 'DATA_UNAVAILABLE');
    assert.strictEqual(aviItem.total, null);
    assert.ok(aviItem.reason.includes('not collected'));
    console.log('✓ O8.5 passed: Capacity roll-up returned items sorted by days-to-full with AVI null/uncollected.');

    // -------------------------------------------------------------------------
    // O8.7: SMB/CIFS share probe and storageRoutes marking
    // -------------------------------------------------------------------------
    console.log('[6/7] Testing O8.7: SMB/CIFS share probe & storage routes...');
    const smbProbe = await probeSmbShare('.', { mockFreePct: 42.5 });
    assert.strictEqual(smbProbe.present, true);
    assert.strictEqual(smbProbe.is_smb, true);
    assert.strictEqual(smbProbe.free_pct, 42.5);
    assert.ok(smbProbe.latency_ms >= 0);

    const rawShares = [
      {
        component: 'win-host-01',
        entity_id: 'host:win-host-01',
        share: '\\\\storage01\\cifs_share',
        metric_name: 'nas.up',
        latest: 1,
        p95: 1,
        samples: 10,
        last_ms: Date.now()
      },
      {
        component: 'linux-host-01',
        entity_id: 'host:linux-host-01',
        share: '/mnt/nfs_share',
        metric_name: 'nas.up',
        latest: 1,
        p95: 1,
        samples: 10,
        last_ms: Date.now()
      }
    ];
    const shaped = storageRoutes.shapeShares(rawShares);
    assert.strictEqual(shaped.length, 2);
    const smb = shaped.find(s => s.share.includes('cifs_share'));
    assert.ok(smb);
    assert.strictEqual(smb.is_smb, true);
    assert.strictEqual(smb.share_type, 'SMB/CIFS');

    const nfs = shaped.find(s => s.share.includes('nfs_share'));
    assert.ok(nfs);
    assert.strictEqual(nfs.is_smb, false);
    assert.strictEqual(nfs.share_type, 'NFS');
    console.log('✓ O8.7 passed: SMB probe tested and storageRoutes marks SMB/CIFS shares.');

    // -------------------------------------------------------------------------
    // O8.8: SBOM and vulnerable hosts queries
    // -------------------------------------------------------------------------
    console.log('[7/7] Testing O8.8: SBOM & vulnerable hosts queries...');
    const appSec = express();
    appSec.use(express.json());
    appSec.use((req, res, next) => {
      req.sentinelEnv = 'prod';
      req.sbomProvider = {
        getPackageInventory: async (env, query) => [
          { host: 'host-01', product_id: 'artifactory', package_name: 'openssl', version: '1.1.1k', type: 'deb' },
          { host: 'host-02', product_id: 'jenkins', package_name: 'log4j-core', version: '2.14.1', type: 'jar' }
        ],
        getVulnerableHosts: async (env, query) => [
          {
            host: 'host-02',
            product_id: 'jenkins',
            package_name: 'log4j-core',
            version: '2.14.1',
            cve_id: 'CVE-2021-44228',
            severity: 'CRITICAL',
            cvss_score: 10.0,
            remediation: 'Upgrade to log4j >= 2.17.1'
          }
        ]
      };
      next();
    });
    appSec.use('/api/v2/security', securityRoutes);

    const srvSec = http.createServer(appSec);
    const portSec = await listen(srvSec);
    closers.push(srvSec);

    const resSbom = await fetchJson(`http://127.0.0.1:${portSec}/api/v2/security/sbom?package=openssl`);
    assert.strictEqual(resSbom.status, 200);
    assert.strictEqual(resSbom.body.count, 1);
    assert.strictEqual(resSbom.body.packages[0].package_name, 'openssl');

    const resVuln = await fetchJson(`http://127.0.0.1:${portSec}/api/v2/security/vulnerable-hosts?package=log4j-core`);
    assert.strictEqual(resVuln.status, 200);
    assert.strictEqual(resVuln.body.count, 1);
    assert.strictEqual(resVuln.body.hosts[0].host, 'host-02');
    assert.strictEqual(resVuln.body.hosts[0].cve_id, 'CVE-2021-44228');
    assert.strictEqual(resVuln.body.hosts[0].severity, 'CRITICAL');
    console.log('✓ O8.8 passed: SBOM package query and vulnerable hosts query verified.');

    console.log('\n=== ALL PHASE O8 ACCEPTANCE TESTS PASSED SUCCESSFULLY! ===\n');
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
