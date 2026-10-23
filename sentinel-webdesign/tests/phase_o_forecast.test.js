/**
 * tests/phase_o_forecast.test.js
 *
 * Phase O1 / O1.3 Forecast Helper Unit Tests:
 * Tests analytics/forecast.js linearRunway with fixed series and literal expected days.
 */
'use strict';

const assert = require('assert');
const { linearRunway } = require('../analytics/forecast');

function main() {
  console.log('=== PHASE O1.3: CAPACITY AND FORECAST HELPER TESTS ===');

  const DAY_MS = 86400 * 1000;
  const baseTime = 1728000000000; // Fixed epoch timestamp

  // 1. Fixed linear series: 2.0 units per day growth
  // 50 -> 52 -> 54 -> 56 -> 58
  const steadyPoints = [
    { ts: baseTime + 0 * DAY_MS, value: 50 },
    { ts: baseTime + 1 * DAY_MS, value: 52 },
    { ts: baseTime + 2 * DAY_MS, value: 54 },
    { ts: baseTime + 3 * DAY_MS, value: 56 },
    { ts: baseTime + 4 * DAY_MS, value: 58 }
  ];
  const limit1 = 100; // Remaining: 100 - 58 = 42; 42 / 2 = 21.0 days

  const res1 = linearRunway(steadyPoints, limit1);
  assert.strictEqual(res1.slope_per_day, 2, 'Slope must be exactly 2.0 units per day');
  assert.strictEqual(res1.days_to_full_7d, 21.0, '7d days to full must be exactly 21.0 days');
  assert.strictEqual(res1.days_to_full_30d, 21.0, '30d days to full must be exactly 21.0 days');
  console.log('✔ Passed: steady growth yields literal expected slope and days to full');

  // 2. Decreasing trend (slope <= 0)
  const shrinkingPoints = [
    { ts: baseTime + 0 * DAY_MS, value: 80 },
    { ts: baseTime + 1 * DAY_MS, value: 75 },
    { ts: baseTime + 2 * DAY_MS, value: 70 }
  ];
  const res2 = linearRunway(shrinkingPoints, 100);
  assert.strictEqual(res2.slope_per_day, -5, 'Slope must be -5');
  assert.strictEqual(res2.days_to_full_7d, null, 'Negative slope must return null days_to_full');
  assert.strictEqual(res2.days_to_full_30d, null, 'Negative slope must return null days_to_full');
  console.log('✔ Passed: decreasing trend returns null for days_to_full');

  // 3. Fewer than N points (0 or 1 point)
  const emptyRes = linearRunway([], 100);
  assert.deepStrictEqual(emptyRes, { days_to_full_7d: null, days_to_full_30d: null, slope_per_day: null });

  const singleRes = linearRunway([{ ts: baseTime, value: 50 }], 100);
  assert.deepStrictEqual(singleRes, { days_to_full_7d: null, days_to_full_30d: null, slope_per_day: null });
  console.log('✔ Passed: insufficient points return all nulls');

  // 4. Resource already at or exceeding limit
  const fullPoints = [
    { ts: baseTime + 0 * DAY_MS, value: 95 },
    { ts: baseTime + 1 * DAY_MS, value: 100 }
  ];
  const resFull = linearRunway(fullPoints, 100);
  assert.strictEqual(resFull.days_to_full_7d, 0, 'Resource already full must return 0 days');
  assert.strictEqual(resFull.days_to_full_30d, 0, 'Resource already full must return 0 days');
  console.log('✔ Passed: already full resource returns 0 days');

  // 5. Distinct 7-day spike vs 30-day baseline
  // Over 20 days: 10 -> 20 (0.5/day)
  // Last 3 days: 20 -> 25 -> 30 (5.0/day)
  const accelPoints = [
    { ts: baseTime - 20 * DAY_MS, value: 10 },
    { ts: baseTime - 15 * DAY_MS, value: 12.5 },
    { ts: baseTime - 10 * DAY_MS, value: 15 },
    { ts: baseTime - 5 * DAY_MS, value: 17.5 },
    { ts: baseTime - 2 * DAY_MS, value: 20 },
    { ts: baseTime - 1 * DAY_MS, value: 25 },
    { ts: baseTime + 0 * DAY_MS, value: 30 } // latest: 30
  ];
  const limit5 = 100; // Remaining: 100 - 30 = 70
  const resAccel = linearRunway(accelPoints, limit5);
  assert.ok(resAccel.days_to_full_7d !== null, '7d projection must be defined');
  assert.ok(resAccel.days_to_full_30d !== null, '30d projection must be defined');
  assert.ok(resAccel.days_to_full_7d < resAccel.days_to_full_30d, 'Recent spike in 7d projection must predict sooner full date than 30d baseline');
  console.log(`✔ Passed: distinct 7d spike (${resAccel.days_to_full_7d}d) vs 30d baseline (${resAccel.days_to_full_30d}d)`);

  console.log('\n✔ ALL PHASE O1.3 FORECAST HELPER TESTS PASSED');
}

main();
