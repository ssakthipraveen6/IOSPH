/**
 * backend/routes/securityRoutes.js
 *
 * A8: Security view over the ClickHouse `cve_findings` table (written by the
 * P9 CVE scan job). Only stored rows are reported; with ClickHouse unset or no
 * rows the answer is DATA_UNAVAILABLE with empty arrays.
 *
 * For each host only its latest scan is counted: rows within one day of that
 * host's newest finding inside the lookback window (`days`, default 7, 1-90).
 * Repeated rows for the same (host, product, package, version, CVE) collapse
 * into one finding.
 */

const express = require('express');
const router = express.Router();
const { requestEnvironment } = require('./_prototype');
const clickhouse = require('../../database/clickhouse');

const DEFAULT_DAYS = 7;
const DEFAULT_FINDINGS = 50;
const MAX_ROWS = 20000;

const FINDINGS_SQL = `SELECT
    f.host AS host,
    f.product_id AS product_id,
    f.package_name AS package_name,
    f.version AS version,
    f.cve_id AS cve_id,
    upper(argMax(f.severity, f.ts)) AS severity,
    max(f.cvss_score) AS cvss_score,
    argMax(f.description, f.ts) AS description,
    argMax(f.remediation, f.ts) AS remediation,
    max(f.is_eol) AS is_eol,
    toUnixTimestamp64Milli(max(f.ts)) AS ts_ms,
    toUnixTimestamp64Milli(any(l.last_scan)) AS last_scan_ms
FROM cve_findings AS f
INNER JOIN
(
    SELECT host, max(ts) AS last_scan
    FROM cve_findings
    WHERE env = {env:String} AND ts >= now64(3) - toIntervalDay({days:UInt16})
    GROUP BY host
) AS l ON f.host = l.host
WHERE f.env = {env:String}
  AND f.ts >= now64(3) - toIntervalDay({days:UInt16})
  AND f.ts >= l.last_scan - toIntervalDay(1)
GROUP BY host, product_id, package_name, version, cve_id
LIMIT {max_rows:UInt32}`;

