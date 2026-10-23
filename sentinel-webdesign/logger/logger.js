/**
 * Structured logging to rotating files (NAS log folder), with environment tags.
 */
const fs = require('fs');
const path = require('path');
const rfs = require('rotating-file-stream');
const config = require('@sentinel/config');
const yamlConfig = require('@sentinel/config/yaml_config');

const runtimeDir = path.resolve(__dirname, '../.runtime');
const localNasFallback = path.join(runtimeDir, 'nas_logs');

// Resolve NAS log folder from config with fallback for local dev environment
let LOG_DIR = config.USE_SIMULATED_COLLECTORS ? config.STG_URLS.nas_mount : config.PROD_URLS.nas_mount;
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  console.warn(`[LOGGER] Could not create target NAS mount (${LOG_DIR}), falling back to local .runtime/nas_logs folder.`);
  LOG_DIR = localNasFallback;
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

// Enterprise audit-grade rotating log stream (daily rotation, 500MB slice cap, 30-day retention with gzip compression)
const masterLogStream = rfs.createStream('windows_yaml_observability.log', {
  size: process.env.LOG_ROTATION_SIZE || '500M',
  interval: process.env.LOG_ROTATION_INTERVAL || '1d',
  maxFiles: parseInt(process.env.LOG_RETENTION_FILES, 10) || 30,
  compress: 'gzip',
  path: LOG_DIR
});

// Writes one structured log line.
function writeNasLog(level, category, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const env = meta.environment || global.runtimeEnvironment || 'staging';
  const traceId = meta.traceId || meta.trace_id || null;

  const logPayload = {
    timestamp,
    level,
    category,
    message,
    environment: env,
    trace_id: traceId,
    ...meta
  };

  const logLine = process.env.LOG_FORMAT === 'json'
    ? `${JSON.stringify(logPayload)}\n`
    : `[${timestamp}] [${level}] [${category}] ${traceId ? `[trace:${traceId}] ` : ''}${message}\n`;

  // Write to master rotating log stream with error resilience
  try {
    masterLogStream.write(logLine);
  } catch (err) {
    // Non-blocking write failure handling
  }

  // Broadcast live log line to WebSockets UI
  if (global.broadcastLog) {
    global.broadcastLog(logPayload);
  }
}

// Same as writeNasLog.
function writeStructuredLog(level, category, message, meta = {}) {
  return writeNasLog(level, category, message, meta);
}

// Logger bound to a category.
function createStructuredLogger(category) {
  return {
    info: (msg, meta) => writeNasLog('INFO', category, msg, meta),
    warn: (msg, meta) => writeNasLog('WARNING', category, msg, meta),
    error: (msg, meta) => writeNasLog('ERROR', category, msg, meta),
    debug: (msg, meta) => writeNasLog('DEBUG', category, msg, meta),
    critical: (msg, meta) => writeNasLog('CRITICAL', category, msg, meta)
  };
}

module.exports = {
  writeNasLog,
  writeStructuredLog,
  createStructuredLogger,
  LOG_DIR
};
