'use strict';

/**
 * tests/env_access.test.js
 *
 * Tests for per-user environment access from AD groups and the session token.
 */

const assert = require('assert');
const yamlConfig = require('../backend/config/yaml_config');
const policy = require('../backend/auth/access_policy');
const session = require('../backend/auth/session');

session.setJwtSecret('sentinel_jwt_secret_at_least_32_characters_long_12345');

// Save original loadGlobalConfig
const origLoad = yamlConfig.loadGlobalConfig;

try {
  console.log('=== RUNNING ENV ACCESS UNIT TESTS ===');

  // Stub yamlConfig.loadGlobalConfig with environment_groups
  yamlConfig.loadGlobalConfig = () => ({
    security: {
      environment_groups: {
        'CN=Sentinel-Env-Prod,OU=Groups,DC=enterprise,DC=corp': ['prod'],
        'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp': ['staging']
      }
    }
  });

  assert.deepStrictEqual(policy.environmentsFromGroups(['cn=sentinel-env-prod,ou=groups,dc=enterprise,dc=corp']), ['prod']);
  assert.deepStrictEqual(policy.environmentsFromGroups(['cn=other,dc=x']), []);
  assert.deepStrictEqual(policy.environmentsFromGroups([
    'cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp',
    'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp'
  ]).sort(), ['prod', 'staging']);

  assert.deepStrictEqual(policy.allowedEnvironments({ role: 'SRE Lead', environments: ['staging'] }), ['staging']);
  assert.deepStrictEqual(policy.allowedEnvironments({ role: 'Viewer', environments: ['prod', 'demo'] }), ['prod']);
  assert.deepStrictEqual(policy.allowedEnvironments({ role: 'Super Admin', environments: ['staging'] }), ['prod', 'staging']);

  assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: ['prod'] }, 'staging'), 'prod');
  assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: ['prod', 'staging'] }, 'staging'), 'staging');
  assert.strictEqual(policy.defaultEnvironment({ role: 'Viewer', environments: [] }, 'staging'), null);

  // with environment_groups = {}:
  yamlConfig.loadGlobalConfig = () => ({
    security: {
      environment_groups: {}
    }
  });
  assert.strictEqual(policy.environmentsFromGroups(['cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp']), null);

  // token round trip:
  const t = session.generateToken({ username: 'a', role: 'Viewer', environments: ['staging'] });
  assert.deepStrictEqual(session.verifyToken(t).environments, ['staging']);
  assert.strictEqual('environments' in session.verifyToken(session.generateToken({ username: 'b', role: 'Viewer' })), false);

  console.log('✔ All env access unit tests passed');
} finally {
  yamlConfig.loadGlobalConfig = origLoad;
}

// HTTP & WebSocket integration tests
const http = require('http');
const WebSocket = require('ws');
const { app, server } = require('../backend/server');

async function runHttpTests() {
  console.log('=== RUNNING ENV ACCESS HTTP TESTS ===');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  function httpRequest({ method, path, headers = {}, body }) {
    return new Promise((resolve, reject) => {
      const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
      const reqHeaders = { ...headers };
      if (payload && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      if (payload && !reqHeaders['Content-Length']) {
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: json !== null ? json : data });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  function post(path, body, token, headers = {}) {
    const h = { ...headers };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return httpRequest({ method: 'POST', path, headers: h, body });
  }

  function get(path, token, headers = {}) {
    const h = { ...headers };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return httpRequest({ method: 'GET', path, headers: h });
  }

  function wsOpen(path, token) {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${port}${path}${path.includes('?') ? '&' : '?'}token=${token}`;
      const ws = new WebSocket(url);
      const queue = [];
      const waiters = [];

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (waiters.length > 0) {
            const w = waiters.shift();
            w(msg);
          } else {
            queue.push(msg);
          }
        } catch (_) {}
      });

      ws.on('open', () => {
        resolve({
          async next(type) {
            if (queue.length > 0) {
              if (!type) return queue.shift();
              const idx = queue.findIndex(m => m.type === type);
              if (idx !== -1) return queue.splice(idx, 1)[0];
            }
            return new Promise(res => {
              const check = (msg) => {
                if (!type || msg.type === type) {
                  res(msg);
                } else {
                  waiters.push(check);
                }
              };
              waiters.push(check);
            });
          },
          async nextOrNull(type, ms = 1000) {
            return Promise.race([
              this.next(type),
              new Promise(res => setTimeout(() => res(null), ms))
            ]);
          },
          send(obj) {
            ws.send(JSON.stringify(obj));
          },
          close() {
            ws.close();
          }
        });
      });

      ws.on('error', reject);
    });
  }

  try {
    // stg_operator signs in -> lands on staging, sees only staging
    let r = await post('/api/auth/sso/login', { username: 'stg_operator', password: 'Pw1!' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.environment, 'staging');
    assert.deepStrictEqual(r.body.user.allowedEnvironments, ['staging']);
    const stg = r.body.token;
    assert.strictEqual((await get('/api/alerts?environment=prod', stg)).status, 403);
    // The session environment wins over the header (resolveEnvironment order), so this is staging data:
    r = await get('/api/alerts', stg, { 'X-Sentinel-Environment': 'prod' });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.every(a => a.environment !== 'prod'));
    assert.strictEqual((await post('/api/environment', { environment: 'prod' }, stg)).status, 403);
    assert.strictEqual((await get('/api/alerts?environment=staging', stg)).status, 200);

    // prod_operator lands on prod even though the server default is staging
    r = await post('/api/auth/sso/login', { username: 'prod_operator', password: 'Pw1!' });
    assert.strictEqual(r.body.user.environment, 'prod');
    const prod = r.body.token;
    assert.strictEqual((await get('/api/alerts?environment=staging', prod)).status, 403);
    assert.deepStrictEqual((await get('/api/auth/me', prod)).body.allowedEnvironments, ['prod']);

    // both users at once: the staging session is unaffected by the prod session
    assert.strictEqual((await get('/api/auth/me', stg)).body.environment, 'staging');

    // WebSocket: asking for prod is downgraded to the user's first allowed environment
    // (server.js ~line 2280), and a later subscribe to prod is ignored
    const ws = await wsOpen('/ws?environment=prod', stg);
    assert.strictEqual((await ws.next('init')).data.environment, 'staging');
    ws.send({ type: 'subscribe', environment: 'prod' });
    assert.strictEqual(await ws.nextOrNull('init', 1000), null);
    ws.close();

    // Super Admin keeps both
    r = await post('/api/auth/sso/login', { username: 'admin_sentinel', password: 'Pw1!' });
    assert.deepStrictEqual(r.body.user.allowedEnvironments.sort(), ['prod', 'staging']);

    console.log('✔ All env access HTTP tests passed');
    process.exit(0);
  } finally {
    server.close();
  }
}

runHttpTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
