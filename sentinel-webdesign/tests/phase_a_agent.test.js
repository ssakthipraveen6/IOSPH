/**
 * tests/phase_a_agent.test.js
 *
 * Phase A acceptance (agent end to end), through the production code paths:
 *  - A1 one auth convention: the probe pushes to the real /v1/metrics route in
 *       enforce mode with X-Sentinel-Api-Key -> 2xx; a wrong key -> 401; the gateway
 *       path uses Authorization: Bearer; served collector configs carry the bearer header.
 *  - A2 sentinel-probe CLI: config pull, localhost timing, error paths, heartbeat with
 *       agent_version / config_hash / os, --write-collector-config.
 *  - A3 per-host rendering: Linux app host, Windows DB host, K8s node, K8s cluster role.
 *  - A4 exact host matching (`host=a` matches nothing); environment only from the key.
 *  - A5 watch: paths in every manifest, generated osquery packs, osquery results
 *       forwarded to POST /api/v2/changes/events (key -> stored, session only -> 401).
 *  - OTLP normalizer keeps SENTINEL / DB receiver metric names and attributes.
 */

process.env.SENTINEL_JOBS_QUIET = 'true';
process.env.SENTINEL_INGEST_AUTH_MODE = 'enforce';

const crypto = require('crypto');
const PROD_KEY = 'snk_test_' + crypto.randomBytes(12).toString('hex');
const STG_KEY = 'snk_test_' + crypto.randomBytes(12).toString('hex');
const METRICS_ONLY_KEY = 'snk_test_' + crypto.randomBytes(12).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
process.env.SENTINEL_INGEST_API_KEYS = [
  `probe-prod:prod:${sha(PROD_KEY)}:agent;heartbeat;metrics`,
  `probe-stg:staging:${sha(STG_KEY)}:agent;heartbeat;metrics`,
  `metrics-only:prod:${sha(METRICS_ONLY_KEY)}:metrics`
].join(',');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const yaml = require('js-yaml');

const { app } = require('../backend/server');
const db = require('../database/db');
const inventory = require('@sentinel/inventory');
const session = require('../backend/auth/session');
const probe = require('../agent/probe');
const { renderAgentConfig, parseDatabase, sameHost } = require('../backend/routes/agentRoutes');
const { normalizeOtlpPayload } = require('../metrics_collection/real/opentelemetry/otlp_metric_normalizer');
const osqueryPack = require('../scripts/generate_osquery_pack');

const closers = [];
// Capture what the real /v1/metrics route hands to the store.
const ingested = [];
const origAddMetricBatch = db.addMetricBatch;
db.addMetricBatch = function (batch, ...rest) {
  ingested.push(...batch);
  return origAddMetricBatch.call(this, batch, ...rest);
};
function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}
async function ok(name, fn) {
  await fn();
  console.log(`  ✔ ${name}`);
}

