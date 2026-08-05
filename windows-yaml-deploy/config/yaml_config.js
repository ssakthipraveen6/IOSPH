const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_DIR = __dirname;
const GLOBAL_YAML_PATH = path.join(CONFIG_DIR, 'global_config.yaml');
const APPS_DIR = path.join(CONFIG_DIR, 'applications');

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

function saveGlobalConfig(data) {
  const yamlStr = yaml.dump(data);
  fs.writeFileSync(GLOBAL_YAML_PATH, yamlStr, 'utf8');
}

function saveApplicationConfig(appId, data) {
  if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
  }
  const targetFile = path.join(APPS_DIR, `${appId}.yaml`);
  const yamlStr = yaml.dump(data);
  fs.writeFileSync(targetFile, yamlStr, 'utf8');
}

function getRawYaml(appId) {
  if (!appId) {
    return fs.existsSync(GLOBAL_YAML_PATH) ? fs.readFileSync(GLOBAL_YAML_PATH, 'utf8') : '';
  }
  const filePath = path.join(APPS_DIR, `${appId}.yaml`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

function updateRawYaml(appId, rawContent) {
  yaml.load(rawContent); // Validate syntax

  if (!appId) {
    fs.writeFileSync(GLOBAL_YAML_PATH, rawContent, 'utf8');
  } else {
    if (!fs.existsSync(APPS_DIR)) {
      fs.mkdirSync(APPS_DIR, { recursive: true });
    }
    const filePath = path.join(APPS_DIR, `${appId}.yaml`);
    fs.writeFileSync(filePath, rawContent, 'utf8');
  }
}

module.exports = {
  loadGlobalConfig,
  loadAllApplications,
  saveGlobalConfig,
  saveApplicationConfig,
  getRawYaml,
  updateRawYaml
};
