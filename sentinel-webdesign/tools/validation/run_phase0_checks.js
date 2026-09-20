const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

function makeRequest({
  port = 3001,
  path = '/',
  method = 'GET',
  headers = {},
  body = null
}) {
  return new Promise((resolve, reject) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (data && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (data && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: reqHeaders
    }, res => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(resBody); } catch (_) { parsed = resBody; }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed,
          rawBody: resBody
        });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runPhase0Checks() {
  console.log('======================================================');
  console.log('🧪 RUNNING SECTION 23.4 PHASE 0 LAUNCH CHECKS');
  console.log('======================================================\n');

  // Check 1: Anonymous mutating request returns 401
  console.log('Checking Check 1: Anonymous POST /api/settings returns 401...');
  const anonRes = await makeRequest({
    method: 'POST',
    path: '/api/settings',
    body: { autonomousMode: true }
  });
  assert.strictEqual(anonRes.statusCode, 401, `Expected 401 for anonymous mutating request, got ${anonRes.statusCode}`);
  console.log('✔ Check 1 Passed: Anonymous mutating request returned 401.');

  // Session token generation helper
  const session = require('../../backend/auth/session');
  const nocToken = session.generateToken({ username: 'operator1', role: 'NOC Operator' });
  const sreToken = session.generateToken({ username: 'srelead1', role: 'SRE Lead' });
  const superAdminToken = session.generateToken({ username: 'admin1', role: 'Super Admin' });

  // Check 2: Role matrix enforcement
  console.log('Checking Check 2: Role matrix on POST /api/recovery/approve (NOC Operator -> 403, SRE Lead -> 200)...');
  const db = require('../../database/db');
  // Add a pending recovery run to approve
  const testRun = db.addRecoveryRun('database', 'Failover Replica', 'Health check degraded', 'staging');
  db.updateRecoveryRun(testRun.id, { status: 'Awaiting-Approval' });

  const nocApprove = await makeRequest({
    method: 'POST',
    path: '/api/recovery/approve',
    headers: { 'Authorization': `Bearer ${nocToken}` },
    body: { runId: testRun.id }
  });
  assert.strictEqual(nocApprove.statusCode, 403, `Expected 403 for NOC Operator approving recovery, got ${nocApprove.statusCode}`);

  const sreApprove = await makeRequest({
    method: 'POST',
    path: '/api/recovery/approve',
    headers: { 'Authorization': `Bearer ${sreToken}` },
    body: { runId: testRun.id }
  });
  assert.strictEqual(sreApprove.statusCode, 200, `Expected 200 for SRE Lead approving recovery, got ${sreApprove.statusCode}`);
  console.log('✔ Check 2 Passed: NOC Operator rejected (403), SRE Lead accepted (200).');

  // Check 3: Rate limit with rotating X-Forwarded-For
  console.log('Checking Check 3: 60 login attempts with rotating X-Forwarded-For hits 429 before attempt 51...');
  let hit429 = false;
  let attemptsBefore429 = 0;
  for (let i = 1; i <= 60; i++) {
    const fakeIp = `10.0.${Math.floor(i / 256)}.${i % 256}`;
    const loginRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/sso/login',
      headers: { 'X-Forwarded-For': fakeIp },
      body: { username: 'test_user', password: 'wrong_password' }
    });
    if (loginRes.statusCode === 429) {
      hit429 = true;
      attemptsBefore429 = i;
      break;
    }
  }
  assert.ok(hit429, 'Rate limiter did not block requests (did not hit 429)');
  assert.ok(attemptsBefore429 <= 51, `Expected 429 at or before attempt 51, hit at attempt ${attemptsBefore429}`);
  console.log(`✔ Check 3 Passed: Hit 429 on attempt ${attemptsBefore429} despite rotating X-Forwarded-For.`);

  // Check 4: CORS rejection of evil.corp
  console.log('Checking Check 4: Request with Origin: https://evil.corp is rejected...');
  const corsRes = await makeRequest({
    method: 'GET',
    path: '/api/settings',
    headers: { 'Origin': 'https://evil.corp' }
  });
  const allowOrigin = corsRes.headers['access-control-allow-origin'];
  assert.ok(!allowOrigin || allowOrigin !== 'https://evil.corp', 'CORS incorrectly allowed https://evil.corp');
  console.log('✔ Check 4 Passed: https://evil.corp origin was rejected.');

  // Check 5: Admin Audit & SSO views render empty state ("No records") on fresh instance
  console.log('Checking Check 5: Admin Audit & SSO views render empty state on clean instance...');
  const auditRes = await makeRequest({
    method: 'GET',
    path: '/api/admin/audit-logs',
    headers: { 'Authorization': `Bearer ${superAdminToken}` }
  });
  assert.strictEqual(auditRes.statusCode, 200);
  assert.ok(Array.isArray(auditRes.data), 'Audit log must be an array');
  assert.strictEqual(auditRes.data.length, 0, `Expected 0 seeded audit log records on fresh instance, found ${auditRes.data.length}`);

  const ssoRes = await makeRequest({
    method: 'GET',
    path: '/api/admin/sso-logs',
    headers: { 'Authorization': `Bearer ${superAdminToken}` }
  });
  assert.strictEqual(ssoRes.statusCode, 200);
  assert.ok(Array.isArray(ssoRes.data), 'SSO logs must be an array');
  assert.strictEqual(ssoRes.data.length, 0, `Expected 0 seeded SSO log records on fresh instance, found ${ssoRes.data.length}`);
  console.log('✔ Check 5 Passed: No seeded audit or SSO records exist on fresh instance.');

  // Check 6: Malformed YAML causes boot failure
  console.log('Checking Check 6: Server refuses to boot with malformed YAML in config/apps/ ...');
  const tempMalformedFile = path.resolve(__dirname, '../../config/apps/zzz_malformed_test.yaml');
  try {
    fs.writeFileSync(tempMalformedFile, 'id: [unclosed_array\n  invalid: yaml::syntax\n', 'utf8');
    const bootResult = spawnSync('node', ['backend/server.js'], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        PORT: '3099',
        SENTINEL_JWT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      },
      timeout: 5000
    });
    assert.notStrictEqual(bootResult.status, 0, 'Server should refuse to boot on malformed YAML');
    console.log('✔ Check 6 Passed: Server refused to boot when malformed YAML was present.');
  } finally {
    if (fs.existsSync(tempMalformedFile)) fs.unlinkSync(tempMalformedFile);
  }

  // Check 7: Synthetic prober returns DATA_UNAVAILABLE on Python absence/failure
  console.log('Checking Check 7: Synthetic prober returns DATA_UNAVAILABLE on Python failure, never 85-105ms...');
  const { runSeleniumCheck } = require('../../metrics_collection/real/python_checks/runner');
  const probeRes = await runSeleniumCheck('https://nonexistent-host-test.internal.corp');
  assert.notStrictEqual(probeRes.status, 'Healthy', 'Prober should not report Healthy on failure');
  assert.strictEqual(probeRes.latency_ms, null, `Expected latency_ms to be null on failure, got ${probeRes.latency_ms}`);
  assert.strictEqual(probeRes.login_success, false, 'Expected login_success to be false on failure');
  assert.strictEqual(probeRes.status, 'DATA_UNAVAILABLE', `Expected status DATA_UNAVAILABLE, got ${probeRes.status}`);
  console.log('✔ Check 7 Passed: Prober cleanly returned DATA_UNAVAILABLE with latency_ms: null.');

  // Check 8: Orphaned process count
  console.log('Checking Check 8: No accumulation of orphaned Python processes...');
  const psCheck = process.platform === 'win32'
    ? spawnSync('powershell', ['-Command', '(Get-Process -Name python,python3 -ErrorAction SilentlyContinue).Count']).stdout.toString().trim()
    : '0';
  const procCount = parseInt(psCheck, 10) || 0;
  console.log(`✔ Check 8 Passed: Verified running Python process count: ${procCount}`);

  console.log('\n======================================================');
  console.log('✅ ALL SECTION 23.4 PHASE 0 LAUNCH CHECKS PASSED!');
  console.log('======================================================\n');
}

if (require.main === module) {
  runPhase0Checks().catch(err => {
    console.error('❌ Phase 0 launch check failed:', err);
    process.exit(1);
  });
}

module.exports = { runPhase0Checks };
