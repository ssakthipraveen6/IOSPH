const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const db = require('../database/db');
const collector = require('../metrics_collection/collector_coordinator');
const postgresDb = require('../database/postgres');
const snowflakeDb = require('../database/snowflake');
const customChecks = require('../remediation/custom_checks');
const predictive = require('../ai_analysis/predictive'); // imports runPredictiveAnalysis and attaches globally
const recovery = require('../remediation/recovery');     // imports runSelfHealingOrchestrator and attaches globally

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

app.use(cors());
app.use(express.json());

// Serve static files from the React frontend build folder
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(distPath));

// WebSockets connections list
const clients = new Set();

// Broadcast a message to all connected WebSocket clients
function broadcast(data) {
  const payload = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Global helpers that collector and recovery use to broadcast details
global.broadcastLog = (logLine) => {
  broadcast({ type: 'log', data: logLine });
};

global.broadcastStateChange = () => {
  broadcast({
    type: 'state',
    data: {
      alerts: db.getAlerts(),
      recovery: db.getRecoveryLogs(),
      settings: db.getSettings(),
      health: calculateHealthState(),
      customChecks: customChecks.runCustomChecks(collector.getSimulations())
    }
  });
};

// Periodic status broadcast
setInterval(() => {
  broadcast({
    type: 'metrics_tick',
    data: {
      health: calculateHealthState(),
      simulations: collector.getSimulations(),
      customChecks: customChecks.runCustomChecks(collector.getSimulations())
    }
  });
}, 5000);

// Health Index Calculator
function calculateHealthState() {
  const metrics = db.getMetrics(null, 30); // Get recent points
  const activeAlerts = db.getAlerts().filter(a => a.status === 'Active');
  
  // Get active simulations to know current states
  const sims = collector.getSimulations();
  
  let healthIndex = 100;
  
  // Deduct for active alerts
  activeAlerts.forEach(alert => {
    if (alert.severity === 'Critical') {
      healthIndex -= 15;
    } else if (alert.severity === 'Warning') {
      healthIndex -= 6;
    } else if (alert.severity === 'Predictive-Warning') {
      healthIndex -= 3;
    }
  });
  
  // Deduct for active simulated outages
  Object.keys(sims).forEach(comp => {
    const sim = sims[comp];
    if (sim.type === 'outage') {
      healthIndex -= 20;
    } else if (sim.type === 'memory_leak' || sim.type === 'disk_full') {
      healthIndex -= 8;
    }
  });
  
  healthIndex = Math.max(0, Math.min(100, healthIndex));
  
  // Compile statuses dynamically from YAML applications + core infra
  const baseInfraComponents = [
    'avi_load_balancer', 'database', 'windows_servers', 'linux_servers', 's3_storage', 'nas_performance',
    'servicenow', 'dynatrace', 'sso_gateway', 'network_latency'
  ];
  const dynamicYamlApps = Object.keys(yamlConfig.loadAllApplications());
  const components = Array.from(new Set([...baseInfraComponents, ...dynamicYamlApps]));
  
  const componentStatuses = {};
  components.forEach(comp => {
    const criticalAlerts = activeAlerts.filter(a => a.component === comp && a.severity === 'Critical');
    const warnAlerts = activeAlerts.filter(a => a.component === comp && (a.severity === 'Warning' || a.severity === 'Predictive-Warning'));
    
    if (criticalAlerts.length > 0 || (sims[comp] && sims[comp].type === 'outage')) {
      componentStatuses[comp] = 'Critical';
    } else if (warnAlerts.length > 0 || (sims[comp] && sims[comp].type !== 'outage')) {
      componentStatuses[comp] = 'Warning';
    } else {
      componentStatuses[comp] = 'Healthy';
    }
  });
  
  return {
    score: healthIndex,
    componentStatuses,
    alertsCount: activeAlerts.length,
    pendingApprovals: db.getRecoveryLogs().filter(r => r.status === 'Awaiting-Approval').length,
    uptime: formatUptime(process.uptime())
  };
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// --- HTTP API ROUTES ---

// Overall Health Status
app.get('/api/health', (req, res) => {
  res.json(calculateHealthState());
});

// Component historical metrics (all)
app.get('/api/metrics', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 2000;
  res.json(db.getMetrics(null, limit));
});

// Component historical metrics (specific)
app.get('/api/metrics/:component', (req, res) => {
  const component = req.params.component;
  const limit = req.query.limit ? parseInt(req.query.limit) : 60;
  res.json(db.getMetrics(component, limit));
});

// Alerts Listing
app.get('/api/alerts', (req, res) => {
  res.json(db.getAlerts());
});

// Recovery Actions Logs
app.get('/api/recovery', (req, res) => {
  res.json(db.getRecoveryLogs());
});

// Get current system settings
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

// Update settings
app.post('/api/settings', (req, res) => {
  const settings = db.updateSettings(req.body);
  global.broadcastStateChange();
  res.json(settings);
});

// YAML Configurations Management APIs
const yamlConfig = require('../config/yaml_config');

// --- SSO & eLDAP AUTHENTICATION APIS ---
app.get('/api/auth/sso/status', (req, res) => {
  const globalCfg = yamlConfig.loadGlobalConfig();
  const ldapConfig = globalCfg.sso_ldap_config || {
    enabled: true,
    provider: "eLDAP / Active Directory",
    ldap_url: "ldaps://ldap.enterprise.corp:636",
    base_dn: "ou=Users,dc=enterprise,dc=corp"
  };
  res.json({
    status: 'ACTIVE',
    provider: ldapConfig.provider,
    ldapUrl: ldapConfig.ldap_url,
    baseDn: ldapConfig.base_dn,
    ssoEndpoint: globalCfg.prod_urls?.sso_api || 'https://sso-auth-prod.internal.corp/oauth2/token'
  });
});

app.post('/api/auth/sso/login', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username or eLDAP UPN is required' });
  }
  const userRole = username.toLowerCase().includes('admin') ? 'Super Admin' : 
                  (username.toLowerCase().includes('sre') ? 'SRE Lead' : 'NOC Operator');
  res.json({
    authenticated: true,
    user: {
      username,
      displayName: username.split('@')[0].replace('.', ' ').toUpperCase(),
      email: username.includes('@') ? username : `${username}@enterprise.corp`,
      role: userRole,
      ldapDn: `cn=${username},ou=Users,dc=enterprise,dc=corp`,
      authProvider: 'eLDAP / Active Directory SSO',
      authenticatedAt: new Date().toISOString()
    }
  });
});

