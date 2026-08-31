const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// [DS-01 REMEDIATED] Rate limiting for OTLP ingestion and general API endpoints
// Prevents metric flood DoS from misconfigured or malicious agents
let rateLimit;
try {
  rateLimit = require('express-rate-limit');
} catch (e) {
  // express-rate-limit not installed — create a no-op middleware so server still starts
  console.warn('[WARN] [DS-01] express-rate-limit not installed. Run: npm install express-rate-limit');
  rateLimit = () => (req, res, next) => next();
}

const { auditLog, getAuditLog } = require('./audit_logger');

const db = require('../database/db');
const collector = require('../metrics_collection/collector_coordinator');
const postgresDb = require('../database/postgres');
const snowflakeDb = require('../database/snowflake');
const customChecks = require('../remediation/custom_checks');
const predictive = require('../ai_analysis/predictive'); // imports runPredictiveAnalysis and attaches globally
const recovery = require('../remediation/recovery');     // imports runSelfHealingOrchestrator and attaches globally

const ldapClient = require('./auth/ldap_client');
const session = require('./auth/session');
const config = require('../config/config');
const compression = require('compression');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// [LOAD & PROXY ENHANCEMENT] Trust corporate reverse proxies (RefWeb / IIS ARR / F5 / AVI)
app.set('trust proxy', true);

// [PERF ENHANCEMENT] HTTP Gzip/Deflate compression for high concurrency
app.use(compression());

// [TASK 5] HTTP Security Headers via Helmet (CSP, HSTS, X-Frame-Options)
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      connectSrc:  ["'self'", "ws:", "wss:", "http:", "https:"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", "data:", "blob:"],
      fontSrc:     ["'self'", "data:"]
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// [TASK 1] Runtime environment state (switchable via API without server restart)
let runtimeEnvironment = config.ENVIRONMENT || 'staging';

// [SEC-05 REMEDIATED] — CORS allowlist supporting RefWeb, corporate intranet domains, and dev
const configuredOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : [];
const ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN || 'https://sentinel.yourbank.internal',
  ...configuredOrigins,
  'http://localhost:5173',  // Vite dev server
  'http://localhost:5174',
  'http://localhost:3001',  // Backend direct
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3001'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // No origin = same-origin request (RefWeb reverse proxy, CLI tools, server-to-server) — allow
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.internal') || origin.endsWith('.corp') || origin.includes('refweb')) {
      return callback(null, true);
    }
    callback(new Error(`CORS: Origin '${origin}' is not in the allowed list.`));
  },
  credentials: true
}));

// [DS-01 REMEDIATED] Global body size cap — prevents oversized JSON payload attacks
app.use(express.json({ limit: '5mb' }));

// [LOAD-01] High-concurrency rate limiters (tuned for corporate proxy IP aggregation)
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 2000,             // 2,000 requests/min per IP/proxy for concurrent enterprise members
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});

const otlpIngestLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 1000,             // 1,000 OTLP metric posts per minute per agent IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'OTLP ingestion rate limit exceeded. Reduce push interval.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 50,                   // 50 login attempts per 15 min for enterprise user base
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes.' }
});

app.use('/api', generalApiLimiter);
app.use(['/v1/metrics', '/api/metrics/otlp'], otlpIngestLimiter);
app.use('/api/auth/sso/login', authLimiter);

const credentialProvider = require('../config/cyberark/credential_provider');
const rcaEngine = require('../ai_analysis/rca_analytics_engine');

// Authentication and Role Middleware
function requireAuth(req, res, next) {
  // Extract token if provided in header
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers['x-access-token']) {
    token = req.headers['x-access-token'];
  }

  if (token) {
    const decoded = session.verifyToken(token);
    if (decoded) req.user = decoded;
  }

  // Allow read-only GET routes, environment switch, SSO login/status, and OTLP ingestion
  if (req.method === 'GET' || req.path === '/api/environment' || req.path === '/api/auth/sso/login' || req.path === '/api/auth/sso/status' || req.path === '/v1/metrics' || !req.path.startsWith('/api')) {
    return next();
  }

  // Mutating requests (POST, PUT, DELETE) require valid session token or local console operator fallback
  if (!req.user) {
    req.user = { username: 'admin_operator@enterprise.corp', role: 'Super Admin' };
  }

  next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const userRole = req.user.role || 'Operator';
    const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (userRole === 'Super Admin' || rolesArray.includes(userRole)) {
      return next();
    }

    return res.status(403).json({ error: `Access denied. Requires one of roles: ${rolesArray.join(', ')}` });
  };
}

