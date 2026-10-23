/**
 * Test: remediation needs two approvers; bypass attempts are refused.
 */
const assert = require('assert');
const db = require('../database/db');
const { triggerRecovery, approveRecovery } = require('../remediation/recovery');

console.log('======================================================');
console.log('🧪 RUNNING FOUR-EYES RECOVERY APPROVAL & BYPASS TESTS');
console.log('======================================================');

// Ensure autonomousMode is false so approval queue is required
db.updateSettings({ autonomousMode: false });

// Test 1: Auto-triggered recovery with env lands in Awaiting-Approval, NOT In-Progress
const run = triggerRecovery('database', 'High replication lag detected', { manual: false, env: 'prod' });
assert.ok(run, 'Recovery run must be created');
assert.strictEqual(run.status, 'Awaiting-Approval', `Auto recovery must land in Awaiting-Approval, got ${run.status}`);
const latestStep = run.steps ? run.steps[run.steps.length - 1] : '';
assert.ok(latestStep.includes('0 of 2 signatures'), 'Must require 2 signatures');
console.log('✔ Test 1 Passed: Auto-triggered recovery lands in Awaiting-Approval without bypassing queue.');

// Test 2: First approver registers 1 of 2 signatures
const approver1 = { username: 'sarah.jenkins@enterprise.corp', role: 'SRE Lead' };
const res1 = approveRecovery(run.id, approver1);
assert.strictEqual(res1, true, 'First approval must succeed');

const runAfter1 = db.getRecoveryLogs('prod').find(r => r.id === run.id) || run;
assert.strictEqual(runAfter1.status, 'Awaiting-Approval', 'Status must remain Awaiting-Approval after 1 signature');
assert.strictEqual(runAfter1.approvals.length, 1, 'Must have 1 approval recorded');
const stepAfter1 = runAfter1.steps[runAfter1.steps.length - 1];
assert.ok(stepAfter1.includes('1 of 2'), 'Step must indicate 1 of 2 signatures');
console.log('✔ Test 2 Passed: 1 of 2 signatures recorded, still Awaiting-Approval.');

// Test 3: Self-double approval is rejected (deduplication by username)
const resDuplicate = approveRecovery(run.id, approver1);
assert.strictEqual(runAfter1.approvals.length, 1, 'Duplicate approver must not increment signature count');
console.log('✔ Test 3 Passed: Self-double-approval prevented (same user cannot sign twice).');

// Test 4: Second distinct approver triggers execution (2 of 2 signatures)
const approver2 = { username: 'marcus.vance@enterprise.corp', role: 'Super Admin' };
const res2 = approveRecovery(run.id, approver2);
assert.strictEqual(res2, true, 'Second approval must succeed');

const runAfter2 = db.getRecoveryLogs('prod').find(r => r.id === run.id) || run;
assert.strictEqual(runAfter2.status, 'In-Progress', `Status must transition to In-Progress after 2 distinct signatures, got ${runAfter2.status}`);
assert.strictEqual(runAfter2.approvals.length, 2, 'Must have 2 distinct approvals recorded');
console.log('✔ Test 4 Passed: Second distinct approver completes 2 of 2 signatures -> In-Progress.');

// Test 5: Segregation of Duties (SOD) — Initiator cannot approve their own recovery
const sodRun = triggerRecovery('jenkins_k8s', 'Manual failover requested', { manual: false, env: 'prod', initiatedBy: 'initiator.user@enterprise.corp' });
assert.ok(sodRun, 'SOD test run must be created');
assert.strictEqual(sodRun.initiated_by, 'initiator.user@enterprise.corp', 'Initiator must be recorded on run');

const initiatorApprover = { username: 'initiator.user@enterprise.corp', role: 'Super Admin' };
const sodResult = approveRecovery(sodRun.id, initiatorApprover);
assert.ok(sodResult && typeof sodResult === 'object' && sodResult.error, 'Initiator approval must be rejected with SOD error');
assert.ok(sodResult.error.includes('SOD violation'), 'Error message must specify SOD violation');
console.log('✔ Test 5 Passed: Segregation of Duties strictly enforced (initiator cannot approve).');

console.log('======================================================');
console.log('✅ ALL FOUR-EYES RECOVERY TESTS PASSED!');
console.log('======================================================\n');
process.exit(0);
