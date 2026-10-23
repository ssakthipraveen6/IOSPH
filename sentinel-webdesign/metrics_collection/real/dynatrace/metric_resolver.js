/**
 * metrics_collection/real/dynatrace/metric_resolver.js
 *
 * Dynamic Dynatrace metric selector resolver (T5.2).
 * Resolves canonical Sentinel metric names against available Dynatrace descriptors.
 * Raises DATA_UNAVAILABLE alerts if a metric cannot be resolved.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { SEVERITY } = require('@sentinel/shared-constants');

let aliasConfig = null;
let resolvedSelectors = new Map(); // canonicalName -> activeSelector

// Loads config/dynatrace_metric_aliases.yaml.
function loadAliases() {
  if (aliasConfig) return aliasConfig;
  const cfgPath = path.resolve(__dirname, '../../../config/dynatrace_metric_aliases.yaml');
  try {
    if (fs.existsSync(cfgPath)) {
      const parsed = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed && parsed.aliases) {
        aliasConfig = parsed.aliases;
        return aliasConfig;
      }
    }
  } catch (e) {
    console.warn('[DYNATRACE_RESOLVER] Failed loading aliases YAML:', e.message);
  }
  aliasConfig = {};
  return aliasConfig;
}

/**
 * Resolves active metric selectors against known available descriptors.
 * 
 * @param {Array<string>} availableDescriptors List of metric descriptor IDs returned by Dynatrace API
 * @param {object} db Datastore for raising alerts on unresolved metrics
 * @param {string} env Environment
 * @returns {Map<string, string>} Map of canonical name to resolved selector
 */
function resolveDescriptors(availableDescriptors = [], db = null, env = 'staging') {
  const aliases = loadAliases();
  const descriptorSet = new Set(availableDescriptors || []);
  const resolved = new Map();

  for (const [canonicalName, def] of Object.entries(aliases)) {
    const candidates = def.candidates || [];
    let matched = null;

    if (descriptorSet.size > 0) {
      for (const cand of candidates) {
        if (descriptorSet.has(cand)) {
          matched = cand;
          break;
        }
      }
    } else {
      // If descriptor set not provided (e.g. offline/mock probe), use primary candidate
      matched = candidates[0] || canonicalName;
    }

    if (matched) {
      resolved.set(canonicalName, matched);
      resolvedSelectors.set(canonicalName, matched);
    } else {
      // When none resolve, raise DATA_UNAVAILABLE alert naming the metric (T5.2)
      resolved.set(canonicalName, null);
      resolvedSelectors.set(canonicalName, null);

      if (db && typeof db.addAlert === 'function') {
        const msg = `[DYNATRACE-DRIFT] Metric drift detected: Canonical metric "${canonicalName}" could not be resolved from candidates [${candidates.join(', ')}]. Status: DATA_UNAVAILABLE.`;
        db.addAlert('dynatrace', SEVERITY.WARNING, msg, 'Active', env);
      }
    }
  }

  return resolved;
}

// Dynatrace selector for a Sentinel metric name.
function getActiveSelector(canonicalName) {
  if (resolvedSelectors.has(canonicalName)) {
    return resolvedSelectors.get(canonicalName);
  }
  const aliases = loadAliases();
  if (aliases[canonicalName] && aliases[canonicalName].candidates) {
    return aliases[canonicalName].candidates[0];
  }
  return canonicalName;
}

module.exports = {
  loadAliases,
  resolveDescriptors,
  getActiveSelector
};