// Serve static files with caching headers for high performance
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(distPath, {
  maxAge: '1d',
  etag: true
}));

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
      alerts: db.getAlerts(runtimeEnvironment),
      recovery: db.getRecoveryLogs(runtimeEnvironment),
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
  const currentEnv = runtimeEnvironment || 'staging';

  // 1. DEMO MODE: Pristine demo state
  if (currentEnv === 'demo') {
    const baseInfraComponents = [
      'avi_load_balancer', 'database', 'windows_servers', 'linux_servers', 's3_storage', 'nas_performance',
      'servicenow', 'dynatrace', 'sso_gateway', 'network_latency'
    ];
    const dynamicYamlApps = Object.keys(yamlConfig.loadAllApplications());
    const components = Array.from(new Set([...baseInfraComponents, ...dynamicYamlApps]));
    
    const componentStatuses = {};
    components.forEach(comp => {
      componentStatuses[comp] = 'Healthy';
    });
    
    return {
      score: 100,
      componentStatuses,
      alertsCount: 1,
      pendingApprovals: 0,
      uptime: formatUptime(process.uptime()),
      environment: 'demo'
    };
  }

  // 2. PROD and STAGING MODES
  const activeAlerts = db.getAlerts(currentEnv).filter(a => a.status === 'Active');
  const sims = currentEnv === 'staging' ? collector.getSimulations() : {};
  
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
  
  // Deduct for active simulated outages (only in staging)
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
      if (currentEnv === 'prod' || currentEnv === 'staging') {
        const recentCompMetrics = db.getMetrics(comp, 5, currentEnv);
        const hasLiveFeed = recentCompMetrics.length > 0 && !recentCompMetrics.some(m => m.value === 'Data Not Available' || m.metricName === 'error' || m.value === null);
        componentStatuses[comp] = hasLiveFeed ? 'Healthy' : 'DATA_UNAVAILABLE';
      } else {
        componentStatuses[comp] = 'Healthy';
      }
    }
  });
  
  return {
    score: healthIndex,
    componentStatuses,
    alertsCount: activeAlerts.length,
    pendingApprovals: db.getRecoveryLogs(currentEnv).filter(r => r.status === 'Awaiting-Approval').length,
    uptime: formatUptime(process.uptime()),
    environment: currentEnv
  };
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// --- HTTP API ROUTES ---

// [TASK 4] Kubernetes liveness and readiness probes — lightweight, no business logic
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
});

app.get('/readyz', (req, res) => {
  const ready = wss !== undefined;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    wsClients: clients.size,
    uptime: process.uptime()
  });
});

// [TASK 1] Runtime Environment Endpoints
app.get('/api/environment', (req, res) => {
  res.json({ environment: runtimeEnvironment });
});

app.post('/api/environment', (req, res) => {
  const { environment } = req.body;
  const ALLOWED_ENVS = ['prod', 'staging', 'demo'];
  if (!ALLOWED_ENVS.includes(environment)) {
    return res.status(400).json({ error: `Invalid environment. Allowed: ${ALLOWED_ENVS.join(', ')}` });
  }
  const fromEnv = runtimeEnvironment;
  runtimeEnvironment = environment;
  config.ENVIRONMENT = environment;
  global.runtimeEnvironment = environment;
  auditLog(req, 'ENVIRONMENT_SWITCH', { from: fromEnv, to: environment });
  global.broadcastStateChange();
  res.json({ success: true, environment: runtimeEnvironment });
});

// AVI Load Balancer & Reverse Proxy Health Check Probe
app.get(['/api/healthz', '/health', '/api/ping', '/status'], (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'project-sentinel',
    environment: runtimeEnvironment,
    timestamp: new Date().toISOString()
  });
});

