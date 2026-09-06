const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const { fetchFromCyberArk } = require('./cyberark_client');

const REGISTRY_PATH = path.join(__dirname, 'registry.yaml');
let registry = null;

function getRegistry() {
  if (!registry) {
    if (fs.existsSync(REGISTRY_PATH)) {
      registry = yaml.load(fs.readFileSync(REGISTRY_PATH, 'utf8')) || {};
    } else {
      registry = { applications: {}, infrastructure: {} };
    }
  }
  return registry;
}

const CACHE = new Map(); // `${appId}:${purpose}` -> { value, expiresAt }
let CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes default TTL

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
      console.warn(`[CRED] CyberArk fetch failed for ${appId}/${purpose}: ${e.message}. Falling back.`);
    }
  } else {
    console.warn(`[CRED] No registry entry for ${appId}/${purpose} — skipping CyberArk, trying fallback.`);
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

function clearCache() {
  CACHE.clear();
}

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
