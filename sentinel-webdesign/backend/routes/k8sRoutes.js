const express = require('express');
const router = express.Router();

router.get('/mesh', (req, res) => {
  const coresAllocated = 3842;
  const coresTotal = 5120;
  const memoryCommittedTb = 73.8;
  const memoryTotalTb = 108.0;

  const objectCounts = {
    namespaces: 24,
    statefulSets: 28,
    deployments: 149,
    runningPods: 3854,
    serviceEndpoints: 765
  };

  const containerRestarts = {
    history: [0.1, 0.8, 0.3, 0.95, 0.2, 0.4, 0.7, 0.15, 0.9, 0.3]
  };

  const namespaceUsage = [
    { name: 'payment-gateway', cpuPercent: 88.4, cores: 1240, podsDesired: 1420, podsReady: 1420, status: 'critical' },
    { name: 'clearing-settlement-engine', cpuPercent: 72.1, cores: 980, podsDesired: 960, podsReady: 960, status: 'healthy' },
    { name: 'ledger-audit-stream', cpuPercent: 54.0, cores: 420, podsDesired: 480, podsReady: 480, status: 'normal' },
    { name: 'compliance-kyc-worker', cpuPercent: 31.2, cores: 210, podsDesired: 120, podsReady: 120, status: 'normal' }
  ];

  // 48 worker node honeycomb mesh
  const nodes = [];
  for (let i = 1; i <= 48; i++) {
    const id = `n${String(i).padStart(2, '0')}`;
    let status = 'healthy';
    let cpuLoad = 40 + (i % 30);
    if (i === 4 || i === 22) { status = 'warning'; cpuLoad = 78; }
    if (i === 10) { status = 'critical'; cpuLoad = 94; }
    nodes.push({ id, status, cpuLoad, memoryLoad: 60 + (i % 25) });
  }

  res.json({
    coresAllocated,
    coresTotal,
    memoryCommittedTb,
    memoryTotalTb,
    objectCounts,
    containerRestarts,
    namespaceUsage,
    nodes,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
