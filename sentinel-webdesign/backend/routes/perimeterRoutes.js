const express = require('express');
const router = express.Router();

router.get('/telemetry', (req, res) => {
  const bandwidthGb = 112;
  const logVolumeHourlyM = 9.39;

  const failuresByHost = [
    { host: 'api.bank.com', percentage: 48.2, color: '#3b82f6' },
    { host: 'auth.bank.com', percentage: 24.1, color: '#14b8a6' },
    { host: 'swift-gw.bank.com', percentage: 18.4, color: '#f59e0b' },
    { host: 'clearing.bank.com', percentage: 9.3, color: '#ef4444' }
  ];

  const statusDistribution = [
    { status: '200 OK', percentage: 96.4, color: '#10b981' },
    { status: '304 Not Modified', percentage: 2.1, color: '#14b8a6' },
    { status: '404 / 401 Client Error', percentage: 1.2, color: '#f59e0b' },
    { status: '500 / 502 Origin Error', percentage: 0.3, color: '#ef4444' }
  ];

  const liveStream = [
    {
      timestamp: new Date(Date.now() - 1200).toISOString().substring(11, 23),
      host: 'api.bank.com',
      uri: '/v2/payments/settlement/execute',
      status: 200,
      statusLabel: '200 OK',
      bytes: 4180,
      durationMs: 14,
      traceId: '4bf92f3577b34da6',
      tlsVip: 'TLS 1.3 / F5-VIP-01'
    },
    {
      timestamp: new Date(Date.now() - 2500).toISOString().substring(11, 23),
      host: 'auth.bank.com',
      uri: '/oauth2/v1/token/validate',
      status: 200,
      statusLabel: '200 OK',
      bytes: 840,
      durationMs: 6,
      traceId: 'e8b91a24d55b3810',
      tlsVip: 'mTLS / Cloudflare-Edge'
    },
    {
      timestamp: new Date(Date.now() - 3800).toISOString().substring(11, 23),
      host: 'clearing.bank.com',
      uri: '/v1/swift/iso20022/batch-ingest',
      status: 504,
      statusLabel: '504 TIMEOUT',
      bytes: 512,
      durationMs: 5002,
      traceId: 'c92841ab7f004911',
      tlsVip: 'TLS 1.3 / NetScaler-VIP'
    },
    {
      timestamp: new Date(Date.now() - 5100).toISOString().substring(11, 23),
      host: 'api.bank.com',
      uri: '/v1/compliance/sanctions/screen',
      status: 404,
      statusLabel: '404 NOT_FOUND',
      bytes: 310,
      durationMs: 3,
      traceId: '98124bcf01a938de',
      tlsVip: 'TLS 1.3 / Cloudflare-Edge'
    }
  ];

  res.json({
    bandwidthGb,
    logVolumeHourlyM,
    failuresByHost,
    statusDistribution,
    liveStream,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
