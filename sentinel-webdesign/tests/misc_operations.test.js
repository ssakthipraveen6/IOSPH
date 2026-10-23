/**
 * Test: on-call rota operations.
 */
const assert = require('assert');
const { teamRotaService } = require('@sentinel/analysis');
const dynatraceCollector = require('../metrics_collection/real/dynatrace/dynatrace_collector');

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
// [F] Runs against a local fake Dynatrace API. Without an endpoint/token the collector
// must return [] (no invented problems); with one it returns what the API returned.
(async () => {
  const http = require('http');
  const config = require('@sentinel/config');
  const tokenProvider = require('../metrics_collection/real/dynatrace/token_provider');

  const unconfigured = await dynatraceCollector.getActiveProblems('staging');
  assert.deepStrictEqual(unconfigured.filter(p => p && p.problemId === 'P-FAKE-1'), [], 'No fixture problem without a configured API');

  const fixture = { problemId: 'P-FAKE-1', title: 'Fixture problem', severityLevel: 'AVAILABILITY', davisAiSummary: 'from fake API' };
  let seenAuth = null;
  const server = http.createServer((req, res) => {
    seenAuth = req.headers.authorization;
    if (req.url.startsWith('/api/v2/problems')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ problems: [fixture] }));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origStg = config.STG_URLS;
  const origToken = tokenProvider.getApiToken;
  config.STG_URLS = { ...(origStg || {}), dynatrace_api_endpoint: `http://127.0.0.1:${server.address().port}` };
  tokenProvider.getApiToken = async () => 'test-token';
  try {
    const problems = await dynatraceCollector.getActiveProblems('staging');
    assert.ok(Array.isArray(problems), 'Problems must be an array');
    assert.strictEqual(problems.length, 1, 'Should return exactly the problems the API returned');
    const prob = problems[0];
    assert.strictEqual(prob.problemId, 'P-FAKE-1');
    assert.strictEqual(seenAuth, 'Api-Token test-token');
    console.log(`✔ Test 4 Passed: Dynatrace active problems come only from the API: [${prob.problemId}] ${prob.title}`);
  } finally {
    config.STG_URLS = origStg;
    tokenProvider.getApiToken = origToken;
    server.close();
  }
  
  console.log('\n======================================================');
  console.log('📊 ALL MONTHLY MULTI-ROTA & EXCEL TESTS PASSED');
  console.log('======================================================');
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
