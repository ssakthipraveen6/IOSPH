/**
 * tests/phase_s_security.test.js
 *
 * Phase S acceptance (S1-S8): change-window roles and audit, environment from the
 * session and entitlements, dashboard ownership and environment scoping, cookie
 * sessions on alert actions, SentinelQL against the configured database, and
 * localhost CORS only behind the explicit flag.
 * (S9/S10 are covered by tests/phase_s_git_llm.test.js.)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.CLICKHOUSE_URL = '';
const session = require('../backend/auth/session');
session.setJwtSecret('sentinel_jwt_secret_at_least_32_characters_long_12345');

const yamlConfig = require('../backend/config/yaml_config');
const { app } = require('../backend/server');
const changeRoutes = require('../backend/routes/changeRoutes');
const { fakeChangeWindowPool } = require('./helpers/fake_change_window_pool');
const { startFakeClickHouse } = require('./helpers/fake_clickhouse');
const { isAllowedOrigin } = require('../backend/cors_validator');
const sentinelql = require('../analytics/sentinelql');

const AUDIT_LOG = path.join(__dirname, '../logs/sentinel_audit.log');

function token(username, role, environment = 'staging') {
  return session.generateToken({ username, role, environment });
}

function auditLinesSince(offset) {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  const buf = fs.readFileSync(AUDIT_LOG, 'utf8').slice(offset);
  return buf.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

function auditOffset() {
  return fs.existsSync(AUDIT_LOG) ? fs.readFileSync(AUDIT_LOG, 'utf8').length : 0;
}

async function run() {
  console.log('=== PHASE S: SECURITY AND ENVIRONMENT ACCEPTANCE ===');
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, { bearer, body, headers = {} } = {}) => fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const lead = token('lead.sre@enterprise.corp', 'SRE Lead', 'prod');
  const viewer = token('viewer@enterprise.corp', 'Viewer', 'staging');
  const owner = token('owner@enterprise.corp', 'SRE', 'staging');
  const other = token('other@enterprise.corp', 'SRE', 'staging');
  const leadStaging = token('lead.sre@enterprise.corp', 'SRE Lead', 'staging');

  const now = Date.now();
  const windowBody = {
    title: 'Phase S window',
    productId: 'jfrog_artifactory',
    environment: 'staging',
    createdBy: 'somebody.else',
    startTime: new Date(now - 60000).toISOString(),
    endTime: new Date(now + 3600000).toISOString()
  };

  try {
    // ---------------------------------------------------------------- S1
    const pool = fakeChangeWindowPool();
    changeRoutes.setPool(pool);

    let res = await call('POST', '/api/v2/changes/windows', { bearer: viewer, body: windowBody });
    assert.strictEqual(res.status, 403, 'Viewer cannot create a change window');

    res = await call('POST', '/api/v2/changes/windows', { body: windowBody });
    assert.strictEqual(res.status, 401, 'anonymous cannot create a change window');

    let off = auditOffset();
    res = await call('POST', '/api/v2/changes/windows', { bearer: lead, body: windowBody });
    assert.strictEqual(res.status, 201);
    const created = (await res.json()).window;
    assert.strictEqual(created.environment, 'prod', 'body environment is ignored; the session decides');
    assert.strictEqual(created.created_by, 'lead.sre@enterprise.corp', 'body createdBy is ignored');
    const createAudit = auditLinesSince(off).find(e => e.action === 'CHANGE_WINDOW_CREATE');
    assert.ok(createAudit, 'CHANGE_WINDOW_CREATE audited');
    assert.strictEqual(createAudit.detail.id, created.id);

    res = await call('GET', '/api/v2/changes/windows', { bearer: leadStaging });
    let listed = await res.json();
    const stagingList = listed.windows || listed.data || listed;
    assert.ok(Array.isArray(stagingList) && !stagingList.some(w => w.id === created.id), 'prod window not listed for a staging session');

    assert.strictEqual((await changeRoutes.isWithinChangeWindow({ environment: 'prod', productId: 'jfrog_artifactory', timestamp: new Date().toISOString() })).approved, true,
      'open window matches');

    res = await call('POST', `/api/v2/changes/windows/${created.id}/close`, { bearer: viewer });
    assert.strictEqual(res.status, 403, 'Viewer cannot close');
    res = await call('POST', `/api/v2/changes/windows/${created.id}/close`, { bearer: leadStaging });
    assert.strictEqual(res.status, 404, 'cannot close another environment\'s window');
    off = auditOffset();
    res = await call('POST', `/api/v2/changes/windows/${created.id}/close`, { bearer: lead });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).window.status, 'CLOSED');
    assert.ok(auditLinesSince(off).some(e => e.action === 'CHANGE_WINDOW_CLOSE'), 'close audited');
    assert.strictEqual((await changeRoutes.isWithinChangeWindow({ environment: 'prod', productId: 'jfrog_artifactory', timestamp: new Date().toISOString() })).approved, false,
      'closed window no longer approves changes');

    changeRoutes.setPool(fakeChangeWindowPool({ failWrites: true }));
    res = await call('POST', '/api/v2/changes/windows', { bearer: lead, body: windowBody });
    assert.strictEqual(res.status, 503, 'failed write is reported, not faked');
    changeRoutes.setPool(null);
    res = await call('POST', '/api/v2/changes/windows', { bearer: lead, body: windowBody });
    assert.strictEqual(res.status, 503, 'no PostgreSQL -> 503');
    res = await call('GET', '/api/v2/changes/windows', { bearer: lead });
    assert.strictEqual((await res.json()).status, 'DATA_UNAVAILABLE');
    console.log('✔ S1 change windows: roles, session environment, audit, close, 503');

    // ---------------------------------------------------------------- S2/S3
    const realLoad = yamlConfig.loadGlobalConfig;
    yamlConfig.loadGlobalConfig = (...a) => {
      const cfg = { ...(realLoad.apply(yamlConfig, a) || {}) };
      cfg.security = { ...(cfg.security || {}), environment_entitlements: { Viewer: ['staging'] } };
      return cfg;
    };
    try {
      res = await call('GET', '/api/products?env=prod', { bearer: viewer });
      assert.strictEqual(res.status, 403, 'staging-only role refused prod via ?env=');
      res = await call('GET', '/api/products?environment=prod', { bearer: viewer });
      assert.strictEqual(res.status, 403, 'staging-only role refused prod via ?environment=');
      res = await call('GET', '/api/products?env=staging', { bearer: viewer });
      assert.strictEqual(res.status, 200, 'entitled environment allowed');
    } finally {
      yamlConfig.loadGlobalConfig = realLoad;
    }
    res = await call('GET', '/api/products?env=demo', { bearer: viewer });
    assert.strictEqual(res.status, 400, 'demo only through /api/demo');
    console.log('✔ S2/S3 environment from session or ?env=, entitlement enforced');

    // ---------------------------------------------------------------- S4
    const dash = { title: 'Phase S owner dash', panels: [{ type: 'stat', query: 'metrics where product = "artifactory"' }] };
    res = await call('POST', '/api/dashboards', { bearer: owner, body: dash });
    assert.strictEqual(res.status, 403, 'SRE cannot create a dashboard');
    res = await call('POST', '/api/dashboards', { bearer: leadStaging, body: { ...dash, environment: 'prod', created_by: 'mallory' } });
    assert.strictEqual(res.status, 201);
    const saved = await res.json();
    assert.strictEqual(saved.environment, 'staging', 'dashboard environment from the session');
    assert.strictEqual(saved.created_by, 'lead.sre@enterprise.corp', 'owner from the session');

    res = await call('GET', `/api/dashboards/${saved.id}`, { bearer: lead });
    assert.strictEqual(res.status, 404, 'prod session cannot read a staging dashboard');
    res = await call('PUT', `/api/dashboards/${saved.id}`, { bearer: other, body: dash });
    assert.strictEqual(res.status, 403, 'non-owner SRE cannot update');
    res = await call('DELETE', `/api/dashboards/${saved.id}`, { bearer: other });
    assert.strictEqual(res.status, 403, 'non-owner SRE cannot delete');
    res = await call('DELETE', `/api/dashboards/${saved.id}`, { bearer: lead });
    assert.strictEqual(res.status, 404, 'cannot delete across environments');

    res = await call('POST', '/api/dashboards/import', { bearer: leadStaging, body: { ...dash, title: 'Imported S', created_by: 'owner@enterprise.corp', environment: 'prod' } });
    assert.ok(res.status === 200 || res.status === 201, `import status ${res.status}`);
    const imported = await res.json();
    const importedDash = imported.dashboard || imported;
    assert.strictEqual(importedDash.environment, 'staging', 'import forced to session environment');
    assert.strictEqual(importedDash.created_by, 'lead.sre@enterprise.corp', 'importer becomes owner');

    // An owner (non-lead) may change their own dashboard.
    const dashboardService = require('../backend/services/dashboardService');
    const own = await dashboardService.saveDashboard({ ...dash, title: 'Owned by SRE', environment: 'staging' }, 'owner@enterprise.corp');
    res = await call('PUT', `/api/dashboards/${own.id}`, { bearer: owner, body: { ...dash, title: 'Owned by SRE v2' } });
    assert.strictEqual(res.status, 200, 'owner can update');
    assert.strictEqual((await res.json()).created_by, 'owner@enterprise.corp');
    res = await call('DELETE', `/api/dashboards/${own.id}`, { bearer: owner });
    assert.strictEqual(res.status, 200, 'owner can delete');
    res = await call('DELETE', `/api/dashboards/${saved.id}`, { bearer: leadStaging });
    assert.strictEqual(res.status, 200);
    await dashboardService.deleteDashboard(importedDash.id);
    console.log('✔ S4 dashboards: role to create, owner or lead to change, environment-scoped');

    // ---------------------------------------------------------------- S5
    const cookieHeaders = (tok, csrf) => ({ Cookie: `sentinel_session=${tok}; sentinel_csrf=${csrf}`, 'X-CSRF-Token': csrf });
    res = await call('POST', '/api/v2/alerts/NO-SUCH-ALERT/ack', { headers: cookieHeaders(leadStaging, 'csrf-s5') });
    assert.strictEqual(res.status, 404, 'cookie session + CSRF passes auth and role (alert simply absent)');
    res = await call('POST', '/api/v2/alerts/NO-SUCH-ALERT/ack', { headers: { Cookie: `sentinel_session=${leadStaging}` } });
    assert.strictEqual(res.status, 403, 'cookie session without CSRF refused');
    res = await call('POST', '/api/v2/alerts/NO-SUCH-ALERT/ack', { headers: cookieHeaders(owner, 'csrf-s5') });
    assert.strictEqual(res.status, 403, 'SRE role cannot ack');
    res = await call('POST', '/api/v2/alerts/NO-SUCH-ALERT/snooze', { bearer: leadStaging, body: { minutes: 999999 } });
    assert.strictEqual(res.status, 404, 'Bearer session works too');
    console.log('✔ S5 alert actions accept cookie sessions (with CSRF) and Bearer tokens');

    // ---------------------------------------------------------------- S7
    const ch = await startFakeClickHouse(() => []);
    const prevDb = process.env.CLICKHOUSE_DATABASE;
    process.env.CLICKHOUSE_URL = ch.url;
    process.env.CLICKHOUSE_DATABASE = 'sentinel_s7';
    try {
      const compiled = sentinelql.compile('metrics where product = "artifactory"', { environment: 'staging' });
      assert.ok(/sentinel_s7\.metrics/.test(compiled.sql), `compiled SQL uses configured database: ${compiled.sql}`);
      assert.ok(!/\bsentinel\.metrics/.test(compiled.sql), 'no hard-coded database');
      res = await call('POST', '/api/query', { bearer: leadStaging, body: { query: 'metrics where product = "artifactory"' } });
      assert.strictEqual(res.status, 200, `query status ${res.status}`);
      const sent = ch.requests.map(r => r.sql).find(s => /metrics/.test(s));
      assert.ok(sent && /sentinel_s7\.metrics/.test(sent), `SQL sent to ClickHouse uses sentinel_s7: ${sent}`);
      const envParam = ch.requests.map(r => r.params).find(p => Object.values(p).includes('staging'));
      assert.ok(envParam, 'environment bound as a parameter from the session');
    } finally {
      process.env.CLICKHOUSE_URL = '';
      if (prevDb === undefined) delete process.env.CLICKHOUSE_DATABASE; else process.env.CLICKHOUSE_DATABASE = prevDb;
      await ch.close();
    }
    console.log('✔ S7 SentinelQL compiles and runs against the configured database');

    // ---------------------------------------------------------------- S8
    const savedFlag = process.env.SENTINEL_ALLOW_LOCALHOST_CORS;
    const savedNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.SENTINEL_ALLOW_LOCALHOST_CORS;
      assert.strictEqual(isAllowedOrigin('http://localhost:5173', []), false, 'localhost refused without the flag');
      process.env.SENTINEL_ALLOW_LOCALHOST_CORS = 'true';
      assert.strictEqual(isAllowedOrigin('http://localhost:5173', []), true, 'localhost allowed with the flag');
      assert.strictEqual(isAllowedOrigin('http://localhost.evil.com', []), false);
      process.env.NODE_ENV = 'production';
      assert.strictEqual(isAllowedOrigin('http://127.0.0.1:5173', []), false, 'never in production');
      assert.strictEqual(isAllowedOrigin('https://sentinel.example', ['https://sentinel.example']), true);
    } finally {
      if (savedFlag === undefined) delete process.env.SENTINEL_ALLOW_LOCALHOST_CORS; else process.env.SENTINEL_ALLOW_LOCALHOST_CORS = savedFlag;
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    }
    console.log('✔ S8 localhost CORS only behind SENTINEL_ALLOW_LOCALHOST_CORS, never in production');

    // Anonymous mutation stays refused even with simulated collectors.
    res = await call('POST', '/api/dashboards', { body: dash });
    assert.strictEqual(res.status, 401, 'no anonymous admin without SENTINEL_DEV_ANON_ADMIN');

    console.log('\n=== PHASE S ACCEPTANCE PASSED ===');
  } finally {
    changeRoutes.setPool(undefined);
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error('PHASE S TEST FAILED:', err);
  process.exit(1);
});
