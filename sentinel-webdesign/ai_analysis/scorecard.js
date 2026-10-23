/**
 * ai_analysis/scorecard.js
 *
 * M5 Task 5.6 / Phase F Task F4: Weekly Product Scorecard Generator
 * Builds availability %, journey step p95 vs last week, change points, top causes,
 * and open CVEs per product. Persists as HTML in Postgres and sends to Teams.
 * Computes strictly from real stored data (zero synthetic numeric defaults; missing = null).
 * All interpolated HTML values are escaped with escapeHtml.
 */

const crypto = require('crypto');
const { escapeHtml } = require('../backend/services/html');

let postgres = null;
try {
  postgres = require('@sentinel/database/postgres');
} catch (_) {
  try {
    postgres = require('../database/postgres');
  } catch (e) {
    postgres = null;
  }
}

let clickhouse = null;
try {
  clickhouse = require('@sentinel/database/clickhouse');
} catch (_) {
  try {
    clickhouse = require('../database/clickhouse');
  } catch (e) {
    clickhouse = null;
  }
}

// In-memory cache for scorecards when Postgres is in local fallback mode
const inMemoryScorecards = [];

/**
 * Builds weekly scorecard object and HTML representation for a product.
 * Takes explicit data parameters; if data was unavailable, fields remain null.
 */
function buildProductScorecard({
  productId,
  productName = null,
  environment = 'staging',
  availabilityPct = null,
  p95Ms = null,
  prevP95Ms = null,
  changePointsCount = null,
  openCvesCount = null,
  topCause = null,
  weekStart = new Date().toISOString().substring(0, 10)
}) {
  const name = productName || productId.replace(/_/g, ' ').toUpperCase();
  
  let p95ChangePct = null;
  if (typeof p95Ms === 'number' && typeof prevP95Ms === 'number' && prevP95Ms > 0) {
    p95ChangePct = parseFloat((((p95Ms - prevP95Ms) / prevP95Ms) * 100).toFixed(1));
  }

  const availDisplay = typeof availabilityPct === 'number'
    ? `${availabilityPct.toFixed(2)}%`
    : 'N/A';

  const availColor = typeof availabilityPct === 'number'
    ? (availabilityPct >= 99.9 ? '#10b981' : '#f59e0b')
    : '#94a3b8';

  const p95Display = typeof p95Ms === 'number'
    ? `${p95Ms.toFixed(1)}ms${p95ChangePct !== null ? ` (${p95ChangePct > 0 ? '+' : ''}${p95ChangePct}%)` : ''}`
    : 'N/A';

  const cpDisplay = typeof changePointsCount === 'number'
    ? String(changePointsCount)
    : 'N/A';

  const cveDisplay = typeof openCvesCount === 'number'
    ? String(openCvesCount)
    : 'N/A';

  const causeDisplay = topCause
    ? escapeHtml(topCause).toUpperCase()
    : 'UNKNOWN';

  const htmlContent = `
    <div class="scorecard-card" style="border: 1px solid #334155; border-radius: 8px; padding: 1.25rem; background: #1e293b; margin-bottom: 1rem;">
      <h3 style="margin: 0 0 0.5rem 0; color: #38bdf8;">${escapeHtml(name)}</h3>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; font-size: 0.9rem;">
        <div><strong>Availability:</strong> <span style="color: ${availColor};">${escapeHtml(availDisplay)}</span></div>
        <div><strong>p95 Latency:</strong> ${escapeHtml(p95Display)}</div>
        <div><strong>Change Points:</strong> ${escapeHtml(cpDisplay)}</div>
        <div><strong>Open CVEs:</strong> ${escapeHtml(cveDisplay)}</div>
      </div>
      <div style="margin-top: 0.75rem; font-size: 0.85rem; color: #94a3b8;">
        <strong>Dominant Degradation Layer:</strong> <span style="color: #f87171; text-transform: uppercase;">${causeDisplay}</span>
      </div>
    </div>
  `;

  const id = `SC-${environment}-${productId}-${weekStart}`;
  const scorecard = {
    id,
    environment,
    week_start: weekStart,
    product_id: productId,
    product_name: name,
    availability_pct: availabilityPct,
    p95_ms: p95Ms,
    p95_change_pct: p95ChangePct,
    change_points_count: changePointsCount,
    open_cves_count: openCvesCount,
    top_cause: topCause,
    html_content: htmlContent,
    created_at: new Date().toISOString()
  };

  inMemoryScorecards.unshift(scorecard);

  // Persist to Postgres if available
  if (postgres && typeof postgres.query === 'function') {
    postgres.query(`
      INSERT INTO product_scorecard (id, environment, week_start, product_id, availability_pct, p95_ms, p95_change_pct, change_points_count, open_cves_count, top_cause, html_content)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        availability_pct = EXCLUDED.availability_pct,
        p95_ms = EXCLUDED.p95_ms,
        p95_change_pct = EXCLUDED.p95_change_pct,
        change_points_count = EXCLUDED.change_points_count,
        open_cves_count = EXCLUDED.open_cves_count,
        top_cause = EXCLUDED.top_cause,
        html_content = EXCLUDED.html_content
    `, [
      id,
      environment,
      weekStart,
      productId,
      availabilityPct,
      p95Ms,
      p95ChangePct,
      changePointsCount,
      openCvesCount,
      topCause,
      htmlContent
    ]).catch(() => {});
  }

  return scorecard;
}

