/**
 * tools/validation/run_phase1b_checks.js
 *
 * Phase 1b Launch Validation (Section 23.4):
 * "Point one app at the fixture's /302-idp route: the tile shows AUTH_FAILED,
 *  visibly distinct from DATA_UNAVAILABLE and from healthy.
 *  Point another at /401: same. Stop the fixture entirely: that tile shows DATA_UNAVAILABLE.
 *  Three distinct states, three distinct renderings."
 */

const { spawn } = require('child_process');
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchJson(url);
      if (res.status === 200 || res.status === 404) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Server failed to start at ${url} within ${timeoutMs}ms`);
}

async function run() {
  console.log('=== RUNNING PHASE 1b LAUNCH VALIDATION (Section 23.4) ===');

  // 1. Start fixture upstream server on port 9099
  const fixtureProc = spawn(process.execPath, ['tools/validation/fixture-upstream/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, FIXTURE_PORT: '9099' },
    stdio: 'pipe'
  });

  await waitForServer('http://127.0.0.1:9099/sonarqube/api/system/status');
  console.log('[CHECK] Fixture upstream running on :9099');

  // 2. Start Sentinel backend on port 3001 with test environment URLs mapped to fixture routes
  const serverProc = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SENTINEL_JWT_SECRET: JWT_SECRET,
      PORT: '3001',
      ENVIRONMENT: 'staging',
      PROD_JENKINS_MASTER_URL: 'http://127.0.0.1:9099/302-idp',
      STG_JENKINS_MASTER_URL: 'http://127.0.0.1:9099/302-idp',
      JENKINS_MASTER_URL: 'http://127.0.0.1:9099/302-idp',
      PROD_ARTIFACTORY_API: 'http://127.0.0.1:9099/401',
      STG_ARTIFACTORY_API: 'http://127.0.0.1:9099/401',
      ARTIFACTORY_API: 'http://127.0.0.1:9099/401',
      PROD_SONARQUBE_API: 'http://127.0.0.1:9998/sonarqube',
      STG_SONARQUBE_API: 'http://127.0.0.1:9998/sonarqube',
      SONARQUBE_API: 'http://127.0.0.1:9998/sonarqube',
      PROD_TEAMCITY_API: 'http://127.0.0.1:9099/teamcity/app/rest',
      STG_TEAMCITY_API: 'http://127.0.0.1:9099/teamcity/app/rest',
      TEAMCITY_API: 'http://127.0.0.1:9099/teamcity/app/rest'
    },
    stdio: 'pipe'
  });

  serverProc.stdout.on('data', d => process.stdout.write(`[SERVER] ${d}`));
  serverProc.stderr.on('data', d => process.stderr.write(`[SERVER-ERR] ${d}`));

  try {
    await waitForServer('http://localhost:3001/healthz');
    console.log('[CHECK] Backend server healthy on :3001');

    // Wait for the high tier collection cycle to run (10s cycle, wait 12s)
    console.log('[CHECK] Waiting for collector cycle to execute against targets...');
    await new Promise(r => setTimeout(r, 12000));

    // 3. Query health endpoint
    console.log('[CHECK] Querying GET /api/health?environment=staging');
    const healthRes = await fetchJson('http://localhost:3001/api/health?environment=staging');
    assert.strictEqual(healthRes.status, 200);

    const statuses = healthRes.data?.componentStatuses || {};
    console.log('[CHECK] Discovered Component Statuses:', statuses);

    // Assert Jenkins is AUTH_FAILED (from /302-idp)
    const jenkinsStatus = statuses['cloudbees_jenkins'] || statuses['jenkins'];
    assert.strictEqual(
      jenkinsStatus,
      'AUTH_FAILED',
      `Expected Jenkins to be AUTH_FAILED (got ${jenkinsStatus})`
    );
    console.log('✔ Verified: Jenkins target (/302-idp) -> AUTH_FAILED');

    // Assert Artifactory is AUTH_FAILED (from /401)
    const artifactoryStatus = statuses['jfrog_artifactory'] || statuses['artifactory'];
    assert.strictEqual(
      artifactoryStatus,
      'AUTH_FAILED',
      `Expected Artifactory to be AUTH_FAILED (got ${artifactoryStatus})`
    );
    console.log('✔ Verified: Artifactory target (/401) -> AUTH_FAILED');

    // Assert SonarQube is DATA_UNAVAILABLE (from unreachable dead port)
    const sonarStatus = statuses['sonarqube'];
    assert.strictEqual(
      sonarStatus,
      'DATA_UNAVAILABLE',
      `Expected SonarQube on dead port to be DATA_UNAVAILABLE (got ${sonarStatus})`
    );
    console.log('✔ Verified: Dead/unreachable target -> DATA_UNAVAILABLE');

    // Assert TeamCity is Healthy (from valid fixture)
    const teamcityStatus = statuses['jetbrains_teamcity'] || statuses['teamcity'];
    assert.strictEqual(
      teamcityStatus,
      'Healthy',
      `Expected TeamCity to be Healthy (got ${teamcityStatus})`
    );
    console.log('✔ Verified: Active target -> Healthy');

    console.log('=== PHASE 1b LAUNCH VALIDATION PASSED SUCCESSFULLY ===');
  } finally {
    serverProc.kill('SIGKILL');
    fixtureProc.kill('SIGKILL');
  }
}

run().catch(err => {
  console.error('=== PHASE 1b LAUNCH VALIDATION FAILED ===', err);
  process.exit(1);
});
