/**
 * security/scanner.js
 *
 * M4 Task 4.8: Package and CVE findings processor
 */

const clickhouse = require('@sentinel/database/clickhouse');

/**
 * Check if a package version has reached End-Of-Life based on mirrored dataset.
 */
function checkEol(packageName, version, eolDataset = {}) {
  if (!packageName || !eolDataset) return false;
  const pkgKey = String(packageName).toLowerCase();
  const entry = eolDataset[pkgKey];
  if (!entry) return false;

  // If entry specifies eol: true or specific cycle that is past eol
  if (entry.eol === true) return true;
  if (entry.eol && typeof entry.eol === 'string') {
    const eolDate = new Date(entry.eol);
    if (!isNaN(eolDate.getTime()) && eolDate < new Date()) {
      return true;
    }
  }

  // Check version cycles if available
  if (Array.isArray(entry.cycles) && version) {
    const matchedCycle = entry.cycles.find(c => String(version).startsWith(c.cycle));
    if (matchedCycle && matchedCycle.eol) {
      const cycleDate = new Date(matchedCycle.eol);
      if (!isNaN(cycleDate.getTime()) && cycleDate < new Date()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Parse Trivy JSON scan output and map to normalized SENTINEL CVE findings.
 */
function parseTrivyReport(trivyJson, { host = 'unknown-host', env = 'staging', productId = null, eolDataset = {}, nowMs = Date.now() } = {}) {
  const ts = new Date(nowMs).toISOString().replace('T', ' ').replace('Z', '');
  const data = typeof trivyJson === 'string' ? JSON.parse(trivyJson) : trivyJson;
  const results = Array.isArray(data.Results) ? data.Results : (Array.isArray(data) ? data : [data]);

  const findings = [];
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let eolCount = 0;

  results.forEach(res => {
    const vulns = res.Vulnerabilities || [];
    vulns.forEach(v => {
      const cveId = v.VulnerabilityID || 'UNKNOWN-CVE';
      const pkgName = v.PkgName || v.Target || 'unknown-package';
      const installedVer = v.InstalledVersion || '';
      // CVE severity keeps the scanner's own scale (CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN);
      // alert severities (Critical/Warning) are a different vocabulary.
      const cveSeverity = String(v.Severity || 'UNKNOWN').toUpperCase();
      if (cveSeverity === 'CRITICAL') criticalCount++;
      else if (cveSeverity === 'HIGH') highCount++;
      else if (cveSeverity === 'MEDIUM') mediumCount++;
      else lowCount++;

      const isEol = checkEol(pkgName, installedVer, eolDataset) ? 1 : 0;
      if (isEol) eolCount++;

      // No score in the report = no score stored (0 in ClickHouse, shown as n/a); never a guessed value.
      let cvssScore = null;
      if (v.CVSS && v.CVSS.nvd && typeof v.CVSS.nvd.V3Score === 'number') {
        cvssScore = v.CVSS.nvd.V3Score;
      } else if (v.CVSS && v.CVSS.redhat && typeof v.CVSS.redhat.V3Score === 'number') {
        cvssScore = v.CVSS.redhat.V3Score;
      } else if (typeof v.Score === 'number') {
        cvssScore = v.Score;
      }

      findings.push({
        ts,
        env,
        host,
        product_id: productId || '',
        package_name: pkgName,
        version: installedVer,
        cve_id: cveId,
        severity: cveSeverity,
        cvss_score: cvssScore,
        description: v.Title || v.Description || '',
        remediation: v.FixedVersion ? `Upgrade to >= ${v.FixedVersion}` : '',
        is_eol: isEol
      });
    });
  });

  return {
    host,
    env,
    product_id: productId,
    critical: criticalCount,
    high: highCount,
    medium: mediumCount,
    low: lowCount,
    eol_count: eolCount,
    findings
  };
}

/**
 * Execute security scan. If mirrorPath is blank, the scan is safely inert.
 */
async function runSecurityScan({
  sbomPath = null,
  mirrorPath = null,
  trivyReport = null,
  host = 'unknown-host',
  env = 'staging',
  productId = null,
  eolDataset = {}
} = {}) {
  // Acceptance criterion: job is inert when mirror path is blank (unless direct report fixture passed)
  if (!mirrorPath && !trivyReport) {
    return {
      status: 'SKIPPED',
      reason: 'Trivy offline database mirror path is blank; scan is inert.',
      findings: []
    };
  }

  if (trivyReport) {
    const parsed = parseTrivyReport(trivyReport, { host, env, productId, eolDataset });

    // Insert into ClickHouse if configured
    if (clickhouse.isConfigured() && parsed.findings.length > 0) {
      try {
        await clickhouse.insertRows('cve_findings', parsed.findings);
      } catch (err) {
        console.warn('[SECURITY] Failed to write CVE findings to ClickHouse:', err.message);
      }
    }

    return {
      status: 'SUCCESS',
      ...parsed
    };
  }

  return {
    status: 'SKIPPED',
    reason: 'No SBOM or report provided to evaluate.',
    findings: []
  };
}

module.exports = {
  checkEol,
  parseTrivyReport,
  runSecurityScan
};
