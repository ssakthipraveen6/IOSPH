const fs = require('fs');
const path = require('path');
const yamlConfig = require('../../../config/yaml_config');
const config = require('../../../config/config');

/**
 * DYNAMIC APPLICATION METRICS COLLECTOR
 * Automatically discovers all applications defined in config/applications/*.yaml
 * and dynamically matches them with custom collector JS modules in this directory.
 */
async function collectAppMetrics(simulations, db, writeNasLog) {
  const currentMetrics = {};
  const appsConfig = yamlConfig.loadAllApplications();
  const collectorsDir = __dirname;
  const currentEnv = global.runtimeEnvironment || config.ENVIRONMENT || 'staging';
  const isProd = currentEnv === 'prod';

  const appKeys = Object.keys(appsConfig);

  for (let i = 0; i < appKeys.length; i++) {
    const key = appKeys[i];
    const appDef = appsConfig[key];
    
    // Baseline values from YAML declaration or fallback
    const base = appDef.metrics_baseline || {
      responseTime: 100,
      successRate: 99.5,
      requests: 30
    };

    let state = 'Healthy';
    if (currentEnv === 'staging' && simulations[key] && simulations[key].type === 'outage') {
      state = 'Critical';
    }

    // Dynamic module resolution: look for <key>_collector.js or <key>.js
    let collectorModule = null;
    const posibles = [
      path.join(collectorsDir, `${key}_collector.js`),
      path.join(collectorsDir, `${key}.js`)
    ];

    for (const p of posibles) {
      if (fs.existsSync(p)) {
        try {
          collectorModule = require(p);
          break;
        } catch (e) {
          console.error(`[APP COLLECTOR] Failed requiring custom collector script ${p}:`, e.message);
        }
      }
    }

    let data = {};

    if (collectorModule && typeof collectorModule.collect === 'function') {
      try {
        data = await collectorModule.collect(currentEnv === 'staging' ? simulations : {}, base);
        // If in prod and all values are null or failed, mark unavailable
        if (isProd && (!data || data.error === 'Data Not Available')) {
          data = { responseTime: null, successRate: null, requests: null, isLive: false, error: 'Data Not Available' };
          state = 'DATA_UNAVAILABLE';
        }
      } catch (e) {
        if (isProd) {
          console.warn(`[APP COLLECTOR PROD] Live feed unreachable for ${key}: ${e.message}`);
          data = { responseTime: null, successRate: null, requests: null, isLive: false, error: 'Data Not Available' };
          state = 'DATA_UNAVAILABLE';
        } else {
          console.warn(`[APP COLLECTOR] Error running collector for ${key}: ${e.message}. Using baseline.`);
          data = generateBaselineMetrics(base);
        }
      }
    } else {
      if (isProd) {
        data = { responseTime: null, successRate: null, requests: null, isLive: false, error: 'Data Not Available' };
        state = 'DATA_UNAVAILABLE';
      } else {
        data = generateBaselineMetrics(base);
      }
    }

    // Record metrics into DB tagged by current environment
    Object.keys(data).forEach(mName => {
      db.addMetric(key, mName, data[mName], currentEnv);
    });

    currentMetrics[key] = { status: state, metrics: data };
    if (state !== 'Healthy') {
      const metricsStr = Object.keys(data).map(k => `${k}: ${data[k]}`).join(', ');
      writeNasLog('WARN', 'APP_REAL', `${key} [${currentEnv.toUpperCase()}] | Status: ${state} | Metrics: ${metricsStr}`);
    }
  }

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
