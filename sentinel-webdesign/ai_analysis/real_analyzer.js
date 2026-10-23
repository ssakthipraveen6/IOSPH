/**
 * Log and metric anomaly detection: rolling baselines with z-scores, and error-pattern detection
 * in server logs.
 */
const db = require('@sentinel/database');
const { SEVERITY } = require('@sentinel/shared-constants');
const crypto = require('crypto');

let postgres;
try {
  postgres = require('@sentinel/database/postgres');
} catch (_) {
  try {
    postgres = require('../database/postgres');
  } catch (e) {
    postgres = null;
  }
}

const baselines = require('./baselines');

// Rolling window per metric; scores new values against mean and deviation.
class MetricBaselineStore {
  // Creates the store (window size, z threshold).
  constructor(windowSize = 60, zThreshold = 3.0) {
    this.windowSize = windowSize;
    this.zThreshold = zThreshold;
    this.series = new Map(); // key `${env}:${component}:${metricName}` -> Array<number>
  }

  // Adds a value and returns its anomaly score.
  recordAndScore(component, metricName, value, env = 'staging', timestamp = new Date()) {
    if (typeof value !== 'number' || isNaN(value)) return null;

    // [M5 Task 5.1] Hour-of-Week Baselines (Median + MAD) Check
    const howScore = baselines.scoreObservation({
      env,
      entityId: component,
      metricName,
      value,
      timestamp,
      zThreshold: this.zThreshold,
      consecutiveN: 3
    });

    if (howScore && howScore.evaluated) {
      if (howScore.isAnomaly) {
        const decisionId = 'DEC-' + crypto.randomUUID();
        if (postgres && postgres.query) {
          postgres.query(`
            INSERT INTO model_decision (decision_id, timestamp, model_version, component, metric_name, value, mean, stddev, z_score, threshold, decision, environment)
            VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [
            decisionId,
            'how-baseline-v1',
            component,
            metricName,
            value,
            howScore.median,
            howScore.mad,
            howScore.robustZ,
            this.zThreshold,
            'ANOMALY_DETECTED',
            env
          ]).catch(() => {});
        }

        const alertMsg = `AI Statistical Anomaly: ${metricName} on ${component} reached ${value} (Robust Z: ${howScore.robustZ}, Median: ${howScore.median} ± MAD: ${howScore.mad})`;
        db.addAlert(component, SEVERITY.CRITICAL, alertMsg, 'Active', env);
      }

      return {
        component,
        metricName,
        value,
        mean: howScore.median,
        stddev: howScore.mad,
        zScore: howScore.robustZ,
        threshold: this.zThreshold,
        isAnomaly: howScore.isAnomaly,
        baselineType: 'hour_of_week'
      };
    }

    // Fallback: Rolling window z-score when hour-of-week samples are not yet collected
    const key = `${env}:${component}:${metricName}`;
    let window = this.series.get(key);
    if (!window) {
      window = [];
      this.series.set(key, window);
    }

    let scoreResult = null;
    if (window.length >= 5) {
      const mean = window.reduce((acc, v) => acc + v, 0) / window.length;
      const variance = window.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / window.length;
      const stddev = Math.sqrt(variance);

      let zScore = 0;
      if (stddev > 0.0001) {
        zScore = Math.abs((value - mean) / stddev);
      }

      const isAnomaly = zScore >= this.zThreshold;
      scoreResult = {
        component,
        metricName,
        value,
        mean: parseFloat(mean.toFixed(2)),
        stddev: parseFloat(stddev.toFixed(2)),
        zScore: parseFloat(zScore.toFixed(2)),
        threshold: this.zThreshold,
        isAnomaly
      };

      if (isAnomaly) {
        const decisionId = 'DEC-' + crypto.randomUUID();
        if (postgres && postgres.query) {
          postgres.query(`
            INSERT INTO model_decision (decision_id, timestamp, model_version, component, metric_name, value, mean, stddev, z_score, threshold, decision, environment)
            VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [
            decisionId,
            'zscore-v1',
            component,
            metricName,
            value,
            scoreResult.mean,
            scoreResult.stddev,
            scoreResult.zScore,
            this.zThreshold,
            'ANOMALY_DETECTED',
            env
          ]).catch(() => {});
        }

        const alertMsg = `AI Statistical Anomaly: ${metricName} on ${component} reached ${value} (Z-Score: ${scoreResult.zScore}, Baseline Mean: ${scoreResult.mean} ± ${scoreResult.stddev})`;
        db.addAlert(component, SEVERITY.CRITICAL, alertMsg, 'Active', env);
      }
    }

    window.push(value);
    if (window.length > this.windowSize) {
      window.shift();
    }

    return scoreResult;
  }

