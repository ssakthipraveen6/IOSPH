'use strict';

/**
 * tests/slo_alert_latency.test.js
 *
 * Acceptance test for R2: Alert Detection Latency SLO from data, or UNKNOWN.
 */

const assert = require('assert');
const db = require('@sentinel/database');
const { evaluateSlos } = require('../backend/services/slo/slo_tracker');

console.log('=== RUNNING SLO ALERT DETECTION LATENCY TESTS (R2) ===');

const origGetAlerts = db.getAlerts;

try {
  // Case 1: No alerts -> status === 'UNKNOWN' and current_sli === null
  db.getAlerts = () => [];
  let res = evaluateSlos('staging');
  let slo = res.slos.find(s => s.id === 'alert_detection_latency');
  assert.ok(slo, 'alert_detection_latency SLO must be present');
  assert.strictEqual(slo.current_sli, null);
  assert.strictEqual(slo.error_budget_remaining_percent, null);
  assert.strictEqual(slo.burn_rate, null);
  assert.strictEqual(slo.status, 'UNKNOWN');
  console.log('✔ Case 1 Passed: No alerts -> status UNKNOWN and current_sli null');

  // Case 2: 5 alerts without event_time -> status === 'UNKNOWN' and current_sli === null
  db.getAlerts = () => [
    { id: 'a1', timestamp: Date.now() },
    { id: 'a2', timestamp: Date.now() },
    { id: 'a3', timestamp: Date.now() },
    { id: 'a4', timestamp: Date.now() },
    { id: 'a5', timestamp: Date.now() }
  ];
  res = evaluateSlos('staging');
  slo = res.slos.find(s => s.id === 'alert_detection_latency');
  assert.strictEqual(slo.current_sli, null);
  assert.strictEqual(slo.status, 'UNKNOWN');
  console.log('✔ Case 2 Passed: Alerts without event_time -> status UNKNOWN and current_sli null');

  // Case 3: 10 alerts with event_time: 9 detected within 30 s and 1 after 120 s -> current_sli === 90 and status not HEALTHY
  const now = 1700000000;
  db.getAlerts = () => [
    { id: 'a1', event_time: now, timestamp: now + 5 },
    { id: 'a2', event_time: now, timestamp: now + 10 },
    { id: 'a3', event_time: now, timestamp: now + 15 },
    { id: 'a4', event_time: now, timestamp: now + 20 },
    { id: 'a5', event_time: now, timestamp: now + 25 },
    { id: 'a6', event_time: now, timestamp: now + 28 },
    { id: 'a7', event_time: now, timestamp: now + 29 },
    { id: 'a8', event_time: now, timestamp: now + 30 },
    { id: 'a9', event_time: now, timestamp: now + 12 },
    { id: 'a10', event_time: now, timestamp: now + 120 }
  ];
  res = evaluateSlos('staging');
  slo = res.slos.find(s => s.id === 'alert_detection_latency');
  assert.strictEqual(slo.current_sli, 90);
  assert.notStrictEqual(slo.status, 'HEALTHY');
  console.log('✔ Case 3 Passed: 9/10 within 30s -> current_sli 90, status not HEALTHY (target 95)');

  console.log('=== ALL SLO ALERT DETECTION LATENCY TESTS PASSED ===');
} finally {
  db.getAlerts = origGetAlerts;
}
