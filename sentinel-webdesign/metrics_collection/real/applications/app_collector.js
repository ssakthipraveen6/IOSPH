const fs = require('fs');
const path = require('path');
const yamlConfig = require('@sentinel/config/yaml_config');
const config = require('@sentinel/config');

/**
 * DYNAMIC APPLICATION METRICS COLLECTOR
 * Automatically discovers all applications defined in config/applications/*.yaml
 * and dynamically matches them with custom collector JS modules in this directory.
 */
async function collectAppMetrics(simulations, db, writeNasLog, targetEnv = null) {
  const currentMetrics = {};
  const appsConfig = yamlConfig.loadAllApplications();
  const collectorsDir = __dirname;
  const currentEnv = targetEnv || global.runtimeEnvironment || config.ENVIRONMENT || 'staging';
  const isProd = currentEnv === 'prod';

  const appKeys = Object.keys(appsConfig);

  for (let i = 0; i < appKeys.length; i++) {
    const key = appKeys[i];
    const appDef = appsConfig[key];

    // Skip alias entries; collection runs under canonical key and records to all aliases
    if (appDef && appDef.id && key !== appDef.id) {
      continue;
    }

    // Check if application probe is disabled via applications_enabled in global_config.yaml
    if (typeof config.isApplicationEnabled === 'function' && !config.isApplicationEnabled(key)) {
      continue;
    }
    
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

    // Dynamic module resolution: look for <key>_collector.js, alias_collector.js, or <key>.js
    const candidateKeys = [key];
    if (Array.isArray(appDef.aliases)) candidateKeys.push(...appDef.aliases);
    if (key.includes('_')) {
      const parts = key.split('_');
      candidateKeys.push(parts[parts.length - 1]);
      candidateKeys.push(parts[0]);
    }

    let collectorModule = null;
    const posibles = [];
    for (const cand of candidateKeys) {
      posibles.push(path.join(collectorsDir, `${cand}_collector.js`));
      posibles.push(path.join(collectorsDir, `${cand}.js`));
    }

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
        if (data && (data.status === 'AUTH_FAILED' || data.error === 'AUTH_FAILED' || data.authFailed)) {
          state = 'AUTH_FAILED';
          data = { responseTime: null, successRate: null, requests: null, isLive: false, error: 'AUTH_FAILED' };
        } else if (!data || data.error === 'Data Not Available' || Object.values(data).every(v => v === null)) {
          if (currentEnv === 'demo') {
            data = generateBaselineMetrics(base);
          } else {
            data = { responseTime: null, successRate: null, requests: null, isLive: false, error: 'Data Not Available' };
            state = 'DATA_UNAVAILABLE';
          }
        }
      } catch (e) {
        if (currentEnv === 'demo') {
          data = generateBaselineMetrics(base);
        } else {
          console.warn(`[APP COLLECTOR ${currentEnv.toUpperCase()}] Live feed unreachable for ${key}: ${e.message}`);
          data = { responseTime: null, successRate: null, requests: null, isLive: false, error: 'Data Not Available' };
          state = 'DATA_UNAVAILABLE';
        }
      }
    } else {
      if (currentEnv === 'demo') {
        data = generateBaselineMetrics(base);
      } else {
        data = { responseTime: null, successRate: null, requests: null, isLive: false, error: 'Data Not Available' };
        state = 'DATA_UNAVAILABLE';
      }
    }

    // Record metrics into DB tagged by current environment across canonical id and all aliases
    const recordKeys = Array.from(new Set([key, appDef.id, ...(appDef.aliases || [])].filter(Boolean)));

    recordKeys.forEach(k => {
      Object.keys(data).forEach(mName => {
        db.addMetric(k, mName, data[mName], currentEnv);
      });
      db.addMetric(k, 'status', state, currentEnv);
      currentMetrics[k] = { status: state, metrics: data };
    });
    if (state !== 'Healthy' && typeof writeNasLog === 'function') {
      const metricsStr = Object.keys(data).map(k => `${k}: ${data[k]}`).join(', ');
      writeNasLog('WARN', 'APP_REAL', `${key} [${currentEnv.toUpperCase()}] | Status: ${state} | Metrics: ${metricsStr}`);
    }
  }

  return currentMetrics;
}

function generateBaselineMetrics(base) {
  const result = {};
  Object.keys(base).forEach(k => {
    result[k] = base[k];
  });
  return result;
}

module.exports = {
  collectAppMetrics
};
