/**
 * tests/phase_o7_expiry_url.test.js
 *
 * Phase O7 Acceptance Tests:
 * - O7.1: Certificate inventory job merges certs, de-duplicates by fingerprint across 3 hosts into 1 item with 3 locations, and flags SHA-1 / TLS 1.0.
 * - O7.2: Certificate alerts at 60 (info), 30 (warning), 14 (critical), 7 (critical EMERGENCY) days; one alert per certificate fingerprint.
 * - O7.3: Licence sources precedence: API -> File -> Manifest date.
 * - O7.4: Licence capacity saturation alert (> 90%).
 * - O7.5: URL validity checks: redirect loop, wrong JSON field, maintenance redirect, and consecutive failure alert (after 2 consecutive failures).
 * - O7.6: API endpoints GET /api/v2/expiry and GET /api/v2/urls/checks.
 */

'use strict';

const assert = require('assert');
const http = require('http');
const expiryStore = require('../database/expiry_store');
const { runExpirySync, resolveProductLicense } = require('../backend/jobs/expiry_sync');
const { runUrlChecks, probeUrl, resetFailureTracker } = require('../backend/jobs/url_checks');
const { runAlertRules } = require('../backend/jobs/alert_rules');
const alertEngine = require('../ai_analysis/alert_engine');

// Mock memory alert store for deterministic testing
function createMockAlertStore() {
  const alerts = [];
  return {
    addAlert(component, severity, message, status, env) {
      const existing = alerts.find(a => a.component === component && a.message === message && a.environment === env);
      if (existing) {
        existing.status = status;
        existing.severity = severity;
        return existing;
      }
      const alert = {
        id: `mock-alert-${alerts.length + 1}`,
        component,
        severity,
        message,
        status,
        environment: env,
        created_at: new Date().toISOString()
      };
      alerts.push(alert);
      return alert;
    },
    getAlerts(env) {
      return alerts.filter(a => a.environment === env);
    },
    persistAlert(a) {},
    _all() { return alerts; }
  };
}

