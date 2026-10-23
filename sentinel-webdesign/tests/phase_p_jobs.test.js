/**
 * tests/phase_p_jobs.test.js
 *
 * Phase P acceptance: every background job is exercised through its job entry
 * point (not through the helper it calls), against local fakes:
 *  - P1 VIP probes → a local HTTPS "VIP" → /api/avi/overview shows its timings
 *  - P2 AVI overhead from fixed fake-ClickHouse rows (literal expected value)
 *  - P3 baseline rollup SQL sent to fake ClickHouse, persisted, loaded, used by scoring
 *  - P4 change-point scan writes change_points once and links a version change
 *  - P5 one test per rule type through the job, maintenance-window suppression, auto-resolve
 *  - P6 problem grouping with no Postgres pool and with a fake pool
 *  - P7 one problem → exactly one Teams payload; resolve → one more
 *  - P8 weekly scorecard: injected clock, numbers from fake ClickHouse, null without data
 *  - P9 CVE scan: fixture SBOM through a fake Trivy, findings written to cve_findings
 *  - P10 silent agent (one deduplicated alert, resolves) and config drift
 *  - /api/v2/jobs/status lists P1–P10 with a last successful run after start-up
 */

process.env.SENTINEL_JOBS_QUIET = 'true';
process.env.SENTINEL_JOBS_TICK_MS = '600000';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { startFakeClickHouse } = require('./helpers/fake_clickhouse');
const { getTestTlsCredentials } = require('./helpers/tls');

const yamlConfig = require('../backend/config/yaml_config');
const { app } = require('../backend/server');
const db = require('../database/db');
const inventory = require('@sentinel/inventory');
const baselines = require('../ai_analysis/baselines');
const changeRoutes = require('../backend/routes/changeRoutes');
const problemStore = require('../correlation/problem_store');
const jobs = require('../backend/jobs');
const { runVipProbes } = require('../backend/jobs/vip_probes');
const { runAviOverhead } = require('../backend/jobs/avi_overhead');
const { runChangePointScan } = require('../backend/jobs/change_points');
const { runAlertRules } = require('../backend/jobs/alert_rules');
const { runProblemGrouping } = require('../backend/jobs/problem_grouping');
const { runWeeklyScorecards, isScorecardDue } = require('../backend/jobs/scorecard_weekly');
const { runCveScan } = require('../backend/jobs/cve_scan');
const { runFleetHealth } = require('../backend/jobs/fleet_health');
const { renderAgentConfig } = require('../backend/routes/agentRoutes');

const uid = Date.now().toString(36);
const closers = [];

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

/** Small in-memory stand-in for the pg pool used by correlation/problem_store. */
function fakeProblemPool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (/^\s*INSERT INTO problem/i.test(sql)) {
        const [id, title, environment, status, severity, top_layer, confidence, suspect_entity, alert_count, evidence_pack, created_at, updated_at] = params;
        const prev = rows.get(id);
        rows.set(id, { id, title, environment, status, severity, top_layer, confidence, suspect_entity, alert_count, evidence_pack, created_at: prev ? prev.created_at : created_at, updated_at });
        return { rows: [] };
      }
      if (/SELECT \* FROM problem WHERE id = \$1/i.test(sql)) {
        return { rows: rows.has(params[0]) ? [rows.get(params[0])] : [] };
      }
      if (/SELECT \* FROM problem WHERE environment = \$1/i.test(sql)) {
        const env = params[0];
        const status = params.length === 3 ? params[1] : null;
        return { rows: [...rows.values()].filter(r => r.environment === env && (!status || r.status === status)) };
      }
      throw new Error('unexpected SQL in fake pool: ' + sql);
    }
  };
}

