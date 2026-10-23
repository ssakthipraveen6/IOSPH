/**
 * backend/jobs/cve_scan.js — P9
 *
 * Daily, leader only. SENTINEL's own scan (no Tanium):
 *  - SBOMs are dropped by the agents / Jenkins jobs under
 *      <security.cve_scan.sbom_dir>/<env>/<product>/<host>.json   (CycloneDX or SPDX JSON)
 *  - each SBOM is scanned with Trivy in offline mode against the mirrored vulnerability
 *    DB (`trivy sbom --offline-scan --skip-db-update --cache-dir <mirror_path> --format json`),
 *  - ready-made Trivy JSON reports under <reports_dir>/<env>/<product>/<host>.json are read as is,
 *  - findings are written to ClickHouse `cve_findings` (security/scanner.js).
 * Inert when `mirror_path` is blank. Trivy runs through execFile (no shell).
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const scanner = require('../../security/scanner');

// execFile wrapped in a promise.
function execFileAsync(file, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

/** Lists <root>/<env>/<product>/<host>.json files for the given environments. */
function listInputs(root, environments) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  for (const env of environments) {
    const envDir = path.join(root, env);
    if (!fs.existsSync(envDir)) continue;
    for (const product of fs.readdirSync(envDir)) {
      const productDir = path.join(envDir, product);
      if (!fs.statSync(productDir).isDirectory()) continue;
      for (const file of fs.readdirSync(productDir)) {
        if (!file.toLowerCase().endsWith('.json')) continue;
        out.push({ env, productId: product, host: file.replace(/\.(cdx|spdx|sbom|trivy)?\.?json$/i, ''), file: path.join(productDir, file) });
      }
    }
  }
  return out;
}

// Loads the end-of-life dataset.
function loadEol(datasetPath) {
  if (!datasetPath || !fs.existsSync(datasetPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(datasetPath, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

// Scans the SBOMs against the offline CVE mirror and stores the findings.
async function runCveScan({ environments = ['prod', 'staging'], settings = {}, run = execFileAsync } = {}) {
  const mirrorPath = settings.mirror_path || '';
  if (!mirrorPath) {
    return { skipped: true, reason: 'security.cve_scan.mirror_path is blank; scan is inert' };
  }
  const trivyPath = settings.trivy_path || 'trivy';
  const timeoutMs = (Number(settings.timeout_seconds) || 300) * 1000;
  const eolDataset = loadEol(settings.eol_dataset_path);
  const summary = { sboms: 0, reports: 0, findings: 0, critical: 0, high: 0, errors: [] };

  const record = async (input, trivyReport) => {
    const result = await scanner.runSecurityScan({
      mirrorPath,
      trivyReport,
      host: input.host,
      env: input.env,
      productId: input.productId,
      eolDataset
    });
    summary.findings += (result.findings || []).length;
    summary.critical += result.critical || 0;
    summary.high += result.high || 0;
  };

  for (const input of listInputs(settings.sbom_dir, environments)) {
    try {
      const stdout = await run(trivyPath, [
        'sbom', '--offline-scan', '--skip-db-update', '--quiet',
        '--cache-dir', mirrorPath,
        '--format', 'json',
        input.file
      ], { timeout: timeoutMs });
      await record(input, stdout);
      summary.sboms++;
    } catch (err) {
      summary.errors.push(`${input.env}/${input.productId}/${input.host}: ${err.message}`);
    }
  }

  for (const input of listInputs(settings.reports_dir, environments)) {
    try {
      await record(input, fs.readFileSync(input.file, 'utf8'));
      summary.reports++;
    } catch (err) {
      summary.errors.push(`${input.env}/${input.productId}/${input.host}: ${err.message}`);
    }
  }
  return summary;
}

module.exports = { runCveScan, listInputs };
