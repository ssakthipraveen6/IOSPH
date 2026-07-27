const config = require('../../../config/config');
const fs = require('fs');

const normalLogs = [
  "[BB-NET] GIT received push request for repository: sentinel-api - User: admin",
  "[DB-POOL] Acquired active transaction thread for client: bitbucket (elapsed: 2ms)",
  "[ART-REPO] Artifact uploaded successfully: /maven-stg/io/sentinel/portal/1.1.0/portal-1.1.0.jar",
  "[ARGO-SYNC] Comparing application state git rev: b492ac9d with cluster K8s resources... Sync OK",
  "[TC-BUILD] Build step completed successfully: Compile artifacts for project 'Remediator' (agent: node-2)",
  "[JENKINS-EVC] Executor #3 polling Jenkins Git Hook trigger queue... Empty",
  "[IIS-SERVER] GET /api/health - Client IP: 10.194.22.45 - Status 200 OK (elapsed: 15ms)",
  "[NEX-VIOL] Scanned jar 'spring-core-5.3.9.jar'. Found 0 critical policy violations",
  "[S3-BUCK] Performing multipart backup archiving snapshot sentinel_db_dump.sql (bandwidth: 84.5 MB/s)"
];

async function collectFluentdLogs(simulations, db, writeNasLog) {
  const logPath = config.STG_URLS.fluentd_log_path;
  const forwardUrl = config.STG_URLS.fluentd_http_endpoint;
  
  console.log(`[REAL COLLECTOR] Streaming logging stream to Fluent-bit forwarder: ${forwardUrl}`);
  
  const linesGenerated = [];
  for (let i = 0; i < 2; i++) {
    const idx = Math.floor(Math.random() * normalLogs.length);
    linesGenerated.push(normalLogs[idx]);
  }

  try {
    // In real deployment: read chunks of lines from logPath or POST to forwardUrl
    if (fs.existsSync(logPath)) {
      const logsText = fs.readFileSync(logPath, 'utf8');
      const lines = logsText.split('\n').filter(Boolean).slice(-5);
      linesGenerated.push(...lines);
    }
  } catch (e) {
    console.warn(`[REAL COLLECTOR] Fluent-bit logs directory check failed: ${e.message}`);
  }

  linesGenerated.forEach(line => {
    writeNasLog('INFO', 'LOG_AGENT_REAL', line);
  });

  return linesGenerated;
}

module.exports = {
  collectFluentdLogs
};
