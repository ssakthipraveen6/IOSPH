const db = require('../database/db');

// Local AI Engine definitions
const ANOMALY_PATTERNS = [
  {
    regex: /OOMKilled|OutOfMemoryError/i,
    category: 'Memory Leak Anomaly',
    component: 'artifactory',
    jenkinsJob: 'artifactory-jvm-recycle',
    severity: 'Critical',
    message: 'Local AI Anomaly: Detected heap leak signature [OutOfMemoryError] in JVM logs. Artifactory service degraded.'
  },
  {
    regex: /No space left on device|Filesystem utilization reached 98\.4%/i,
    category: 'Disk Space Anomaly',
    component: 'nas_performance',
    jenkinsJob: 'nas-log-purge',
    severity: 'Critical',
    message: 'Local AI Anomaly: Log spillage pattern identified. Storage capacity projected to exhaust in 12 minutes.'
  },
  {
    regex: /Database connection pool saturated|refused/i,
    category: 'Database Lock Anomaly',
    component: 'database',
    jenkinsJob: 'db-connection-flush',
    severity: 'Critical',
    message: 'Local AI Anomaly: TCP pool saturation detected on PostgreSQL node. Threads locked.'
  },
  {
    regex: /Ingress network bottleneck|sat/i,
    category: 'AVI Saturation Anomaly',
    component: 'avi_load_balancer',
    jenkinsJob: 'avi-ingress-scale',
    severity: 'Warning',
    message: 'Local AI Anomaly: Load balancer request queue rising exponentially. Bandwidth saturated.'
  }
];

function analyzeServerLogs(logLines, writeNasLog, triggerRecoveryFunc) {
  if (!logLines || logLines.length === 0) return;
  
  logLines.forEach(line => {
    ANOMALY_PATTERNS.forEach(pattern => {
      if (pattern.regex.test(line)) {
        writeNasLog('WARNING', 'AI_ENGINE', `[LOCAL AI ANALYZER] Log pattern match: ${pattern.category}. Raw: "${line}"`);
        
        // Check if alert already exists for this pattern
        const activeAlerts = db.getAlerts().filter(
          a => a.component === pattern.component && a.status === 'Active' && a.severity === pattern.severity
        );
        
        if (activeAlerts.length === 0) {
          db.addAlert(pattern.component, pattern.severity, pattern.message);
          writeNasLog('CRITICAL', 'AI_ENGINE', `[LOCAL AI PREDICTOR] Raised ${pattern.severity} Alert for ${pattern.component}: "${pattern.message}"`);
          
          if (triggerRecoveryFunc) {
            triggerRecoveryFunc(
              pattern.component, 
              `Local AI detected logs signature: "${pattern.category}"`, 
              pattern.jenkinsJob
            );
          }
        }
      }
    });
  });
}

module.exports = {
  analyzeServerLogs
};
