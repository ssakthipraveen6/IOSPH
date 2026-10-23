#!/usr/bin/env node
/**
 * lint:samples (M1.3) — catches fabricated "real-looking" data outside demo code.
 *
 * lint:random only catches Math.random(). Prototype data is usually literal:
 * made-up ServiceNow numbers, sample IPs, sample hashes. This lint flags such
 * literals in backend and frontend sources unless they sit in a demo-gated
 * block (a `demo` check within the preceding WINDOW lines) or the line carries
 * `sample-data-ok`. The route-level regression tests are the stronger guard;
 * this catches new literals early.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['backend', 'remediation', 'metrics_collection/real', 'ai_analysis', 'frontend/src'];
const SKIP = [
  /node_modules/,
  /frontend\/src\/data\/correlationData\.js$/,
  /backend\/demo\//,
  /frontend\/src\/components\/demo\//,
  /\.test\.js$/
];
const WINDOW = 120;
const PATTERNS = [
  { re: /['"`]INC-?0*\d{5,}['"`]/, what: 'ServiceNow incident number' },
  { re: /['"`]CHG0*\d{5,}['"`]/, what: 'ServiceNow change number' },
  { re: /['"`]10\.\d{1,3}\.\d{1,3}\.\d{1,3}['"`]/, what: 'private IP address' },
  { re: /hash:\s*['"`][0-9a-f]{12,}/, what: 'audit hash' },
  { re: /['"`]CVE-\d{4}-\d+['"`]/i, what: 'CVE vulnerability id' },
  { re: /['"`]storage:[a-zA-Z0-9_-]+['"`]/, what: 'storage entity id literal' },
  { re: /['"`]host:[a-zA-Z0-9_.-]+['"`]/, what: 'host entity id literal' },
  { re: /['"`][a-zA-Z0-9._%+-]+@enterprise\.corp['"`]/i, what: 'sample @enterprise.corp email literal' },
  { re: /['"`][a-zA-Z0-9.-]+\.internal\.corp['"`]/i, what: 'sample .internal.corp hostname literal' }
];
const DEMO_GUARD = /demo/i;

// Collects files of a folder.
function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP.some(r => r.test(full.replace(/\\/g, '/')))) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
}

const files = [];
DIRS.forEach(d => walk(path.join(ROOT, d), files));

const violations = [];
files.forEach(file => {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('sample-data-ok')) return;
    const hit = PATTERNS.find(p => p.re.test(line));
    if (!hit) return;
    const from = Math.max(0, i - WINDOW);
    const guarded = lines.slice(from, i + 1).some(l => DEMO_GUARD.test(l));
    if (!guarded) violations.push(`${path.relative(ROOT, file)}:${i + 1}  ${hit.what}: ${line.trim().slice(0, 100)}`);
  });
});

if (violations.length > 0) {
  console.error(`[lint:samples] ${violations.length} literal(s) that look like real data outside a demo-gated block:`);
  violations.forEach(v => console.error('  ' + v));
  console.error('Gate them to the demo environment, or mark a genuine constant with `sample-data-ok`.');
  process.exit(1);
}
console.log(`[lint:samples] Clean: ${files.length} files scanned.`);
