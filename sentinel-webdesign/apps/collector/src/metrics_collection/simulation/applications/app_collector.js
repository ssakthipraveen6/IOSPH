const fs = require('fs');
const path = require('path');
const yamlConfig = require('../../../config/yaml_config');

/**
 * DYNAMIC SIMULATION APPLICATION METRICS COLLECTOR
 * Dynamically loads applications from config/applications/*.yaml
 */
function collectAppMetrics(simulations, db, writeNasLog) {
  const currentMetrics = {};
  const appsConfig = yamlConfig.loadAllApplications();
  const realCollectorsDir = path.join(__dirname, '../../real/applications');

  Object.keys(appsConfig).forEach(key => {
    const appDef = appsConfig[key];
    const base = appDef.metrics_baseline || { responseTime: 85, successRate: 99.5, requests: 30 };

    let state = 'Healthy';
    if (simulations[key] && simulations[key].type === 'outage') {
      state = 'Critical';
    }

    // Dynamic resolution of custom collector if present
    let collectorModule = null;
    const posibles = [
      path.join(__dirname, `${key}_collector.js`),
      path.join(__dirname, `${key}.js`),
      path.join(realCollectorsDir, `${key}_collector.js`),
      path.join(realCollectorsDir, `${key}.js`)
    ];

    for (const p of posibles) {
      if (fs.existsSync(p)) {
        try {
          collectorModule = require(p);
          break;
        } catch (e) {
          // ignore
        }
      }
    }

    let data = {};
    if (collectorModule && typeof collectorModule.collect === 'function') {
      try {
        const res = collectorModule.collect(simulations, base);
        data = (res && typeof res.then === 'function') ? base : res; // sync or async fallback
      } catch (e) {
        data = generateBaselineMetrics(base);
      }
    } else {
      data = generateBaselineMetrics(base);
    }

    Object.keys(data).forEach(mName => {
      db.addMetric(key, mName, data[mName]);
    });

    currentMetrics[key] = { status: state, metrics: data };
    const metricsStr = Object.keys(data).map(k => `${k}: ${data[k]}`).join(', ');
    writeNasLog('INFO', 'APP_SIMULATION', `${key} | Status: ${state} | Metrics: ${metricsStr}`);
  });

  return currentMetrics;
}

function generateBaselineMetrics(base) {
  const result = {};
  Object.keys(base).forEach(k => {
    const val = base[k];
    if (typeof val === 'number') {
      const variation = (Math.random() - 0.5) * (val * 0.1);
      result[k] = parseFloat(Math.max(0, val + variation).toFixed(2));
    } else {
      result[k] = val;
    }
  });
  return result;
}

module.exports = {
  collectAppMetrics
};