// Integer within limits.
function clampInt(raw, def, min, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

const SEVERITY_KEYS = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// ISO date or null.
function iso(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

/** Aggregate deduplicated finding rows into host, product and top-finding lists. */
function summarize(rows, findingsLimit = DEFAULT_FINDINGS) {
  const hosts = new Map();
  const products = new Map();
  const findings = [];

  for (const r of rows || []) {
    const sev = String(r.severity || '').toUpperCase();
    const sevKey = SEVERITY_KEYS[sev] || null;
    const productId = r.product_id || 'unknown';
    const hostKey = `${r.host}|${productId}`;
    let h = hosts.get(hostKey);
    if (!h) {
      h = { host: r.host, product_id: productId, critical: 0, high: 0, medium: 0, low: 0, eol: new Set(), last_scan_ms: 0 };
      hosts.set(hostKey, h);
    }
    let p = products.get(productId);
    if (!p) {
      p = { product_id: productId, critical: 0, high: 0, eol: new Set(), hosts: new Set() };
      products.set(productId, p);
    }
    if (sevKey) h[sevKey] += 1;
    if (sevKey === 'critical' || sevKey === 'high') p[sevKey] += 1;
    const component = `${r.package_name}@${r.version}`;
    if (Number(r.is_eol) === 1) {
      h.eol.add(component);
      p.eol.add(`${r.host}|${component}`);
    }
    p.hosts.add(r.host);
    const lastScan = Number(r.last_scan_ms) || 0;
    if (lastScan > h.last_scan_ms) h.last_scan_ms = lastScan;

    if (sevKey === 'critical' || sevKey === 'high') {
      findings.push({
        host: r.host,
        product_id: productId,
        package_name: r.package_name,
        version: r.version,
        cve_id: r.cve_id,
        severity: sev,
        cvss_score: Number.isFinite(Number(r.cvss_score)) ? Number(r.cvss_score) : null,
        description: r.description || '',
        remediation: r.remediation || '',
        is_eol: Number(r.is_eol) === 1,
        ts: iso(r.ts_ms)
      });
    }
  }

  findings.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || (b.cvss_score ?? -1) - (a.cvss_score ?? -1)
    || String(b.ts).localeCompare(String(a.ts)));

  return {
    hosts: [...hosts.values()]
      .map(h => ({
        host: h.host,
        product_id: h.product_id,
        critical: h.critical,
        high: h.high,
        medium: h.medium,
        low: h.low,
        eol_components: h.eol.size,
        last_scan: iso(h.last_scan_ms)
      }))
      .sort((a, b) => b.critical - a.critical || b.high - a.high || a.host.localeCompare(b.host)),
    products: [...products.values()]
      .map(p => ({
        product_id: p.product_id,
        critical: p.critical,
        high: p.high,
        eol_components: p.eol.size,
        hosts: p.hosts.size
      }))
      .sort((a, b) => b.critical - a.critical || b.high - a.high || a.product_id.localeCompare(b.product_id)),
    findings: findings.slice(0, findingsLimit)
  };
}

// DATA_UNAVAILABLE response.
function unavailable(res, env, days, reason) {
  return res.json({
    status: 'DATA_UNAVAILABLE',
    prototype: false,
    environment: env,
    days,
    reason,
    hosts: [],
    products: [],
    findings: [],
    timestamp: new Date().toISOString()
  });
}

// Security summary.
router.get('/summary', async (req, res) => {
  const env = requestEnvironment(req);
  const days = clampInt(req.query.days, DEFAULT_DAYS, 1, 90);
  const limit = clampInt(req.query.limit, DEFAULT_FINDINGS, 1, 500);
  if (!clickhouse.isConfigured()) {
    return unavailable(res, env, days, 'ClickHouse is not configured, so no CVE findings are stored.');
  }
  try {
    const rows = await clickhouse.query(FINDINGS_SQL, { env, days, max_rows: MAX_ROWS });
    if (!rows || rows.length === 0) {
      return unavailable(res, env, days, `No CVE scan findings stored for ${env} in the last ${days} days.`);
    }
    return res.json({
      prototype: false,
      environment: env,
      days,
      truncated: rows.length >= MAX_ROWS,
      ...summarize(rows, limit),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return unavailable(res, env, days, `Failed to query CVE findings: ${err.message}`);
  }
});

// Software bill of materials per host.
router.get('/sbom', async (req, res) => {
  const env = requestEnvironment(req);
  const hostFilter = req.query.host ? String(req.query.host).trim() : null;
  const productFilter = req.query.product ? String(req.query.product).trim() : null;
  const pkgFilter = req.query.package ? String(req.query.package).trim().toLowerCase() : null;

  if (req.sbomProvider && typeof req.sbomProvider.getPackageInventory === 'function') {
    const packages = await req.sbomProvider.getPackageInventory(env, { host: hostFilter, product: productFilter });
    let filtered = packages || [];
    if (hostFilter) filtered = filtered.filter(p => p.host === hostFilter);
    if (productFilter) filtered = filtered.filter(p => p.product_id === productFilter);
    if (pkgFilter) filtered = filtered.filter(p => (p.package_name || '').toLowerCase().includes(pkgFilter));
    return res.json({
      environment: env,
      count: filtered.length,
      packages: filtered,
      timestamp: new Date().toISOString()
    });
  }

  if (!clickhouse.isConfigured()) {
    return res.json({
      environment: env,
      count: 0,
      packages: [],
      reason: 'DATA_UNAVAILABLE: ClickHouse not configured',
      timestamp: new Date().toISOString()
    });
  }

  return res.json({
    environment: env,
    count: 0,
    packages: [],
    reason: 'No SBOM packages found',
    timestamp: new Date().toISOString()
  });
});

// Hosts with a vulnerable package.
router.get('/vulnerable-hosts', async (req, res) => {
  const env = requestEnvironment(req);
  const pkgName = req.query.package ? String(req.query.package).trim() : null;
  const cveId = req.query.cve ? String(req.query.cve).trim().toUpperCase() : null;

  if (!pkgName && !cveId) {
    return res.status(400).json({ error: 'Query parameter "package" or "cve" is required.' });
  }

  if (req.sbomProvider && typeof req.sbomProvider.getVulnerableHosts === 'function') {
    const results = await req.sbomProvider.getVulnerableHosts(env, { package: pkgName, cve: cveId });
    return res.json({
      environment: env,
      query: { package: pkgName, cve: cveId },
      count: (results || []).length,
      hosts: results || [],
      timestamp: new Date().toISOString()
    });
  }

  if (!clickhouse.isConfigured()) {
    return res.json({
      environment: env,
      query: { package: pkgName, cve: cveId },
      count: 0,
      hosts: [],
      reason: 'DATA_UNAVAILABLE: ClickHouse not configured',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const sql = `SELECT host, product_id, package_name, version, cve_id, severity, cvss_score, remediation
                 FROM cve_findings
                 WHERE env = {env:String}
                   AND (${pkgName ? 'package_name = {pkg:String}' : '1=1'})
                   AND (${cveId ? 'cve_id = {cve:String}' : '1=1'})
                 GROUP BY host, product_id, package_name, version, cve_id, severity, cvss_score, remediation
                 LIMIT 500`;
    const rows = await clickhouse.query(sql, { env, pkg: pkgName || '', cve: cveId || '' });
    return res.json({
      environment: env,
      query: { package: pkgName, cve: cveId },
      count: (rows || []).length,
      hosts: rows || [],
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.summarize = summarize;