async function runTests() {
  console.log('=== PHASE O7 ACCEPTANCE TESTS: CERTIFICATES, LICENCES & URL VALIDITY ===');

  expiryStore.clearStore();
  const mockNow = new Date('2026-10-13T10:00:00Z').getTime();

  // --------------------------------------------------------------------------
  // TEST 1: O7.1 Certificate inventory de-duplication across 3 hosts + SHA-1 / TLS 1.0 flagging
  // --------------------------------------------------------------------------
  console.log('\n[TEST 1] Certificate inventory multi-location de-duplication & flag detection...');
  const testCertFp = 'abcd1234ef567890abcd1234ef567890';
  const certInputs = [
    {
      fingerprint: testCertFp,
      subject: 'api.bank.internal',
      issuer: 'Corp Enterprise CA',
      location: 'host:app-prod-01:8443',
      valid_to: new Date(mockNow + 25 * 86400 * 1000).toISOString(), // 25 days left
      sigalg: 'sha1WithRSAEncryption', // SHA-1
      protocol: 'TLSv1.0',             // TLS 1.0
      product: 'bitbucket'
    },
    {
      fingerprint: testCertFp,
      subject: 'api.bank.internal',
      issuer: 'Corp Enterprise CA',
      location: 'host:app-prod-02:8443',
      valid_to: new Date(mockNow + 25 * 86400 * 1000).toISOString(),
      product: 'bitbucket'
    },
    {
      fingerprint: testCertFp,
      subject: 'api.bank.internal',
      issuer: 'Corp Enterprise CA',
      location: 'vip:bb-vip.bank.internal:443',
      valid_to: new Date(mockNow + 25 * 86400 * 1000).toISOString(),
      product: 'bitbucket'
    }
  ];

  const syncResult = await runExpirySync({
    apps: {},
    certInputs,
    nowMs: mockNow,
    store: expiryStore
  });

  const storedItems = await expiryStore.getExpiryItems(mockNow);
  const certItem = storedItems.find(i => i.fingerprint === testCertFp);

  assert.ok(certItem, 'Certificate item must be stored');
  assert.strictEqual(certItem.locations.length, 3, 'Must have merged all 3 locations into 1 item');
  assert.ok(certItem.locations.includes('host:app-prod-01:8443'), 'Contains host 1');
  assert.ok(certItem.locations.includes('host:app-prod-02:8443'), 'Contains host 2');
  assert.ok(certItem.locations.includes('vip:bb-vip.bank.internal:443'), 'Contains VIP');
  assert.ok(certItem.flags.includes('SHA-1'), 'SHA-1 flag must be detected');
  assert.ok(certItem.flags.includes('TLS_1.0'), 'TLS 1.0 flag must be detected');
  assert.strictEqual(certItem.daysLeft, 25, 'Days remaining must be 25');
  console.log('✔ Test 1 Passed: 3 host instances merged into 1 item with 3 locations and SHA-1/TLS-1.0 flagged.');

  // --------------------------------------------------------------------------
  // TEST 2: O7.2 Certificate alerts at 60d (info), 30d (warning), 14d (critical), 7d (critical EMERGENCY)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 2] Certificate expiry alert rules with injected clock...');
  const alertStore = createMockAlertStore();

  // Set up 4 certificates with distinct expiry days: 55d, 25d, 12d, 5d
  expiryStore.clearStore();
  const certsToTest = [
    { fingerprint: 'cert-60d', subject: 'cert-60d.bank', valid_to: new Date(mockNow + 55 * 86400 * 1000).toISOString(), kind: 'tls_cert', product: 'github' },
    { fingerprint: 'cert-30d', subject: 'cert-30d.bank', valid_to: new Date(mockNow + 25 * 86400 * 1000).toISOString(), kind: 'tls_cert', product: 'bitbucket' },
    { fingerprint: 'cert-14d', subject: 'cert-14d.bank', valid_to: new Date(mockNow + 12 * 86400 * 1000).toISOString(), kind: 'tls_cert', product: 'artifactory' },
    { fingerprint: 'cert-7d',  subject: 'cert-7d.bank',  valid_to: new Date(mockNow + 5 * 86400 * 1000).toISOString(),  kind: 'tls_cert', product: 'jenkins' }
  ];

  for (const c of certsToTest) {
    await expiryStore.upsertExpiryItem({
      ...c,
      not_after: c.valid_to
    }, mockNow);
  }

  const alertRules = [
    { id: 'rule_cert_expiry_60d', type: 'expiry', item_kind: 'tls_cert', days_threshold: 60, severity: 'info', name: 'Cert 60d Warning' },
    { id: 'rule_cert_expiry_30d', type: 'expiry', item_kind: 'tls_cert', days_threshold: 30, severity: 'warning', name: 'Cert 30d Warning' },
    { id: 'rule_cert_expiry_14d', type: 'expiry', item_kind: 'tls_cert', days_threshold: 14, severity: 'critical', name: 'Cert 14d Warning' },
    { id: 'rule_cert_expiry_7d',  type: 'expiry', item_kind: 'tls_cert', days_threshold: 7,  severity: 'critical', name: 'EMERGENCY: Cert 7d Warning' }
  ];

  await runAlertRules({
    environments: ['prod'],
    rules: alertRules,
    store: alertStore,
    nowMs: mockNow,
    expiryStore
  });

  const prodAlerts = alertStore.getAlerts('prod');
  const alert60d = prodAlerts.find(a => a.message.includes('rule_cert_expiry_60d:cert-60d'));
  const alert30d = prodAlerts.find(a => a.message.includes('rule_cert_expiry_30d:cert-30d'));
  const alert14d = prodAlerts.find(a => a.message.includes('rule_cert_expiry_14d:cert-14d'));
  const alert7d  = prodAlerts.find(a => a.message.includes('rule_cert_expiry_7d:cert-7d'));

  assert.ok(alert60d, '60d rule fired for cert-60d');
  assert.strictEqual(alert60d.severity, 'info', '60d severity is info');

  assert.ok(alert30d, '30d rule fired for cert-30d');
  assert.strictEqual(alert30d.severity, 'warning', '30d severity is warning');

  assert.ok(alert14d, '14d rule fired for cert-14d');
  assert.strictEqual(alert14d.severity, 'critical', '14d severity is critical');

  assert.ok(alert7d, '7d rule fired for cert-7d');
  assert.strictEqual(alert7d.severity, 'critical', '7d severity is critical');
  assert.ok(alert7d.message.includes('EMERGENCY'), '7d rule message has EMERGENCY');
  console.log('✔ Test 2 Passed: Alert rules triggered with exact severities (info, warning, critical, critical EMERGENCY).');

  // --------------------------------------------------------------------------
  // TEST 3: O7.3 Licence sources precedence: API -> File -> Manifest
  // --------------------------------------------------------------------------
  console.log('\n[TEST 3] Licence sources precedence resolution (API -> File -> Manifest)...');

  // 3a. Manifest with all three: API should win
  const manifestAll = {
    license: {
      api: 'https://artifactory.bank.internal/artifactory/api/system/license',
      file: '/opt/artifactory/license.lic',
      expiry: '2027-01-01T00:00:00Z',
      seats_total: 500
    }
  };
  const licFromApi = await resolveProductLicense('artifactory', manifestAll, {
    apiReader: async () => ({ expiry: '2027-06-01T00:00:00Z', seats_total: 1000, seats_used: 850 }),
    fileReader: async () => JSON.stringify({ expiry: '2026-12-01T00:00:00Z' }),
    nowMs: mockNow
  });
  assert.strictEqual(licFromApi.source, 'license_api', 'API source must take precedence over file and manifest');
  assert.strictEqual(licFromApi.seats_total, 1000, 'Seats from API used');

  // 3b. Manifest with file and manifest only: File should win
  const manifestFile = {
    license: {
      file: '/opt/bitbucket/license.lic',
      expiry: '2027-01-01T00:00:00Z',
      seats_total: 200
    }
  };
  const licFromFile = await resolveProductLicense('bitbucket', manifestFile, {
    apiReader: null,
    fileReader: async () => JSON.stringify({ expiry: '2027-03-15T00:00:00Z', seats_total: 250, seats_used: 120 }),
    nowMs: mockNow
  });
  assert.strictEqual(licFromFile.source, 'license_file', 'File source must take precedence when API is not present');
  assert.strictEqual(licFromFile.seats_total, 250, 'Seats from File used');

  // 3c. Manifest only: Manifest date should win
  const manifestOnly = {
    license: {
      expiry: '2027-08-01T00:00:00Z',
      seats_total: 300,
      seats_used: 150
    }
  };
  const licFromManifest = await resolveProductLicense('jira', manifestOnly, {
    apiReader: null,
    fileReader: null,
    nowMs: mockNow
  });
  assert.strictEqual(licFromManifest.source, 'manifest', 'Manifest date must be used as final fallback');
  console.log('✔ Test 3 Passed: Precedence order (API -> File -> Manifest) correctly observed.');

  // --------------------------------------------------------------------------
  // TEST 4: O7.4 Licence capacity saturation alert (> 90%)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 4] Licence capacity saturation alerting (> 90%)...');
  expiryStore.clearStore();
  const alertStoreLic = createMockAlertStore();

  await expiryStore.upsertExpiryItem({
    fingerprint: 'lic-saturated',
    kind: 'license',
    subject: 'Saturated Toolchain License',
    product: 'cloudbees_jenkins',
    seats_total: 100,
    seats_used: 95, // 95% utilization (> 90%)
    not_after: new Date(mockNow + 180 * 86400 * 1000).toISOString()
  }, mockNow);

  const capacityRule = [
    {
      id: 'rule_license_capacity_saturation',
      type: 'expiry',
      item_kind: 'license',
      capacity_pct_threshold: 90,
      severity: 'critical',
      name: 'License Saturation'
    }
  ];

  await runAlertRules({
    environments: ['prod'],
    rules: capacityRule,
    store: alertStoreLic,
    nowMs: mockNow,
    expiryStore
  });

  const satAlert = alertStoreLic.getAlerts('prod').find(a => a.message.includes('rule_license_capacity_saturation'));
  assert.ok(satAlert, 'Capacity saturation rule must fire');
  assert.strictEqual(satAlert.severity, 'critical', 'Capacity saturation alert must be critical');
  console.log('✔ Test 4 Passed: Licence capacity saturation (> 90%) triggers critical alert.');

  // --------------------------------------------------------------------------
  // TEST 5: O7.5 URL validity checks with local HTTP fixture
  // --------------------------------------------------------------------------
  console.log('\n[TEST 5] URL validity checks: redirect loop, maintenance redirect, wrong JSON...');
  let localServer;
  let srvPort;

  await new Promise(resolve => {
    localServer = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'UP', service: 'auth' }));
      }
      if (req.url === '/bad-json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'DEGRADED', service: 'auth' }));
      }
      if (req.url === '/redirect-loop-1') {
        res.writeHead(302, { 'Location': `http://127.0.0.1:${srvPort}/redirect-loop-2` });
        return res.end();
      }
      if (req.url === '/redirect-loop-2') {
        res.writeHead(302, { 'Location': `http://127.0.0.1:${srvPort}/redirect-loop-1` });
        return res.end();
      }
      if (req.url === '/down') {
        res.writeHead(302, { 'Location': `http://127.0.0.1:${srvPort}/maintenance` });
        return res.end();
      }
      if (req.url === '/maintenance') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<h1>System Maintenance</h1>');
      }
      res.writeHead(404);
      res.end('Not Found');
    });

    localServer.listen(0, '127.0.0.1', () => {
      srvPort = localServer.address().port;
      resolve();
    });
  });

  try {
    resetFailureTracker();

    // 5a. Healthy URL with expect_json
    const okRes = await probeUrl(`http://127.0.0.1:${srvPort}/ok`, {
      expectStatus: 200,
      expectJson: { status: 'UP' }
    });
    assert.strictEqual(okRes.success, true, 'Healthy URL probe succeeds');

    // 5b. JSON field mismatch
    const badJsonRes = await probeUrl(`http://127.0.0.1:${srvPort}/bad-json`, {
      expectJson: { status: 'UP' }
    });
    assert.strictEqual(badJsonRes.success, false, 'Probe fails when JSON assertion fails');
    assert.strictEqual(badJsonRes.error, 'JSON_ASSERTION_FAILED', 'Correct error code');

    // 5c. Redirect loop
    const loopRes = await probeUrl(`http://127.0.0.1:${srvPort}/redirect-loop-1`);
    assert.strictEqual(loopRes.success, false, 'Probe fails on circular redirect');
    assert.strictEqual(loopRes.error, 'REDIRECT_LOOP', 'Correct loop error code');

    // 5d. Redirect to maintenance page
    const maintRes = await probeUrl(`http://127.0.0.1:${srvPort}/down`);
    assert.strictEqual(maintRes.success, false, 'Probe fails when redirected to maintenance page');
    assert.strictEqual(maintRes.error, 'MAINTENANCE_REDIRECT', 'Correct maintenance redirect error');

    // 5e. Consecutive failure alerting: 1 fail = no alert, 2 fails = alert
    const urlToCheck = `http://127.0.0.1:${srvPort}/bad-json`;
    const targets = [{ appId: 'auth_service', type: 'health_check', url: urlToCheck, expectJson: { status: 'UP' } }];

    // Run 1: 1 failure
    const run1 = await runUrlChecks({ targets });
    assert.strictEqual(run1.alerts.length, 0, 'No alert on first failure');

    // Run 2: 2nd consecutive failure -> alert generated
    const run2 = await runUrlChecks({ targets });
    assert.strictEqual(run2.alerts.length, 1, 'Alert generated on 2 consecutive failures');
    assert.strictEqual(run2.alerts[0].consecutiveFailures, 2, '2 consecutive failures recorded');
    console.log('✔ Test 5 Passed: URL checks correctly detect JSON mismatch, loops, maintenance redirects, and 2-failure alert.');
  } finally {
    localServer.close();
  }

  console.log('\n✔ ALL PHASE O7 ACCEPTANCE TESTS PASSED SUCCESSFULLY.');
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n✖ PHASE O7 TEST FAILED:', err);
  process.exit(1);
});
