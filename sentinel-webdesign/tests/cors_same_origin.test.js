'use strict';

/**
 * tests/cors_same_origin.test.js
 *
 * Acceptance test for R3: CORS accepts the app's own address and refuses with 403.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { server } = require('../backend/server');

console.log('=== RUNNING CORS SAME ORIGIN TESTS (R3) ===');

function request({ port, method = 'GET', path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json !== null ? json : data
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const savedAllowedOrigin = process.env.ALLOWED_ORIGIN;
  const savedAllowLocalhost = process.env.SENTINEL_ALLOW_LOCALHOST_CORS;

  try {
    // Ensure localhost CORS flag is not hiding evil origins
    delete process.env.SENTINEL_ALLOW_LOCALHOST_CORS;

    // 1. Get real bundle name from frontend/dist/index.html
    const htmlPath = path.resolve(__dirname, '../frontend/dist/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const match = html.match(/src="\/assets\/([^"]+)"/);
    assert.ok(match, 'frontend/dist/index.html must reference a bundle asset');
    const bundleName = match[1];

    // Case 1: GET /assets/<bundle> with Origin: http://127.0.0.1:P -> 200
    const resOwnOrigin = await request({
      port,
      path: `/assets/${bundleName}`,
      headers: {
        Origin: `http://127.0.0.1:${port}`
      }
    });
    assert.strictEqual(resOwnOrigin.status, 200, `Expected 200 for own origin, got ${resOwnOrigin.status}`);
    assert.strictEqual(resOwnOrigin.headers['access-control-allow-origin'], `http://127.0.0.1:${port}`);
    console.log('✔ Case 1 Passed: Own origin request to static asset succeeded with 200');

    // Case 2: GET /api/health with Origin: https://evil.example -> 403, no allow header
    const resEvil = await request({
      port,
      path: '/api/health',
      headers: {
        Origin: 'https://evil.example'
      }
    });
    assert.strictEqual(resEvil.status, 403, `Expected 403 for untrusted origin, got ${resEvil.status}`);
    assert.strictEqual(resEvil.headers['access-control-allow-origin'], undefined, 'Must not emit Access-Control-Allow-Origin for untrusted origin');
    console.log('✔ Case 2 Passed: Untrusted origin rejected with 403 and no allow header');

    // Case 3: GET /api/health with ALLOWED_ORIGIN=https://sentinel.test and that origin -> 200 with allow header
    process.env.ALLOWED_ORIGIN = 'https://sentinel.test';
    const resAllowed = await request({
      port,
      path: '/api/health',
      headers: {
        Origin: 'https://sentinel.test'
      }
    });
    assert.strictEqual(resAllowed.status, 200, `Expected 200 for allowed origin, got ${resAllowed.status}`);
    assert.strictEqual(resAllowed.headers['access-control-allow-origin'], 'https://sentinel.test');
    console.log('✔ Case 3 Passed: Configured ALLOWED_ORIGIN allowed with 200 and correct header');

    console.log('=== ALL CORS SAME ORIGIN TESTS PASSED ===');
    process.exit(0);
  } finally {
    if (savedAllowedOrigin !== undefined) process.env.ALLOWED_ORIGIN = savedAllowedOrigin;
    else delete process.env.ALLOWED_ORIGIN;
    if (savedAllowLocalhost !== undefined) process.env.SENTINEL_ALLOW_LOCALHOST_CORS = savedAllowLocalhost;
    server.close();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
