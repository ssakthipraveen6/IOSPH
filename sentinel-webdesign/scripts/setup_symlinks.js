/**
 * scripts/setup_symlinks.js
 *
 * Automatically verifies and links workspace packages into node_modules/@sentinel
 * and ensures frontend dependencies (including Vite) and required modules are present.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const sentinelDir = path.join(rootDir, 'node_modules', '@sentinel');

const packages = {
  'analysis': 'ai_analysis',
  'api': 'backend',
  'collector': 'metrics_collection',
  'config': 'backend/config',
  'database': 'database',
  'inventory': 'inventory',
  'logger': 'logger',
  'remediation': 'remediation',
  'shared-constants': 'shared',
  'correlation': 'correlation',
  'synthetics': 'synthetics',
  'security': 'security',
  'sentinelql': 'analytics/sentinelql'
};

console.log('[SETUP] Validating Project Sentinel workspace symlinks...');

if (!fs.existsSync(sentinelDir)) {
  fs.mkdirSync(sentinelDir, { recursive: true });
}

for (const [pkgName, targetRel] of Object.entries(packages)) {
  const targetPath = path.join(rootDir, targetRel);
  const linkPath = path.join(sentinelDir, pkgName);

  if (!fs.existsSync(targetPath)) {
    console.warn(`[WARN] Target package directory not found: ${targetRel}`);
    continue;
  }

  let needsLink = true;
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      // Check if target exists and is valid
      try {
        const real = fs.realpathSync(linkPath);
        if (real.toLowerCase() === targetPath.toLowerCase()) {
          needsLink = false;
        } else {
          fs.unlinkSync(linkPath);
        }
      } catch (e) {
        fs.unlinkSync(linkPath);
      }
    } else if (stat.isDirectory()) {
      // Not a link, already directory
      needsLink = false;
    }
  } catch (err) {
    // does not exist yet
  }

  if (needsLink) {
    try {
      // Windows junctions do not require administrator privileges
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(targetPath, linkPath, type);
      console.log(`[LINK] Linked @sentinel/${pkgName} -> ${targetRel}`);
    } catch (err) {
      // Fallback: create junction via cmd mklink /J on Windows if symlinkSync throws
      if (process.platform === 'win32') {
        try {
          execSync(`cmd /c mklink /J "${linkPath}" "${targetPath}"`, { stdio: 'ignore' });
          console.log(`[LINK] Created junction @sentinel/${pkgName} -> ${targetRel}`);
        } catch (mkErr) {
          console.error(`[ERROR] Could not link @sentinel/${pkgName}: ${mkErr.message}`);
        }
      } else {
        console.error(`[ERROR] Could not link @sentinel/${pkgName}: ${err.message}`);
      }
    }
  }
}

// Check express-rate-limit in root
const rateLimitPath = path.join(rootDir, 'node_modules', 'express-rate-limit');
if (!fs.existsSync(rateLimitPath)) {
  console.log('[SETUP] express-rate-limit missing. Installing in root...');
  try {
    execSync('npm install express-rate-limit --save', { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    console.warn('[WARN] Could not install express-rate-limit automatically:', e.message);
  }
}

// Check frontend dependencies and vite
const frontendDir = path.join(rootDir, 'frontend');
const viteBinWin = path.join(frontendDir, 'node_modules', '.bin', 'vite.cmd');
const viteBinPosix = path.join(frontendDir, 'node_modules', '.bin', 'vite');
const viteDir = path.join(frontendDir, 'node_modules', 'vite');
const rootViteDir = path.join(rootDir, 'node_modules', 'vite');

if (!fs.existsSync(viteDir) && !fs.existsSync(rootViteDir) && !fs.existsSync(viteBinWin) && !fs.existsSync(viteBinPosix)) {
  console.log('[SETUP] Frontend dependencies (Vite) missing. Running npm install in frontend...');
  try {
    execSync('npm install', { cwd: frontendDir, stdio: 'inherit' });
  } catch (e) {
    console.error('[ERROR] Failed to install frontend dependencies:', e.message);
  }
}

console.log('[SETUP] Setup check completed successfully.');
