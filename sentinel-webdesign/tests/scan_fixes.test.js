/**
 * Regression tests for the code-scan fixes:
 *  1. Jenkins remediation succeeds only when Jenkins reports SUCCESS
 *  2. A failed trigger marks the run Failed instead of crashing the process
 *  3. The Jenkins of the run's own environment is called
 *  4. Simulated login stays off when global.yaml says prod (any spelling)
 *  5. Approvers sign only runs of environments they are entitled to
 *  6. One recovery lock per component per environment
 *  7. NOC Operator may trigger a recovery
 *  8. Agents fetch their config with an ingest key when reads need a session
 *  9. The session token is not returned in response bodies, nor accepted in the WebSocket URL
 * 10. Failed sign-ins are audited
 * 11. The ingest key cache is bounded
 * 12. Directory details are hidden from anonymous callers
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const db = require('../database/db');
const config = require('../backend/config/config');
const yamlConfig = require('../backend/config/yaml_config');
const credentialProvider = require('../backend/config/cyberark/credential_provider');
const session = require('../backend/auth/session');
const ingestKeys = require('../backend/auth/ingest_keys');
const ldapClient = require('../backend/auth/ldap_client');
const recovery = require('../remediation/recovery');
const { triggerJenkinsSelfHealingJob } = require('../remediation/real/jenkins/jenkins_trigger');
const { server } = require('../backend/server');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const noLog = () => {};

// A fake Jenkins: `buildResult` is what the build reports; `triggerStatus` what the POST answers.
function fakeJenkins({ triggerStatus = 201, buildResult = 'SUCCESS' } = {}) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const base = `http://127.0.0.1:${srv.address().port}`;
    const json = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'POST' && req.url.endsWith('/build')) {
      res.writeHead(triggerStatus, triggerStatus === 201 ? { Location: `${base}/queue/item/1/` } : {});
      return res.end();
    }
    if (req.url === '/queue/item/1/api/json') return json({ executable: { number: 7, url: `${base}/job/demo/7/` } });
    if (req.url === '/job/demo/7/api/json') return json({ building: false, result: buildResult });
    res.writeHead(404); res.end();
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, masterUrl: `http://127.0.0.1:${srv.address().port}/job` })));
}

function request({ port, method = 'GET', path: p, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: json !== null ? json : data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const saved = {
    simulated: config.USE_SIMULATED_COLLECTORS,
    prodJenkins: config.PROD_URLS.jenkins_master_url,
    stgJenkins: config.STG_URLS.jenkins_master_url,
    getCredential: credentialProvider.getCredential,
    loadGlobalConfig: yamlConfig.loadGlobalConfig,
    env: { ...process.env }
  };
  const servers = [];

  try {
    db.updateSettings({ autonomousMode: false });
    config.USE_SIMULATED_COLLECTORS = false;
    credentialProvider.getCredential = async () => 'svc:token';

    // --- 1 + 3: real result, and the run's own environment ---
    const prodOk = await fakeJenkins();
    const stg = await fakeJenkins();
    servers.push(prodOk.srv, stg.srv);
    config.PROD_URLS.jenkins_master_url = prodOk.masterUrl;
    config.STG_URLS.jenkins_master_url = stg.masterUrl;

    let completed = false;
    await triggerJenkinsSelfHealingJob('demo', 'demo', noLog, noLog, () => { completed = true; }, 'prod', { pollMs: 5 });
    assert.strictEqual(completed, true, 'a SUCCESS build completes the run');
    assert.ok(prodOk.hits.includes('POST /job/demo/build'), 'the prod Jenkins was triggered');
    assert.strictEqual(stg.hits.length, 0, 'the staging Jenkins is not called for a prod run');
    console.log('✔ 1/3 Passed: completes on SUCCESS and calls the Jenkins of the run environment');

    const refused = await fakeJenkins({ triggerStatus: 500 });
    const failedBuild = await fakeJenkins({ buildResult: 'FAILURE' });
    servers.push(refused.srv, failedBuild.srv);
    for (const [label, fake, expected] of [['HTTP 500 trigger', refused, /HTTP 500/], ['FAILURE build', failedBuild, /result FAILURE/]]) {
      config.PROD_URLS.jenkins_master_url = fake.masterUrl;
      let done = false;
      await assert.rejects(
        triggerJenkinsSelfHealingJob('demo', 'demo', noLog, noLog, () => { done = true; }, 'prod', { pollMs: 5 }),
        expected, `${label} must reject`);
      assert.strictEqual(done, false, `${label} must not report completion`);
    }
    console.log('✔ 1 Passed: a refused trigger and a failed build are reported as failures');

    // --- 2: a failed trigger marks the run Failed (and nothing is left unhandled) ---
    config.PROD_URLS.jenkins_master_url = refused.masterUrl;
    recovery.getActiveRecoveries().clear();
    const failing = recovery.triggerRecovery('nas_performance', 'scan fix test', { manual: true, env: 'prod' });
    await sleep(300);
    const failingNow = db.getRecoveryLogs('prod').find(r => r.id === failing.id);
    assert.strictEqual(failingNow.status, 'Failed', `run must be Failed, got ${failingNow.status}`);
    assert.strictEqual(recovery.getActiveRecoveries().size, 0, 'the lock is released after a failure');

    credentialProvider.getCredential = async () => null;
    const noToken = recovery.triggerRecovery('nas_performance', 'no token', { manual: true, env: 'prod' });
    await sleep(100);
    assert.strictEqual(db.getRecoveryLogs('prod').find(r => r.id === noToken.id).status, 'Failed', 'a missing token fails the run');
    credentialProvider.getCredential = async () => 'svc:token';
    recovery.resetCircuitBreaker();
    console.log('✔ 2 Passed: trigger failures mark the run Failed without an unhandled rejection');

    // --- 6: one lock per component per environment ---
    recovery.getActiveRecoveries().clear();
    const lockStg = recovery.triggerRecovery('artifactory', 'lock test', { manual: false, env: 'staging' });
    const lockProd = recovery.triggerRecovery('artifactory', 'lock test', { manual: false, env: 'prod' });
    assert.notStrictEqual(lockStg.id, lockProd.id, 'a staging run must not stand in for a prod run');
    assert.strictEqual(lockProd.env, 'prod');
    assert.strictEqual(recovery.triggerRecovery('artifactory', 'again', { manual: false, env: 'prod' }).id, lockProd.id, 'same environment still shares one run');
    console.log('✔ 6 Passed: recovery lock is per component and environment');

    // --- 4: simulated login stays off when global.yaml says prod ---
    for (const spelling of ['prod', 'prd', 'production']) {
      yamlConfig.loadGlobalConfig = (...a) => ({ ...saved.loadGlobalConfig(...a), environment: spelling });
      process.env.NODE_ENV = 'production';
      process.env.SENTINEL_ALLOW_SIMULATED_LOGIN = 'true';
      delete process.env.SSO_ELDAP_BIND;
      credentialProvider.getCredential = async () => { throw new Error('no vault in test'); };
      const r = await ldapClient.authenticate('admin_user', 'Any-Pass-1');
      assert.strictEqual(r.success, false, `simulated login must be refused when environment is "${spelling}"`);
      assert.strictEqual(r.code, 'UNAVAILABLE', 'the real directory path was taken');
    }
    yamlConfig.loadGlobalConfig = saved.loadGlobalConfig;
    credentialProvider.getCredential = async () => 'svc:token';
    if (saved.env.NODE_ENV) process.env.NODE_ENV = saved.env.NODE_ENV; else delete process.env.NODE_ENV;
    delete process.env.SENTINEL_ALLOW_SIMULATED_LOGIN;
    console.log('✔ 4 Passed: SENTINEL_ALLOW_SIMULATED_LOGIN is ignored for prod, prd and production');

    // --- HTTP checks ---
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const bearer = (user) => ({ Authorization: `Bearer ${session.generateToken(user)}` });

    // 5: approval scoped to the approver's environments
    const stagingLead = { username: 'stg.lead', role: 'SRE Lead', environment: 'staging', environments: ['staging'] };
    let r = await request({ port, method: 'POST', path: '/api/recovery/approve', headers: bearer(stagingLead), body: { runId: lockProd.id } });
    assert.strictEqual(r.status, 403, `staging-only lead must not approve a prod run, got ${r.status}`);
    assert.strictEqual(r.body.code, 'ENVIRONMENT_NOT_ENTITLED');
    assert.strictEqual((db.getRecoveryLogs('prod').find(x => x.id === lockProd.id).approvals || []).length, 0, 'no signature was recorded');
    r = await request({ port, method: 'POST', path: '/api/recovery/approve', headers: bearer(stagingLead), body: { runId: lockStg.id } });
    assert.strictEqual(r.status, 200, 'the same lead may approve a staging run');
    console.log('✔ 5 Passed: approval is refused outside the approver environments');

    // 7: NOC Operator may trigger
    r = await request({ port, method: 'POST', path: '/api/recovery/trigger', headers: bearer({ username: 'noc.one', role: 'NOC Operator', environment: 'staging' }), body: { component: 'avi_load_balancer', reason: 'role test' } });
    assert.strictEqual(r.status, 200, `NOC Operator must be able to trigger, got ${r.status}`);
    r = await request({ port, method: 'POST', path: '/api/recovery/trigger', headers: bearer({ username: 'view.one', role: 'Viewer', environment: 'staging' }), body: { component: 'avi_load_balancer' } });
    assert.strictEqual(r.status, 403, 'Viewer still cannot trigger');
    console.log('✔ 7 Passed: NOC Operator can trigger a recovery, Viewer cannot');

    // 8: agent config with an ingest key while reads need a session
    const AGENT_KEY = 'snk_scan_fix_agent_key';
    process.env.SENTINEL_REQUIRE_AUTH_READS = 'true';
    process.env.SENTINEL_INGEST_AUTH_MODE = 'enforce';
    process.env.SENTINEL_INGEST_API_KEYS = `scan-agent:staging:${ingestKeys.hashKey(AGENT_KEY)}:agent`;
    r = await request({ port, path: '/api/v2/agent/config?host=scan-host' });
    assert.strictEqual(r.status, 401, 'no key and no session is refused');
    r = await request({ port, path: '/api/v2/agent/config?host=scan-host', headers: { 'X-Sentinel-Api-Key': 'snk_wrong' } });
    assert.strictEqual(r.status, 401, 'a wrong key is refused');
    r = await request({ port, path: '/api/v2/agent/config?host=scan-host', headers: { 'X-Sentinel-Api-Key': AGENT_KEY } });
    assert.strictEqual(r.status, 200, `an agent key fetches the config, got ${r.status}`);
    assert.strictEqual(r.body.environment, 'staging');
    r = await request({ port, path: '/api/alerts', headers: { 'X-Sentinel-Api-Key': AGENT_KEY } });
    assert.strictEqual(r.status, 401, 'an ingest key opens nothing else');
    console.log('✔ 8 Passed: agents fetch config with an ingest key; other reads still need a session');

    // 9 (WebSocket): a token in the URL is not accepted when reads need a session
    const adminToken = session.generateToken({ username: 'ws.scan', role: 'Super Admin', environment: 'staging' });
    const wsResult = (url, opts) => new Promise(resolve => {
      const ws = new WebSocket(url, opts);
      ws.on('open', () => { ws.close(); resolve('open'); });
      ws.on('error', () => resolve('refused'));
    });
    assert.strictEqual(await wsResult(`ws://127.0.0.1:${port}/ws?token=${adminToken}`), 'refused', 'token in the URL is ignored');
    assert.strictEqual(await wsResult(`ws://127.0.0.1:${port}/ws`, { headers: { Authorization: `Bearer ${adminToken}` } }), 'open', 'token in the header works');
    delete process.env.SENTINEL_REQUIRE_AUTH_READS;
    delete process.env.SENTINEL_INGEST_AUTH_MODE;
    delete process.env.SENTINEL_INGEST_API_KEYS;
    console.log('✔ 9 Passed: WebSocket accepts the token from the header only');

    // 9 (bodies) + 10: login and environment switch
    r = await request({ port, method: 'POST', path: '/api/auth/sso/login', body: { username: 'admin_sentinel', password: 'Scan-Pass-1234' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.token, undefined, 'login does not return the session token in the body');
    const cookie = /sentinel_session=([^;]+)/.exec([].concat(r.headers['set-cookie'] || []).join(';'))[1];
    r = await request({ port, method: 'POST', path: '/api/environment', headers: { Authorization: `Bearer ${cookie}` }, body: { environment: 'prod' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.token, undefined, 'environment switch does not return the session token in the body');
    assert.ok(/sentinel_session=/.test([].concat(r.headers['set-cookie'] || []).join(';')), 'the new session is set as a cookie');

    r = await request({ port, method: 'POST', path: '/api/auth/sso/login', body: { username: 'scan_failed_user', password: 'wrong_password' } });
    assert.strictEqual(r.status, 401);
    const auditFile = path.join(__dirname, '..', 'logs', 'sentinel_audit.log');
    const auditTail = fs.readFileSync(auditFile, 'utf8').trim().split('\n').slice(-20).map(l => JSON.parse(l));
    const failedEntry = auditTail.find(e => e.action === 'SSO_LOGIN_FAILED' && e.detail.attemptedUser === 'scan_failed_user');
    assert.ok(failedEntry, 'a failed sign-in is written to the audit log');
    assert.ok(!JSON.stringify(failedEntry).includes('wrong_password'), 'the password is never audited');
    console.log('✔ 9/10 Passed: no session token in response bodies; failed sign-ins are audited');

    // 12: directory details only for signed-in users
    r = await request({ port, path: '/api/auth/sso/status' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ldapUrl, null);
    assert.strictEqual(r.body.baseDn, null);
    assert.strictEqual(r.body.ssoEndpoint, null);
    assert.ok(r.body.csrfToken, 'the CSRF token is still issued');
    console.log('✔ 12 Passed: anonymous SSO status carries no directory details');

    // --- 11: ingest key cache is bounded ---
    ingestKeys.clearCache();
    for (let i = 0; i < 5200; i++) {
      await ingestKeys.authenticate({ headers: { 'x-sentinel-api-key': `snk_unknown_${i}` } }, 'metrics');
    }
    assert.ok(ingestKeys.cacheSize() <= 5000, `cache must stay bounded, has ${ingestKeys.cacheSize()} entries`);
    console.log('✔ 11 Passed: ingest key cache stays within its bound');

    // --- 13: a host whose agent went silent is not reported HEALTHY ---
    const express = require('express');
    const { createInfraRouter } = require('../backend/routes/infraRoutes');
    const hostEntity = (name, heartbeat) => ({
      entity_id: `host:${name}`, name, kind: 'host', environment: 'staging', status: 'HEALTHY',
      labels: { os: 'linux', agent_version: '3.0.4', last_heartbeat: heartbeat }
    });
    const infraApp = express();
    infraApp.use((req, res, next) => { req.sentinelEnv = 'staging'; next(); });
    infraApp.use('/api/v2/infra', createInfraRouter({
      inv: { getEntities: async () => [
        hostEntity('scan-silent', new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString()),
        hostEntity('scan-fresh', new Date().toISOString())
      ] },
      metricsProvider: async () => new Map()
    }));
    const infraSrv = infraApp.listen(0, '127.0.0.1');
    servers.push(infraSrv);
    await new Promise(resolve => infraSrv.on('listening', resolve));
    r = await request({ port: infraSrv.address().port, path: '/api/v2/infra/hosts' });
    const hostStatus = Object.fromEntries(r.body.hosts.map(h => [h.host, h.status]));
    assert.strictEqual(hostStatus['scan-silent'], 'DEGRADED', 'a host silent for 9 days must not be HEALTHY');
    assert.strictEqual(hostStatus['scan-fresh'], 'HEALTHY', 'a reporting host keeps its stored status');
    console.log('✔ 13 Passed: a silent host is DEGRADED, a reporting host stays HEALTHY');

    // --- 14: the dump endpoint records a request, claims no capture, and is audited ---
    const lead = bearer({ username: 'dump.lead', role: 'SRE Lead', environment: 'staging' });
    r = await request({ port, method: 'POST', path: '/api/v2/infra/hosts/scan-host/processes/abc/dump', headers: lead });
    assert.strictEqual(r.status, 400, 'a non-numeric pid is refused');
    r = await request({ port, method: 'POST', path: '/api/v2/infra/hosts/scan-host/processes/321/dump', headers: lead });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.status, 'REQUESTED');
    assert.ok(/No dump has been captured/.test(r.body.message), 'the answer says no dump was captured');
    const dumpId = r.body.attachment_id;
    r = await request({ port, path: `/api/problems/attachments/${encodeURIComponent(dumpId)}`, headers: lead });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.type, 'diagnostic_dump_request');
    assert.ok(!/dump captured/i.test(r.body.content), 'the attachment does not claim a captured dump');
    assert.ok(/No dump is attached/.test(r.body.content));
    const dumpAudit = fs.readFileSync(auditFile, 'utf8').trim().split('\n').slice(-20).map(l => JSON.parse(l))
      .find(e => e.action === 'DIAGNOSTIC_DUMP_REQUESTED' && e.detail.attachment_id === dumpId);
    assert.ok(dumpAudit, 'the dump request is written to the audit log');
    assert.strictEqual(dumpAudit.user, 'dump.lead');
    console.log('✔ 14 Passed: dump request is validated, honest about no capture, and audited');

    console.log('\n✅ ALL SCAN FIX TESTS PASSED');
  } finally {
    config.USE_SIMULATED_COLLECTORS = saved.simulated;
    config.PROD_URLS.jenkins_master_url = saved.prodJenkins;
    config.STG_URLS.jenkins_master_url = saved.stgJenkins;
    credentialProvider.getCredential = saved.getCredential;
    yamlConfig.loadGlobalConfig = saved.loadGlobalConfig;
    servers.forEach(s => s.close());
    server.close();
  }
  process.exit(0);
})().catch(err => {
  console.error('Scan fix test failed:', err);
  process.exit(1);
});
