const assert = require('assert');
const db = require('../database/db');
const { SEVERITY } = require('@sentinel/shared-constants');
const realAnalyzer = require('../ai_analysis/real_analyzer');

console.log('======================================================');
console.log('🧪 RUNNING ALERT ENVIRONMENT TAGGING TESTS (T0.2)');
console.log('======================================================');

// Test 1: Direct db.addAlert with prod env
const directAlert = db.addAlert('jenkins_k8s', SEVERITY.CRITICAL, 'Disk volume 95% full', 'Active', 'prod');
assert.strictEqual(directAlert.env, 'prod', 'Alert must be tagged with prod');
assert.strictEqual(directAlert.status, 'Active', 'Alert status must be Active');

const prodAlerts = db.getAlerts('prod');
const foundInProd = prodAlerts.some(a => a.id === directAlert.id);
assert.strictEqual(foundInProd, true, 'Alert raised for prod must be returned by getAlerts("prod")');

const stgAlerts = db.getAlerts('staging');
const foundInStg = stgAlerts.some(a => a.id === directAlert.id);
assert.strictEqual(foundInStg, false, 'Alert raised for prod must NOT be returned by getAlerts("staging")');
console.log('✔ Test 1 Passed: Direct alert for prod isolated strictly from staging.');

// Test 2: AI Analyzer pattern matching in prod mode
const fakeLogLine = 'OutOfMemoryError: Java heap space on Artifactory Node 1';
realAnalyzer.analyzeServerLogs([fakeLogLine], () => {}, null, 'prod');

const prodAlertsAfterAi = db.getAlerts('prod');
const artifactoryAiAlert = prodAlertsAfterAi.find(a => a.component === 'artifactory' && a.message.includes('OutOfMemoryError'));
assert.ok(artifactoryAiAlert, 'AI Analyzer must generate alert for Artifactory in prod');
assert.strictEqual(artifactoryAiAlert.env, 'prod', 'AI alert must be tagged with prod environment');
assert.strictEqual(artifactoryAiAlert.status, 'Active', 'AI alert status must be Active, NOT prod');

const stgAlertsAfterAi = db.getAlerts('staging');
const leakedToStaging = stgAlertsAfterAi.some(a => a.id === artifactoryAiAlert.id);
assert.strictEqual(leakedToStaging, false, 'AI alert for prod must NOT leak into staging alerts');
console.log('✔ Test 2 Passed: AI analyzer raises alert for prod with status Active and env prod.');

console.log('======================================================');
console.log('✅ ALL ALERT ENVIRONMENT TAGGING TESTS PASSED!');
console.log('======================================================\n');
process.exit(0);
