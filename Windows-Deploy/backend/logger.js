const fs = require('fs');
const path = require('path');
const config = require('../config/config');

// Resolve NAS log folder from config
const LOG_DIR = config.USE_SIMULATED_COLLECTORS ? config.STG_URLS.nas_mount : config.PROD_URLS.nas_mount;
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logFilePath = path.join(LOG_DIR, 'sentinel_observability.log');

// Map log levels/messages to app subfolders
function detectApplication(category, message) {
  const components = [
    'avi_load_balancer', 'database', 'windows_servers', 'linux_servers', 's3_storage', 'nas_performance',
    'bitbucket', 'jenkins_k8s', 'artifactory', 'nexusiq', 'fortify', 'teamcity', 'servicenow', 'dynatrace',
    'mcp_server_k8s', 'argocd_k8s', 'argoworkflows_k8s', 'sonarqube', 'github', 'sso_gateway', 'network_latency'
  ];

  // 1. Check if message starts with "componentName |"
  const pipeIdx = message.indexOf(' |');
  if (pipeIdx > 0) {
    const candidate = message.substring(0, pipeIdx).trim().toLowerCase();
    if (components.includes(candidate)) {
      return candidate;
    }
  }

  // 2. Check for tag prefixes in the message like [BB-NET], [DB-ERR], etc.
  const upperMsg = message.toUpperCase();
  if (upperMsg.includes('[BB-NET]') || upperMsg.includes('BITBUCKET')) return 'bitbucket';
  if (upperMsg.includes('[DB-') || upperMsg.includes('DATABASE') || upperMsg.includes('POSTGRES')) return 'database';
  if (upperMsg.includes('[ART-') || upperMsg.includes('ARTIFACTORY')) return 'artifactory';
  if (upperMsg.includes('[ARGO-SYNC') || upperMsg.includes('ARGOCD')) return 'argocd_k8s';
  if (upperMsg.includes('[ARGO-WORKFLOWS') || upperMsg.includes('ARGOWORKFLOWS')) return 'argoworkflows_k8s';
  if (upperMsg.includes('[TC-BUILD') || upperMsg.includes('TEAMCITY')) return 'teamcity';
  if (upperMsg.includes('[JENKINS') || upperMsg.includes('JENKINS')) return 'jenkins_k8s';
  if (upperMsg.includes('[IIS-SERVER') || upperMsg.includes('WINDOWS')) return 'windows_servers';
  if (upperMsg.includes('[NEX-') || upperMsg.includes('NEXUS')) return 'nexusiq';
  if (upperMsg.includes('FORTIFY')) return 'fortify';
  if (upperMsg.includes('SONAR')) return 'sonarqube';
  if (upperMsg.includes('[S3-') || upperMsg.includes('S3_STORAGE')) return 's3_storage';
  if (upperMsg.includes('[NAS-') || upperMsg.includes('NAS_PERFORMANCE')) return 'nas_performance';
  if (upperMsg.includes('[AVI-') || upperMsg.includes('AVI_LOAD_BALANCER')) return 'avi_load_balancer';
  if (upperMsg.includes('SSO_GATEWAY') || upperMsg.includes('SSO')) return 'sso_gateway';
  if (upperMsg.includes('NETWORK_LATENCY') || upperMsg.includes('NETWORK')) return 'network_latency';
  if (upperMsg.includes('DYNATRACE')) return 'dynatrace';
  if (upperMsg.includes('SERVICENOW')) return 'servicenow';
  if (upperMsg.includes('MCP')) return 'mcp_server_k8s';
  if (upperMsg.includes('LINUX')) return 'linux_servers';

  // 3. Scan the message for any exact match of a component name
  for (const comp of components) {
    if (message.toLowerCase().includes(comp)) {
      return comp;
    }
  }

  // 4. Default to 'system'
  return 'system';
}

function writeNasLog(level, category, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const logLine = `[${timestamp}] [${level}] [${category}] ${message}\n`;
  
  // Write to the global log first (for backward compatibility/single view)
  try {
    fs.appendFileSync(logFilePath, logLine, 'utf8');
  } catch (error) {
    console.error('Failed writing to global NAS log:', error);
  }

  // Write to categorized application subfolder
  const app = detectApplication(category, message);
  const appDir = path.join(LOG_DIR, app);
  try {
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }
    const appLogFile = path.join(appDir, `${app}.log`);
    fs.appendFileSync(appLogFile, logLine, 'utf8');
  } catch (error) {
    console.error(`Failed writing to app log for ${app}:`, error);
  }
  
  if (global.broadcastLog) {
    global.broadcastLog(logLine);
  }
}

module.exports = {
  writeNasLog
};
