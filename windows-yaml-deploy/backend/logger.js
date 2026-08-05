const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const yamlConfig = require('../config/yaml_config');

// Resolve NAS log folder from config with fallback for local dev environment
let LOG_DIR = config.USE_SIMULATED_COLLECTORS ? config.STG_URLS.nas_mount : config.PROD_URLS.nas_mount;
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  console.warn(`[LOGGER] Could not create target NAS mount (${LOG_DIR}), falling back to local nas_logs folder.`);
  LOG_DIR = path.join(__dirname, '../nas_logs');
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

const logFilePath = path.join(LOG_DIR, 'windows_yaml_observability.log');

function detectApplication(category, message) {
  const appsConfig = yamlConfig.loadAllApplications();
  const dynamicApps = Object.keys(appsConfig);

  // 1. Check if message starts with "componentName |"
  const pipeIdx = message.indexOf(' |');
  if (pipeIdx > 0) {
    const candidate = message.substring(0, pipeIdx).trim().toLowerCase();
    if (dynamicApps.includes(candidate)) {
      return candidate;
    }
  }

  // 2. Check for tag prefixes defined in YAML (log_tag)
  const upperMsg = message.toUpperCase();
  for (let i = 0; i < dynamicApps.length; i++) {
    const appKey = dynamicApps[i];
    const appDef = appsConfig[appKey];
    if (appDef.log_tag && upperMsg.includes(appDef.log_tag.toUpperCase())) {
      return appKey;
    }
    if (upperMsg.includes(appKey.toUpperCase())) {
      return appKey;
    }
  }

  return null;
}

function writeNasLog(level, category, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] [${category}] ${message}\n`;

  // Write to master log file
  fs.appendFile(logFilePath, logLine, (err) => {
    if (err) console.error('[LOGGER ERROR] Failed to write to NAS master log:', err);
  });

  // Write to application-specific log file if detected
  const app = detectApplication(category, message);
  if (app) {
    const appDir = path.join(LOG_DIR, app);
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }
    const appLogPath = path.join(appDir, `${app}.log`);
    fs.appendFile(appLogPath, logLine, (err) => {
      if (err) console.error(`[LOGGER ERROR] Failed to write to ${app}.log:`, err);
    });
  }

  // Broadcast live log line to WebSockets UI
  if (global.broadcastLog) {
    global.broadcastLog({ timestamp, level, category, message, app });
  }
}

module.exports = {
  writeNasLog,
  LOG_DIR
};
