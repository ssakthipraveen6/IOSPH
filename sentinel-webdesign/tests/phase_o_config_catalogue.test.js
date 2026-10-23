/**
 * tests/phase_o_config_catalogue.test.js
 *
 * Phase O1 / O1.1 Acceptance:
 * Validates config/component_metrics.yaml and config:check behaviour:
 *  - Shipped catalogue passes with exit 0 (14 kinds, all charts valid).
 *  - Unknown kind fails validation (exit 1).
 *  - Duplicate chart id within a kind fails (exit 1).
 *  - Missing metric list fails (exit 1).
 *  - Bad capacity mapping fails (exit 1).
 *  - Missing catalogue file fails (exit 1).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'config_check.js');

function scratchConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-cfg-o1-'));
  fs.cpSync(path.join(ROOT, 'config'), dir, { recursive: true, filter: src => !src.endsWith('.env') });
  return dir;
}

function check(dir) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, SENTINEL_CONFIG_DIR: dir },
    encoding: 'utf8'
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function withCatalogue(dir, yamlText) {
  fs.writeFileSync(path.join(dir, 'component_metrics.yaml'), yamlText);
}

function main() {
  console.log('=== PHASE O1.1: METRIC CATALOGUE VALIDATION TESTS ===');
  const dirs = [];
  try {
    // 1. Shipped configuration must pass
    let dir = scratchConfig(); dirs.push(dir);
    let r = check(dir);
    assert.strictEqual(r.code, 0, `Shipped config must pass: \n${r.out}`);
    assert.ok(/Metric catalogue: 14 kinds, \d+ charts/.test(r.out), '14 kinds counted in output');

    // 2. Negative test cases
    const scenarios = [
      {
        name: 'unknown kind',
        yaml: 'magic_component:\n  - id: c1\n    title: "Magic"\n    metrics: ["m.one"]\n',
        expectedRegex: /unknown kind "magic_component"/
      },
      {
        name: 'duplicate chart id',
        yaml: 'vip:\n  - id: response_time\n    title: "T1"\n    metrics: ["v1"]\n  - id: response_time\n    title: "T2"\n    metrics: ["v2"]\n',
        expectedRegex: /duplicate chart id "response_time"/
      },
      {
        name: 'missing metric list',
        yaml: 'vip:\n  - id: response_time\n    title: "T1"\n    metrics: []\n',
        expectedRegex: /missing metric list/
      },
      {
        name: 'bad capacity mapping - invalid field',
        yaml: 'host_linux:\n  - id: cpu\n    title: "CPU"\n    metrics: ["cpu"]\n    capacity:\n      bad_key: "something"\n',
        expectedRegex: /bad capacity mapping \(unknown field "bad_key"/
      },
      {
        name: 'bad capacity mapping - non-object',
        yaml: 'host_linux:\n  - id: cpu\n    title: "CPU"\n    metrics: ["cpu"]\n    capacity: "invalid_string"\n',
        expectedRegex: /bad capacity mapping/
      }
    ];

    for (const sc of scenarios) {
      dir = scratchConfig(); dirs.push(dir);
      withCatalogue(dir, sc.yaml);
      r = check(dir);
      assert.strictEqual(r.code, 1, `${sc.name} must fail validation with exit code 1:\n${r.out}`);
      assert.ok(sc.expectedRegex.test(r.out), `${sc.name} output must match ${sc.expectedRegex}:\n${r.out}`);
      console.log(`✔ Passed scenario: ${sc.name}`);
    }

    // 3. Missing catalogue file
    dir = scratchConfig(); dirs.push(dir);
    fs.rmSync(path.join(dir, 'component_metrics.yaml'), { force: true });
    r = check(dir);
    assert.strictEqual(r.code, 1, `Missing catalogue must fail:\n${r.out}`);
    assert.ok(/component_metrics\.yaml is missing/.test(r.out), `Missing error message expected:\n${r.out}`);
    console.log('✔ Passed scenario: missing catalogue file');

    console.log('\n✔ ALL PHASE O1.1 CONFIG CATALOGUE TESTS PASSED');
  } finally {
    dirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  }
}

main();
