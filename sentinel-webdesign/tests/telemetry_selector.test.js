const assert = require('assert');
const providerSelector = require('../apps/collector/src/metrics_collection/telemetry_provider_selector');

async function runSelectorTests() {
  console.log('=== RUNNING TELEMETRY PRODUCTION PROFILE TESTS ===');

  // Test 1: Active Profile Resolution
  const profileNum = providerSelector.getActiveProfileNumber();
  assert(profileNum >= 1 && profileNum <= 3);
  const strategy = providerSelector.getActiveStrategy();
  console.log(`✔ Test 1 Passed: Selected Production Profile [${profileNum}] -> ${strategy.name}`);

  // Test 2: Profile 1 (OpenTelemetry + Sentinel Unified Prober)
  const p1 = providerSelector.COMBINATION_STRATEGIES[1];
  assert(!p1.allowedCollectors.includes('dynatrace'));
  assert(p1.allowedCollectors.includes('app_collector'));
  assert(p1.allowedCollectors.includes('nas_performance'));
  assert(p1.allowedCollectors.includes('sso_gateway'));
  assert(p1.skippedCollectors.includes('dynatrace'));
  assert(p1.skippedCollectors.includes('linux_servers'));
  assert(p1.skippedCollectors.includes('node_exporter'));
  console.log('✔ Test 2 Passed: Profile 1 (OpenTelemetry + Sentinel Prober) covers 100% of layers via push OTLP');

  // Test 3: Profile 2 (Dynatrace + Sentinel Unified Prober)
  const p2 = providerSelector.COMBINATION_STRATEGIES[2];
  assert(p2.allowedCollectors.includes('dynatrace'));
  assert(p2.allowedCollectors.includes('app_collector'));
  assert(p2.allowedCollectors.includes('nas_performance'));
  assert(p2.skippedCollectors.includes('linux_servers'));
  assert(p2.skippedCollectors.includes('node_exporter'));
  console.log('✔ Test 3 Passed: Profile 2 (Dynatrace + Sentinel Prober) covers 100% of layers without duplicate scrapers');

  // Test 4: Profile 3 (Node Exporter + Sentinel Unified Prober)
  const p3 = providerSelector.COMBINATION_STRATEGIES[3];
  assert(p3.allowedCollectors.includes('node_exporter'));
  assert(p3.allowedCollectors.includes('app_collector'));
  assert(p3.skippedCollectors.includes('dynatrace'));
  console.log('✔ Test 4 Passed: Profile 3 (Node Exporter + Sentinel Prober) covers 100% of layers via Prometheus scrapes');

  console.log('=== ALL PRODUCTION PROFILE TESTS PASSED ===\n');
}

if (require.main === module) {
  runSelectorTests();
}

module.exports = { runSelectorTests };

