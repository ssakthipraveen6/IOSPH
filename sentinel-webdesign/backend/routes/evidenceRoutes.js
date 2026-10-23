/**
 * backend/routes/evidenceRoutes.js
 *
 * M5 Task 5.5 / Phase F Task F1 & F2: Enterprise Evidence Packs API
 * Generates self-contained HTML and PDF evidence packs for incident post-mortems
 * and external review. Built strictly from real stored data (problem, alerts,
 * metrics, change events, and CVE findings).
 * Unknown problem ID returns HTTP 404. All interpolated values are HTML-escaped.
 */

const express = require('express');
const router = express.Router();
const problemStore = require('../../correlation/problem_store');
const eventStore = require('../../database/event_store');
const clickhouse = require('../../database/clickhouse');
const { escapeHtml } = require('../services/html');

/**
 * Server-rendered SVG time-series sparkline chart from real metric points.
 * Returns a fallback message if points are missing or insufficient.
 */
function renderSvgChart(points = []) {
  if (!Array.isArray(points) || points.length < 2) {
    return `<p style="font-size: 0.85rem; color: #94a3b8; font-style: italic;">No metric data in window</p>`;
  }

  const width = 600;
  const height = 140;
  const padding = 20;

  const numericPoints = points.map(p => typeof p === 'number' ? p : (typeof p?.value === 'number' ? p.value : parseFloat(p?.value) || 0));
  const min = Math.min(...numericPoints);
  const max = Math.max(...numericPoints) || 1;

  const coords = numericPoints.map((val, idx) => {
    const x = padding + (idx / (numericPoints.length - 1)) * (width - 2 * padding);
    const range = (max - min) || 1;
    const y = height - padding - ((val - min) / range) * (height - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylineStr = coords.join(' ');
  const maxIdx = numericPoints.indexOf(max);
  const maxCoord = coords[maxIdx >= 0 ? maxIdx : coords.length - 1].split(',');

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background: #0f172a; border-radius: 8px; border: 1px solid #334155;">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ef4444" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#ef4444" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <!-- Grid Lines -->
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#334155" stroke-dasharray="3,3" />
      <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="#334155" stroke-dasharray="3,3" />
      <!-- Line Chart -->
      <polyline fill="none" stroke="#ef4444" stroke-width="2.5" points="${polylineStr}" />
      <!-- High point marker -->
      <circle cx="${maxCoord[0]}" cy="${maxCoord[1]}" r="5" fill="#f87171" stroke="#ffffff" stroke-width="1.5" />
    </svg>
  `;
}

/** Rows for the alerts grouped into this problem (only this problem's own alerts). */
function alertRows(problem) {
  const alerts = (problem.evidence_pack && Array.isArray(problem.evidence_pack.alerts)) ? problem.evidence_pack.alerts : [];
  if (alerts.length === 0) return '<tr><td colspan="4">No alert details stored for this problem.</td></tr>';
  return alerts.map(a => `<tr><td>${escapeHtml(a.timestamp || a.created_at || '')}</td><td>${escapeHtml(a.component || '')}</td><td>${escapeHtml(a.severity || '')}</td><td>${escapeHtml(a.message || a.title || a.rule_id || '')}</td></tr>`).join('\n        ');
}

/**
 * Builds standard ServiceNow ticket form URL with URI-encoded parameters
 */
function buildServiceNowUrl(problem) {
  const base = process.env.SENTINEL_SERVICENOW_BASE_URL || 'https://bank.service-now.com';
  const shortDesc = encodeURIComponent(`[SENTINEL] ${problem.title || 'Observability Problem'}`);
  const confText = problem.confidence !== null && problem.confidence !== undefined ? `${Math.round(problem.confidence * 100)}%` : 'N/A';
  const desc = encodeURIComponent(`Problem ID: ${problem.id}\nLayer: ${problem.top_layer || 'unknown'}\nSuspect Entity: ${problem.suspect_entity || 'unknown'}\nConfidence: ${confText}\nGenerated via SENTINEL Evidence Pack.`);
  const ci = encodeURIComponent(problem.suspect_entity || 'DevOps-Toolchain');
  return `${base}/nav_to.do?uri=incident.do?sys_id=-1%26short_description=${shortDesc}%26description=${desc}%26cmdb_ci=${ci}`;
}

/**
 * Generates full standalone HTML report from real stored data
 */
function generateEvidenceHtml(problem, { metricPoints = [], changeEvents = [], cveFindings = [] } = {}) {
  const serviceNowUrl = buildServiceNowUrl(problem);
  const svg = renderSvgChart(metricPoints);

  const confLabel = problem.confidence !== null && problem.confidence !== undefined
    ? `${Math.round(problem.confidence * 100)}%`
    : 'Unknown (no hypothesis)';

  let changeRows = '';
  const totalFindings = changeEvents.length + cveFindings.length;

  if (totalFindings === 0) {
    changeRows = `<tr><td colspan="4" style="text-align: center; color: #94a3b8; font-style: italic;">No data in window</td></tr>`;
  } else {
    for (const ev of changeEvents) {
      const cat = ev.kind === 'file_change' ? 'File Change' : 'Version Change';
      const entity = escapeHtml(ev.entity_id || ev.payload?.product || ev.payload?.host || 'system');
      const details = escapeHtml(ev.summary || ev.title || JSON.stringify(ev.payload || {}));
      const state = escapeHtml(ev.payload?.change_window_id ? `APPROVED (${ev.payload.change_window_id})` : (ev.payload?.approved ? 'APPROVED' : (ev.payload?.status || 'RECORDED')));
      const color = state.includes('APPROVED') ? '#10b981' : '#38bdf8';
      changeRows += `
        <tr>
          <td>${cat}</td>
          <td>${entity}</td>
          <td>${details}</td>
          <td><span style="color: ${color}; font-weight: bold;">${state}</span></td>
        </tr>`;
    }

    for (const cve of cveFindings) {
      const pkg = escapeHtml(cve.package_name || cve.product_id || cve.host || 'package');
      const details = escapeHtml(`${cve.cve_id || 'CVE'} (CVSS ${cve.cvss_score || 'N/A'}${cve.severity ? ` - ${cve.severity}` : ''})`);
      const state = escapeHtml(cve.severity ? `${cve.severity.toUpperCase()} CVE` : 'ACTIVE CVE');
      changeRows += `
        <tr>
          <td>Security Vulnerability</td>
          <td>${pkg}</td>
          <td>${details}</td>
          <td><span style="color: #ef4444;">${state}</span></td>
        </tr>`;
    }
  }

  const severityClass = (problem.severity || 'CRITICAL').toLowerCase() === 'warning' ? 'badge-warning' : 'badge-critical';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SENTINEL Evidence Pack - ${escapeHtml(problem.id)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f1f5f9; padding: 2.5rem; line-height: 1.5; }
    .header { border-bottom: 2px solid #334155; padding-bottom: 1.25rem; margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: flex-start; }
    h1 { margin: 0 0 0.5rem 0; font-size: 1.8rem; color: #ffffff; }
    .badge { display: inline-block; padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }
    .badge-critical { background: #dc2626; color: #fff; }
    .badge-warning { background: #d97706; color: #fff; }
    .section { background: #1e293b; border-radius: 8px; border: 1px solid #334155; padding: 1.5rem; margin-bottom: 1.5rem; }
    .section-title { font-size: 1.1rem; font-weight: 700; color: #38bdf8; margin-top: 0; margin-bottom: 1rem; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
    .field { font-size: 0.9rem; margin-bottom: 0.5rem; }
    .field-label { color: #94a3b8; font-weight: 600; }
    .field-value { color: #f8fafc; font-weight: 500; font-family: monospace; }
    .btn { display: inline-block; background: #0284c7; color: #fff; padding: 0.6rem 1.2rem; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
    .btn:hover { background: #0369a1; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
    th, td { border: 1px solid #334155; padding: 0.6rem; text-align: left; }
    th { background: #0f172a; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <span class="badge ${severityClass}">${escapeHtml(problem.severity || 'CRITICAL')}</span>
      <h1>${escapeHtml(problem.title || 'Observability Problem')}</h1>
      <div style="color: #94a3b8; font-size: 0.9rem;">Problem ID: <code>${escapeHtml(problem.id)}</code> | Environment: <strong>${escapeHtml((problem.environment || 'unknown').toUpperCase())}</strong></div>
    </div>
    <div>
      <a href="${escapeHtml(serviceNowUrl)}" target="_blank" class="btn">🎫 Raise ServiceNow Ticket</a>
    </div>
  </div>

  <div class="section">
    <div class="section-title">1. Executive Summary &amp; Root Cause</div>
    <div class="grid">
      <div>
        <div class="field"><span class="field-label">Diagnosis Layer:</span> <span class="field-value">${escapeHtml(problem.top_layer || 'unknown')}</span></div>
        <div class="field"><span class="field-label">Suspect Entity:</span> <span class="field-value">${escapeHtml(problem.suspect_entity || 'unknown')}</span></div>
        <div class="field"><span class="field-label">Diagnostic Confidence:</span> <span class="field-value">${escapeHtml(confLabel)}</span></div>
      </div>
      <div>
        <div class="field"><span class="field-label">Grouped Alerts:</span> <span class="field-value">${escapeHtml(problem.alert_count || 1)}</span></div>
        <div class="field"><span class="field-label">Window Start:</span> <span class="field-value">${escapeHtml(problem.created_at || new Date().toISOString())}</span></div>
        <div class="field"><span class="field-label">Status:</span> <span class="field-value">${escapeHtml(problem.status || 'OPEN')}</span></div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Alerts in this problem</div>
    <table>
      <thead><tr><th>Time</th><th>Component</th><th>Severity</th><th>Alert</th></tr></thead>
      <tbody>
        ${alertRows(problem)}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">2. Telemetry Degradation Timeline &amp; Sparkline</div>
    <p style="font-size: 0.85rem; color: #94a3b8;">Metric profile during the 60-minute incident correlation window:</p>
    ${svg}
  </div>

  <div class="section">
    <div class="section-title">3. Correlated Changes, Versions &amp; CVEs</div>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Entity / Component</th>
          <th>Details</th>
          <th>Approval State</th>
        </tr>
      </thead>
      <tbody>
        ${changeRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">4. Governance &amp; Next Steps</div>
    <p style="font-size: 0.88rem; color: #cbd5e1; margin-bottom: 0.8rem;">
      In accordance with bank policy, SENTINEL does not automatically modify external infrastructure. 
      Use the button below to prefill an incident ticket directly in your organization's ServiceNow instance.
    </p>
    <a href="${escapeHtml(serviceNowUrl)}" target="_blank" class="btn">Open Prefilled Incident in ServiceNow</a>
  </div>
</body>
</html>`;
}

/**
 * Hosts and products a problem involves (suspect entity plus its grouped alerts).
 * Entity ids look like `host:<name>` / `app:<product>`; bare components are products.
 */
function problemScope(problem) {
  const hosts = new Set();
  const products = new Set();
  const add = (value) => {
    if (!value || typeof value !== 'string') return;
    if (value.startsWith('host:')) hosts.add(value.slice(5));
    else if (value.startsWith('app:')) products.add(value.slice(4));
    else if (!value.includes(':')) products.add(value);
  };
  add(problem.suspect_entity);
  for (const a of problem.evidence_pack?.alerts || []) {
    add(a.entity_id);
    add(a.component);
    if (a.host) hosts.add(a.host);
  }
  return { hosts: [...hosts], products: [...products] };
}

/**
 * GET /api/problems/:id/evidence?format=html|pdf
 */
router.get('/:id/evidence', async (req, res) => {
  const { id } = req.params;
  const format = (req.query.format || 'html').toLowerCase();

  // Load problem details strictly from real stores (correlation module / database)
  const problem = await problemStore.get(id);

  // F1: Unknown ID returns HTTP 404 (never synthetic default fallback problem)
  if (!problem) {
    return res.status(404).json({ error: `Problem not found: ${id}` });
  }

  // Calculate incident time window (60-minute correlation window)
  const toTs = problem.updated_at || problem.created_at || new Date().toISOString();
  const toDate = new Date(toTs);
  const fromDate = new Date(toDate.getTime() - 60 * 60 * 1000);
  const fromTs = fromDate.toISOString();
  const env = (problem.environment || 'staging').toLowerCase();

  // 1. Fetch real metric points for the window
  let metricPoints = [];
  try {
    if (clickhouse && clickhouse.isConfigured() && problem.suspect_entity) {
      metricPoints = await clickhouse.queryMetrics({
        env,
        entity_id: problem.suspect_entity,
        from: fromTs,
        to: toTs,
        limit: 100
      });
    }
  } catch (mErr) {
    console.warn('[EVIDENCE] Metrics lookup warning:', mErr.message);
  }

  // 2. Fetch real change events (version_change, file_change)
  let changeEvents = [];
  try {
    if (eventStore && typeof eventStore.getEvents === 'function') {
      const allEvents = await eventStore.getEvents({
        from: fromTs,
        to: toTs,
        environment: env,
        limit: 50
      });
      changeEvents = (allEvents || []).filter(e => e.kind === 'version_change' || e.kind === 'file_change');
    }
  } catch (eErr) {
    console.warn('[EVIDENCE] Events lookup warning:', eErr.message);
  }

  // 3. Fetch real CVE findings, only for the hosts/products this problem involves
  let cveFindings = [];
  try {
    const { hosts, products } = problemScope(problem);
    if (clickhouse && clickhouse.isConfigured() && (hosts.length > 0 || products.length > 0)) {
      cveFindings = await clickhouse.query(
        `SELECT cve_id, severity, package_name, product_id, host, cvss_score, description
         FROM cve_findings
         WHERE env = {env:String} AND ts >= {from:DateTime64(3, 'UTC')} AND ts <= {to:DateTime64(3, 'UTC')}
           AND (host IN {hosts:Array(String)} OR product_id IN {products:Array(String)})
         ORDER BY cvss_score DESC LIMIT 20`,
        { env, from: fromTs, to: toTs, hosts, products }
      );
    }
  } catch (cErr) {
    console.warn('[EVIDENCE] CVE findings lookup warning:', cErr.message);
  }

  const html = generateEvidenceHtml(problem, { metricPoints, changeEvents, cveFindings });

  if (format === 'pdf') {
    try {
      let playwright;
      try {
        playwright = require('playwright');
      } catch (_) {
        playwright = null;
      }

      if (playwright && playwright.chromium) {
        const browser = await playwright.chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: 'load' });
          const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="evidence-pack-${id}.pdf"`);
          return res.send(pdfBuffer);
        } finally {
          await browser.close();
        }
      }
    } catch (pdfErr) {
      console.warn('[EVIDENCE] Headless PDF generation error, falling back to HTML:', pdfErr.message);
    }
  }

  // Default format: Standalone HTML
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Attachments store (e.g. diagnostic thread/stack dumps)
const attachmentsStore = new Map();

// Stores an evidence attachment in memory.
function storeAttachment(idOrObj, data) {
  if (typeof idOrObj === 'object' && idOrObj !== null) {
    const id = idOrObj.id || `att_${Date.now()}`;
    attachmentsStore.set(id, {
      ...idOrObj,
      id,
      stored_at: new Date().toISOString()
    });
    return attachmentsStore.get(id);
  }
  const id = idOrObj;
  attachmentsStore.set(id, {
    id,
    ...data,
    stored_at: new Date().toISOString()
  });
  return attachmentsStore.get(id);
}

// One stored attachment.
function getAttachment(id) {
  return attachmentsStore.get(id) || null;
}

// Downloads an attachment.
router.get('/attachments/:id', (req, res) => {
  const att = getAttachment(req.params.id);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  res.json(att);
});

module.exports = router;
module.exports.problemScope = problemScope;
module.exports.storeAttachment = storeAttachment;
module.exports.getAttachment = getAttachment;
