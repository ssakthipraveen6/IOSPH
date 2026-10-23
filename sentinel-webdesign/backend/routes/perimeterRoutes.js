/**
 * Perimeter routes (/api/perimeter, /api/avi): VIP probe telemetry and AVI data.
 */
const express = require('express');
const router = express.Router();
const { requestEnvironment } = require('./_prototype');

// M3 Task 3.4: Real VIP probe telemetry route
router.get(['/telemetry', '/overview'], (req, res) => {
  const env = requestEnvironment(req);

  // Prod / Staging: Serve real VIP probe telemetry
  let probeResults = [];
  try {
    const urlProbeCollector = require('../../metrics_collection/real/probers/url_probe_collector');
    probeResults = urlProbeCollector.getLastVipProbes(env);
  } catch (_) {}

  if (!probeResults || probeResults.length === 0) {
    return res.json({
      status: 'DATA_UNAVAILABLE',
      prototype: false,
      environment: env,
      reason: 'No VIP probe telemetry collected yet for this environment.',
      vips: [],
      timingBreakdown: [],
      worstVips: [],
      certExpiries: [],
      statusDistribution: [],
      timestamp: new Date().toISOString()
    });
  }

  // Stacked DNS/TCP/TLS/TTFB breakdown
  const timingBreakdown = probeResults.map(p => ({
    url: p.url,
    productId: p.productId,
    component: p.component,
    dns_ms: p.dns_ms,
    tcp_ms: p.tcp_ms,
    tls_ms: p.tls_ms,
    ttfb_ms: p.ttfb_ms,
    total_ms: p.total_ms,
    status: p.status
  }));

  // Status distribution
  const statusCounts = {};
  probeResults.forEach(p => {
    const key = p.httpStatus ? `${p.httpStatus}` : (p.status || 'UNKNOWN');
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  });
  const totalCount = probeResults.length;
  const statusDistribution = Object.entries(statusCounts).map(([status, count]) => ({
    status,
    count,
    percentage: totalCount > 0 ? parseFloat(((count / totalCount) * 100).toFixed(1)) : 0
  }));

  // Certificate expiry list
  const certExpiries = probeResults
    .filter(p => p.cert_days_left !== null)
    .map(p => ({
      url: p.url,
      productId: p.productId,
      days_left: p.cert_days_left,
      subject: p.cert_subject,
      issuer: p.cert_issuer,
      protocol: p.protocol,
      cipher: p.cipher,
      status: p.cert_days_left < 7 ? 'CRITICAL' : (p.cert_days_left < 30 ? 'EXPIRING_SOON' : 'HEALTHY')
    }))
    .sort((a, b) => a.days_left - b.days_left);

  // Worst VIPs
  const worstVips = [...probeResults]
    .sort((a, b) => (b.total_ms || 0) - (a.total_ms || 0))
    .slice(0, 5);

  res.json({
    prototype: false,
    environment: env,
    vips: probeResults,
    timingBreakdown,
    worstVips,
    certExpiries,
    statusDistribution,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
