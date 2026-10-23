/**
 * tests/e2e_replay_degradation.test.js
 *
 * "Done when" replay: a staging degradation of one fake product, end to end through the
 * real jobs. The product's VIP (a local HTTPS server) becomes slow while the agent on the
 * product host still sees a fast localhost backend. Expected:
 *   P1 VIP probe       -> vip.* metrics for the product
 *   agent OTLP push    -> agent.localhost_ms through /v1/metrics
 *   P5 alert rules     -> exactly one alert (shipped rule rule_composite_avi_path_bottleneck)
 *   P6 grouping        -> exactly one problem, diagnosed layer AVI/path
 *   P7 Teams           -> exactly one payload
 *   evidence pack      -> only this replay's data (an unrelated alert is not in it)
 */
'use strict';

const assert = require('assert');
const http = require('http');
const https = require('https');
const { getTestTlsCredentials } = require('./helpers/tls');

process.env.CLICKHOUSE_URL = '';
const yamlConfig = require('../backend/config/yaml_config');
const { app } = require('../backend/server');
const db = require('../database/db');
const problemStore = require('../correlation/problem_store');
const alertEngine = require('../ai_analysis/alert_engine');
const changeRoutes = require('../backend/routes/changeRoutes');
const { runVipProbes } = require('../backend/jobs/vip_probes');
const { runAlertRules } = require('../backend/jobs/alert_rules');
const { runProblemGrouping } = require('../backend/jobs/problem_grouping');

const uid = Date.now().toString(36);
const PRODUCT = `replay${uid}`;
const NOISE = `noise${uid}`;
const VIP_DELAY_MS = 700;
const closers = [];

const listen = (server) => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

function otlpGauge(appId, metricName, value, tsMs) {
  return {
    resourceMetrics: [{
      resource: { attributes: [
        { key: 'application.id', value: { stringValue: appId } },
        { key: 'service.name', value: { stringValue: appId } },
        { key: 'deployment.environment', value: { stringValue: 'staging' } }
      ] },
      scopeMetrics: [{ metrics: [{ name: metricName, unit: 'ms', gauge: { dataPoints: [{ timeUnixNano: String(tsMs * 1e6), asDouble: value }] } }] }]
    }]
  };
}

