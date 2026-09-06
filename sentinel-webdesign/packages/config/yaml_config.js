const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_DIR = __dirname;
const GLOBAL_YAML_PATH = path.join(CONFIG_DIR, 'global_config.yaml');
const DEFINITIONS_DIR = path.join(CONFIG_DIR, 'definitions');
const APPS_DIR = path.join(CONFIG_DIR, 'applications');
const INFRA_DIR = path.join(CONFIG_DIR, 'infrastructure');
const REGISTRY_PATH = path.join(CONFIG_DIR, 'cyberark', 'registry.yaml');

let cachedGlobal = null;
let cachedApps = null;
let cachedInfra = null;

function clearConfigCache() {
  cachedGlobal = null;
  cachedApps = null;
  cachedInfra = null;
}

function loadGlobalConfig(forceReload = false) {
  if (cachedGlobal && !forceReload) return cachedGlobal;
  if (fs.existsSync(GLOBAL_YAML_PATH)) {
    try {
      cachedGlobal = yaml.load(fs.readFileSync(GLOBAL_YAML_PATH, 'utf8')) || {};
      return cachedGlobal;
    } catch (e) {
      console.error('[YAML CONFIG] Error parsing global_config.yaml:', e.message);
    }
  }
  return {};
}

function loadAllApplications(forceReload = false) {
  if (cachedApps && !forceReload) return cachedApps;
  const apps = {};

  // 1. Load legacy applications as baseline fallback
  if (fs.existsSync(APPS_DIR)) {
    const files = fs.readdirSync(APPS_DIR);
    files.forEach(file => {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = path.join(APPS_DIR, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = yaml.load(content);
          if (parsed && parsed.id) {
            apps[parsed.id] = parsed;
          }
        } catch (e) {
          console.error(`[YAML CONFIG] Error parsing ${file}:`, e.message);
        }
      }
    });
  }

  // 2. Load unified definitions (Option A) with priority
  if (fs.existsSync(DEFINITIONS_DIR)) {
    const files = fs.readdirSync(DEFINITIONS_DIR);
    files.forEach(file => {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = path.join(DEFINITIONS_DIR, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = yaml.load(content);
          if (parsed && parsed.id) {
            const isApp = parsed.kind === 'application' || (file.startsWith('app-') && parsed.kind !== 'infrastructure');
            if (isApp) {
              apps[parsed.id] = { ...apps[parsed.id], ...parsed };
            }
          }
        } catch (e) {
          console.error(`[YAML CONFIG] Error parsing definition ${file}:`, e.message);
        }
      }
    });
  }

  cachedApps = apps;
  return apps;
}

function loadAllInfrastructureLayers(forceReload = false) {
  if (cachedInfra && !forceReload) return cachedInfra;
  const layers = {};

  // 1. Load legacy infrastructure as baseline fallback
  if (fs.existsSync(INFRA_DIR)) {
    const files = fs.readdirSync(INFRA_DIR);
    files.forEach(file => {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = path.join(INFRA_DIR, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = yaml.load(content);
          if (parsed && parsed.id) {
            layers[parsed.id] = parsed;
          }
        } catch (e) {
          console.error(`[YAML CONFIG] Error parsing infra layer ${file}:`, e.message);
        }
      }
    });
  }

  // 2. Load unified definitions (Option A) with priority
  if (fs.existsSync(DEFINITIONS_DIR)) {
    const files = fs.readdirSync(DEFINITIONS_DIR);
    files.forEach(file => {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = path.join(DEFINITIONS_DIR, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = yaml.load(content);
          if (parsed && parsed.id) {
            const isInfra = parsed.kind === 'infrastructure' || (file.startsWith('infra-') && parsed.kind !== 'application');
            if (isInfra) {
              layers[parsed.id] = { ...layers[parsed.id], ...parsed };
            }
          }
        } catch (e) {
          console.error(`[YAML CONFIG] Error parsing infra definition ${file}:`, e.message);
        }
      }
    });
  }

  cachedInfra = layers;
  return layers;
}

