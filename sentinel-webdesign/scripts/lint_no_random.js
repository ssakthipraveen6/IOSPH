/**
 * Lint Script: Assert Zero Math.random() in real/ collector directories (T2b.2 / T2b lint)
 */

const fs = require('fs');
const path = require('path');

const TARGET_DIRS = [
  path.join(__dirname, '..', 'metrics_collection', 'real'),
  path.join(__dirname, '..', 'logs_collection', 'real')
];

let violationCount = 0;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        // Skip pure comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return;
        }

        if (line.includes('Math.random(')) {
          console.error(`❌ [LINT ERROR] Disallowed Math.random() found at ${fullPath}:${idx + 1}`);
          console.error(`    ${trimmed}`);
          violationCount++;
        }
      });
    }
  }
}

console.log('=== LINT: ZERO Math.random() IN REAL COLLECTORS ===');
TARGET_DIRS.forEach(d => scanDir(d));

if (violationCount > 0) {
  console.error(`\n❌ Failed: Found ${violationCount} Math.random() violation(s) in real collectors.`);
  process.exit(1);
} else {
  console.log('✔ Passed: 0 Math.random() invocations in real collectors.');
  process.exit(0);
}