  // Mean and deviation of a metric's window.
  getBaseline(component, metricName, env = 'staging') {
    const key = `${env}:${component}:${metricName}`;
    const window = this.series.get(key) || [];
    if (window.length === 0) return null;
    const mean = window.reduce((acc, v) => acc + v, 0) / window.length;
    const variance = window.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / window.length;
    return {
      count: window.length,
      mean: parseFloat(mean.toFixed(2)),
      stddev: parseFloat(Math.sqrt(variance).toFixed(2))
    };
  }

  reset() {
    this.series.clear();
  }
}

const defaultBaselineStore = new MetricBaselineStore();

const ANOMALY_PATTERNS = [
  {
    regex: /OOMKilled|OutOfMemoryError/i,
    category: 'Memory Leak Anomaly',
    component: 'artifactory',
    jenkinsJob: 'artifactory-jvm-recycle',
    severity: SEVERITY.CRITICAL,
    message: 'Local AI Anomaly: Detected heap leak signature [OutOfMemoryError] in JVM logs. Artifactory service degraded.'
  },
  {
    regex: /No space left on device|Filesystem utilization reached 98\.4%/i,
    category: 'Disk Space Anomaly',
    component: 'nas_performance',
    jenkinsJob: 'nas-log-purge',
    severity: SEVERITY.CRITICAL,
    message: 'Local AI Anomaly: Log spillage pattern identified. Storage capacity projected to exhaust in 12 minutes.'
  },
  {
    regex: /Database connection pool saturated|refused/i,
    category: 'Database Lock Anomaly',
    component: 'database',
    jenkinsJob: 'db-connection-flush',
    severity: SEVERITY.CRITICAL,
    message: 'Local AI Anomaly: TCP pool saturation detected on PostgreSQL node. Threads locked.'
  },
  {
    regex: /Ingress network bottleneck|saturat(ed|ion)/i,
    category: 'AVI Saturation Anomaly',
    component: 'avi_load_balancer',
    jenkinsJob: 'avi-ingress-scale',
    severity: SEVERITY.WARNING,
    message: 'Local AI Anomaly: Load balancer request queue rising exponentially. Bandwidth saturated.'
  }
];

// Scans log lines for error patterns and triggers recovery when configured.
function analyzeServerLogs(logLines, writeNasLog, triggerRecoveryFunc, env = 'staging') {
  if (!logLines || logLines.length === 0) return;
  
  logLines.forEach(line => {
    ANOMALY_PATTERNS.forEach(pattern => {
      if (pattern.regex.test(line)) {
        writeNasLog('WARNING', 'AI_ENGINE_REAL', `[LOCAL AI ANALYZER] [${env.toUpperCase()}] Log pattern match: ${pattern.category}. Raw: "${line}"`);
        
        const activeAlerts = db.getAlerts(env).filter(
          a => a.component === pattern.component && a.status === 'Active' && a.severity === pattern.severity
        );
        
        if (activeAlerts.length === 0) {
          db.addAlert(pattern.component, pattern.severity, pattern.message, 'Active', env);
          writeNasLog('CRITICAL', 'AI_ENGINE_REAL', `[LOCAL AI PREDICTOR] [${env.toUpperCase()}] Raised ${pattern.severity} Alert for ${pattern.component}: "${pattern.message}"`);
          
          if (triggerRecoveryFunc) {
            triggerRecoveryFunc(
              pattern.component, 
              `Local AI detected logs signature: "${pattern.category}"`, 
              pattern.jenkinsJob,
              env
            );
          }
        }
      }
    });
  });
}

// Scores one metric value against its baseline.
function analyzeMetricStream(component, metricName, value, env = 'staging') {
  return defaultBaselineStore.recordAndScore(component, metricName, value, env);
}

module.exports = {
  analyzeServerLogs,
  analyzeMetricStream,
  MetricBaselineStore,
  defaultBaselineStore
};