(async () => {
  const appServer = http.createServer(app);
  const appPort = await listen(appServer);
  closers.push(() => appServer.close());
  const base = `http://127.0.0.1:${appPort}`;

  // A product's "localhost" endpoint with a fixed 120 ms delay, and one that fails.
  const local = http.createServer((req, res) => {
    if (req.url === '/slow') return setTimeout(() => { res.writeHead(200); res.end('ok'); }, 120);
    res.writeHead(503); res.end('down');
  });
  const localPort = await listen(local);
  closers.push(() => local.close());

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-phase-a-'));
  const uid = Date.now().toString(36);
  const host = 'cloudbees-jenkins-node-01.internal.corp';

  console.log('\n=== PHASE A: AGENT END TO END ===');

  // ---------------------------------------------------------------- A1
  await ok('A1: probe -> real /v1/metrics in enforce mode with X-Sentinel-Api-Key is 2xx', async () => {
    const payload = probe.buildOtlpPayload([{ name: 'agent.localhost_ms', value: 12.5, attributes: { url: 'http://127.0.0.1/x' } }],
      { 'host.name': `a1-${uid}`, 'application.id': 'cloudbees_jenkins' });
    const r = await probe.pushOtlpMetrics(base, payload, { auth: 'api_key', apiKey: PROD_KEY });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const stored = ingested.filter(m => m.metricName === 'agent.localhost_ms' && m.entity_id === `host:a1-${uid}`);
    assert.strictEqual(stored.length, 1, 'metric stored under its dotted name');
    assert.strictEqual(stored[0].env, 'prod', 'environment from the key');
    assert.strictEqual(stored[0].component, 'cloudbees_jenkins');
    assert.deepStrictEqual(stored[0].attributes, { url: 'http://127.0.0.1/x' });
  });

  await ok('A1: wrong key, missing key and the old x-sentinel-key header -> 401', async () => {
    const payload = probe.buildOtlpPayload([{ name: 'agent.localhost_ms', value: 1 }], { 'host.name': 'x' });
    assert.strictEqual((await probe.pushOtlpMetrics(base, payload, { auth: 'api_key', apiKey: 'snk_wrong' })).status, 401);
    assert.strictEqual((await probe.pushOtlpMetrics(base, payload, { auth: 'none' })).status, 401);
    const legacy = await fetch(`${base}/v1/metrics`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sentinel-key': PROD_KEY }, body: JSON.stringify(payload) });
    assert.strictEqual(legacy.status, 401);
    // A gateway bearer token is not an app credential.
    assert.strictEqual((await probe.pushOtlpMetrics(base, payload, { auth: 'bearer', gatewayToken: PROD_KEY })).status, 401);
  });

  await ok('A1: gateway destination sends Authorization: Bearer; served configs use it too', async () => {
    let seen = null;
    const gw = http.createServer((req, res) => { seen = req.headers; res.writeHead(200); res.end('{}'); });
    const gwPort = await listen(gw);
    const r = await probe.pushOtlpMetrics(`http://127.0.0.1:${gwPort}`, { resourceMetrics: [] }, { auth: 'bearer', gatewayToken: 'gw-token-1' });
    gw.close();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(seen.authorization, 'Bearer gw-token-1');
    assert.strictEqual(seen['x-sentinel-api-key'], undefined);
    const cfg = renderAgentConfig({ host, os: 'linux' });
    assert.deepStrictEqual(cfg.collector_config.exporters.otlphttp.headers, { Authorization: 'Bearer ${env:SENTINEL_GATEWAY_TOKEN}' });
    for (const f of ['collector-linux.yaml', 'collector-windows.yaml', 'collector-k8s.yaml']) {
      const c = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'agent', 'config', f), 'utf8'));
      assert.deepStrictEqual(c.exporters.otlphttp.headers, { Authorization: 'Bearer ${env:SENTINEL_GATEWAY_TOKEN}' }, f);
    }
    const values = fs.readFileSync(path.join(__dirname, '..', 'deployments', 'k8s', 'sentinel-agent', 'values.yaml'), 'utf8');
    assert.ok(!/snk_[A-Za-z0-9_]{8,}/.test(values), 'no key material in Helm values');
  });

  // ---------------------------------------------------------------- A2
  const collectorFile = path.join(tmp, 'collector.yaml');
  const resultsFile = path.join(tmp, 'osqueryd.results.log');
  const cfgFile = path.join(tmp, 'probe.json');
  fs.writeFileSync(path.join(tmp, 'ingest.key'), PROD_KEY + '\n');
  const shareDir = fs.mkdtempSync(path.join(tmp, 'share-'));
  fs.writeFileSync(cfgFile, JSON.stringify({
    sentinel_url: base,
    api_key_file: path.join(tmp, 'ingest.key'),
    host,
    os: 'linux',
    otlp_endpoint: base,
    otlp_auth: 'api_key',
    collector_config_path: collectorFile,
    osquery_results_path: resultsFile,
    state_file: path.join(tmp, 'state.json'),
    shares: [shareDir],
    localhost_targets: [
      { productId: 'cloudbees_jenkins', url: `http://127.0.0.1:${localPort}/slow` },
      { productId: 'cloudbees_jenkins', url: `http://127.0.0.1:${localPort}/down` }
    ]
  }));

  await ok('A2: --write-collector-config writes the served config; its hash is the served hash', async () => {
    const cfg = probe.loadProbeConfig(cfgFile, {});
    const runner = new probe.ProbeRunner(cfg, { log: () => {} });
    const code = await probe.writeCollectorConfig(runner, collectorFile);
    assert.strictEqual(code, 0);
    const served = renderAgentConfig({ host, os: 'linux', agentVersion: probe.AGENT_VERSION, env: 'prod' });
    assert.strictEqual(sha(fs.readFileSync(collectorFile)), served.config_hash);
    assert.strictEqual(runner.hostConfig.environment, 'prod');
  });

  let cycle;
  await ok('A2: one cycle measures localhost timing, reports errors, pushes and heartbeats', async () => {
    const cfg = probe.loadProbeConfig(cfgFile, {});
    const runner = new probe.ProbeRunner(cfg, { log: () => {} });
    cycle = await runner.runOnce();
    const metrics = cycle.payload.resourceMetrics.flatMap(rm => rm.scopeMetrics[0].metrics.map(m => ({
      name: m.name, value: m.gauge.dataPoints[0].asDouble,
      attrs: Object.fromEntries(m.gauge.dataPoints[0].attributes.map(a => [a.key, a.value.stringValue]))
    })));
    const slow = metrics.find(m => m.name === 'agent.localhost_ms' && m.attrs.url.endsWith('/slow'));
    assert.ok(slow && slow.value >= 110 && slow.value < 2000, `timing ${slow && slow.value}`);
    const up = metrics.filter(m => m.name === 'agent.localhost_up');
    assert.deepStrictEqual(up.map(m => m.value).sort(), [0, 1], 'slow=up, 503=down');
    for (const n of ['nas.stat_ms', 'nas.list_ms', 'nas.read_ms', 'nas.write_ms']) {
      assert.ok(metrics.some(m => m.name === n && m.attrs.share === shareDir), n);
    }
    assert.strictEqual(cycle.push.ok, true, JSON.stringify(cycle.push));
    assert.strictEqual(cycle.heartbeat.ok, true);
    // A 503 is a result, not a probe error. The only error is the manifest's NAS share,
    // which does not exist on this test machine (reported as nas.up = 0).
    assert.deepStrictEqual(cycle.errors.map(e => e.split(':')[0]), ['share /mnt/nfs/production_shares/cloudbees-jenkins'], cycle.errors.join('; '));
    assert.ok(metrics.some(m => m.name === 'nas.up' && m.value === 0 && m.attrs.share === '/mnt/nfs/production_shares/cloudbees-jenkins'));
    const ent = await inventory.getEntityById(`host:${host}`);
    assert.ok(ent, 'heartbeat registered the host');
    assert.strictEqual(ent.environment, 'prod', 'env from the key');
    assert.strictEqual(ent.labels.agent_version, probe.AGENT_VERSION);
    assert.strictEqual(ent.labels.os, 'linux');
    assert.strictEqual(ent.labels.config_hash, sha(fs.readFileSync(collectorFile)));
  });

  await ok('A2: error paths: unreachable target, SENTINEL down (keeps last config), bad key', async () => {
    const cfg = probe.loadProbeConfig(cfgFile, {});
    cfg.extraTargets = [{ productId: 'x', url: 'http://127.0.0.1:9/never' }];
    cfg.timeoutMs = 500;
    const runner = new probe.ProbeRunner(cfg, { log: () => {} });
    await runner.refreshConfig(true);
    const kept = runner.hostConfig;
    runner.cfg.sentinelUrl = 'http://127.0.0.1:9';
    runner.lastConfigPull = 0;
    const r = await runner.runOnce();
    assert.strictEqual(runner.hostConfig, kept, 'last good config kept');
    assert.ok(r.errors.some(e => /config pull failed/.test(e)));
    assert.ok(r.errors.some(e => /\/never/.test(e)), 'unreachable target reported');
    assert.ok(r.errors.some(e => /heartbeat failed/.test(e)));
    assert.strictEqual(r.heartbeat.ok, false);

    const bad = new probe.ProbeRunner({ ...probe.loadProbeConfig(cfgFile, {}), apiKey: 'snk_wrong' }, { log: () => {} });
    const hb = await bad.sendHeartbeat('HEALTHY');
    assert.strictEqual(hb.status, 401);
  });

  await ok('A2: CLI entry point parses flags; missing sentinel_url exits 2', async () => {
    assert.deepStrictEqual(probe.parseArgs(['--config', 'a.json', '--once']), { config: 'a.json', once: true, writeCollectorConfig: '', role: '' });
    assert.strictEqual(probe.parseArgs(['--write-collector-config', '/x', '--role', 'cluster']).role, 'cluster');
    const empty = path.join(tmp, 'empty.json');
    fs.writeFileSync(empty, '{}');
    const prev = process.env.SENTINEL_APP_URL;
    delete process.env.SENTINEL_APP_URL;
    const origErr = console.error; console.error = () => {};
    const code = await probe.main(['--config', empty]);
    console.error = origErr;
    if (prev !== undefined) process.env.SENTINEL_APP_URL = prev;
    assert.strictEqual(code, 2);
  });

  // ---------------------------------------------------------------- A3
  await ok('A3: Linux app host gets process + osquery filelog, probe targets and shares, no DB receiver', async () => {
    const c = renderAgentConfig({ host, os: 'linux', env: 'staging' });
    const rec = Object.keys(c.collector_config.receivers);
    assert.ok(rec.includes('hostmetrics') && rec.includes('process') && rec.includes('filelog/osquery'), rec.join());
    assert.ok(!rec.some(r => /^(postgresql|oracledb|sqlserver|kubeletstats|k8s_cluster|windowsperfcounters)/.test(r)), rec.join());
    assert.deepStrictEqual(c.apps.map(a => a.id), ['cloudbees_jenkins']);
    assert.ok(c.shares.length > 0);
    assert.ok(c.watch_paths.length > 0, 'watch paths served for the host');
    assert.deepStrictEqual(c.collector_config.service.pipelines.logs.receivers, ['filelog/osquery']);
  });

  await ok('A3: Windows DB host gets windowsperfcounters + its database receiver on loopback', async () => {
    const c = renderAgentConfig({ host: 'db-prod-jenkins.internal.corp', os: 'windows' });
    const rec = c.collector_config.receivers;
    assert.ok(rec.windowsperfcounters);
    const pg = Object.keys(rec).find(k => k.startsWith('postgresql/'));
    assert.ok(pg, Object.keys(rec).join());
    assert.strictEqual(rec[pg].endpoint, '127.0.0.1:5432');
    assert.deepStrictEqual(rec[pg].databases, ['jenkins_db']);
    assert.strictEqual(rec[pg].password, '${env:SENTINEL_DB_PG_PASSWORD}', 'credential from the host env, never inline');
    assert.ok(c.collector_config.service.pipelines.metrics.receivers.includes(pg));
    assert.strictEqual(rec['filelog/osquery'].include[0], 'C:/ProgramData/SentinelAgent/osquery/log/osqueryd.results.log');
    assert.ok(!rec.load && !rec.hostmetrics.scrapers.load, 'no load scraper on Windows');
    assert.deepStrictEqual(parseDatabase('jdbc:sqlserver://mssql-01.internal.corp:1433;databaseName=perf'), { engine: 'sqlserver', host: 'mssql-01.internal.corp', port: 1433, database: 'perf' });
    assert.deepStrictEqual(parseDatabase('jdbc:oracle:thin:@//ora-01.internal.corp:1521/ORCLPDB'), { engine: 'oracle', host: 'ora-01.internal.corp', port: 1521, database: 'ORCLPDB' });
  });

  await ok('A3: K8s node gets kubeletstats (no process/filelog); cluster role gets only k8s_cluster', async () => {
    const node = renderAgentConfig({ host: 'k8s-worker-17', os: 'kubernetes' });
    const nr = Object.keys(node.collector_config.receivers);
    assert.ok(nr.includes('kubeletstats') && nr.includes('hostmetrics'), nr.join());
    assert.ok(!nr.includes('process') && !nr.includes('filelog/osquery') && !nr.includes('k8s_cluster'), nr.join());
    assert.strictEqual(node.collector_config.receivers.hostmetrics.root_path, '/hostfs');
    const cluster = renderAgentConfig({ host: 'k8s-prod-cluster-01', os: 'kubernetes', role: 'cluster' });
    // The cluster role scrapes kube-state-metrics once per cluster (pod/deployment readiness) next to k8s_cluster.
    assert.deepStrictEqual(Object.keys(cluster.collector_config.receivers).sort(), ['k8s_cluster', 'otlp', 'prometheus/kube_state_metrics']);
    const ksm = cluster.collector_config.receivers['prometheus/kube_state_metrics'].config.scrape_configs[0];
    assert.ok(/kube_pod_status/.test(ksm.metric_relabel_configs[0].regex), 'only pod/deployment readiness series are kept');
    assert.ok(!nr.includes('prometheus/kube_state_metrics'), 'node agents never scrape kube-state-metrics');
    assert.ok(cluster.collector_config.service.pipelines.metrics.receivers.includes('prometheus/kube_state_metrics'));
    // NFS client stats: Linux hosts that mount shares only.
    const linuxShares = renderAgentConfig({ host, os: 'linux' });
    assert.ok(linuxShares.shares.length > 0, 'fixture host mounts a share');
    assert.ok(/node_mountstats_nfs/.test(linuxShares.collector_config.receivers['prometheus/node_nfs'].config.scrape_configs[0].metric_relabel_configs[0].regex));
    assert.ok(!renderAgentConfig({ host: 'a', os: 'linux' }).collector_config.receivers['prometheus/node_nfs'], 'no NFS scrape on a host with no shares');
    assert.strictEqual(cluster.role, 'cluster');
  });

  await ok('A3: OS comes from the request, not from the host name', async () => {
    // "node" in the name used to make this a Kubernetes host, "win" a Windows host.
    assert.strictEqual(renderAgentConfig({ host, os: 'linux' }).os, 'linux');
    assert.strictEqual(renderAgentConfig({ host: 'win-fortify-app-1.internal.corp' }).os, 'linux');
  });

  // ---------------------------------------------------------------- A4
  await ok('A4: exact host matching: host=a and prefixes match nothing', async () => {
    assert.strictEqual(renderAgentConfig({ host: 'a' }).apps.length, 0);
    assert.strictEqual(renderAgentConfig({ host: 'cloudbees-jenkins-node-0' }).apps.length, 0);
    assert.strictEqual(renderAgentConfig({ host: 'cloudbees' }).apps.length, 0);
    assert.strictEqual(renderAgentConfig({ host: 'cloudbees-jenkins-node-01.other.corp' }).apps.length, 0);
    assert.strictEqual(renderAgentConfig({ host: 'CLOUDBEES-JENKINS-NODE-01' }).apps.length, 1, 'short name');
    assert.strictEqual(sameHost('a.b.corp', 'a.c.corp'), false);
  });

  await ok('A4: GET /api/v2/agent/config takes the environment only from the key', async () => {
    const r = await fetch(`${base}/api/v2/agent/config?host=a&env=prod&environment=prod`, { headers: { 'X-Sentinel-Api-Key': STG_KEY } });
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.environment, 'staging');
    assert.deepStrictEqual(body.apps, []);
    assert.strictEqual((await fetch(`${base}/api/v2/agent/config?host=a`, { headers: { 'X-Sentinel-Api-Key': METRICS_ONLY_KEY } })).status, 401, 'scope agent required');
  });

  await ok('A4/S2: heartbeat ignores environment in the body', async () => {
    const r = await fetch(`${base}/api/v2/shipper/heartbeat?env=prod`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': STG_KEY },
      body: JSON.stringify({ host: `hb-${uid}`, environment: 'prod', agent_version: '2.4.0' })
    });
    assert.strictEqual(r.status, 200);
    const ent = await inventory.getEntityById(`host:hb-${uid}`);
    assert.strictEqual(ent.environment, 'staging');
  });

  // ---------------------------------------------------------------- A5
  await ok('A5: every product manifest has watch: paths and the committed packs are current', async () => {
    const dir = path.join(__dirname, '..', 'config', 'apps');
    for (const f of fs.readdirSync(dir).filter(f => !f.startsWith('_') && f.endsWith('.yaml'))) {
      const doc = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.ok(doc.watch && (doc.watch.linux || doc.watch.windows), `${f} has watch:`);
      assert.ok([...(doc.watch.linux || []), ...(doc.watch.windows || [])].length > 0, `${f} watches something`);
    }
    const packs = osqueryPack.buildPacks(osqueryPack.loadWatchPaths());
    for (const [name, content] of Object.entries(packs)) {
      const committed = fs.readFileSync(path.join(__dirname, '..', 'agent', 'osquery', 'packs', name), 'utf8').replace(/\r\n/g, '\n');
      assert.strictEqual(committed, content, `${name} is up to date (npm run agent:osquery-pack)`);
    }
    assert.deepStrictEqual(JSON.parse(packs['file-changes.conf']).file_paths.sonarqube, ['/opt/sonarqube/conf/%%', '/opt/sonarqube/extensions/plugins/%.jar']);
  });

  await ok('A5: osquery file events -> probe -> POST /api/v2/changes/events, stored with approval state', async () => {
    const lines = [
      { name: 'pack_file_changes_file_events', action: 'added', unixTime: 1760000000, columns: { target_path: '/var/lib/jenkins/config.xml', category: 'cloudbees_jenkins', action: 'UPDATED', sha256: 'ab'.repeat(32), uid: '0', time: '1760000000' } },
      { name: 'pack_file_changes_file_events', action: 'added', columns: { target_path: '/usr/bin/curl', category: 'system_binaries', action: 'UPDATED', sha256: 'cd'.repeat(32), time: '1760000001' } },
      { name: 'pack_sentinel_security_listening_ports', action: 'added', columns: { port: '22' } }
    ];
    fs.writeFileSync(resultsFile, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const cfg = probe.loadProbeConfig(cfgFile, {});
    const runner = new probe.ProbeRunner(cfg, { log: () => {} });
    await runner.refreshConfig(true);
    const r = await runner.forwardFileEvents();
    assert.deepStrictEqual(r, { ok: true, sent: 2 });
    const again = await runner.forwardFileEvents();
    assert.strictEqual(again.sent, 0, 'offset remembered');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'), 'utf8')).osqueryOffset, fs.statSync(resultsFile).size);

    const viaApi = await fetch(`${base}/api/v2/changes/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': PROD_KEY },
      body: JSON.stringify({ path: '/opt/sonarqube/conf/sonar.properties', productId: 'sonarqube', host: 'sonarqube-node-01.internal.corp', environment: 'staging' })
    });
    assert.strictEqual(viaApi.status, 201);
    const ev = (await viaApi.json()).event;
    assert.strictEqual(ev.environment, 'prod', 'environment from the key, body ignored');
    assert.strictEqual(typeof ev.is_approved, 'boolean');
    assert.strictEqual(ev.payload.is_approved, false, 'no change window -> unapproved');
    assert.strictEqual(ev.payload.user, null, 'nothing invented');
  });

  await ok('A5: change events with a session only (no ingest key) -> 401; wrong scope -> 401', async () => {
    const token = session.generateToken({ username: 'sre.lead', role: 'Super Admin', environment: 'prod' });
    const r = await fetch(`${base}/api/v2/changes/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: '/etc/passwd', host: 'h' })
    });
    assert.strictEqual(r.status, 401);
    const r2 = await fetch(`${base}/api/v2/changes/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': METRICS_ONLY_KEY },
      body: JSON.stringify({ path: '/etc/passwd', host: 'h' })
    });
    assert.strictEqual(r2.status, 401);
  });

  // ---------------------------------------------------------------- normalizer
  await ok('OTLP normalizer keeps DB receiver names and the database name attribute', async () => {
    const rows = normalizeOtlpPayload({ resourceMetrics: [{
      resource: { attributes: [{ key: 'host.name', value: { stringValue: 'db1' } }, { key: 'postgresql.database.name', value: { stringValue: 'jenkins_db' } }] },
      scopeMetrics: [{ metrics: [
        { name: 'postgresql.backends', sum: { dataPoints: [{ asInt: '7' }] } },
        { name: 'postgresql.db_size', sum: { dataPoints: [{ asInt: '5000000000' }] } },
        { name: 'system.cpu.load_average.1m', gauge: { dataPoints: [{ asDouble: 0.5 }] } }
      ] }]
    }] });
    assert.strictEqual(rows[0].metricName, 'postgresql.backends');
    assert.strictEqual(rows[0].value, 7);
    assert.deepStrictEqual(rows[0].attributes, { 'postgresql.database.name': 'jenkins_db' });
    assert.strictEqual(rows[1].value, 5000000000, 'not rescaled to MB');
    assert.strictEqual(rows[2].metricName, 'system_cpu_load_average_1m', 'other names unchanged');
  });

  console.log('\n=== PHASE A AGENT TESTS PASSED ===');
  fs.rmSync(tmp, { recursive: true, force: true });
  closers.forEach(c => c());
  process.exit(0);
})().catch(err => {
  console.error('\n✖ PHASE A AGENT TEST FAILED:', err && err.stack || err);
  closers.forEach(c => { try { c(); } catch (_) {} });
  process.exit(1);
});
