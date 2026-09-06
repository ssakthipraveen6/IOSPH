const assert = require('assert');
const teamRotaService = require('../apps/api/src/services/ai_analysis/team_rota_service');
const dynatraceCollector = require('../apps/collector/src/metrics_collection/real/dynatrace/dynatrace_collector');

console.log('======================================================');
console.log('🧪 RUNNING MISC MONTHLY EXCEL ROTA TEST SUITE');
console.log('======================================================');

// Test 1: Fetch All 3 Monthly Rotas (Core, BAU, Montreal)
const allRotas = teamRotaService.getAllRotas();
assert.ok(allRotas.core, 'Core rota must exist');
assert.ok(allRotas.bau, 'BAU rota must exist');
assert.ok(allRotas.montreal, 'Montreal rota must exist');

assert.ok(Array.isArray(allRotas.core.tableRows), 'Core must have tableRows array');
assert.ok(Array.isArray(allRotas.bau.tableRows), 'BAU must have tableRows array');
assert.ok(Array.isArray(allRotas.montreal.tableRows), 'Montreal must have tableRows array');

assert.ok(allRotas.core.tableRows.length >= 30, `Core table must have full month (got ${allRotas.core.tableRows.length} days)`);
assert.ok(allRotas.bau.tableRows.length >= 30, `BAU table must have full month (got ${allRotas.bau.tableRows.length} days)`);
assert.ok(allRotas.montreal.tableRows.length >= 30, `Montreal table must have full month (got ${allRotas.montreal.tableRows.length} days)`);

console.log(`✔ Test 1 Passed: All 3 Monthly Rotas verified with full month schedules [Core: ${allRotas.core.tableRows.length} days, BAU: ${allRotas.bau.tableRows.length} days, Montreal: ${allRotas.montreal.tableRows.length} days]`);

// Test 2: Generate Monthly Excel Template for Montreal & BAU
const mtlTemplateBuffer = teamRotaService.generateExcelTemplate('montreal');
assert.ok(Buffer.isBuffer(mtlTemplateBuffer), 'Should return valid Excel buffer');
assert.ok(mtlTemplateBuffer.length > 500, 'Excel buffer should contain template data');
console.log(`✔ Test 2 Passed: Montreal Monthly Excel template generated successfully (${mtlTemplateBuffer.length} bytes)`);

// Test 3: Parse and Apply Excel Buffer to Montreal Rota
const updatedRotas = teamRotaService.parseAndApplyExcel(mtlTemplateBuffer, 'montreal');
assert.ok(updatedRotas.montreal, 'Updated Montreal rota must exist');
assert.ok(updatedRotas.montreal.tableRows.length >= 30, 'Parsed monthly rows must be present');
console.log(`✔ Test 3 Passed: Successfully parsed and applied Excel buffer (${updatedRotas.montreal.tableRows.length} rows) to Montreal Rota`);

// Test 4: Dynatrace Active Problems Retrieval
(async () => {
  const problems = await dynatraceCollector.getActiveProblems();
  assert.ok(Array.isArray(problems), 'Problems must be an array');
  assert.ok(problems.length > 0, 'Should return active problems');
  const prob = problems[0];
  assert.ok(prob.problemId, 'Problem ID must exist');
  assert.ok(prob.severityLevel, 'Severity level must exist');
  assert.ok(prob.davisAiSummary, 'Davis AI summary must exist');
  console.log(`✔ Test 4 Passed: Dynatrace active problems retrieved: [${prob.problemId}] ${prob.title}`);
  
  console.log('\n======================================================');
  console.log('📊 ALL MONTHLY MULTI-ROTA & EXCEL TESTS PASSED');
  console.log('======================================================');
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
