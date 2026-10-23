/**
 * tests/phase_q_config_check.test.js
 *
 * Q5: `npm run config:check` validates config/alerts/*.yaml and manifest `watch:` paths.
 * Runs scripts/config_check.js against scratch copies of config/ (SENTINEL_CONFIG_DIR).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-cfg-'));
  fs.cpSync(path.join(ROOT, 'config'), dir, { recursive: true, filter: src => !src.endsWith('.env') });
  return dir;
}

function check(dir) {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, SENTINEL_CONFIG_DIR: dir }, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function withRules(dir, yamlText) {
  fs.writeFileSync(path.join(dir, 'alerts', 'zz_test.yaml'), yamlText);
}

function main() {
  console.log('=== PHASE Q5: CONFIG CHECK FOR ALERT RULES AND WATCH PATHS ===');
  const dirs = [];
  try {
    // The shipped config is valid.
    let dir = scratchConfig(); dirs.push(dir);
    let r = check(dir);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/Alert rules : \d+ in \d+ file/.test(r.out), 'alert rules counted');

    const badRules = [
      ['unknown type', 'alerts:\n  - id: r1\n    type: magic\n', /unknown type "magic"/],
      ['threshold without number', 'alerts:\n  - id: r2\n    type: threshold\n    metric: m\n    operator: ">"\n    threshold: high\n', /threshold must be a number/],
      ['bad operator', 'alerts:\n  - id: r3\n    type: threshold\n    metric: m\n    operator: "=>"\n    threshold: 1\n', /operator "=>"/],
      ['absence without seconds', 'alerts:\n  - id: r4\n    type: absence\n    metric: agent.heartbeat\n', /absence_seconds/],
      ['composite with one condition', 'alerts:\n  - id: r5\n    type: composite\n    operator: AND\n    conditions:\n      - { metric: m, operator: ">", threshold: 1 }\n', /at least two/],
      ['unknown component', 'alerts:\n  - id: r6\n    type: threshold\n    component: no_such_app\n    metric: m\n    operator: ">"\n    threshold: 1\n', /component "no_such_app"/],
      ['bad severity', 'alerts:\n  - id: r7\n    type: journey_failure\n    severity: urgent\n', /unknown severity "urgent"/],
      ['duplicate id', 'alerts:\n  - id: rule_high_jvm_heap\n    type: journey_failure\n', /duplicates the id/],
      ['no alerts list', 'rules: []\n', /top-level `alerts:` list/],
      ['invalid yaml', 'alerts: [\n', /invalid YAML/]
    ];
    for (const [label, text, re] of badRules) {
      dir = scratchConfig(); dirs.push(dir);
      withRules(dir, text);
      r = check(dir);
      assert.strictEqual(r.code, 1, `${label}: expected exit 1\n${r.out}`);
      assert.ok(re.test(r.out), `${label}: expected ${re}\n${r.out}`);
    }
    console.log(`✔ ${badRules.length} invalid alert rules rejected`);

    const manifest = (dir) => path.join(dir, 'apps', 'github.yaml');
    const badWatch = [
      ['relative linux path', 'watch:\n  linux: ["etc/github"]\n', /absolute Linux path/],
      ['dot-dot', 'watch:\n  linux: ["/opt/github/../../etc/%%"]\n', /must not contain "\.\."/],
      ['glob star', 'watch:\n  linux: ["/etc/github/*"]\n', /use osquery wildcards/],
      ['too broad', 'watch:\n  linux: ["/etc/%%"]\n', /too broad/],
      ['windows relative', 'watch:\n  windows: ["Program Files/GitHub"]\n', /absolute Windows path/],
      ['windows drive root', 'watch:\n  windows: ["C:/%%"]\n', /too broad/],
      ['not a mapping', 'watch: ["/etc/github"]\n', /must be a mapping/],
      ['unknown os', 'watch:\n  macos: ["/etc"]\n', /watch\.macos is not recognised/]
    ];
    for (const [label, text, re] of badWatch) {
      dir = scratchConfig(); dirs.push(dir);
      const lines = fs.readFileSync(manifest(dir), 'utf8').split('\n');
      const kept = [];
      let inWatch = false;
      for (const line of lines) {
        if (/^watch:/.test(line)) { inWatch = true; continue; }
        if (inWatch && (/^\s/.test(line) || line === '')) continue;
        inWatch = false;
        kept.push(line);
      }
      const src = kept.join('\n');
      fs.writeFileSync(manifest(dir), src + '\n' + text);
      r = check(dir);
      assert.strictEqual(r.code, 1, `${label}: expected exit 1\n${r.out}`);
      assert.ok(re.test(r.out), `${label}: expected ${re}\n${r.out}`);
    }
    console.log(`✔ ${badWatch.length} invalid watch: blocks rejected`);
  } finally {
    dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  }
  console.log('✔ Q5 config:check validates config/alerts/*.yaml and watch: paths');
}

try { main(); } catch (err) { console.error('Q5 TEST FAILED:', err.message); process.exit(1); }
