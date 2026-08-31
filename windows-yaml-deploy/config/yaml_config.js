const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_DIR = __dirname;
const GLOBAL_YAML_PATH = path.join(CONFIG_DIR, 'global_config.yaml');
const APPS_DIR = path.join(CONFIG_DIR, 'applications');
const INFRA_DIR = path.join(CONFIG_DIR, 'infrastructure');
const REGISTRY_PATH = path.join(CONFIG_DIR, 'cyberark', 'registry.yaml');

function loadGlobalConfig() {
  if (fs.existsSync(GLOBAL_YAML_PATH)) {
    try {
      return yaml.load(fs.readFileSync(GLOBAL_YAML_PATH, 'utf8')) || {};
    } catch (e) {
      console.error('[YAML CONFIG] Error parsing global_config.yaml:', e.message);
    }
  }
  return {};
}

function loadAllApplications() {
  const apps = {};
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
  return apps;
}

function loadAllInfrastructureLayers() {
  const layers = {};
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
          const hasAppObject = appRegistry?.objects?.[purpose];
          const hasInfraObject = registry.infrastructure?.[purpose] || registry.infrastructure?.[layerKey];
          
          if (!hasAppObject && !hasInfraObject) {
            errors.push(`App "${appId}" layer "${layerKey}" references credential_purpose "${purpose}", but no matching entry exists in cyberark/registry.yaml.`);
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
  const yamlStr = yaml.dump(data);
  fs.writeFileSync(GLOBAL_YAML_PATH, yamlStr, 'utf8');
}

function saveApplicationConfig(appId, data) {
  const safeAppId = sanitizeAppId(appId);
  if (!safeAppId) {
    throw new Error('[YAML CONFIG] Cannot save application config without a valid appId.');
  }
  if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
  }
  const targetFile = path.join(APPS_DIR, `${safeAppId}.yaml`);
  const yamlStr = yaml.dump(data);
  fs.writeFileSync(targetFile, yamlStr, 'utf8');
}

function getRawYaml(appId) {
  if (!appId) {
    return fs.existsSync(GLOBAL_YAML_PATH) ? fs.readFileSync(GLOBAL_YAML_PATH, 'utf8') : '';
  }
  const safeAppId = sanitizeAppId(appId);
  const filePath = path.join(APPS_DIR, `${safeAppId}.yaml`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

function updateRawYaml(appId, rawContent) {
  const parsed = yaml.load(rawContent); // Validate YAML syntax

  if (!appId) {
    fs.writeFileSync(GLOBAL_YAML_PATH, rawContent, 'utf8');
  } else {
    const safeAppId = sanitizeAppId(appId);
    if (!fs.existsSync(APPS_DIR)) {
      fs.mkdirSync(APPS_DIR, { recursive: true });
    }
    const filePath = path.join(APPS_DIR, `${safeAppId}.yaml`);
    fs.writeFileSync(filePath, rawContent, 'utf8');
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
  updateRawYaml
};
