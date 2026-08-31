const fs = require('fs');
const path = require('path');
const rfs = require('rotating-file-stream');
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

// Single bounded rotating log stream for master log (capped at 500KB, maxFiles: 1)
const masterLogStream = rfs.createStream('windows_yaml_observability.log', {
  size: '500K',
  maxFiles: 1,
  path: LOG_DIR
});

function writeNasLog(level, category, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] [${category}] ${message}\n`;

  // Write to master rotating log stream with error resilience
  try {
    masterLogStream.write(logLine);
  } catch (err) {
    // Non-blocking write failure handling
  }

  // Broadcast live log line to WebSockets UI
  if (global.broadcastLog) {
    global.broadcastLog({ timestamp, level, category, message });
  }
}

module.exports = {
  writeNasLog,
  LOG_DIR
};
