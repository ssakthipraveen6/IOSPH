#!/usr/bin/env node
/**
 * scripts/run_tests.js  (npm test)
 *
 * Runs every test file listed in package.json "test:all", in order, stopping at the first
 * failure. Each run uses a throwaway SENTINEL_RUNTIME_DIR, so tests never write alerts,
 * settings or inventory into the real .runtime folder (that used to leave test alerts and
 * an "autonomous mode changed" entry visible in staging).
 *
 * Usage: node scripts/run_tests.js [substring ...]   (only files containing a substring)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const chain = String((pkg.scripts && pkg.scripts['test:all']) || '');
let files = chain.split('&&').map(s => s.trim().replace(/^node\s+/, '')).filter(Boolean);
const filters = process.argv.slice(2);
if (filters.length) files = files.filter(f => filters.some(x => f.includes(x)));
if (!files.length) { console.error('[run_tests] no test files selected'); process.exit(1); }

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));
let failed = null;
try {
  for (const f of files) {
    const r = spawnSync(process.execPath, [f], { cwd: root, stdio: 'inherit', env: { ...process.env, SENTINEL_RUNTIME_DIR: runtimeDir } });
    if (r.status !== 0) { failed = f; break; }
  }
} finally {
  try { fs.rmSync(runtimeDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
if (failed) { console.error(`\n[run_tests] FAILED: ${failed}`); process.exit(1); }
console.log(`\n[run_tests] ${files.length} test file(s) passed.`);
