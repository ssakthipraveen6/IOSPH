/**
 * Test: platform maturity regression suite (phase 3).
 */
const assert = require('assert');
const { evaluateSlos, loadSloConfig } = require('../backend/services/slo/slo_tracker');
const { createIncidentForRecovery, resolveIncidentForRecovery } = require('../remediation/integrations/servicenow_client');
const { auditLog } = require('../backend/audit_logger');
const db = require('../database/db');

async function runPhase3Tests() {
  console.log('======================================================');
  console.log('🧪 RUNNING PHASE 3 PLATFORM MATURITY REGRESSION SUITE');
  console.log('======================================================');

  // --- Test 1: P3-02 SLO & Error Budget Tracker ---
  console.log('\n--- Test 1: Service Level Objectives & Error Budget Evaluation ---');
  const sloConfig = loadSloConfig();
  assert.ok(sloConfig && Array.isArray(sloConfig.slos), 'SLO config must load with slos array');
  assert.ok(sloConfig.slos.length >= 3, 'Must define at least 3 enterprise SLOs');

  const evalResult = evaluateSlos('staging');
  assert.ok(evalResult && Array.isArray(evalResult.slos), 'Evaluation must return slos');
  assert.ok(evalResult.slos.length >= 3);
  
  const recoverySlo = evalResult.slos.find(s => s.id === 'autonomous_recovery_success_rate');
  assert.ok(recoverySlo, 'Recovery SLO must exist');
  assert.ok(recoverySlo.error_budget_remaining_percent >= 0, 'Error budget percent must be >= 0');
  console.log(`✔ Test 1 Passed: Evaluated 3 SLOs successfully (Recovery SLI: ${recoverySlo.current_sli}%, Budget Remaining: ${recoverySlo.error_budget_remaining_percent}%).`);

  // --- Test 2: P3-06 ServiceNow Incident & On-Call Routing ---
  console.log('\n--- Test 2: ServiceNow Incident & On-Call Dispatch ---');
  const mockRecovery = {
    id: 'REC-TEST-SNOW',
    component: 'artifactory',
    action: 'Restart Container',
    triggerReason: 'High JVM Garbage Collection Pauses',
    status: 'Awaiting-Approval',
    env: 'prod'
  };

  const snowTicket = await createIncidentForRecovery(mockRecovery);
  assert.ok(snowTicket, 'ServiceNow ticket must be generated');
  // [M1.1] SENTINEL prepares a draft and never invents an incident number.
  assert.strictEqual(snowTicket.incident_id, null);
  assert.strictEqual(snowTicket.state, 'Draft');
  assert.strictEqual(snowTicket.recovery_id, 'REC-TEST-SNOW');
  assert.strictEqual(snowTicket.urgency, '1 - High', 'Production incidents must have High urgency');
  assert.ok(snowTicket.assigned_to, 'Incident must be assigned to on-call personnel');

  // Test resolution
  const resolvedTicket = await resolveIncidentForRecovery(mockRecovery, 14.5);
  assert.ok(resolvedTicket);
  assert.strictEqual(resolvedTicket.state, 'Resolved');
  console.log(`✔ Test 2 Passed: ServiceNow ticket draft for ${snowTicket.recovery_id} prepared for ${snowTicket.assigned_to}.`);

  // --- Test 3: P3-04 Immutable Audit Event with trace_id ---
  console.log('\n--- Test 3: Immutable Audit Event with Trace Context ---');
  const mockReq = {
    user: { username: 'lead.sre@enterprise.corp', role: 'SRE Lead' },
    ip: '10.240.12.88',
    headers: { 'user-agent': 'Sentinel/CLI', 'x-trace-id': 'trace-12345-p3-audit' },
    traceId: 'trace-12345-p3-audit',
    path: '/api/settings',
    method: 'POST'
  };

  auditLog(mockReq, 'SETTINGS_UPDATE', { autonomousMode: true });
  console.log('✔ Test 3 Passed: Immutable audit event logged with distributed trace_id.');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 3 PLATFORM MATURITY TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase3Tests().catch(err => {
  console.error('❌ Phase 3 Test failed:', err);
  process.exit(1);
});
