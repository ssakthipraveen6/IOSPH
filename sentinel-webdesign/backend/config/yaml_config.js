/**
 * Loads, validates and saves the YAML configuration: config/global.yaml, config/apps/*.yaml
 * (application manifests) and config/infra/*.yaml (infrastructure layers).
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_PKG_DIR = __dirname;
const ROOT_CONFIG_DIR = path.resolve(__dirname, '../../config');

// Primary Root Config Paths
const ROOT_GLOBAL_YAML = path.join(ROOT_CONFIG_DIR, 'global.yaml');
const ROOT_APPS_DIR = path.join(ROOT_CONFIG_DIR, 'apps');
const ROOT_INFRA_DIR = path.join(ROOT_CONFIG_DIR, 'infra');
const ROOT_REGISTRY_PATH = path.join(ROOT_CONFIG_DIR, 'cyberark.yaml');

// Legacy packages/config Paths (Fallback)
const LEGACY_GLOBAL_YAML = path.join(CONFIG_PKG_DIR, 'global_config.yaml');
const DEFINITIONS_DIR = path.join(CONFIG_PKG_DIR, 'definitions');
const APPS_DIR = path.join(CONFIG_PKG_DIR, 'applications');
const INFRA_DIR = path.join(CONFIG_PKG_DIR, 'infrastructure');
const LEGACY_REGISTRY_PATH = path.join(CONFIG_PKG_DIR, 'cyberark', 'registry.yaml');

const GLOBAL_YAML_PATH = fs.existsSync(ROOT_GLOBAL_YAML) ? ROOT_GLOBAL_YAML : LEGACY_GLOBAL_YAML;
const REGISTRY_PATH = fs.existsSync(ROOT_REGISTRY_PATH) ? ROOT_REGISTRY_PATH : LEGACY_REGISTRY_PATH;

let cachedGlobal = null;
let cachedApps = null;
let cachedInfra = null;

// [YAML-SRC] Maps every resolvable config id (including aliases) to the file it
// actually came from, so lookups never have to guess a filename from an id.
let cachedSourceFiles = null;

// Map of application id to the manifest file it came from.
function getSourceFileMap() {
  if (!cachedSourceFiles) {
    cachedSourceFiles = {};
    loadAllApplications();
    loadAllInfrastructureLayers();
  }
  return cachedSourceFiles;
}

// Remembers which file an application was loaded from.
function recordSourceFile(parsed, filePath) {
  if (!cachedSourceFiles) cachedSourceFiles = {};
  cachedSourceFiles[parsed.id] = filePath;
  if (Array.isArray(parsed.aliases)) {
    for (const alias of parsed.aliases) {
      if (!cachedSourceFiles[alias]) cachedSourceFiles[alias] = filePath;
    }
  }
}

// Drops the cached configuration so the next read reloads the files.
function clearConfigCache() {
  cachedGlobal = null;
  cachedApps = null;
  cachedInfra = null;
  cachedSourceFiles = null;
}

// Reads config/global.yaml (cached).
function loadGlobalConfig(forceReload = false) {
  if (cachedGlobal && !forceReload) return cachedGlobal;
  const targetGlobal = fs.existsSync(ROOT_GLOBAL_YAML) ? ROOT_GLOBAL_YAML : GLOBAL_YAML_PATH;
  if (fs.existsSync(targetGlobal)) {
    try {
      cachedGlobal = yaml.load(fs.readFileSync(targetGlobal, 'utf8')) || {};
      return cachedGlobal;
    } catch (e) {
      console.error('[YAML CONFIG] Error parsing global config YAML:', e.message);
    }
  }
  return {};
}

// Reads every application manifest in config/apps (cached), including aliases.
function loadAllApplications(forceReload = false) {
  if (cachedApps && !forceReload) return cachedApps;
  const apps = {};

  function scanDir(dir, filterFn) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      // Files prefixed with "_" are templates or notes, never real manifests.
      if (file.startsWith('_')) return;
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = path.join(dir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = yaml.load(content);
          if (parsed && parsed.id && (!filterFn || filterFn(parsed, file))) {
            apps[parsed.id] = { ...apps[parsed.id], ...parsed };
            recordSourceFile(parsed, filePath);
          }
        } catch (e) {
          throw new Error(`[YAML CONFIG] Fatal error parsing application config ${file}: ${e.message}`);
        }
      }
    });
  }

  // 1. Load legacy applications as baseline fallback
  scanDir(APPS_DIR);

  // 2. Load unified definitions (Option A) with priority
  scanDir(DEFINITIONS_DIR, (parsed, file) => {
    return parsed.kind === 'application' || (file.startsWith('app-') && parsed.kind !== 'infrastructure');
  });

  // 3. Load root config/apps/ with highest priority
  scanDir(ROOT_APPS_DIR, (parsed) => {
    return parsed.kind !== 'infrastructure';
  });

  // 4. Populate aliases for backward compatibility (T1.5)
  for (const app of Object.values(apps)) {
    if (Array.isArray(app.aliases)) {
      for (const alias of app.aliases) {
        if (!apps[alias]) {
          apps[alias] = app;
        }
      }
    }
  }

  cachedApps = apps;
  return apps;
}

// One application by id (also accepts its aliases).
function getApplication(appId) {
  if (!appId) return null;
  const apps = loadAllApplications();
  if (apps[appId]) return apps[appId];
  // Check aliases (T1.5)
  for (const app of Object.values(apps)) {
    if (Array.isArray(app.aliases) && app.aliases.includes(appId)) {
      return app;
    }
  }
  return null;
}

// Reads every infrastructure layer in config/infra (cached).
function loadAllInfrastructureLayers(forceReload = false) {
  if (cachedInfra && !forceReload) return cachedInfra;
  const layers = {};

  function scanDir(dir, filterFn) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = path.join(dir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = yaml.load(content);
          if (parsed && parsed.id && (!filterFn || filterFn(parsed, file))) {
            layers[parsed.id] = { ...layers[parsed.id], ...parsed };
            recordSourceFile(parsed, filePath);
          }
        } catch (e) {
          throw new Error(`[YAML CONFIG] Fatal error parsing infra layer ${file}: ${e.message}`);
        }
      }
    });
  }

  // 1. Load legacy infrastructure as baseline fallback
  scanDir(INFRA_DIR);

  // 2. Load unified definitions (Option A) with priority
  scanDir(DEFINITIONS_DIR, (parsed, file) => {
    return parsed.kind === 'infrastructure' || (file.startsWith('infra-') && parsed.kind !== 'application');
  });

  // 3. Load root config/infra/ with highest priority
  scanDir(ROOT_INFRA_DIR, (parsed) => {
    return parsed.kind !== 'application';
  });

  cachedInfra = layers;
  return layers;
}

// Validates manifests and the CyberArk registry; returns errors and warnings.
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

    if (Array.isArray(cfg.journeys)) {
      const VALID_STEP_TYPES = ['http', 'browser', 'git', 'upload_download', 'jenkins'];
      const VALID_LAYERS = ['network', 'app', 'db', 'storage'];
      cfg.journeys.forEach((j, jIdx) => {
        const jName = j.id || `journey[${jIdx}]`;
        if (!j.id) {
          errors.push(`App "${appId}" journey at index ${jIdx} missing "id".`);
        }
        if (j.interval_seconds !== undefined && Number(j.interval_seconds) < 30) {
          errors.push(`App "${appId}" journey "${jName}" interval_seconds (${j.interval_seconds}) must be >= 30.`);
        }
        if (!Array.isArray(j.steps) || j.steps.length === 0) {
          errors.push(`App "${appId}" journey "${jName}" has no steps.`);
        } else {
          j.steps.forEach((s, sIdx) => {
            const sName = s.id || `step[${sIdx}]`;
            if (!s.type || !VALID_STEP_TYPES.includes(s.type)) {
              errors.push(`App "${appId}" journey "${jName}" step "${sName}" has unknown type "${s.type}".`);
            }
            if (!s.layer) {
              errors.push(`App "${appId}" journey "${jName}" step "${sName}" missing required field "layer".`);
            } else if (!VALID_LAYERS.includes(s.layer)) {
              errors.push(`App "${appId}" journey "${jName}" step "${sName}" has invalid layer "${s.layer}".`);
            }
          });
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

// Checks an application id is safe to use in a file name.
function sanitizeAppId(appId) {
  if (!appId) return null;
  const sanitized = String(appId).trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new Error(`[SECURITY] Invalid appId "${appId}". App ID must contain only alphanumeric characters, underscores, and hyphens.`);
  }
  return sanitized;
}

// Writes config/global.yaml.
function saveGlobalConfig(data) {
  clearConfigCache();
  const yamlStr = yaml.dump(data);
  const target = fs.existsSync(ROOT_GLOBAL_YAML) ? ROOT_GLOBAL_YAML : GLOBAL_YAML_PATH;
  fs.writeFileSync(target, yamlStr, 'utf8');
  if (target !== GLOBAL_YAML_PATH && fs.existsSync(GLOBAL_YAML_PATH)) {
    try { fs.writeFileSync(GLOBAL_YAML_PATH, yamlStr, 'utf8'); } catch (e) {}
  }
}

// Writes one application manifest.
function saveApplicationConfig(appId, data) {
  clearConfigCache();
  const safeAppId = sanitizeAppId(appId);
  if (!safeAppId) {
    throw new Error('[YAML CONFIG] Cannot save application config without a valid appId.');
  }

  // 1. Save to root config/apps/ if available
  if (fs.existsSync(ROOT_APPS_DIR)) {
    const targetFile = path.join(ROOT_APPS_DIR, `${safeAppId}.yaml`);
    fs.writeFileSync(targetFile, yaml.dump(data), 'utf8');
    if (fs.existsSync(DEFINITIONS_DIR)) {
      try {
        fs.writeFileSync(path.join(DEFINITIONS_DIR, `app-${safeAppId}.yaml`), yaml.dump(data), 'utf8');
      } catch (e) {}
    }
    return;
  }

  // 2. Save to definitions directory if available, else legacy applications dir
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

// Raw YAML text of the global config or one manifest.
function getRawYaml(appId) {
  if (!appId) {
    const globalPath = fs.existsSync(ROOT_GLOBAL_YAML) ? ROOT_GLOBAL_YAML : GLOBAL_YAML_PATH;
    return fs.existsSync(globalPath) ? fs.readFileSync(globalPath, 'utf8') : '';
  }
  const safeAppId = sanitizeAppId(appId);

  // 0. Resolve through the recorded source-file map. This is the only lookup that
  //    survives id/filename divergence (underscores vs hyphens) and alias ids that
  //    have no file of their own.
  const srcMap = getSourceFileMap();
  const knownPath = srcMap[safeAppId];
  if (knownPath && fs.existsSync(knownPath)) {
    return fs.readFileSync(knownPath, 'utf8');
  }

  // 1. Check root config/apps/
  if (fs.existsSync(ROOT_APPS_DIR)) {
    const appFile = path.join(ROOT_APPS_DIR, `${safeAppId}.yaml`);
    if (fs.existsSync(appFile)) return fs.readFileSync(appFile, 'utf8');
    const appPrefixed = path.join(ROOT_APPS_DIR, `app-${safeAppId}.yaml`);
    if (fs.existsSync(appPrefixed)) return fs.readFileSync(appPrefixed, 'utf8');
  }

  // 2. Check root config/infra/
  if (fs.existsSync(ROOT_INFRA_DIR)) {
    const infraFile = path.join(ROOT_INFRA_DIR, `${safeAppId}.yaml`);
    if (fs.existsSync(infraFile)) return fs.readFileSync(infraFile, 'utf8');
    const infraPrefixed = path.join(ROOT_INFRA_DIR, `infra-${safeAppId}.yaml`);
    if (fs.existsSync(infraPrefixed)) return fs.readFileSync(infraPrefixed, 'utf8');
  }

  // 3. Check definitions directory
  if (fs.existsSync(DEFINITIONS_DIR)) {
    const defApp = path.join(DEFINITIONS_DIR, `app-${safeAppId}.yaml`);
    if (fs.existsSync(defApp)) return fs.readFileSync(defApp, 'utf8');
    const defInfra = path.join(DEFINITIONS_DIR, `infra-${safeAppId}.yaml`);
    if (fs.existsSync(defInfra)) return fs.readFileSync(defInfra, 'utf8');
    const defDirect = path.join(DEFINITIONS_DIR, `${safeAppId}.yaml`);
    if (fs.existsSync(defDirect)) return fs.readFileSync(defDirect, 'utf8');
  }

  // 4. Fallback to legacy applications directory
  const filePath = path.join(APPS_DIR, `${safeAppId}.yaml`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

// Replaces a YAML file after checking its syntax.
function updateRawYaml(appId, rawContent) {
  clearConfigCache();
  yaml.load(rawContent); // Validate YAML syntax

  if (!appId) {
    const target = fs.existsSync(ROOT_GLOBAL_YAML) ? ROOT_GLOBAL_YAML : GLOBAL_YAML_PATH;
    fs.writeFileSync(target, rawContent, 'utf8');
    if (target !== GLOBAL_YAML_PATH && fs.existsSync(GLOBAL_YAML_PATH)) {
      try { fs.writeFileSync(GLOBAL_YAML_PATH, rawContent, 'utf8'); } catch (e) {}
    }
  } else {
    const safeAppId = sanitizeAppId(appId);
    let targetPath = null;

    // Determine target in root config
    if (fs.existsSync(ROOT_APPS_DIR) || fs.existsSync(ROOT_INFRA_DIR)) {
      const appFile = path.join(ROOT_APPS_DIR, `${safeAppId}.yaml`);
      const infraFile = path.join(ROOT_INFRA_DIR, `${safeAppId}.yaml`);
      if (fs.existsSync(infraFile)) {
        targetPath = infraFile;
      } else {
        targetPath = appFile;
      }
    } else if (fs.existsSync(DEFINITIONS_DIR)) {
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
  getSourceFileMap,
  loadGlobalConfig,
  loadAllApplications,
  getApplication,
  loadApplicationConfigs: loadAllApplications,
  loadAllInfrastructureLayers,
  validateConfig,
  saveGlobalConfig,
  saveApplicationConfig,
  getRawYaml,
  updateRawYaml,
  ROOT_CONFIG_DIR,
  ROOT_APPS_DIR,
  ROOT_INFRA_DIR,
  DEFINITIONS_DIR,
  APPS_DIR,
  INFRA_DIR
};
