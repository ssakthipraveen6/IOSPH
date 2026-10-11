const express = require('express');
const router = express.Router();

// Mock / live fallback dataset for APM Overview
router.get('/overview', (req, res) => {
  const apdex = 0.984;
  const violations = 13;
  const syntheticFailures = 13;

  const deployments = [
    { rev: 'v1.5', deployer: 'praveen.s', description: 'Update NetScaler TLS session reuse VIP', time: '14:39, 11 Oct' },
    { rev: 'v1.4', deployer: 'release-bot', description: 'Tune RocksDB memory buffer pool for Kafka', time: '12:15, 11 Oct' },
    { rev: 'v1.3', deployer: 'jon.sre', description: 'Add circuit breaker to Oracle settlement pool', time: '09:40, 11 Oct' },
    { rev: 'v1.2', deployer: 'infra-cd', description: 'Patch OpenSSL 3.0.12 CVE-2024 zero-day', time: '06:22, 11 Oct' }
  ];

  const webTransactions = {
    avgResponseTimeMs: 22.4,
    stdDevMs: 6.8,
    history: [0.2, 0.25, 0.8, 0.82, 0.18, 0.2, 0.9, 0.22]
  };

  const errorsPerMin = {
    current: 4,
    history: [0.05, 0.04, 0.08, 0.05, 0.12, 0.6, 0.2, 0.05]
  };

  const datastore = {
    avgLatencyMs: 4.2,
    throughputPerMin: 124500,
    history: [0.15, 0.18, 0.22, 0.19, 0.24, 0.28, 0.35, 0.22]
  };

  const multiTierLayer = {
    database: [0.3, 0.35, 0.4, 0.38, 0.42, 0.48, 0.52, 0.41],
    cache: [0.2, 0.22, 0.25, 0.24, 0.26, 0.3, 0.32, 0.28],
    transit: [0.08, 0.1, 0.12, 0.11, 0.14, 0.15, 0.18, 0.12]
  };

  res.json({
    apdex,
    violations,
    syntheticFailures,
    deployments,
    webTransactions,
    errorsPerMin,
    datastore,
    multiTierLayer,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
