const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'nas_logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logFilePath = path.join(LOG_DIR, 'sentinel_observability.log');

function writeNasLog(level, category, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const logLine = `[${timestamp}] [${level}] [${category}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, logLine, 'utf8');
  } catch (error) {
    console.error('Failed writing to NAS log:', error);
  }
  
  if (global.broadcastLog) {
    global.broadcastLog(logLine);
  }
}

module.exports = {
  writeNasLog
};
