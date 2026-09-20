#!/usr/bin/env node
/**
 * scripts/verify_dist.js
 *
 * frontend/dist is committed so production hosts can run without the build
 * toolchain. The cost of that is staleness: someone edits frontend/src, forgets
 * to rebuild, and ships an old bundle that looks fine.
 *
 * This records a fingerprint of frontend/src alongside the build and compares
 * it on demand.
 *
 *   npm run build         -> writes frontend/dist/.srchash
 *   npm run verify:dist   -> exits 1 if src has moved on since that build
 *
 * Run it in CI and before tagging a release.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const DIST = path.join(ROOT, 'frontend', 'dist');
const HASH_FILE = path.join(DIST, '.srchash');
const EXTRA = [
  path.join(ROOT, 'frontend', 'index.html'),
  path.join(ROOT, 'frontend', 'vite.config.js'),
  path.join(ROOT, 'frontend', 'package.json'),
  path.join(ROOT, 'shared', 'index.js')
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function fingerprint() {
  const hash = crypto.createHash('sha256');
  const files = walk(SRC).concat(EXTRA.filter(f => fs.existsSync(f)));
  for (const f of files) {
    hash.update(path.relative(ROOT, f).replace(/\\/g, '/'));
    // Normalise line endings: a CRLF checkout on Windows must not read as a change.
    const text = fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
    hash.update(text);
  }
  return hash.digest('hex');
}

const mode = process.argv[2] === '--write' ? 'write' : 'check';
const current = fingerprint();

if (mode === 'write') {
  if (!fs.existsSync(DIST)) {
    console.error('[VERIFY-DIST] frontend/dist does not exist. Run: npm run build');
    process.exit(1);
  }
  fs.writeFileSync(HASH_FILE, current + '\n', 'utf8');
  console.log('[VERIFY-DIST] Recorded source fingerprint for this build.');
  process.exit(0);
}

if (!fs.existsSync(DIST) || !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('[VERIFY-DIST] frontend/dist is missing or incomplete. Run: npm run build');
  process.exit(1);
}

if (!fs.existsSync(HASH_FILE)) {
  console.error('[VERIFY-DIST] frontend/dist has no recorded fingerprint, so it cannot be');
  console.error('              proven current. Rebuild with: npm run build');
  process.exit(1);
}

const recorded = fs.readFileSync(HASH_FILE, 'utf8').trim();

if (recorded !== current) {
  console.error('');
  console.error('[VERIFY-DIST] frontend/src has changed since frontend/dist was built.');
  console.error('              The committed bundle is STALE and would ship old UI.');
  console.error('');
  console.error('              Fix:  npm run build && git add frontend/dist');
  console.error('');
  process.exit(1);
}

console.log('[VERIFY-DIST] frontend/dist matches frontend/src.');
