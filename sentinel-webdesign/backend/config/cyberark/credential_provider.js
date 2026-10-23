/**
 * Credential lookup for every integration: finds the safe/object in config/cyberark.yaml, fetches
 * it through CyberArk (cached), and falls back to an <APPID>_<PURPOSE> environment variable.
 */
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const { fetchFromCyberArk } = require('./cyberark_client');

// Same warning for the same thing at most once every 5 minutes (a poll cycle used to print it per request).
const _warned = new Map();
// Logs a warning at most once every 5 minutes per key.
function warnOnce(key, message) {
  const now = Date.now();
  if ((_warned.get(key) || 0) > now - 300000) return;
  _warned.set(key, now);
  console.warn(message);
}

const ROOT_CONFIG_DIR = path.resolve(__dirname, '../../../config');
const ROOT_REGISTRY_PATH = path.join(ROOT_CONFIG_DIR, 'cyberark.yaml');
const LEGACY_REGISTRY_PATH = path.join(__dirname, 'registry.yaml');
const REGISTRY_PATH = fs.existsSync(ROOT_REGISTRY_PATH) ? ROOT_REGISTRY_PATH : LEGACY_REGISTRY_PATH;
let registry = null;

// Loads config/cyberark.yaml once.
function getRegistry() {
  if (!registry) {
    const targetPath = fs.existsSync(ROOT_REGISTRY_PATH) ? ROOT_REGISTRY_PATH : REGISTRY_PATH;
    if (fs.existsSync(targetPath)) {
      registry = yaml.load(fs.readFileSync(targetPath, 'utf8')) || {};
    } else {
      registry = { applications: {}, infrastructure: {} };
    }
  }
  return registry;
}

const CACHE = new Map(); // `${appId}:${purpose}` -> { value, expiresAt }
let CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes default TTL

// Safe and object name for an application and purpose.
function resolveRegistryEntry(appId, purpose) {
  const reg = getRegistry();
  
  // 1. Direct match on application identifier
  const appEntry = reg.applications?.[appId];
  if (appEntry?.objects?.[purpose]) {
    return { safe: appEntry.safe, object: appEntry.objects[purpose] };
  }

  // 1b. Check unified manifest credentials (packages/config/definitions/)
  try {
    const yamlConfig = require('../yaml_config');
    const apps = yamlConfig.loadAllApplications();
    if (apps[appId]?.credentials?.objects?.[purpose]) {
      return { safe: apps[appId].credentials.safe, object: apps[appId].credentials.objects[purpose] };
    }
    const infra = yamlConfig.loadAllInfrastructureLayers();
    if (infra[appId]?.credentials?.objects?.[purpose]) {
      return { safe: infra[appId].credentials.safe, object: infra[appId].credentials.objects[purpose] };
    }
  } catch (e) {
    // Non-blocking fallback
  }

  // 2. Direct match on shared infrastructure key (e.g. appId === 'sso_eldap', 'avi', 'nfs', 'unix', etc.)
  const infraByAppId = reg.infrastructure?.[appId];
  if (infraByAppId?.objects) {
    if (infraByAppId.objects[purpose]) {
      return { safe: infraByAppId.safe, object: infraByAppId.objects[purpose] };
    }
    const firstKey = Object.keys(infraByAppId.objects)[0];
    if (firstKey) {
      return { safe: infraByAppId.safe, object: infraByAppId.objects[firstKey] };
    }
  }

  // 3. Fallback match on shared infrastructure key by purpose (e.g. purpose === 'avi', 'nfs', 'sso_eldap', etc.)
  const infraByPurpose = reg.infrastructure?.[purpose];
  if (infraByPurpose?.objects) {
    const firstKey = Object.keys(infraByPurpose.objects)[0];
    if (firstKey) {
      return { safe: infraByPurpose.safe, object: infraByPurpose.objects[firstKey] };
    }
  }

  return null;
}

/**
 * Resolves a credential for a given appId and purpose.
 * Resolution chain: Cache -> CyberArk Subprocess -> Process Environment (.env) -> Error.
 * 
 * @param {string} appId Application ID or Infrastructure Layer ID
 * @param {string} purpose Logical credential purpose ('db', 'sso', 'api_token', 'bind', etc.)
 * @param {object} options Override options for testing
 * @returns {Promise<string>} Resolved secret value
 */
async function getCredential(appId, purpose, options = {}) {
  if (!appId || !purpose) {
    throw new Error('[CRED] Both appId and purpose must be provided to resolve a credential.');
  }

  const cacheKey = `${appId}:${purpose}`;
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && !options.skipCache) {
    return cached.value;
  }

  let value = null;

  const entry = resolveRegistryEntry(appId, purpose);
  if (entry) {
    try {
      value = await fetchFromCyberArk(entry.safe, entry.object, options);
    } catch (e) {
      warnOnce(`fail:${appId}/${purpose}`, `[CRED] CyberArk fetch failed for ${appId}/${purpose}: ${e.message}. Falling back.`);
    }
  } else {
    warnOnce(`noreg:${appId}/${purpose}`, `[CRED] No registry entry for ${appId}/${purpose} — skipping CyberArk, trying fallback.`);
  }

  // Fallback: Strictly namespaced Environment Variables (${APPID}_${PURPOSE})
  if (!value) {
    const strictEnvVar = `${appId.toUpperCase()}_${purpose.toUpperCase()}`;
    if (process.env[strictEnvVar]) {
      value = process.env[strictEnvVar];
      console.warn(`[CRED] Using strictly namespaced .env fallback for ${appId}/${purpose} (${strictEnvVar}).`);
    }
  }

  if (!value) {
    throw new Error(`[CRED] No credential resolved for ${appId}/${purpose} from CyberArk or ${appId.toUpperCase()}_${purpose.toUpperCase()}.`);
  }

  CACHE.set(cacheKey, { value, expiresAt: Date.now() + (options.ttlMs || CACHE_TTL_MS) });
  return value;
}

// Clears one cached credential or all of them.
function clearCache(appId = null, purpose = null) {
  if (appId && purpose) {
    CACHE.delete(`${appId}:${purpose}`);
  } else if (appId) {
    for (const k of CACHE.keys()) {
      if (k.startsWith(`${appId}:`)) CACHE.delete(k);
    }
  } else {
    CACHE.clear();
  }
}

// Re-reads config/cyberark.yaml.
function reloadRegistry() {
  registry = null;
  getRegistry();
}

module.exports = {
  getCredential,
  resolveRegistryEntry,
  clearCache,
  reloadRegistry
};
