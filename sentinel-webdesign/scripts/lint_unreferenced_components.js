#!/usr/bin/env node
/**
 * scripts/lint_unreferenced_components.js
 *
 * Phase U3: fails when a file under frontend/src is not reachable through static or
 * dynamic imports from frontend/src/main.jsx (dead screens must be deleted, not left behind).
 * Usage: node scripts/lint_unreferenced_components.js [--list]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../frontend/src');
const ENTRY = path.join(SRC, 'main.jsx');
const EXTS = ['', '.jsx', '.js', '.css', '/index.jsx', '/index.js'];
const IMPORT_RE = /(?:\bimport\s+(?:[^'";]*?\s+from\s+)?|\bimport\s*\(\s*|\brequire\s*\(\s*|@import\s+(?:url\()?)['"]([^'"]+)['"]/g;

// Files of a folder.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// Resolves an import path.
function resolve(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const ext of EXTS) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

// Files reachable from main.jsx.
function reachable() {
  const seen = new Set();
  const stack = [ENTRY];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(jsx?|css)$/.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const r = resolve(f, m[1]);
      if (r) stack.push(r);
    }
  }
  return seen;
}

// Fails when a front-end file is not imported.
function main() {
  const seen = reachable();
  const files = walk(SRC).filter(f => /\.(jsx?|css)$/.test(f) && !/\.test\.jsx?$/.test(f));
  const dead = files.filter(f => !seen.has(f)).map(f => path.relative(path.resolve(__dirname, '..'), f).replace(/\\/g, '/'));
  if (process.argv.includes('--list')) dead.forEach(f => console.log(f));
  if (dead.length) {
    console.error(`[LINT-UNREFERENCED] ${dead.length} frontend file(s) are not imported from main.jsx:`);
    dead.forEach(f => console.error('  ' + f));
    process.exit(1);
  }
  console.log(`[LINT-UNREFERENCED] OK: all ${files.length} frontend source files are reachable from main.jsx.`);
}

if (require.main === module) main();
module.exports = { reachable };