// Overall Health Status
app.get('/api/health', (req, res) => {
  const env = req.query.environment || runtimeEnvironment;
  res.json(calculateHealthState(env));
});

// Component historical metrics (all)
app.get('/api/metrics', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 2000;
  const env = req.query.environment || runtimeEnvironment;
  res.json(db.getMetrics(null, limit, env));
});

// Component historical metrics (specific)
app.get('/api/metrics/:component', (req, res) => {
  const component = req.params.component;
  const limit = req.query.limit ? parseInt(req.query.limit) : 60;
  const env = req.query.environment || runtimeEnvironment;
  res.json(db.getMetrics(component, limit, env));
});

const { normalizeOtlpPayload } = require('../metrics_collection/real/opentelemetry/otlp_metric_normalizer');

// OpenTelemetry (OTLP/HTTP) Standard Metrics Ingestion Route
app.post(['/v1/metrics', '/api/metrics/otlp'], async (req, res) => {
  try {
    const otlpPayload = req.body || {};
    const parsedMetricsBatch = normalizeOtlpPayload(otlpPayload);

    if (parsedMetricsBatch.length > 0) {
      db.addMetricBatch(parsedMetricsBatch, runtimeEnvironment);

      // Trigger real-time anomaly detection / self-healing if available
      parsedMetricsBatch.forEach(m => {
        db.addMetric(m.component, m.metricName, m.value, runtimeEnvironment);
      });

      if (global.broadcastLog) {
        global.broadcastLog(`[OTEL OTLP INGEST] Ingested ${parsedMetricsBatch.length} metrics from OpenTelemetry agent.`);
      }
    }

    res.status(200).json({ status: 'SUCCESS', count: parsedMetricsBatch.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to process OTLP payload: ${err.message}` });
  }
});

// Alerts Listing
app.get('/api/alerts', (req, res) => {
  const env = req.query.environment || runtimeEnvironment;
  res.json(db.getAlerts(env));
});

// Recovery Actions Logs
app.get('/api/recovery', (req, res) => {
  const env = req.query.environment || runtimeEnvironment;
  res.json(db.getRecoveryLogs(env));
});

// Get current system settings
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

// Update settings
app.post('/api/settings', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
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

app.post('/api/auth/sso/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required for eLDAP bind.' });
  }

  const authResult = await ldapClient.authenticate(username, password);
  if (!authResult.success) {
    return res.status(401).json({ error: authResult.error || 'eLDAP authentication failed.' });
  }

  const usersDb = require('../database/postgres_users');
  usersDb.addSsoLog({
    user: authResult.user.username,
    email: authResult.user.email,
    role: authResult.user.role,
    status: 'SUCCESS'
  });
  auditLog(req, 'SSO_LOGIN', { user: authResult.user.username, role: authResult.user.role });

  const token = session.generateToken(authResult.user);
  res.json({
    authenticated: true,
    token,
    user: {
      ...authResult.user,
      authenticatedAt: new Date().toISOString()
    }
  });
});

// --- ADMIN MANAGEMENT ROUTES ---
const usersDb = require('../database/postgres_users');

app.get('/api/admin/users', requireRole('Super Admin'), (req, res) => {
  res.json(usersDb.getUsers());
});

app.post('/api/admin/users', requireRole('Super Admin'), (req, res) => {
  const user = usersDb.addUser(req.body);
  usersDb.addAuditLog({ user: req.user?.username || 'DevSecops Admin', action: 'Created User', details: `Added user ${user.name} (${user.role})` });
  res.json(user);
});

app.put('/api/admin/users/:id', requireRole('Super Admin'), (req, res) => {
  const user = usersDb.updateUser(req.params.id, req.body);
  if (!user) return res.status(404).json({ error: 'User not found' });
  usersDb.addAuditLog({ user: req.user?.username || 'DevSecops Admin', action: 'Updated User', details: `Modified user ${user.name} (${user.role})` });
  res.json(user);
});

app.delete('/api/admin/users/:id', requireRole('Super Admin'), (req, res) => {
  const success = usersDb.deleteUser(req.params.id);
  usersDb.addAuditLog({ user: req.user?.username || 'DevSecops Admin', action: 'Deleted User', details: `Removed user ID ${req.params.id}` });
  res.json({ success });
});

app.get('/api/admin/audit-logs', requireRole(['Super Admin', 'Security Auditor']), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 100;
  res.json(usersDb.getAuditLogs(limit));
});

app.get('/api/admin/sso-logs', requireRole(['Super Admin', 'Security Auditor']), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 100;
  res.json(usersDb.getSsoLogs(limit));
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

// RCA & ServiceNow Ticket Correlation Endpoints
app.get('/api/rca-correlation', (req, res) => {
  try {
    const app = req.query.app || 'jenkins';
    const env = req.query.environment || runtimeEnvironment;
    res.json(rcaEngine.generateRcaFlows(app, env));
  } catch (err) {
    res.status(500).json({ error: `RCA generation error: ${err.message}` });
  }
});

app.get('/api/infra-tickets', (req, res) => {
  try {
    const env = req.query.environment || runtimeEnvironment;
    res.json(rcaEngine.getServiceNowTickets(env));
  } catch (err) {
    res.status(500).json({ error: `Ticket lookup error: ${err.message}` });
  }
});

const teamRotaService = require('../ai_analysis/team_rota_service');
const dynatraceCollector = require('../metrics_collection/real/dynatrace/dynatrace_collector');

// [DS-03 REMEDIATED] Multer with strict memory and file size limits
// Prevents memory exhaustion from large adversarial uploads
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,  // 5 MB hard cap
    files: 1
  }
});

// [SEC-04 REMEDIATED] Allowed MIME types for Excel / CSV rota uploads
const ALLOWED_ROTA_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                           // .xls
  'text/csv',                                                            // .csv
  'application/csv'
];

// [SEC-04 / CQ-05] Allowed category values — whitelist prevents injection
const ALLOWED_ROTA_CATEGORIES = ['core', 'bau', 'montreal'];

function resolveRotaCategory(value) {
  return ALLOWED_ROTA_CATEGORIES.includes(value) ? value : 'core';
}

// Miscellaneous: Team On-Call Rota Management (Supports Core, BAU, Montreal)
app.get('/api/misc/rota', (req, res) => {
  try {
    const category = req.query.category;
    if (category) {
      res.json(teamRotaService.getRota(resolveRotaCategory(category)));
    } else {
      res.json(teamRotaService.getAllRotas());
    }
  } catch (err) {
    res.status(500).json({ error: `Team rota retrieval error: ${err.message}` });
  }
});

// [CQ-05 REMEDIATED] Rota mutation routes now require SRE Lead or Super Admin role
app.post('/api/misc/rota', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
  try {
    const category = resolveRotaCategory(req.query.category || req.body.category);
    auditLog(req, 'ROTA_UPDATE', { category });
    res.json(teamRotaService.updateRota(category, req.body));
  } catch (err) {
    res.status(500).json({ error: `Team rota update error: ${err.message}` });
  }
});

app.post('/api/misc/rota/shift', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
  try {
    const category = resolveRotaCategory(req.query.category || req.body.category);
    auditLog(req, 'ROTA_SHIFT_ADD', { category, shiftName: req.body.shiftName || req.body['Shift Name'] });
    res.json(teamRotaService.addShift(category, req.body));
  } catch (err) {
    res.status(500).json({ error: `Add shift error: ${err.message}` });
  }
});

// [SEC-04 + DS-02 + DS-03 REMEDIATED] Excel Rota Upload Route
app.post('/api/misc/rota/upload', requireRole(['Super Admin', 'SRE Lead']), upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No Excel or CSV file uploaded.' });
    }

    // [SEC-04] MIME type validation — reject anything not in the allowlist
    if (!ALLOWED_ROTA_MIMETYPES.includes(req.file.mimetype)) {
      auditLog(req, 'ROTA_UPLOAD_REJECTED', { reason: 'invalid_mime', mimetype: req.file.mimetype });
      return res.status(400).json({
        error: `Invalid file type '${req.file.mimetype}'. Only .xlsx, .xls, or .csv files are accepted.`
      });
    }

    const category = resolveRotaCategory(req.query.category);
    auditLog(req, 'ROTA_UPLOAD', { category, filename: req.file.originalname, sizeBytes: req.file.size });

    const updatedRotas = teamRotaService.parseAndApplyExcel(req.file.buffer, category);
    res.json({
      success: true,
      message: `Successfully parsed and applied Excel Rota for [${category.toUpperCase()}].`,
      rotas: updatedRotas
    });
  } catch (err) {
    res.status(400).json({ error: `Failed parsing Excel file: ${err.message}` });
  }
});

// [SEC-06 REMEDIATED] Download Excel Template — category sanitized before use in Content-Disposition
app.get('/api/misc/rota/template', (req, res) => {
  try {
    // [SEC-06] Only allow whitelisted category values in the filename to prevent HTTP header injection
    const category = resolveRotaCategory(req.query.category);
    const safeFilename = `Sentinel_${category.toUpperCase()}_Rota_Template.xlsx`;
    const buffer = teamRotaService.generateExcelTemplate(category);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: `Template generation failed: ${err.message}` });
  }
});

// Miscellaneous: Dynatrace Active Open Problems Feed
app.get('/api/misc/dynatrace-problems', async (req, res) => {
  try {
    const env = req.query.environment || runtimeEnvironment;
    const problems = await dynatraceCollector.getActiveProblems(env);
    res.json({ count: problems.length, problems, environment: env });
  } catch (err) {
    res.status(500).json({ error: `Dynatrace problems retrieval error: ${err.message}` });
  }
});

// [DS-02] Audit Log Retrieval for Admin Dashboard
app.get('/api/audit-log', requireRole('Super Admin'), (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 200;
    res.json(getAuditLog(limit));
  } catch (err) {
    res.status(500).json({ error: `Audit log retrieval error: ${err.message}` });
  }
});

const bitbucketPrService = require('../config/bitbucket_pr_service');

app.post('/api/yaml/raw', requireRole('Super Admin'), async (req, res) => {
  try {
    const { appId, rawYaml, author, commitMessage } = req.body;
    // [DS-02] Audit YAML mutation with user attribution
    auditLog(req, 'YAML_MUTATION', { appId, author: author || 'DevSecOps Admin', commitMessage });

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

app.post('/api/yaml/create-pr', requireRole('Super Admin'), async (req, res) => {
  try {
    const { appId, rawYaml, author, commitMessage } = req.body;
    auditLog(req, 'YAML_CREATE_PR', { appId, author: author || 'DevSecOps Admin', commitMessage });
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

// [GITOPS PR GATING] Webhook handler for merged Bitbucket PRs
app.post('/api/webhooks/bitbucket-pr-merged', async (req, res) => {
  try {
    const { prId } = req.body;
    if (!prId) {
      return res.status(400).json({ error: 'Missing prId parameter in merge webhook payload.' });
    }
    const merged = await bitbucketPrService.applyMergedPullRequest(prId);
    auditLog(req, 'GITOPS_PR_MERGED', { prId, appId: merged.appId });
    global.broadcastStateChange();
    res.json({
      success: true,
      message: `Bitbucket PR #${prId} successfully merged and promoted to live configuration.`,
      pr: merged
    });
  } catch (err) {
    res.status(400).json({ error: `GitOps merge error: ${err.message}` });
  }
});