async function run() {
  console.log('=== RUNNING PHASE P: SCHEDULED JOBS TESTS ===');
  const appServer = http.createServer(app);
  const appPort = await listen(appServer);
  closers.push(() => { appServer.closeAllConnections(); appServer.close(); });
  const base = `http://127.0.0.1:${appPort}`;

  // ---------------------------------------------------------------- P1
  const { key, cert } = getTestTlsCredentials();
  const vipServer = https.createServer({ key, cert }, (req, res) => { res.writeHead(200); res.end('ok'); });
  const vipPort = await listen(vipServer);
  closers.push(() => { vipServer.closeAllConnections(); vipServer.close(); });
  const realLoadApps = yamlConfig.loadAllApplications;
  yamlConfig.loadAllApplications = () => ({
    [`vipapp${uid}`]: { id: `vipapp${uid}`, name: 'VIP test app', enabled: true, layers: { vip: `https://127.0.0.1:${vipPort}/health` } }
  });
  const p1 = await runVipProbes({ environments: ['staging'] });
  assert.strictEqual(p1.staging.vips, 1);
  const avi = await (await fetch(`${base}/api/avi/overview?environment=staging`)).json();
  const row = (avi.timingBreakdown || []).find(t => t.url === `https://127.0.0.1:${vipPort}/health`);
  assert.ok(row, 'AVI view shows the probed VIP');
  assert.ok(row.total_ms > 0 && row.tls_ms > 0, 'VIP timings recorded');
  console.log('✔ P1: VIP probe job filled the AVI view with real timings.');

  // ---------------------------------------------------------------- fake ClickHouse for P2–P4, P8
  let responder = () => [];
  const ch = await startFakeClickHouse((sql, e) => responder(sql, e));
  closers.push(() => ch.close());
  process.env.CLICKHOUSE_URL = ch.url;
  process.env.CLICKHOUSE_DATABASE = 'sentinel';

  // ---------------------------------------------------------------- P2
  const minute = Date.UTC(2026, 9, 12, 9, 0, 0);
  responder = (sql) => (sql.includes("avgIf(value, metric_name = 'vip.total_ms')")
    ? [{ component: 'artifactory', minute_ms: minute, vip_ms: 240, local_ms: 8, n_vip: 2, n_local: 2 }]
    : []);
  const captured = [];
  const fakeStore = { addMetricBatch: (b) => captured.push(...b) };
  await runAviOverhead({ environments: ['staging'], store: fakeStore, nowMs: minute + 120000 });
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].metricName, 'avi.overhead_ms');
  assert.strictEqual(captured[0].value, 232);
  assert.strictEqual(captured[0].component, 'artifactory');
  await runAviOverhead({ environments: ['staging'], store: fakeStore, nowMs: minute + 120000 });
  assert.strictEqual(captured.length, 1, 'same minute is not written twice');
  console.log('✔ P2: avi.overhead_ms = 232 from fixed rows (240 − 8), written once.');

  // ---------------------------------------------------------------- P3
  responder = (sql) => {
    if (sql.includes('quantile(0.5)(abs(p.value - m.median))')) {
      return [{ env: 'staging', entity_id: 'app:p3prod', metric_name: 'journey.step.duration_ms', hour_of_week: 10, median: 120, mad: 6, sample_count: 40 }];
    }
    if (sql.includes('FROM baselines FINAL')) {
      return [{ env: 'staging', entity_id: 'app:p3loaded', metric_name: 'vip.total_ms', hour_of_week: 11, median: 300, mad: 10, sample_count: 50 }];
    }
    return [];
  };
  const before = ch.requests.length;
  const p3 = await baselines.computeBaselinesFromClickHouse(28, { nowMs: Date.UTC(2026, 9, 12), skipLeaderCheck: true });
  assert.strictEqual(p3.status, 'SUCCESS');
  const p3Reqs = ch.requests.slice(before);
  const rollup = p3Reqs.find(r => r.sql.includes('INNER JOIN'));
  assert.ok(rollup, 'rollup query sent');
  assert.ok(rollup.sql.includes('(toDayOfWeek(ts) % 7) * 24 + toHour(ts)'), 'Sunday-0 hour-of-week convention in SQL');
  assert.ok(!rollup.sql.includes('{db}'), 'no literal {db}');
  const insert = p3Reqs.find(r => r.sql.startsWith('INSERT INTO baselines'));
  assert.ok(insert && insert.body.includes('"median":120'), 'baselines persisted');
  // Sunday 10:00 UTC = hour-of-week 10 in JS and SQL
  const sunday10 = new Date(Date.UTC(2026, 9, 11, 10, 0, 0));
  assert.strictEqual(baselines.getHourOfWeek(sunday10), 10);
  const score = baselines.scoreObservation({ env: 'staging', entityId: 'app:p3prod', metricName: 'journey.step.duration_ms', value: 400, timestamp: sunday10, consecutiveN: 1 });
  assert.ok(score.evaluated && score.isAnomaly, 'scoring uses the rolled-up baseline');
  const loaded = await baselines.loadBaselinesFromClickHouse();
  assert.strictEqual(loaded.loaded, 1);
  assert.ok(baselines.getBaseline('staging', 'app:p3loaded', 'vip.total_ms', new Date(Date.UTC(2026, 9, 11, 11))), 'persisted baseline loaded on start');
  console.log('✔ P3: two-step MAD SQL, persisted to baselines, loaded and used for scoring.');

  // ---------------------------------------------------------------- P4
  const t0 = Date.UTC(2026, 9, 12, 0, 0, 0);
  const seriesRows = [];
  for (let i = 0; i < 24; i++) {
    seriesRows.push({ component: 'jenkins', series: 'journey.step.p95:build:compile', bucket_ms: t0 + i * 900000, p95: i < 12 ? 100 : 160 });
  }
  responder = (sql) => (sql.includes("concat('journey.step.p95:'") ? seriesRows : []);
  const changeTs = new Date(t0 + 12 * 900000).toISOString();
  const fakeEvents = { getEvents: async () => [{ kind: 'version_change', entity_id: 'app:jenkins', ts: changeTs, title: 'Jenkins 2.440 -> 2.452' }] };
  const beforeP4 = ch.requests.length;
  const p4 = await runChangePointScan({ environments: ['staging'], events: fakeEvents, nowMs: t0 + 24 * 900000 });
  assert.strictEqual(p4.staging.change_points, 1);
  const cpInsert = ch.requests.slice(beforeP4).find(r => r.sql.includes('INSERT INTO sentinel.change_points'));
  assert.ok(cpInsert, 'change point written with the configured database name');
  assert.strictEqual(cpInsert.params.param_direction, 'worsened');
  const p4again = await runChangePointScan({ environments: ['staging'], events: fakeEvents, nowMs: t0 + 24 * 900000 });
  assert.strictEqual(p4again.staging.change_points, 0, 'same change point not recorded twice');
  console.log('✔ P4: change point detected, written to sentinel.change_points once.');

  // ---------------------------------------------------------------- P8 (fake ClickHouse still on)
  assert.strictEqual(isScorecardDue(new Date(2026, 9, 11, 23, 0).getTime(), null), false, 'Sunday: not due');
  assert.strictEqual(isScorecardDue(new Date(2026, 9, 12, 5, 59).getTime(), null), false, 'Monday 05:59: not due');
  assert.strictEqual(isScorecardDue(new Date(2026, 9, 12, 6, 0).getTime(), null), true, 'Monday 06:00: due');
  assert.strictEqual(isScorecardDue(new Date(2026, 9, 13, 9, 0).getTime(), '2026-10-12'), false, 'already done this week');
  responder = (sql, e) => {
    if (sql.includes("metric_name = 'journey.success'")) return [{ total: 200, success: 198 }];
    if (sql.includes('quantile(0.95)(value)') && e.params.param_weekAgo && !e.params.param_twoWeeksAgo) return [{ p95: 250 }];
    if (sql.includes('quantile(0.95)(value)') && e.params.param_twoWeeksAgo) return [{ p95: 200 }];
    if (sql.includes('FROM change_points')) return [{ cnt: 2 }];
    if (sql.includes('FROM cve_findings')) return [{ cnt: 3 }];
    return [];
  };
  const p8Now = new Date(2026, 9, 12, 6, 5).getTime();
  const problemSource = { list: async () => [
    { created_at: new Date(p8Now - 86400000).toISOString(), top_layer: 'storage', suspect_entity: 'app:p8prod', evidence_pack: { alerts: [] } },
    { created_at: new Date(p8Now - 86400000).toISOString(), top_layer: 'storage', suspect_entity: 'app:p8prod', evidence_pack: { alerts: [] } },
    { created_at: new Date(p8Now - 86400000).toISOString(), top_layer: 'network/AVI', suspect_entity: 'app:p8prod', evidence_pack: { alerts: [] } }
  ] };
  const scorecard = require('../ai_analysis/scorecard');
  const sent = [];
  const fakeNotifier = { sendScorecardSummary: async (cards, o) => { sent.push({ cards, o }); return { status: 'DELIVERED' }; } };
  const p8 = await runWeeklyScorecards({
    environments: ['staging'],
    nowMs: p8Now,
    products: [{ id: 'p8prod', name: 'P8 Product' }],
    compute: (args) => scorecard.computeScorecardFromData({ ...args, problemSource }),
    notifier: fakeNotifier
  });
  assert.strictEqual(p8.week_start, '2026-10-12');
  const card = sent[0].cards[0];
  assert.strictEqual(card.availability_pct, 99);
  assert.strictEqual(card.p95_ms, 250);
  assert.strictEqual(card.p95_change_pct, 25);
  assert.strictEqual(card.change_points_count, 2);
  assert.strictEqual(card.open_cves_count, 3);
  assert.strictEqual(card.top_cause, 'storage');
  assert.strictEqual(sent.length, 1, 'one Teams summary per environment');

  // ---------------------------------------------------------------- ClickHouse off from here
  process.env.CLICKHOUSE_URL = '';
  const empty = await scorecard.computeScorecardFromData({ productId: 'p8none', environment: 'staging', nowMs: p8Now, problemSource: { list: async () => [] } });
  assert.strictEqual(empty.availability_pct, null);
  assert.strictEqual(empty.p95_ms, null);
  assert.strictEqual(empty.change_points_count, null);
  assert.strictEqual(empty.open_cves_count, null);
  assert.strictEqual(empty.top_cause, null);
  console.log('✔ P8: Monday 06:00 schedule; 99% / 250 ms (+25%) / 2 / 3 / storage from data; all null without data.');

  // ---------------------------------------------------------------- P5
  const now5 = Date.now();
  const thr = `p5thr${uid}`, comp = `p5comp${uid}`, bl = `p5bl${uid}`, abs = `p5abs${uid}`, maint = `p5maint${uid}`;
  db.addMetricBatch([
    { component: thr, metricName: 'p5.cpu', value: 95, timestamp: new Date(now5 - 10000).toISOString(), source: 'probe' },
    { component: comp, metricName: 'p5.vip', value: 900, timestamp: new Date(now5 - 10000).toISOString(), source: 'probe' },
    { component: comp, metricName: 'p5.local', value: 5, timestamp: new Date(now5 - 10000).toISOString(), source: 'probe' },
    { component: abs, metricName: 'p5.absent', value: 1, timestamp: new Date(now5 - 600000).toISOString(), source: 'probe' },
    { component: maint, metricName: 'p5.cpu', value: 99, timestamp: new Date(now5 - 10000).toISOString(), source: 'probe' }
  ], 'staging');
  const hourNow = baselines.getHourOfWeek(new Date(now5));
  baselines.setBaseline('staging', `app:${bl}`, 'p5.lat', hourNow, 100, 5, 30);
  const realWindow = changeRoutes.isWithinChangeWindow;
  changeRoutes.isWithinChangeWindow = async ({ productId }) => (productId === maint ? { approved: true, window: { id: 'CW-TEST' } } : { approved: false });
  const fakeRunner = {
    history: new Map([[`p5app${uid}`, [
      { journeyId: 'j1', success: false, env: 'staging' },
      { journeyId: 'j1', success: false, env: 'staging' },
      { journeyId: 'j1', success: true, env: 'staging' }
    ]]]),
    getJourneyRuns(appId, { env }) { return (this.history.get(appId) || []).filter(r => r.env === env); }
  };
  const rules = [
    { id: `thr_${uid}`, name: 'CPU high', type: 'threshold', metric: 'p5.cpu', operator: '>', threshold: 90, severity: 'Critical' },
    { id: `cmp_${uid}`, name: 'VIP slow, local fast', type: 'composite', operator: 'AND', conditions: [{ metric: 'p5.vip', operator: '>', threshold: 500 }, { metric: 'p5.local', operator: '<', threshold: 25 }], severity: 'Warning' },
    { id: `bl_${uid}`, name: 'Latency anomaly', type: 'baseline', metric: 'p5.lat', z_threshold: 3, consecutive_points: 2, severity: 'Warning' },
    { id: `abs_${uid}`, name: 'Metric absent', type: 'absence', metric: 'p5.absent', absence_seconds: 300, severity: 'Warning' },
    { id: `jf_${uid}`, name: 'Journey failing', type: 'journey_failure', consecutive_failures: 2, severity: 'Critical' }
  ];
  const ruleAlert = (ruleId, component) => db.getAlerts('staging').find(a => a.rule_id === ruleId && a.component === component && a.status === 'Active');

  for (let i = 0; i < 2; i++) {
    db.addMetricBatch([{ component: bl, metricName: 'p5.lat', value: 300, timestamp: new Date(now5 - 5000 + i).toISOString(), source: 'probe' }], 'staging');
    await runAlertRules({ environments: ['staging'], rules, runner: fakeRunner, nowMs: now5 });
  }
  assert.ok(ruleAlert(`thr_${uid}`, thr), 'threshold rule opened an alert');
  assert.ok(ruleAlert(`cmp_${uid}`, comp), 'composite rule opened an alert');
  assert.ok(ruleAlert(`bl_${uid}`, bl), 'baseline rule opened an alert after 2 consecutive violations');
  assert.ok(ruleAlert(`abs_${uid}`, abs), 'absence rule opened an alert');
  assert.ok(ruleAlert(`jf_${uid}`, `p5app${uid}`), 'journey_failure rule opened an alert');
  assert.ok(!ruleAlert(`thr_${uid}`, maint), 'firing inside a change window is suppressed');
  const thrAlert = ruleAlert(`thr_${uid}`, thr);
  assert.strictEqual(thrAlert.count, 2, 'repeated firing updates the same alert');

  // CPU recovers: a later run with only a low value in the window resolves the alert.
  const later = now5 + 180000;
  db.addMetricBatch([{ component: thr, metricName: 'p5.cpu', value: 20, timestamp: new Date(later - 5000).toISOString(), source: 'probe' }], 'staging');
  await runAlertRules({ environments: ['staging'], rules: [rules[0]], runner: fakeRunner, nowMs: later });
  assert.strictEqual(thrAlert.status, 'Resolved', 'alert resolved when the rule stops firing');
  changeRoutes.isWithinChangeWindow = realWindow;
  console.log('✔ P5: threshold, composite, baseline, absence and journey_failure fire through the job; change window suppresses; recovery resolves.');

  // ---------------------------------------------------------------- P6 + P7
  let teamsPayloads = [];
  const teamsServer = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => { teamsPayloads.push(JSON.parse(b)); res.writeHead(200); res.end('1'); });
  });
  const teamsPort = await listen(teamsServer);
  closers.push(() => { teamsServer.closeAllConnections(); teamsServer.close(); });
  process.env.SENTINEL_TEAMS_WEBHOOK_URL = `http://127.0.0.1:${teamsPort}/hook`;

  for (const mode of ['no-pool', 'fake-pool']) {
    const pool = mode === 'no-pool' ? null : fakeProblemPool();
    problemStore.setPool(pool);
    // Absorb alerts left by earlier sections, so this pass only sees the test alert.
    await runProblemGrouping({ environments: ['staging'], runner: null });
    teamsPayloads = [];
    const c6 = `p6${mode.replace('-', '')}${uid}`;
    const a6 = db.addAlert(c6, 'Critical', `[test] ${c6} latency`, 'Active', 'staging');
    const r1 = await runProblemGrouping({ environments: ['staging'], runner: null });
    assert.strictEqual(r1.staging.new_problems, 1, `${mode}: one problem`);
    assert.ok(a6.problem_id, `${mode}: alert linked to its problem`);
    const stored = await problemStore.get(a6.problem_id);
    assert.ok(stored && stored.status === 'OPEN', `${mode}: problem readable from the store`);
    if (pool) assert.ok(pool.rows.has(a6.problem_id), 'fake-pool: problem written to Postgres');
    const r2 = await runProblemGrouping({ environments: ['staging'], runner: null });
    assert.strictEqual(r2.staging.new_problems, 0, `${mode}: no duplicate problem`);
    assert.strictEqual(teamsPayloads.length, 1, `${mode}: exactly one Teams payload for one problem`);
    // Second alert on the same component joins the open problem.
    const a6b = db.addAlert(c6, 'Warning', `[test] ${c6} errors`, 'Active', 'staging');
    await runProblemGrouping({ environments: ['staging'], runner: null });
    assert.strictEqual(a6b.problem_id, a6.problem_id, `${mode}: new alert joins the open problem`);
    // Resolve both alerts → problem resolved → one resolve message.
    a6.status = 'Resolved';
    a6b.status = 'Resolved';
    const r3 = await runProblemGrouping({ environments: ['staging'], runner: null });
    assert.strictEqual(r3.staging.resolved, 1, `${mode}: problem resolved`);
    assert.strictEqual((await problemStore.get(a6.problem_id)).status, 'RESOLVED');
    assert.strictEqual(teamsPayloads.length, 2, `${mode}: one resolve payload`);
    assert.ok(teamsPayloads[1].title.includes('Resolved'));
  }
  problemStore.setPool(undefined);
  delete process.env.SENTINEL_TEAMS_WEBHOOK_URL;
  console.log('✔ P6/P7: problems stored (memory and fake Postgres), alerts linked, one Teams message on open and on resolve.');

  // ---------------------------------------------------------------- P9
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-p9-'));
  const sbomDir = path.join(tmp, 'sbom');
  fs.mkdirSync(path.join(sbomDir, 'staging', 'bitbucket'), { recursive: true });
  fs.writeFileSync(path.join(sbomDir, 'staging', 'bitbucket', 'bb-node-01.cdx.json'), JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'openssl', version: '1.1.1k' }] }));
  const fakeTrivy = path.join(tmp, 'fake_trivy.js');
  fs.writeFileSync(fakeTrivy, `const args = process.argv.slice(2);
if (args[0] !== 'sbom' || !args.includes('--offline-scan')) { console.error('bad args'); process.exit(2); }
process.stdout.write(JSON.stringify({ Results: [{ Target: args[args.length - 1], Vulnerabilities: [
  { VulnerabilityID: 'CVE-2099-0001', PkgName: 'openssl', InstalledVersion: '1.1.1k', Severity: 'CRITICAL', FixedVersion: '1.1.1l' },
  { VulnerabilityID: 'CVE-2099-0002', PkgName: 'openssl', InstalledVersion: '1.1.1k', Severity: 'HIGH' }
] }] }));`);
  const inserted = [];
  const ch9 = await startFakeClickHouse((sql, e) => { if (sql.startsWith('INSERT INTO cve_findings')) inserted.push(...e.body.trim().split('\n').map(l => JSON.parse(l))); return []; });
  closers.push(() => ch9.close());
  const runViaNode = (file, args, opts) => new Promise((resolve, reject) => {
    execFile(process.execPath, [fakeTrivy, ...args], opts, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
  const inert = await runCveScan({ environments: ['staging'], settings: { mirror_path: '' } });
  assert.ok(inert.skipped, 'blank mirror path = inert');
  process.env.CLICKHOUSE_URL = ch9.url;
  const p9 = await runCveScan({ environments: ['staging'], settings: { mirror_path: path.join(tmp, 'db'), sbom_dir: sbomDir, trivy_path: 'trivy' }, run: runViaNode });
  process.env.CLICKHOUSE_URL = '';
  assert.strictEqual(p9.sboms, 1);
  assert.strictEqual(p9.critical, 1);
  assert.strictEqual(p9.high, 1);
  assert.strictEqual(inserted.length, 2);
  assert.strictEqual(inserted[0].host, 'bb-node-01');
  assert.strictEqual(inserted[0].product_id, 'bitbucket');
  assert.strictEqual(inserted[0].severity, 'CRITICAL');
  assert.strictEqual(inserted[1].severity, 'HIGH');
  console.log('✔ P9: fixture SBOM scanned through Trivy (offline args), 2 findings written to cve_findings.');

  // ---------------------------------------------------------------- P10
  const silent = `p10silent${uid}`, healthy = `p10ok${uid}`, drift = `p10drift${uid}`;
  const goodHash = renderAgentConfig({ host: healthy, os: 'linux', agentVersion: '1.0.0', env: 'staging' }).config_hash;
  await inventory.upsertEntity({ entity_id: `host:${silent}`, kind: 'host', name: silent, environment: 'staging', labels: { last_heartbeat: new Date(Date.now() - 6 * 60000).toISOString() } });
  await inventory.upsertEntity({ entity_id: `host:${healthy}`, kind: 'host', name: healthy, environment: 'staging', labels: { last_heartbeat: new Date().toISOString(), os: 'linux', agent_version: '1.0.0', config_hash: goodHash } });
  await inventory.upsertEntity({ entity_id: `host:${drift}`, kind: 'host', name: drift, environment: 'staging', labels: { last_heartbeat: new Date().toISOString(), os: 'linux', agent_version: '1.0.0', config_hash: 'deadbeef'.repeat(8) } });
  await runFleetHealth({ environments: ['staging'] });
  await runFleetHealth({ environments: ['staging'] });
  const silentAlerts = db.getAlerts('staging').filter(a => a.component === silent && a.rule_id === 'fleet_silent_agent' && a.status === 'Active');
  assert.strictEqual(silentAlerts.length, 1, 'one deduplicated silent-agent alert');
  assert.strictEqual(silentAlerts[0].count, 2);
  assert.ok(db.getAlerts('staging').some(a => a.component === drift && a.rule_id === 'fleet_config_drift' && a.status === 'Active'), 'drift alert');
  assert.ok(!db.getAlerts('staging').some(a => a.component === healthy && a.status === 'Active'), 'healthy host: no alert');
  assert.strictEqual((await inventory.getEntityById(`host:${drift}`)).labels.config_drift, true);
  await inventory.upsertEntity({ entity_id: `host:${silent}`, kind: 'host', name: silent, environment: 'staging', labels: { last_heartbeat: new Date().toISOString() } });
  await runFleetHealth({ environments: ['staging'] });
  assert.strictEqual(silentAlerts[0].status, 'Resolved', 'silent alert resolves when heartbeats return');
  console.log('✔ P10: silent agent → one alert, resolved on heartbeat; config drift detected against the served config.');

  // ---------------------------------------------------------------- start-up: /api/v2/jobs/status
  yamlConfig.loadAllApplications = () => ({});
  const sched = jobs.startJobs();
  // Let the first tick finish (it runs every due job once).
  for (let i = 0; i < 100; i++) {
    const st = sched.getStatus();
    if (st.jobs.every(j => j.last_finish_at)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const status = await (await fetch(`${base}/api/v2/jobs/status`)).json();
  const tasks = status.jobs.map(j => j.task).join(',');
  for (const t of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6/P7', 'P8', 'P9', 'P10']) {
    assert.ok(tasks.includes(t), `jobs status lists ${t}`);
  }
  const notRun = status.jobs.filter(j => j.name !== 'weekly_scorecard' && !j.last_success_at);
  assert.deepStrictEqual(notRun.map(j => `${j.name}: ${j.last_error}`), [], 'every interval job has a last successful run');
  jobs.stopJobs();
  yamlConfig.loadAllApplications = realLoadApps;
  console.log(`✔ Jobs status: ${status.jobs.length} jobs listed, all interval jobs ran successfully at start-up.`);

  console.log('=== PHASE P JOBS TESTS PASSED ===');
}

run()
  .then(async () => { for (const c of closers) { try { await c(); } catch (_) {} } process.exit(0); })
  .catch(async (err) => {
    console.error('✘ Phase P test failed:', err);
    for (const c of closers) { try { await c(); } catch (_) {} }
    process.exit(1);
  });