function validateConfig() {
  const apps = loadAllApplications();
  let registry = {};
  if (fs.existsSync(REGISTRY_PATH)) {
    try {
      registry = yaml.load(fs.readFileSync(REGISTRY_PATH, 'utf8')) || {};
    } catch (e) {
      console.error('[YAML CONFIG] Could not parse cyberark/registry.yaml:', e.message);
    }
  }

  const errors = [];

  Object.entries(apps).forEach(([appId, cfg]) => {
    if (!cfg.id) {
      errors.push(`App config file for "${appId}" is missing required field "id".`);
    }

    const hasEndpoint = (cfg.endpoints && (cfg.endpoints.prod?.api || cfg.endpoints.stg?.api)) || cfg.api;
    if (!hasEndpoint) {
      errors.push(`App config "${appId}" missing required API endpoint (endpoints.prod.api or endpoints.stg.api).`);
    }

    if (cfg.layers) {
      Object.entries(cfg.layers).forEach(([layerKey, layerVal]) => {
        if (layerVal && typeof layerVal === 'object' && layerVal.credential_purpose) {
          const purpose = layerVal.credential_purpose;
          const appRegistry = registry.applications?.[appId];
          const hasAppObject = appRegistry?.objects?.[purpose] || cfg.credentials?.objects?.[purpose];
          const hasInfraObject = registry.infrastructure?.[purpose] || registry.infrastructure?.[layerKey];
          
          if (!hasAppObject && !hasInfraObject) {
            errors.push(`App "${appId}" layer "${layerKey}" references credential_purpose "${purpose}", but no matching entry exists in cyberark/registry.yaml or app manifest credentials.`);
          }
        }
      });
    }
  });

  if (errors.length > 0) {
    const errorMsg = `[CONFIG VALIDATION FAILED] Found ${errors.length} validation error(s):\n` + errors.join('\n');
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  return true;
}

function sanitizeAppId(appId) {
  if (!appId) return null;
  const sanitized = String(appId).trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new Error(`[SECURITY] Invalid appId "${appId}". App ID must contain only alphanumeric characters, underscores, and hyphens.`);
  }
  return sanitized;
}

function saveGlobalConfig(data) {
  clearConfigCache();
  const yamlStr = yaml.dump(data);
  fs.writeFileSync(GLOBAL_YAML_PATH, yamlStr, 'utf8');
}

function saveApplicationConfig(appId, data) {
  clearConfigCache();
  const safeAppId = sanitizeAppId(appId);
  if (!safeAppId) {
    throw new Error('[YAML CONFIG] Cannot save application config without a valid appId.');
  }

  // Save to definitions directory if available, else legacy applications dir
  if (fs.existsSync(DEFINITIONS_DIR)) {
    const targetFile = path.join(DEFINITIONS_DIR, `app-${safeAppId}.yaml`);
    fs.writeFileSync(targetFile, yaml.dump(data), 'utf8');
    return;
  }

  if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
  }
  const targetFile = path.join(APPS_DIR, `${safeAppId}.yaml`);
  fs.writeFileSync(targetFile, yaml.dump(data), 'utf8');
}

function getRawYaml(appId) {
  if (!appId) {
    return fs.existsSync(GLOBAL_YAML_PATH) ? fs.readFileSync(GLOBAL_YAML_PATH, 'utf8') : '';
  }
  const safeAppId = sanitizeAppId(appId);

  // 1. Check definitions directory first
  if (fs.existsSync(DEFINITIONS_DIR)) {
    const defApp = path.join(DEFINITIONS_DIR, `app-${safeAppId}.yaml`);
    if (fs.existsSync(defApp)) return fs.readFileSync(defApp, 'utf8');
    const defInfra = path.join(DEFINITIONS_DIR, `infra-${safeAppId}.yaml`);
    if (fs.existsSync(defInfra)) return fs.readFileSync(defInfra, 'utf8');
    const defDirect = path.join(DEFINITIONS_DIR, `${safeAppId}.yaml`);
    if (fs.existsSync(defDirect)) return fs.readFileSync(defDirect, 'utf8');
  }

  // 2. Fallback to legacy applications directory
  const filePath = path.join(APPS_DIR, `${safeAppId}.yaml`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

function updateRawYaml(appId, rawContent) {
  clearConfigCache();
  yaml.load(rawContent); // Validate YAML syntax

  if (!appId) {
    fs.writeFileSync(GLOBAL_YAML_PATH, rawContent, 'utf8');
  } else {
    const safeAppId = sanitizeAppId(appId);
    let targetPath = null;

    if (fs.existsSync(DEFINITIONS_DIR)) {
      const defApp = path.join(DEFINITIONS_DIR, `app-${safeAppId}.yaml`);
      const defInfra = path.join(DEFINITIONS_DIR, `infra-${safeAppId}.yaml`);
      const defDirect = path.join(DEFINITIONS_DIR, `${safeAppId}.yaml`);

      if (fs.existsSync(defApp)) {
        targetPath = defApp;
      } else if (fs.existsSync(defInfra)) {
        targetPath = defInfra;
      } else if (fs.existsSync(defDirect)) {
        targetPath = defDirect;
      } else {
        targetPath = defApp;
      }
    } else {
      if (!fs.existsSync(APPS_DIR)) {
        fs.mkdirSync(APPS_DIR, { recursive: true });
      }
      targetPath = path.join(APPS_DIR, `${safeAppId}.yaml`);
    }

    fs.writeFileSync(targetPath, rawContent, 'utf8');
  }

  // Validate overall system configuration consistency
  validateConfig();
}

module.exports = {
  sanitizeAppId,
  loadGlobalConfig,
  loadAllApplications,
  loadApplicationConfigs: loadAllApplications,
  loadAllInfrastructureLayers,
  validateConfig,
  saveGlobalConfig,
  saveApplicationConfig,
  getRawYaml,
  updateRawYaml,
  DEFINITIONS_DIR,
  APPS_DIR,
  INFRA_DIR
};