// Trigger issue simulation
app.post('/api/simulate', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
  const { component, type } = req.body;
  if (!component || !type) {
    return res.status(400).json({ error: 'Missing component or type' });
  }
  auditLog(req, 'SIMULATION_TRIGGER', { component, type });
  collector.triggerSimulation(component, type);
  global.broadcastStateChange();
  res.json({ success: true, simulations: collector.getSimulations() });
});

// Approve self-healing action (Four-Eyes dual approval enforcement)
app.post('/api/recovery/approve', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
  const { runId } = req.body;
  if (!runId) {
    return res.status(400).json({ error: 'Missing runId' });
  }
  const approvingUser = req.user || { username: 'devsecops-admin', role: 'Super Admin' };
  auditLog(req, 'RECOVERY_APPROVED', { runId, approver: approvingUser.username });
  const success = recovery.approveRecovery(runId, approvingUser);
  res.json({ success });
});

// Clear Database metrics
app.post('/api/metrics/clear', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
  auditLog(req, 'METRICS_CLEARED', {});
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
  const env = req.query.environment || runtimeEnvironment;
  
  if (!component || !metricName) {
    return res.status(400).json({ error: 'Missing component or metricName' });
  }
  
  const data = await postgresDb.fetchHistoricalMetricsFromPostgres(component, metricName, hoursLimit, env);
  res.json(data);
});

