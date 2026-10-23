'use strict';

/**
 * tests/dashboards.test.js
 *
 * M7 Task 7.2 Test Suite: Dashboard builder schema validation,
 * persistence with fallback, file-based sync, and round-trip export/import.
 */

const assert = require('assert');
const dashboardService = require('../backend/services/dashboardService');

async function runTests() {
  console.log('=== Running Dashboard Builder Test Suite ===\n');

  // 1. Initial file loading from config/dashboards/
  console.log('[TEST 1] Loading dashboards from config/dashboards/ files...');
  const initialList = await dashboardService.listDashboards('production');
  assert(Array.isArray(initialList), 'should return an array of dashboards');
  assert(initialList.length >= 2, `expected at least 2 starter dashboards, found ${initialList.length}`);

  const overview = await dashboardService.getDashboard('toolchain-overview');
  assert(overview, 'overview dashboard should be retrievable by slug');
  assert.strictEqual(overview.title, 'DevOps Toolchain Overview');
  assert(overview.panels.length >= 3, 'overview dashboard must have panels');
  console.log('  -> PASSED: Successfully loaded initial dashboards from files');

  // 2. Schema Validation
  console.log('[TEST 2] Schema validation for dashboard creation...');
  assert.throws(() => {
    dashboardService.validateDashboard({});
  }, /Dashboard title is required/);

  assert.throws(() => {
    dashboardService.validateDashboard({ title: 'Invalid', panels: 'not an array' });
  }, /Dashboard panels must be an array/);

  assert.throws(() => {
    dashboardService.validateDashboard({
      title: 'Invalid Panel Type',
      panels: [{ title: 'Bad', type: 'unsupported_type', query: 'metrics' }]
    });
  }, /Invalid panel type 'unsupported_type'/);

  assert.throws(() => {
    dashboardService.validateDashboard({
      title: 'Missing Query',
      panels: [{ title: 'Bad', type: 'stat', query: '' }]
    });
  }, /requires a valid SentinelQL query/);
  console.log('  -> PASSED: Schema validation rules enforced');

  // 3. Create & Retrieve New Dashboard
  console.log('[TEST 3] Creating and retrieving a custom dashboard...');
  const customData = {
    title: 'Custom Artifactory Analytics',
    description: 'Artifactory journey steps and repository response times',
    tags: ['artifactory', 'custom'],
    environment: 'production',
    panels: [
      {
        id: 'p-1',
        title: 'Artifactory P95 Latency',
        type: 'time_series',
        query: 'metrics where product = "artifactory" and metric = "journey.step.duration_ms" | percentile(95) by step every 5m since 6h',
        layout: { x: 0, y: 0, w: 12, h: 4 },
        options: { unit: 'ms' }
      }
    ]
  };

  const saved = await dashboardService.saveDashboard(customData, 'lead_sre');
  assert(saved.id, 'saved dashboard must have an id');
  assert.strictEqual(saved.title, 'Custom Artifactory Analytics');
  assert.strictEqual(saved.created_by, 'lead_sre');

  const retrieved = await dashboardService.getDashboard(saved.id);
  assert.strictEqual(retrieved.id, saved.id);
  assert.strictEqual(retrieved.panels.length, 1);
  console.log('  -> PASSED: Custom dashboard successfully saved and retrieved');

  // 4. Update Dashboard
  console.log('[TEST 4] Updating an existing dashboard...');
  const updatedData = {
    ...retrieved,
    description: 'Updated description for Artifactory analytics'
  };
  const updated = await dashboardService.saveDashboard(updatedData, 'lead_sre');
  assert.strictEqual(updated.description, 'Updated description for Artifactory analytics');
  console.log('  -> PASSED: Dashboard successfully updated');

  // 5. Round-trip Export and Import
  console.log('[TEST 5] Verifying round-trip export and import...');
  const exportedJson = dashboardService.exportDashboard(updated);
  assert(typeof exportedJson === 'string', 'export must return a JSON string');

  const parsedExport = JSON.parse(exportedJson);
  assert.strictEqual(parsedExport.id, updated.id);
  assert.strictEqual(parsedExport.title, updated.title);
  assert.strictEqual(parsedExport.panels.length, 1);
  assert.strictEqual(parsedExport.panels[0].query, updated.panels[0].query);

  // Import as a cloned/new dashboard
  const cloneDefinition = {
    ...parsedExport,
    id: 'dash-cloned-001',
    slug: 'custom-artifactory-analytics-cloned',
    title: 'Custom Artifactory Analytics (Cloned)'
  };
  const imported = await dashboardService.importDashboard(cloneDefinition, 'auditor');
  assert.strictEqual(imported.id, 'dash-cloned-001');
  assert.strictEqual(imported.title, 'Custom Artifactory Analytics (Cloned)');
  assert.strictEqual(imported.panels[0].query, updated.panels[0].query);
  console.log('  -> PASSED: Round-trip export and import verified');

  // 6. Delete Dashboard
  console.log('[TEST 6] Deleting a dashboard...');
  const deleted = await dashboardService.deleteDashboard('dash-cloned-001');
  assert.strictEqual(deleted, true, 'delete should return true for existing dashboard');
  const postDelete = await dashboardService.getDashboard('dash-cloned-001');
  assert.strictEqual(postDelete, null, 'deleted dashboard should return null');
  console.log('  -> PASSED: Dashboard successfully deleted');

  console.log('\n=== All Dashboard Builder Tests Passed Successfully ===');
}

runTests().catch(err => {
  console.error('\n[FATAL] Dashboard builder test failed:', err);
  process.exit(1);
});
