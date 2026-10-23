'use strict';
/**
 * analytics/forecast.js
 *
 * Phase O1 / O1.3 Capacity & Forecast Helper:
 *   linearRunway(points, limit)
 *
 * Computes linear regression trend over 7-day and 30-day windows to forecast
 * days until resource limit is reached.
 *
 * Returns:
 *   {
 *     days_to_full_7d: number | null,
 *     days_to_full_30d: number | null,
 *     slope_per_day: number | null
 *   }
 */

const MS_PER_DAY = 86400 * 1000;
const MIN_POINTS = 2;

// Timestamp from a number, Date or string.
function parseTs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const parsed = new Date(v).getTime();
    if (Number.isFinite(parsed)) return parsed;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

// Cleans and sorts raw points.
function normalizePoints(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];
  const out = [];
  for (const p of rawPoints) {
    if (!p) continue;
    let ts, val;
    if (Array.isArray(p)) {
      ts = parseTs(p[0]);
      val = Number(p[1]);
    } else if (typeof p === 'object') {
      ts = parseTs(p.ts !== undefined ? p.ts : p.timestamp);
      val = Number(p.value !== undefined ? p.value : p.val);
    }
    if (ts !== null && Number.isFinite(val)) {
      out.push({ ts, value: val });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// Linear regression; days until the limit is reached.
function regression(subPoints, limit, latestVal) {
  if (subPoints.length < MIN_POINTS) {
    return { slope: null, daysToFull: null };
  }

  const t0 = subPoints[0].ts;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const n = subPoints.length;

  for (let i = 0; i < n; i++) {
    const x = (subPoints[i].ts - t0) / MS_PER_DAY; // time in days
    const y = subPoints[i].value;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) {
    return { slope: null, daysToFull: null };
  }

  const slope = (n * sumXY - sumX * sumY) / denom; // change in value per day

  // If resource is not increasing towards the limit
  if (slope <= 0) {
    return { slope: Number(slope.toFixed(4)), daysToFull: null };
  }

  // Current distance to limit
  const remaining = limit - latestVal;
  if (remaining <= 0) {
    return { slope: Number(slope.toFixed(4)), daysToFull: 0 };
  }

  const days = remaining / slope;
  return {
    slope: Number(slope.toFixed(4)),
    daysToFull: Number(days.toFixed(1))
  };
}

/**
 * Computes runway until capacity limit is reached.
 * @param {Array<{ts: number|string, value: number}>} points - Time-series points
 * @param {number} limit - Total capacity threshold
 * @returns {{ days_to_full_7d: number|null, days_to_full_30d: number|null, slope_per_day: number|null }}
 */
function linearRunway(points, limit) {
  if (!Number.isFinite(limit)) {
    return { days_to_full_7d: null, days_to_full_30d: null, slope_per_day: null };
  }

  const clean = normalizePoints(points);
  if (clean.length < MIN_POINTS) {
    return { days_to_full_7d: null, days_to_full_30d: null, slope_per_day: null };
  }

  const latestPt = clean[clean.length - 1];
  const tLatest = latestPt.ts;
  const yLatest = latestPt.value;

  const points7d = clean.filter(p => p.ts >= tLatest - 7 * MS_PER_DAY);
  const points30d = clean.filter(p => p.ts >= tLatest - 30 * MS_PER_DAY);

  const reg7d = regression(points7d, limit, yLatest);
  const reg30d = regression(points30d, limit, yLatest);

  const primarySlope = reg30d.slope !== null ? reg30d.slope : reg7d.slope;

  return {
    days_to_full_7d: reg7d.daysToFull,
    days_to_full_30d: reg30d.daysToFull,
    slope_per_day: primarySlope
  };
}

/**
 * Computes linear regression trend over points and returns slope, R2, and growth percentage.
 * @param {Array<{ts: number|string, value: number}>} points
 * @returns {{ slope: number|null, r2: number|null, growth_pct: number|null, is_growth: boolean }}
 */
function linearTrend(points) {
  const clean = normalizePoints(points);
  if (clean.length < MIN_POINTS) {
    return { slope: null, r2: null, growth_pct: null, is_growth: false };
  }
  const t0 = clean[0].ts;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  const n = clean.length;
  for (let i = 0; i < n; i++) {
    const x = (clean[i].ts - t0) / 3600000; // in hours
    const y = clean[i].value;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) {
    return { slope: null, r2: null, growth_pct: null, is_growth: false };
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const x = (clean[i].ts - t0) / 3600000;
    const y = clean[i].value;
    const yHat = intercept + slope * x;
    ssTot += (y - meanY) * (y - meanY);
    ssRes += (y - yHat) * (y - yHat);
  }
  const r2 = ssTot > 0 ? Math.max(0, 1 - (ssRes / ssTot)) : 0;
  const firstY = clean[0].value;
  const lastY = clean[clean.length - 1].value;
  const growthPct = firstY > 0 ? ((lastY - firstY) / firstY) * 100 : 0;
  return {
    slope: Number(slope.toFixed(4)),
    r2: Number(r2.toFixed(4)),
    growth_pct: Number(growthPct.toFixed(2)),
    is_growth: slope > 0
  };
}

module.exports = {
  linearRunway,
  linearTrend,
  normalizePoints
};

