#!/usr/bin/env node
/**
 * scripts/lint_no_demo.js
 *
 * lint:demo (Phase D acceptance)
 *
 * Fails if a file outside:
 *   - backend/demo/
 *   - backend/routes/demoRoutes.js
 *   - frontend/src/components/demo/
 *   - tests/
 *
 * imports a demo fixture or contains an `env === 'demo'` style branch.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['backend', 'frontend/src', 'correlation', 'ai_analysis', 'synthetics', 'security', 'metrics_collection'];

const ALLOWED_FILES = [
  /backend[\\/]routes[\\/]demoRoutes\.js$/,
  /backend[\\/]demo[\\/]/,
  /frontend[\\/]src[\\/]components[\\/]demo[\\/]/,
  /tests[\\/]/,
  /node_modules/,
  /dist[\\/]/,
  /\.sentinel_backup[\\/]/,
  /scripts[\\/]/
];

const VIOLATION_PATTERNS = [
  {
    re: /require\s*\(\s*['"][^'"]*demo[\\/]fixtures[^'"]*['"]\s*\)/,
    what: 'Import of demo fixture'
  },
  {
    re: /import\s+.*from\s+['"][^'"]*demo[\\/]fixtures[^'"]*['"]/,
    what: 'ES import of demo fixture'
  },
  {
    re: /\b(env|environment|targetEnv|currentEnv)\s*===?\s*['"]demo['"]/,
    what: "env === 'demo' branch"
  },
  {
    re: /\b(env|environment|targetEnv|currentEnv)\s*!==?\s*['"]demo['"]/,
    what: "env !== 'demo' branch"
  },
  {
    re: /\[\s*['"]prod['"]\s*,\s*['"]staging['"]\s*,\s*['"]demo['"]\s*\]/,
    what: "['prod', 'staging', 'demo'] array"
  }
];

// True for files allowed to mention demo data.
function isAllowed(filepath) {
  const rel = path.relative(ROOT, filepath);
  return ALLOWED_FILES.some(r => r.test(rel));
}

// Collects files of a folder.
function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      walk(full, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      if (!isAllowed(full)) {
        out.push(full);
      }
    }
  }
}

const files = [];
SCAN_DIRS.forEach(d => walk(path.join(ROOT, d), files));

const violations = [];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

    // In backend/server.js: explicitly permit the HTTP 400 rejection lines
    if (rel === 'backend/server.js') {
      if (line.includes("candidate.toLowerCase() === 'demo'") && (lines[i + 1]?.includes('Use the Demo view') || lines[i + 2]?.includes('Use the Demo view'))) {
        return;
      }
      if (line.includes("String(rawEnv).toLowerCase() === 'demo'") && (lines[i + 1]?.includes('Use the Demo view') || line.includes('Use the Demo view'))) {
        return;
      }
    }

    for (const pat of VIOLATION_PATTERNS) {
      if (pat.re.test(line)) {
        violations.push(`${rel}:${i + 1}  [${pat.what}] ${trimmed.slice(0, 100)}`);
        break;
      }
    }
  });
});

if (violations.length > 0) {
  console.error(`[lint:demo] FAILED: ${violations.length} violation(s) found outside allowed demo directories:`);
  violations.forEach(v => console.error('  ' + v));
  console.error('\nDemo/sample data and demo environment handling must reside exclusively in:');
  console.error('  - backend/demo/');
  console.error('  - backend/routes/demoRoutes.js');
  console.error('  - frontend/src/components/demo/');
  process.exit(1);
}

console.log(`[lint:demo] PASSED: Clean across ${files.length} production files.`);