async function run() {
  console.log('=== E2E: REPLAYED STAGING DEGRADATION ===');
  const appServer = http.createServer(app);
  const base = `http://127.0.0.1:${await listen(appServer)}`;
  closers.push(() => { appServer.closeAllConnections(); appServer.close(); });

  // Fake product VIP: slow through "AVI".
  const { key, cert } = getTestTlsCredentials();
  const vip = https.createServer({ key, cert }, (req, res) => setTimeout(() => { res.writeHead(200); res.end('ok'); }, VIP_DELAY_MS));
  const vipUrl = `https://127.0.0.1:${await listen(vip)}/health`;
  closers.push(() => { vip.closeAllConnections(); vip.close(); });

  // Fake Teams webhook.
  const teams = [];
  const teamsServer = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => { teams.push(JSON.parse(b)); res.writeHead(200); res.end('1'); });
  });
  process.env.SENTINEL_TEAMS_WEBHOOK_URL = `http://127.0.0.1:${await listen(teamsServer)}/hook`;
  closers.push(() => { teamsServer.closeAllConnections(); teamsServer.close(); });

  const realLoadApps = yamlConfig.loadAllApplications;
  yamlConfig.loadAllApplications = () => ({ [PRODUCT]: { id: PRODUCT, name: 'Replay product', enabled: true, layers: { vip: vipUrl } } });
  const realWindow = changeRoutes.isWithinChangeWindow;
  changeRoutes.isWithinChangeWindow = async () => ({ approved: false });
  problemStore.setPool(null);

  try {
    // Unrelated activity that must not leak into this replay's evidence.
    db.addAlert(NOISE, 'Warning', `[test] ${NOISE} unrelated`, 'Active', 'staging');
    await runProblemGrouping({ environments: ['staging'], runner: null });
    teams.length = 0;

    // 1. P1 probes the slow VIP.
    const p1 = await runVipProbes({ environments: ['staging'] });
    assert.strictEqual(p1.staging.vips, 1, 'one VIP probed');
    const now = Date.now();
    const vipPoints = await db.queryMetrics({ metricName: 'vip.total_ms', env: 'staging', sinceMs: now - 60000, untilMs: now + 1000, limit: 100 });
    const ours = (vipPoints || []).filter(p => p.component === PRODUCT);
    assert.ok(ours.length >= 1 && ours[0].value >= VIP_DELAY_MS - 50, `VIP metric recorded (${ours.map(p => p.value)})`);
    console.log(`✔ P1: vip.total_ms = ${Math.round(ours[0].value)} ms for ${PRODUCT}`);

    // 2. The agent reports a fast localhost backend through the real OTLP endpoint.
    const ingest = await fetch(`${base}/v1/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(otlpGauge(PRODUCT, 'agent.localhost_ms', 9, now))
    });
    assert.ok(ingest.status >= 200 && ingest.status < 300, `OTLP accepted (${ingest.status})`);
    await new Promise(r => setTimeout(r, 200));
    const local = await db.queryMetrics({ metricName: 'agent.localhost_ms', env: 'staging', sinceMs: now - 60000, untilMs: now + 60000, limit: 100 });
    assert.ok((local || []).some(p => p.component === PRODUCT && p.value === 9), 'agent.localhost_ms stored for the product');

    // 3. P5 with the shipped composite rule.
    const shipped = alertEngine.loadRules().filter(r => r.id === 'rule_composite_avi_path_bottleneck');
    assert.strictEqual(shipped.length, 1, 'shipped AVI path rule present in config/alerts');
    await runAlertRules({ environments: ['staging'], rules: shipped, runner: null, nowMs: Date.now() });
    const alerts = db.getAlerts('staging').filter(a => a.component === PRODUCT && a.status === 'Active');
    assert.strictEqual(alerts.length, 1, `exactly one alert (${alerts.length})`);
    console.log(`✔ P5: one alert "${alerts[0].message || alerts[0].title || alerts[0].rule_id}"`);

    // 4. P6/P7: one problem, layer diagnosed, one Teams payload.
    const g = await runProblemGrouping({ environments: ['staging'], runner: null });
    assert.strictEqual(g.staging.new_problems, 1, 'exactly one problem');
    const problem = await problemStore.get(alerts[0].problem_id);
    assert.ok(problem, 'problem stored');
    assert.strictEqual(problem.top_layer, 'AVI/path', `diagnosed layer AVI/path (got ${problem.top_layer})`);
    assert.strictEqual(teams.length, 1, `exactly one Teams payload (${teams.length})`);
    assert.ok(JSON.stringify(teams[0]).includes(problem.id), 'Teams payload names the problem');
    console.log(`✔ P6/P7: problem ${problem.id}, layer ${problem.top_layer}, one Teams payload`);

    // 5. Evidence pack holds only this replay's data.
    const pack = await fetch(`${base}/api/problems/${problem.id}/evidence`);
    assert.strictEqual(pack.status, 200);
    const html = await pack.text();
    assert.ok(html.includes(PRODUCT), 'evidence names the product');
    assert.ok(!html.includes(NOISE), 'evidence excludes the unrelated alert');
    const packAlerts = (problem.evidence_pack && problem.evidence_pack.alerts) || [];
    assert.ok(packAlerts.length >= 1 && packAlerts.every(a => a.component === PRODUCT), 'pack alerts all belong to the replay');
    const unknown = await fetch(`${base}/api/problems/PRB-NO-SUCH/evidence`);
    assert.strictEqual(unknown.status, 404, 'unknown problem id -> 404');
    console.log('✔ Evidence pack contains only the replay (unknown id 404)');

    // 6. Second grouping pass: nothing new, no second Teams message.
    await runProblemGrouping({ environments: ['staging'], runner: null });
    assert.strictEqual(teams.length, 1, 'no duplicate notification');
    console.log('=== E2E REPLAY PASSED ===');
  } finally {
    yamlConfig.loadAllApplications = realLoadApps;
    changeRoutes.isWithinChangeWindow = realWindow;
    problemStore.setPool(undefined);
    delete process.env.SENTINEL_TEAMS_WEBHOOK_URL;
  }
}

run()
  .then(async () => {
    for (const c of closers) { try { await c(); } catch (_) {} }
    setTimeout(() => process.exit(0), 50).unref();
  })
  .catch(async (err) => {
    console.error('✘ E2E replay failed:', err);
    for (const c of closers) { try { await c(); } catch (_) {} }
    setTimeout(() => process.exit(1), 50).unref();
  });