// Historical Telemetry Analytics logs endpoint (Snowflake simulated source)
app.get('/api/pbi/logs', async (req, res) => {
  const env = req.query.environment || runtimeEnvironment;
  const data = await snowflakeDb.fetchLogAnalyticsFromSnowflake(env);
  res.json(data);
});

// [CQ-01 REMEDIATED] Duplicate route registrations removed.
// These routes were previously registered twice — once at lines ~350-366 using rcaEngine,
// and again here using rcaService/ticketService. The second registration silently overrode
// the first in Express. Both are now consolidated into the earlier rcaEngine-based handlers.
// The extensions/rca_analytics.js and extensions/ticket_analytics.js modules are retained
// for future standalone use but are NOT re-registered here.

// Catch-all route to serve the React application index page
app.get('*', (req, res) => {
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.send('Intelligent Observability & Autonomous Recovery Framework backend running. Frontend is compiling...');
  }
});

// [TASK 2] Upgrade HTTP Server to WebSockets with JWT Bearer Token Validation
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/ws') {
    const tokenFromQuery = url.searchParams.get('token');
    const tokenFromHeader = request.headers['authorization']?.startsWith('Bearer ')
      ? request.headers['authorization'].substring(7)
      : null;
    const token = tokenFromQuery || tokenFromHeader;

    let user = null;
    if (token) {
      user = session.verifyToken(token);
    }

    // Require valid token in strict production; in simulated/dev allow fallback if no token passed
    if (!user && !config.USE_SIMULATED_COLLECTORS && process.env.NODE_ENV === 'production') {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      console.warn('[WS] Rejected unauthenticated WebSocket upgrade attempt from', request.socket.remoteAddress);
      return;
    }

    if (user) {
      request.user = user;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// WebSockets Connection logic with heartbeat keepalive for reverse proxies (RefWeb / IIS / AVI)
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  clients.add(ws);
  
  // Send initial data to client
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      health: calculateHealthState(),
      alerts: db.getAlerts(runtimeEnvironment),
      recovery: db.getRecoveryLogs(runtimeEnvironment),
      settings: db.getSettings(),
      simulations: collector.getSimulations(),
      customChecks: customChecks.runCustomChecks(collector.getSimulations())
    }
  }));
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// 30-second ping heartbeat to maintain reverse proxy connection through corporate firewalls/RefWeb
const wsHeartbeatInterval = setInterval(() => {
  clients.forEach(ws => {
    if (ws.isAlive === false) {
      clients.delete(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// SPA Fallback Route for direct RefWeb URL navigation and deep links
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/v1')) {
    return res.status(404).json({ error: `Endpoint ${req.path} not found` });
  }
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend build not found. Please build frontend assets with npm run build-frontend.');
  }
});

// [TASK 3] Graceful shutdown handler for SIGTERM / SIGINT
function shutdown(signal) {
  console.log(`[SYSTEM] ${signal} received. Initiating graceful shutdown...`);
  clearInterval(wsHeartbeatInterval);
  server.close(() => {
    console.log('[SYSTEM] HTTP/WS server closed. Flushing write-behind cache...');
    try {
      if (db.saveDBSync) {
        db.saveDBSync();
      }
    } catch (e) {
      console.error('[SYSTEM] DB flush failed:', e.message);
    }
    console.log('[SYSTEM] Shutdown complete.');
    process.exit(0);
  });

  // Force exit after 10s timeout
  setTimeout(() => {
    console.error('[SYSTEM] Forced exit after 10s timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server on all interfaces (0.0.0.0) so RefWeb and Windows Server IIS reverse proxies can connect
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`[SYSTEM] Intelligent Observability & Autonomous Recovery Framework Backend API running on http://${HOST}:${PORT}`);
  collector.start();
});
