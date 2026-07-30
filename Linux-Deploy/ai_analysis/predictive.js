const db = require('../database/db');
const { writeNasLog } = require('../backend/logger');

// Simple linear regression to calculate slope and predict breach time
function calculateLinearRegression(points) {
  const n = points.length;
  if (n < 5) return { slope: 0, intercept: 0 }; // Need enough points
  
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  
  // Use index as X (time step, e.g. 10s intervals)
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = points[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  return { slope, intercept };
}

function checkPredictiveAlerts(component, metricName, threshold, alertMessageTemplate) {
  // Get last 15 metric points for this component and metric (approx 2.5 minutes)
  const allMetrics = db.getMetrics(component, 100);
  const filtered = allMetrics.filter(m => m.metricName === metricName);
  
  if (filtered.length < 8) return; // Wait for historical buffer
  
  const values = filtered.map(m => m.value);
  const currentVal = values[values.length - 1];
  
  // Check if current value already exceeds threshold (it's already a critical error, handled by recovery)
  if (currentVal >= threshold) {
    return;
  }
  
  const { slope } = calculateLinearRegression(values);
  
  // If slope is positive, we are trending upwards
  if (slope > 0.05) { // Ensure there is a meaningful upward trend
    // Number of steps (10 seconds each) to reach threshold
    const stepsToBreach = (threshold - currentVal) / slope;
    const secondsToBreach = stepsToBreach * 10;
    const minutesToBreach = secondsToBreach / 60;
    
    // If it will breach within 15 minutes (900 seconds)
    if (minutesToBreach > 0 && minutesToBreach <= 15) {
      const activeAlerts = db.getAlerts().filter(
        a => a.component === component && a.status === 'Active' && a.severity === 'Predictive-Warning'
      );
      
      if (activeAlerts.length === 0) {
        const breachTimeStr = Math.ceil(minutesToBreach);
        const msg = alertMessageTemplate
          .replace('{val}', currentVal.toFixed(1))
          .replace('{time}', breachTimeStr)
          .replace('{thresh}', threshold);
        
        db.addAlert(component, 'Predictive-Warning', msg);
        writeNasLog('WARNING', 'PREDICTIVE', `[ANOMALY DETECTED] ${component} - ${msg}`);
      }
    }
  } else {
    // If slope is negative or flat, and we have an active predictive warning, resolve it
    const activeAlerts = db.getAlerts().filter(
      a => a.component === component && a.status === 'Active' && a.severity === 'Predictive-Warning'
    );
    if (activeAlerts.length > 0) {
      db.resolveAlertsForComponent(component);
      writeNasLog('INFO', 'PREDICTIVE', `[ANOMALY RESOLVED] ${component} metric ${metricName} stabilized. Predictive alerts cleared.`);
    }
  }
}

function runPredictiveAnalysis(currentMetrics) {
  // 1. Check Artifactory Heap Usage Trend (Simulated Heap Leak)
  checkPredictiveAlerts(
    'artifactory', 
    'heap', 
    90, 
    'Predictive Alert: Heap memory is at {val}% and rising. Projected to breach JVM Heap Limit ({thresh}%) in {time} minutes.'
  );

  // 2. Check Database CPU Trend
  checkPredictiveAlerts(
    'database', 
    'cpu', 
    90, 
    'Predictive Alert: DB CPU utilization is at {val}% and rising. Projected to breach thread pool capacity ({thresh}%) in {time} minutes.'
  );

  // 3. Check NAS Storage Space Used Trend (Simulated Log Spill)
  checkPredictiveAlerts(
    'nas_performance', 
    'spaceUsed', 
    95, 
    'Predictive Alert: NAS capacity is at {val}% and filling rapidly. Projected to exhaust storage capacity ({thresh}%) in {time} minutes.'
  );
}

// Attach to global scope for the collector loop to invoke without circular references
global.runPredictiveAnalysis = runPredictiveAnalysis;

module.exports = {
  runPredictiveAnalysis
};
