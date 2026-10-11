const express = require('express');
const router = express.Router();

router.get('/sod-audit', (req, res) => {
  const pendingActions = [
    {
      id: 'ACT-0849201',
      action: 'ORACLE_KILL_BLOCKING_SESSION(SID: 412)',
      target: 'oracle-rac-cluster-02 (Node 02)',
      incidentId: 'INC0849201',
      primarySigner: 'praveen.s (SRE Lead)',
      primarySignedAt: '14:40:12 UTC',
      status: 'PENDING_CO_SIGN',
      riskLevel: 'CRITICAL_PRODUCTION_MUTATION'
    }
  ];

  const itsmSync = [
    {
      ticketId: 'INC0849201',
      priority: 'P1-CRITICAL',
      ciComponent: 'clearing-settlement-engine',
      assignedGroup: 'BFSI Tier-0 SRE',
      status: 'Investigating'
    },
    {
      ticketId: 'INC0849188',
      priority: 'P2-HIGH',
      ciComponent: 'oracle-rac-cluster-02',
      assignedGroup: 'Database Operations',
      status: 'Remediated'
    },
    {
      ticketId: 'CHG0094102',
      priority: 'STANDARD',
      ciComponent: 'netscaler-vip-core',
      assignedGroup: 'Network Perimeter',
      status: 'Scheduled'
    }
  ];

  const auditTrail = [
    {
      timestamp: '14:48:12 UTC',
      event: 'SESSION_TOKEN_MINTED',
      details: 'Minted via CyberArk Vault CCP engine',
      hash: '8f4a2c1b9e01a883726d5ef0',
      operator: 'praveen.s',
      ip: '10.240.12.88'
    },
    {
      timestamp: '14:42:45 UTC',
      event: 'CIRCUIT_BREAKER_TRIPPED',
      details: 'Oracle HikariCP max consecutive errors exceeded threshold 5',
      hash: 'd32b918f02acc8840192eef1',
      operator: 'sentinel-sentinel-daemon',
      ip: '10.240.12.01'
    },
    {
      timestamp: '14:35:10 UTC',
      event: 'PRE_TERMINATION_HEAP_DUMP',
      details: 'Captured thread dump before eviction to S3-Vault://bfsi-audit/',
      hash: 'c9014efa7781b28499210aa3',
      operator: 'sentinel-agent-node-10',
      ip: '10.240.14.92'
    }
  ];

  res.json({
    pendingActions,
    itsmSync,
    auditTrail,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
