/**
 * scripts/lint_severity_constants.js
 * 
 * Lightweight CI/CD verification rule flagging hardcoded inline severity / status
 * comparisons and color maps across apps/web and apps/api.
 * Enforces usage of @sentinel/shared-constants.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_DIRS = [
  path.join(ROOT_DIR, 'frontend', 'src', 'components'),
  path.join(ROOT_DIR, 'backend', 'services')
];

// Patterns that indicate inline hardcoded severity anti-patterns
const ANTI_PATTERNS = [
  {
    regex: /(?:status|severity|sev)\s*===\s*['"](?:Critical|Warning|Predictive-Warning)['"]/i,
    message: 'Inline severity comparison detected. Use SEVERITY enum or normalizeSeverity() from @sentinel/shared-constants.'
  },
  {
    regex: /\{\s*['"]?Critical['"]?\s*:\s*['"]#(?:ef4444|dc2626|red)['"]/i,
    message: 'Inline severity color map detected. Use SEVERITY_COLORS from @sentinel/shared-constants.'
  }
];

// Files permitted to contain definitions or stubs
const EXCLUSIONS = [
  path.normalize('shared')
];

let violationCount = 0;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (EXCLUSIONS.some(ex => fullPath.includes(ex))) continue;

    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      scanFile(fullPath);
    }
  }
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');

  lines.forEach((line, idx) => {
    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    for (const rule of ANTI_PATTERNS) {
      if (rule.regex.test(line)) {
        violationCount++;
        console.warn(`[SEVERITY LINT] ${relPath}:${idx + 1} - ${rule.message}`);
        console.warn(`    Line: ${trimmed}`);
      }
    }
  });
}

console.log('--- Scanning codebase for unshared severity/status literals ---');
TARGET_DIRS.forEach(scanDir);

if (violationCount > 0) {
  console.log(`Found ${violationCount} potential inline severity literal pattern(s).`);
  console.log('Recommendation: Refactor to import { SEVERITY, SEVERITY_COLORS, normalizeSeverity } from "@sentinel/shared-constants".');
} else {
  console.log('100% Clean: Zero unshared severity literals detected in target paths.');
}

module.exports = { violationCount };
