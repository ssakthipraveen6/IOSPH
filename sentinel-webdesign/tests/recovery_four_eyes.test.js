/**
 * Test: remediation needs two approvers; bypass attempts are refused.
 */
const assert = require('assert');
const db = require('../database/db');
const { triggerRecovery, approveRecovery, getActiveRecoveries } = require('../remediation/recovery');

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

// --- Test 6: SF-11 Case-insensitive SOD and deduplication ---
getActiveRecoveries().clear();
// 6a: Initiator 'jsmith' vs approver 'JSMITH' -> SOD violation
const sodRunCase = triggerRecovery('database', 'Failover test', { manual: false, env: 'prod', initiatedBy: 'jsmith' });
const sodResultCase = approveRecovery(sodRunCase.id, { username: 'JSMITH', role: 'Super Admin' });
assert.ok(sodResultCase && typeof sodResultCase === 'object' && sodResultCase.error, 'Approval by JSMITH for jsmith initiated run must fail SOD');
assert.ok(sodResultCase.error.includes('SOD violation'), 'Error must specify SOD violation');
console.log('✔ Test 6a Passed: Initiator jsmith cannot be approved by JSMITH (case-insensitive SOD).');

getActiveRecoveries().clear();
// 6b: Approver 'a.lead' and 'A.LEAD' count once
const multiRun = triggerRecovery('database', 'Lag test', { manual: false, env: 'prod', initiatedBy: 'other.user' });
const app1 = approveRecovery(multiRun.id, { username: 'a.lead', role: 'SRE Lead' });
assert.strictEqual(app1, true);
const app2 = approveRecovery(multiRun.id, { username: 'A.LEAD', role: 'SRE Lead' });
const currentMultiRun = db.getRecoveryLogs('prod').find(r => r.id === multiRun.id) || multiRun;
assert.strictEqual(currentMultiRun.approvals.length, 1, 'Approvals by a.lead and A.LEAD must count as only 1 signature');
console.log('✔ Test 6b Passed: a.lead and A.LEAD deduplicated to 1 signature.');

// 6c: LDAP canonical username in production
async function testLdapCanonical() {
  const EventEmitter = require('events');
  const ldap = require('ldapjs');
  const credentialProvider = require('../backend/config/cyberark/credential_provider');
  const ldapClient = require('../backend/auth/ldap_client');

  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const origGetCred = credentialProvider.getCredential;
  const origCreateClient = ldap.createClient;

  credentialProvider.getCredential = async () => 'stub_bind_pw';

  ldap.createClient = () => {
    const emitter = new EventEmitter();
    emitter.bind = (dn, pw, cb) => cb(null);
    emitter.unbind = (cb) => { if (cb) cb(); };
    emitter.search = (base, opts, cb) => {
      const resEmitter = new EventEmitter();
      cb(null, resEmitter);
      process.nextTick(() => {
        resEmitter.emit('searchEntry', {
          object: {
            dn: 'cn=jsmith,dc=enterprise,dc=corp',
            sAMAccountName: 'jsmith',
            mail: 'jsmith@enterprise.corp',
            memberOf: [
              'cn=sentinel-operators,ou=Groups,dc=enterprise,dc=corp',
              'cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp'
            ]
          }
        });
        resEmitter.emit('end', { status: 0 });
      });
    };
    return emitter;
  };

  try {
    const authRes = await ldapClient.authenticate('JSMITH', 'some_pw');
    assert.strictEqual(authRes.success, true);
    assert.strictEqual(authRes.user.username, 'jsmith', 'LDAP authentication must return lowercase canonical username');
    console.log('✔ Test 6c Passed: authenticate("JSMITH") returns canonical username "jsmith".');
  } finally {
    process.env.NODE_ENV = oldEnv;
    credentialProvider.getCredential = origGetCred;
    ldap.createClient = origCreateClient;
  }
}

testLdapCanonical().then(() => {
  console.log('======================================================');
  console.log('✅ ALL FOUR-EYES RECOVERY TESTS PASSED!');
  console.log('======================================================\n');
  process.exit(0);
}).catch(err => {
  console.error('Test 6c failed:', err);
  process.exit(1);
});
return;