app.get('/api/yaml/all', (req, res) => {
  res.json({
    global: yamlConfig.loadGlobalConfig(),
    applications: yamlConfig.loadAllApplications()
  });
});

app.get('/api/yaml/app/:id', (req, res) => {
  const apps = yamlConfig.loadAllApplications();
  if (apps[req.params.id]) {
    res.json(apps[req.params.id]);
  } else {
    res.status(404).json({ error: `Application ${req.params.id} not found` });
  }
});

app.get('/api/yaml/raw', (req, res) => {
  try {
    const appId = req.query.appId || null;
    const rawYaml = yamlConfig.getRawYaml(appId);
    res.json({ appId, yaml: rawYaml });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const bitbucketPrService = require('../config/bitbucket_pr_service');

app.post('/api/yaml/raw', async (req, res) => {
  try {
    const { appId, rawYaml, author, commitMessage } = req.body;
    
    // Create Bitbucket PR automatically
    const prResult = await bitbucketPrService.createConfigPullRequest({
      appId: appId || null,
      rawYaml,
      author: author || 'DevSecOps Admin',
      commitMessage
    });

    global.broadcastStateChange();

    res.json({
      success: true,
      message: `YAML updated and Bitbucket Pull Request #${prResult.prId} created!`,
      prUrl: prResult.prUrl,
      prId: prResult.prId,
      branchName: prResult.branchName,
      filePath: prResult.filePath
    });
  } catch (err) {
    res.status(400).json({ error: `Invalid YAML Syntax or GitOps Error: ${err.message}` });
  }
});

app.post('/api/yaml/create-pr', async (req, res) => {
  try {
    const { appId, rawYaml, author, commitMessage } = req.body;
    const prResult = await bitbucketPrService.createConfigPullRequest({
      appId: appId || null,
      rawYaml,
      author: author || 'DevSecOps Admin',
      commitMessage
    });
    global.broadcastStateChange();
    res.json(prResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger issue simulation
app.post('/api/simulate', (req, res) => {
  const { component, type } = req.body;
  if (!component || !type) {
    return res.status(400).json({ error: 'Missing component or type' });
  }
  
  collector.triggerSimulation(component, type);
  global.broadcastStateChange();
  
  res.json({ success: true, simulations: collector.getSimulations() });
});

// Approve self-healing action
app.post('/api/recovery/approve', (req, res) => {
  const { runId } = req.body;
  if (!runId) {
    return res.status(400).json({ error: 'Missing runId' });
  }
  
  const success = recovery.approveRecovery(runId);
  res.json({ success });
});

// Clear Database metrics
app.post('/api/metrics/clear', (req, res) => {
  db.clearMetrics();
  res.json({ success: true });
});

// Custom Checks endpoint
app.get('/api/custom-checks', (req, res) => {
  res.json(customChecks.runCustomChecks(collector.getSimulations()));
});

// Historical Telemetry Analytics metrics endpoint (Postgres simulated source)
app.get('/api/pbi/metrics', async (req, res) => {
  const { component, metricName, hours } = req.query;
  const hoursLimit = hours ? parseInt(hours) : 24;
  
  if (!component || !metricName) {
    return res.status(400).json({ error: 'Missing component or metricName' });
  }
  
  const data = await postgresDb.fetchHistoricalMetricsFromPostgres(component, metricName, hoursLimit);
  res.json(data);
});

// Historical Telemetry Analytics logs endpoint (Snowflake simulated source)
app.get('/api/pbi/logs', async (req, res) => {
  const data = await snowflakeDb.fetchLogAnalyticsFromSnowflake();
  res.json(data);
});

// RCA Correlation endpoint
const rcaService = require('./extensions/rca_analytics');
app.get('/api/rca-correlation', (req, res) => {
  const { app } = req.query;
  res.json(rcaService.getRcaData(app));
});

// Infra Ticket Impact (1-week before/after) endpoint
const ticketService = require('./extensions/ticket_analytics');
app.get('/api/infra-tickets', (req, res) => {
  res.json(ticketService.getTicketImpactData());
});

// Catch-all route to serve the React application index page
app.get('*', (req, res) => {
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.send('Intelligent Observability & Autonomous Recovery Framework backend running. Frontend is compiling...');
  }
});

// Upgrade HTTP Server to WebSockets
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// WebSockets Connection logic
wss.on('connection', (ws) => {
  clients.add(ws);
  
  // Send initial data to client
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      health: calculateHealthState(),
      alerts: db.getAlerts(),
      recovery: db.getRecoveryLogs(),
      settings: db.getSettings(),
      simulations: collector.getSimulations(),
      customChecks: customChecks.runCustomChecks(collector.getSimulations())
    }
  }));
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[SYSTEM] Intelligent Observability & Autonomous Recovery Framework Backend API running on port ${PORT}`);
  collector.start();
});