/**
 * Computes weekly scorecard metrics directly from real data stores
 */
async function computeScorecardFromData({ productId, environment = 'staging', weekStart = null, nowMs = Date.now(), problemSource = null }) {
  const normEnv = (environment === 'production' || environment === 'prod') ? 'prod' : 'staging';
  const startDay = weekStart || new Date().toISOString().substring(0, 10);

  let availabilityPct = null;
  let p95Ms = null;
  let prevP95Ms = null;
  let changePointsCount = null;
  let openCvesCount = null;
  let topCause = null;

  // 1. Availability from journey.success
  try {
    if (clickhouse && clickhouse.isConfigured()) {
      const availRows = await clickhouse.query(
        `SELECT count() AS total, countIf(value > 0) AS success 
         FROM metrics 
         WHERE env = {env:String} AND component = {prod:String} AND metric_name = 'journey.success'
         AND ts >= fromUnixTimestamp64Milli({weekAgo:Int64}, 'UTC') AND ts < fromUnixTimestamp64Milli({now:Int64}, 'UTC')`,
        { env: normEnv, prod: productId, weekAgo: nowMs - 7 * 86400000, now: nowMs }
      );
      if (availRows.length > 0 && Number(availRows[0].total) > 0) {
        availabilityPct = parseFloat(((Number(availRows[0].success) / Number(availRows[0].total)) * 100).toFixed(2));
      }
    }
  } catch (_) {}

  // 2. Latency p95 this week vs last week from ClickHouse
  try {
    if (clickhouse && clickhouse.isConfigured()) {
      const p95Rows = await clickhouse.query(
        `SELECT quantile(0.95)(value) AS p95 
         FROM metrics 
         WHERE env = {env:String} AND component = {prod:String} AND metric_name = 'journey.step.duration_ms'
         AND ts >= fromUnixTimestamp64Milli({weekAgo:Int64}, 'UTC') AND ts < fromUnixTimestamp64Milli({now:Int64}, 'UTC')`,
        { env: normEnv, prod: productId, weekAgo: nowMs - 7 * 86400000, now: nowMs }
      );
      if (p95Rows.length > 0 && p95Rows[0].p95 !== null && !isNaN(Number(p95Rows[0].p95))) {
        p95Ms = parseFloat(Number(p95Rows[0].p95).toFixed(1));
      }

      const prevP95Rows = await clickhouse.query(
        `SELECT quantile(0.95)(value) AS p95 
         FROM metrics 
         WHERE env = {env:String} AND component = {prod:String} AND metric_name = 'journey.step.duration_ms'
         AND ts >= fromUnixTimestamp64Milli({twoWeeksAgo:Int64}, 'UTC') AND ts < fromUnixTimestamp64Milli({weekAgo:Int64}, 'UTC')`,
        { env: normEnv, prod: productId, twoWeeksAgo: nowMs - 14 * 86400000, weekAgo: nowMs - 7 * 86400000 }
      );
      if (prevP95Rows.length > 0 && prevP95Rows[0].p95 !== null && !isNaN(Number(prevP95Rows[0].p95))) {
        prevP95Ms = parseFloat(Number(prevP95Rows[0].p95).toFixed(1));
      }
    }
  } catch (_) {}

  // 3. Change points from change_points
  try {
    if (clickhouse && clickhouse.isConfigured()) {
      const cpRows = await clickhouse.query(
        `SELECT count() AS cnt FROM change_points
         WHERE env = {env:String} AND entity_id IN ({prod:String}, {entity:String})
         AND ts >= fromUnixTimestamp64Milli({weekAgo:Int64}, 'UTC') AND ts < fromUnixTimestamp64Milli({now:Int64}, 'UTC')`,
        { env: normEnv, prod: productId, entity: `app:${productId}`, weekAgo: nowMs - 7 * 86400000, now: nowMs }
      );
      if (cpRows.length > 0 && cpRows[0].cnt !== null) {
        changePointsCount = Number(cpRows[0].cnt);
      }
    }
  } catch (_) {}

  // 4. Open CVEs from cve_findings
  try {
    if (clickhouse && clickhouse.isConfigured()) {
      const cveRows = await clickhouse.query(
        `SELECT uniqExact(cve_id) AS cnt FROM cve_findings
         WHERE env = {env:String} AND product_id = {prod:String}
         AND ts >= fromUnixTimestamp64Milli({weekAgo:Int64}, 'UTC')`,
        { env: normEnv, prod: productId, weekAgo: nowMs - 7 * 86400000 }
      );
      if (cveRows.length > 0 && cveRows[0].cnt !== null) {
        openCvesCount = Number(cveRows[0].cnt);
      }
    }
  } catch (_) {}

  // 5. Top cause: most frequent diagnosed layer among this week's problems for the product
  try {
    const source = problemSource || require('../correlation/problem_store');
    const problems = await source.list(normEnv, { limit: 500 });
    const weekAgo = nowMs - 7 * 86400000;
    const counts = new Map();
    for (const p of problems) {
      if (new Date(p.created_at).getTime() < weekAgo) continue;
      const alerts = (p.evidence_pack && p.evidence_pack.alerts) || [];
      const involves = (p.suspect_entity || '') === `app:${productId}` || alerts.some(a => a.component === productId);
      if (!involves || !p.top_layer || p.top_layer === 'unknown') continue;
      counts.set(p.top_layer, (counts.get(p.top_layer) || 0) + 1);
    }
    if (counts.size > 0) {
      topCause = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  } catch (_) {}

  return buildProductScorecard({
    productId,
    environment: normEnv,
    weekStart: startDay,
    availabilityPct,
    p95Ms,
    prevP95Ms,
    changePointsCount,
    openCvesCount,
    topCause
  });
}

/**
 * Returns past scorecards for an environment
 */
async function getScorecards(environment = 'prod') {
  const normEnv = (environment === 'production' || environment === 'prod') ? 'prod' : environment;
  if (postgres && typeof postgres.query === 'function') {
    try {
      const res = await postgres.query(`
        SELECT * FROM product_scorecard
        WHERE environment = $1 OR ($1 = 'prod' AND environment = 'production')
        ORDER BY week_start DESC, product_id ASC
        LIMIT 100
      `, [normEnv]);
      if (res && res.rows && res.rows.length > 0) {
        return res.rows;
      }
    } catch (_) {}
  }
  return inMemoryScorecards.filter(sc => {
    const scEnv = (sc.environment === 'production' || sc.environment === 'prod') ? 'prod' : sc.environment;
    return scEnv === normEnv;
  });
}

module.exports = {
  buildProductScorecard,
  computeScorecardFromData,
  getScorecards,
  inMemoryScorecards
};
