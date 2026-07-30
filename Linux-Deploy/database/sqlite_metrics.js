const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'metrics_history.jsonl');

// Schema Simulation: Columns are timestamp, component, metric_name, value
// We use a high-performance stream appender to keep writes instantaneous
function archiveMetrics(metrics) {
  const timestamp = new Date().toISOString();
  let entriesCount = 0;

  try {
    const linesToAppend = [];

    // Loop through each component layer
    Object.keys(metrics).forEach(component => {
      const compData = metrics[component];
      if (typeof compData !== 'object' || compData === null) return;

      // Extract metrics from nested object if present
      const compMetrics = compData.metrics || compData;
      if (typeof compMetrics !== 'object' || compMetrics === null) return;

      // Extract each individual metric key-value pair
      Object.keys(compMetrics).forEach(metricName => {
        const value = compMetrics[metricName];
        
        // Only archive numerical values
        if (typeof value === 'number') {
          const row = {
            timestamp,
            component,
            metric_name: metricName,
            value: parseFloat(value.toFixed(3))
          };
          linesToAppend.push(JSON.stringify(row));
          entriesCount++;
        }
      });
    });

    if (linesToAppend.length > 0) {
      // Append lines asynchronously/synchronously to preserve historical data
      fs.appendFileSync(DB_FILE, linesToAppend.join('\n') + '\n', 'utf8');
      console.log(`[SECONDARY DB] Archived ${entriesCount} performance metrics to local database: ${path.basename(DB_FILE)}`);
    }
  } catch (e) {
    console.error('[SECONDARY DB] Failed archiving performance metrics:', e.message);
  }
}

// Queries historical database entries to calculate averages for dashboards
function queryHistoricalMetrics(component, metricName, hoursLimit = 24) {
  const dataset = [];
  try {
    if (!fs.existsSync(DB_FILE)) return dataset;

    const data = fs.readFileSync(DB_FILE, 'utf8');
    const lines = data.split('\n');
    const cutoffTime = Date.now() - (hoursLimit * 60 * 60 * 1000);

    lines.forEach(line => {
      if (!line.trim()) return;
      try {
        const row = JSON.parse(line);
        if (
          row.component === component &&
          row.metric_name === metricName &&
          Date.parse(row.timestamp) >= cutoffTime
        ) {
          dataset.push({
            timestamp: row.timestamp,
            value: row.value
          });
        }
      } catch (_) {
        // Skip corrupted rows
      }
    });
  } catch (e) {
    console.error('[SECONDARY DB] Error querying metrics history:', e.message);
  }
  return dataset;
}

module.exports = {
  archiveMetrics,
  queryHistoricalMetrics
};
