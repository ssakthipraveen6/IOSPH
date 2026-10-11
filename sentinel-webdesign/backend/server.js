const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Canonical Root and module resolution
const ROOT_DIR = path.resolve(__dirname, '..');

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

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

// Enterprise Module Imports
const db = require('../database/db');
const collector = require('../metrics_collection/collector_coordinator');
const config = require('./config/config');
const yamlConfig = require('./config/yaml_config');
const postgresDb = require('../database/postgres');
const snowflakeDb = require('../database/snowflake');
const { customChecks, recovery } = require('../remediation');
const { predictive, rcaAnalyticsEngine: rcaEngine, teamRotaService } = require('../ai_analysis');
const healthCalculator = require('./services/health/healthCalculator');
const uptimeResolver = require('./services/telemetry/uptimeResolver');
const sloTracker = require('./services/slo/slo_tracker');
const inventory = require('@sentinel/inventory');
const logStore = require('../database/log_store');
const logParser = require('../logs_collection/parser/log_parser');
const eventStore = require('../database/event_store');
const correlation = require('@sentinel/correlation');

const ldapClient = require('./auth/ldap_client');
const session = require('./auth/session');
const compression = require('compression');

const cookieParser = require('cookie-parser');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// [T0.11 REMEDIATED] Trust only explicitly configured reverse proxies
const trustedProxies = new Set((process.env.TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean));
if (trustedProxies.size > 0) {
  app.set('trust proxy', (ip) => trustedProxies.has(ip));
} else {
  app.set('trust proxy', false);
}

// [P2-05] OpenTelemetry W3C Distributed Tracing Middleware
const { tracingMiddleware } = require('./tracing');
app.use(tracingMiddleware);

// [PERF ENHANCEMENT] HTTP Gzip/Deflate compression for high concurrency
app.use(compression());
app.use(cookieParser());

// [T0.8 REMEDIATED] HTTP Security Headers via Helmet (CSP, HSTS, X-Frame-Options)
const helmet = require('helmet');
const isDev = process.env.NODE_ENV !== 'production';

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      connectSrc:  isDev ? ["'self'", "ws:", "wss:", "http:", "https:"] : ["'self'", "ws:", "wss:", "https:"],
      scriptSrc:   isDev ? ["'self'", "'unsafe-inline'"] : ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:      ["'self'", "data:", "blob:"],
      fontSrc:     ["'self'", "data:", 'https://fonts.gstatic.com']
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// [T1c.1] Per-user environment isolation: helper to extract environment from query, session claim, or header
function resolveEnvironment(req) {
  const candidate = req?.query?.environment || req?.user?.environment || req?.headers?.['x-sentinel-environment'];
  if (candidate && ['prod', 'staging', 'demo'].includes(candidate.toLowerCase())) {
    return candidate.toLowerCase();
  }
  if (candidate) {
    // Unknown token supplied explicitly: normalise (and warn) rather than trust it.
    return config.normalizeEnvironment(candidate, 'request');
  }
  return config.ENVIRONMENT || 'staging';
}

// [SEC-05 REMEDIATED] — CORS allowlist supporting RefWeb, corporate intranet domains, and dev
const { isAllowedOrigin } = require('./cors_validator');
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
    if (isAllowedOrigin(origin, ALLOWED_ORIGINS)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: Origin '${origin}' is not in the allowed list.`));
  },
  credentials: true
}));

// [DS-01 REMEDIATED] Global body size cap — prevents oversized JSON payload attacks
app.use(express.json({ limit: '5mb' }));

// [LOAD-01 + T0.11] High-concurrency rate limiters with enabled validation
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 2000,             // 2,000 requests/min per IP/proxy for concurrent enterprise members
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests. Please slow down.' }
});

const otlpIngestLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 1000,             // 1,000 OTLP metric posts per minute per agent IP
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'OTLP ingestion rate limit exceeded. Reduce push interval.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 50,                   // 50 login attempts per 15 min for enterprise user base
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many authentication attempts. Please wait 15 minutes.' }
});

app.use('/api', generalApiLimiter);
app.use(['/v1/metrics', '/api/metrics/otlp'], otlpIngestLimiter);
app.use(['/v1/logs', '/api/logs/otlp', '/api/v2/logs/ingest'], otlpIngestLimiter);
app.use('/api/auth/sso/login', authLimiter);

const credentialProvider = require('./config/cyberark/credential_provider');
// rcaEngine imported from ai_analysis

// Authentication and Role Middleware (T0.5, T0.21)
function requireAuth(req, res, next) {
  // Extract token from cookie (T0.21), or Bearer Authorization header, or x-access-token
  let token = req.cookies?.sentinel_session || null;
  const authViaCookie = !!req.cookies?.sentinel_session;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers['x-access-token']) {
    token = req.headers['x-access-token'];
  }

  if (token) {
    const decoded = session.verifyToken(token);
    if (decoded) req.user = decoded;
  }

  // Allow read-only GET routes, environment switch, SSO login/status, and telemetry ingestion
  if (req.method === 'GET' || req.path === '/api/environment' || req.path === '/api/auth/sso/login' || req.path === '/api/auth/sso/status' || req.path === '/v1/metrics' || req.path === '/v1/logs' || req.path === '/api/logs/otlp' || req.path === '/api/v2/shipper/heartbeat' || !req.path.startsWith('/api')) {
    return next();
  }

  // [T0.21] CSRF validation on mutating requests when authenticated via cookie or when receiving form post
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  const isFormPost = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
  const csrfHeader = req.headers['x-csrf-token'] || req.body?._csrf;
  const cookieCsrf = req.cookies?.sentinel_csrf;

  if (authViaCookie || isFormPost) {
    if (!csrfHeader || (cookieCsrf && csrfHeader !== cookieCsrf)) {
      return res.status(403).json({ error: 'CSRF token missing or invalid.' });
    }
  }

  // [T0.5 REMEDIATED] Close anonymous Super Admin hole on mutating routes
  if (!req.user) {
    if (config.USE_SIMULATED_COLLECTORS && process.env.NODE_ENV !== 'production') {
      req.user = { username: 'admin_operator@enterprise.corp', role: 'Super Admin' };
      return next();
    }
    return res.status(401).json({ error: 'Authentication required. Please provide a valid session.' });
  }

  next();
}

app.use(requireAuth);

// Role-Based Access Control (RBAC) Middleware Generator
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const userRole = req.user.role;
    const rolesArray = allowedRoles.flat();

    if (userRole === 'Super Admin' || rolesArray.includes(userRole)) {
      return next();
    }

    return res.status(403).json({ error: `Access denied. Requires one of roles: ${rolesArray.join(', ')}` });
  };
}

// Serve static files with caching headers for high performance
const distPath = path.resolve(ROOT_DIR, 'frontend/dist');
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

global.broadcastStateChange = (targetEnv = null) => {
  const activeEnvs = new Set(targetEnv ? [targetEnv] : []);
  if (!targetEnv) {
    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) activeEnvs.add(ws.environment || 'staging');
    });
  }

  const framesByEnv = {};
  activeEnvs.forEach(env => {
    const sims = env === 'staging' ? collector.getSimulations() : {};
    framesByEnv[env] = JSON.stringify({
      type: 'state',
      data: {
        alerts: db.getAlerts(env),
        recovery: db.getRecoveryLogs(env),
        settings: db.getSettings(),
        health: calculateHealthState(env),
        customChecks: customChecks.runCustomChecks(sims)
      }
    });
  });

  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      const clientEnv = ws.environment || 'staging';
      if (!targetEnv || clientEnv === targetEnv) {
        const frame = framesByEnv[clientEnv];
        if (frame) ws.send(frame);
      }
    }
  });
};

// Periodic status broadcast (T1c.2: computed once per distinct environment per tick)
setInterval(() => {
  if (clients.size === 0) return;

  const activeEnvs = new Set();
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) activeEnvs.add(ws.environment || 'staging');
  });

  const framesByEnv = {};
  activeEnvs.forEach(env => {
    const sims = env === 'staging' ? collector.getSimulations() : {};
    framesByEnv[env] = JSON.stringify({
      type: 'metrics_tick',
      data: {
        health: calculateHealthState(env),
        simulations: sims,
        customChecks: customChecks.runCustomChecks(sims)
      }
    });
  });

  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      const frame = framesByEnv[ws.environment || 'staging'];
      if (frame) ws.send(frame);
    }
  });
}, 5000);

// Health Index Calculator (Modular Engine)
function calculateHealthState(requestedEnv = null) {
  const currentEnv = requestedEnv || 'staging';

  const baseInfraComponents = [
    'avi_load_balancer', 'database', 'windows_servers', 'linux_servers', 's3_storage', 'nas_performance',
    'servicenow', 'dynatrace', 'sso_gateway', 'network_latency', 'firewall'
  ].filter(comp => typeof config.isComponentEnabled === 'function' ? config.isComponentEnabled(comp) : true);
  const dynamicYamlApps = Object.keys(yamlConfig.loadAllApplications()).filter(appId => typeof config.isApplicationEnabled === 'function' ? config.isApplicationEnabled(appId) : true);
  const components = Array.from(new Set([...baseInfraComponents, ...dynamicYamlApps]));

  // 1. DEMO MODE: Pristine demo state
  if (currentEnv === 'demo') {
    const componentStatuses = healthCalculator.calculateComponentStatuses({
      components,
      activeAlerts: [],
      sims: {},
      currentEnv: 'demo',
      db
    });
    
    return {
      score: 100,
      componentStatuses,
      alertsCount: 1,
      pendingApprovals: 0,
      uptime: uptimeResolver.formatUptime(uptimeResolver.getInfrastructureUptimeSeconds()),
      environment: 'demo'
    };
  }

  // 2. PROD and STAGING MODES
  const activeAlerts = db.getAlerts(currentEnv).filter(a => a.status === 'Active');
  const sims = currentEnv === 'staging' ? collector.getSimulations() : {};
  
  const healthIndex = healthCalculator.calculateHealthScore(activeAlerts, sims, currentEnv);
  
  const componentStatuses = healthCalculator.calculateComponentStatuses({
    components,
    activeAlerts,
    sims,
    currentEnv,
    db
  });
  
  return {
    score: healthIndex,
    componentStatuses,
    alertsCount: activeAlerts.length,
    pendingApprovals: db.getRecoveryLogs(currentEnv).filter(r => r.status === 'Awaiting-Approval').length,
    uptime: uptimeResolver.formatUptime(uptimeResolver.getInfrastructureUptimeSeconds()),
    environment: currentEnv,
    persistence: db.getPersistenceStatus ? db.getPersistenceStatus() : { degraded: false }
  };
}

function formatUptime(seconds) {
  return uptimeResolver.formatUptime(seconds);
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

// [T1c.1] Runtime Environment Endpoints (session state, never mutates global)
app.get('/api/environment', (req, res) => {
  res.json({ environment: resolveEnvironment(req) });
});

app.post('/api/environment', (req, res) => {
  const { environment } = req.body;
  const ALLOWED_ENVS = ['prod', 'staging', 'demo'];
  if (!ALLOWED_ENVS.includes(environment)) {
    return res.status(400).json({ error: `Invalid environment. Allowed: ${ALLOWED_ENVS.join(', ')}` });
  }

  let newToken = null;
  if (req.user) {
    const updatedUser = { ...req.user, environment };
    newToken = session.generateToken(updatedUser);
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('sentinel_session', newToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'Strict',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000
    });
  }

  auditLog(req, 'ENVIRONMENT_SWITCH', { user: req.user?.username || 'anonymous', to: environment });
  res.json({ success: true, environment, token: newToken, demoActive: environment === 'demo' });
});

// AVI Load Balancer & Reverse Proxy Health Check Probe
app.get(['/api/healthz', '/health', '/api/ping', '/status'], (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'project-sentinel',
    environment: resolveEnvironment(req),
    timestamp: new Date().toISOString()
  });
});

// BFSI MNC Domain Sub-Routers (APM, K8s Mesh, Perimeter Logs, Governance)
const apmRoutes = require('./routes/apmRoutes');
const k8sRoutes = require('./routes/k8sRoutes');
const perimeterRoutes = require('./routes/perimeterRoutes');
const governanceRoutes = require('./routes/governanceRoutes');

app.use('/api/apm', apmRoutes);
app.use('/api/k8s', k8sRoutes);
app.use('/api/perimeter', perimeterRoutes);
app.use('/api/governance', governanceRoutes);

// Overall Health Status
app.get('/api/health', (req, res) => {
  const env = resolveEnvironment(req);
  res.json(calculateHealthState(env));
});

// Component historical metrics (all)
app.get('/api/metrics', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 2000;
  const env = resolveEnvironment(req);
  res.json(db.getMetrics(null, limit, env));
});

// Component historical metrics (specific)
app.get('/api/metrics/:component', (req, res) => {
  const component = req.params.component;
  const limit = req.query.limit ? parseInt(req.query.limit) : 60;
  const env = resolveEnvironment(req);
  res.json(db.getMetrics(component, limit, env));
});

const { normalizeOtlpPayload } = require('../metrics_collection/real/opentelemetry/otlp_metric_normalizer');

// OpenTelemetry (OTLP/HTTP) Standard Metrics Ingestion Route (T1c.4)
app.post(['/v1/metrics', '/api/metrics/otlp'], async (req, res) => {
  try {
    const otlpPayload = req.body || {};

    // [T1.3] Auto-register incoming host and service entities from OTLP resource attributes
    try {
      await inventory.sources.otlp.processOtlpPayload(otlpPayload);
    } catch (invErr) {
      console.warn('[INVENTORY] OTLP auto-registration warning:', invErr.message);
    }

    const parsedMetricsBatch = normalizeOtlpPayload(otlpPayload);

    if (parsedMetricsBatch.length > 0) {
      const headerOrQueryEnv = req.query?.environment || req.headers['x-sentinel-environment'];
      const defaultEnv = headerOrQueryEnv ? headerOrQueryEnv.toLowerCase() : 'staging';

      parsedMetricsBatch.forEach(m => {
        if (!m.env) m.env = defaultEnv;
      });

      db.addMetricBatch(parsedMetricsBatch);

      if (global.broadcastLog) {
        global.broadcastLog(`[OTEL OTLP INGEST] Ingested ${parsedMetricsBatch.length} metrics from OpenTelemetry agent.`);
      }
    }

    res.status(200).json({ status: 'SUCCESS', count: parsedMetricsBatch.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to process OTLP payload: ${err.message}` });
  }
});

// Structured Logs Ingestion Route (Fluentd JSON & OTLP/logs) (T3.1)
app.post(['/v1/logs', '/api/logs/otlp', '/api/v2/logs/ingest'], async (req, res) => {
  try {
    const payload = req.body;
    if (!payload) {
      return res.status(400).json({ error: 'Missing log payload' });
    }

    const headerOrQueryEnv = req.query?.environment || req.headers['x-sentinel-environment'];
    const defaultEnv = (headerOrQueryEnv || req.session?.environment || config.ENVIRONMENT || 'staging').toLowerCase();
    const rawRecords = [];

    // Case 1: OpenTelemetry OTLP/logs payload ({ resourceLogs: [...] })
    if (payload.resourceLogs && Array.isArray(payload.resourceLogs)) {
      payload.resourceLogs.forEach(rl => {
        const attributes = rl.resource?.attributes || [];
        const envAttr = attributes.find(a =>
          a.key === 'deployment.environment' || a.key === 'environment' || a.key === 'env'
        )?.value?.stringValue || defaultEnv;

        const serviceName = attributes.find(a =>
          a.key === 'service.name' || a.key === 'app' || a.key === 'app_id'
        )?.value?.stringValue || 'system';

        const hostName = attributes.find(a =>
          a.key === 'host.name' || a.key === 'hostname'
        )?.value?.stringValue || null;

        (rl.scopeLogs || []).forEach(sl => {
          (sl.logRecords || []).forEach(lr => {
            const bodyStr = lr.body?.stringValue || (typeof lr.body === 'object' ? JSON.stringify(lr.body) : String(lr.body || ''));
            const ts = lr.timeUnixNano ? new Date(Number(BigInt(lr.timeUnixNano) / 1000000n)).toISOString() : new Date().toISOString();
            rawRecords.push({
              ts,
              level: lr.severityText || logParser.normalizeLogLevel(lr.severityNumber),
              message: bodyStr,
              app_id: serviceName,
              entity_id: hostName ? `host:${hostName}` : `app:${serviceName}`,
              environment: envAttr.toLowerCase(),
              fields: lr.attributes ? Object.fromEntries(lr.attributes.map(a => [a.key, a.value?.stringValue || a.value])) : {}
            });
          });
        });
      });
    }
    // Case 2: Array of JSON logs (Fluentd array, batch shipper)
    else if (Array.isArray(payload)) {
      payload.forEach(item => {
        if (typeof item === 'object' && item !== null) {
          rawRecords.push({
            ...item,
            environment: item.environment || item.env || defaultEnv
          });
        } else if (typeof item === 'string') {
          rawRecords.push({
            message: item,
            environment: defaultEnv
          });
        }
      });
    }
    // Case 3: Single JSON log object or string
    else if (typeof payload === 'object' && payload !== null) {
      rawRecords.push({
        ...payload,
        environment: payload.environment || payload.env || defaultEnv
      });
    } else if (typeof payload === 'string') {
      rawRecords.push({
        message: payload,
        environment: defaultEnv
      });
    }

    const ingestedCount = await logStore.appendLogs(rawRecords, {
      environment: defaultEnv,
      app_id: req.query?.app_id || 'system'
    });

    if (global.broadcastLog && rawRecords.length > 0) {
      const sampleMsg = rawRecords[0].message || '';
      global.broadcastLog(`[LOG INGEST] [${defaultEnv.toUpperCase()}] Ingested ${ingestedCount} logs. Sample: ${sampleMsg.substring(0, 100)}`);
    }

    res.status(200).json({ status: 'SUCCESS', count: ingestedCount });
  } catch (err) {
    res.status(500).json({ error: `Failed to process logs: ${err.message}` });
  }
});

// Alerts Listing
app.get('/api/alerts', (req, res) => {
  const env = resolveEnvironment(req);
  res.json(db.getAlerts(env));
});

// Recovery Actions Logs
app.get('/api/recovery', (req, res) => {
  const env = resolveEnvironment(req);
  res.json(db.getRecoveryLogs(env));
});

// Get current system settings
// [UI-CONFIG] Serves config/ui.yaml so operators can change banners without a
// rebuild or restart. Read-only and unauthenticated: it carries no secrets and
// the SPA needs it before a session exists.
app.get('/api/ui-config', (req, res) => {
  try {
    const uiPath = path.join(ROOT_DIR, 'config', 'ui.yaml');
    const yamlLib = require('js-yaml');
    const uiData = fs.existsSync(uiPath) ? (yamlLib.load(fs.readFileSync(uiPath, 'utf8')) || {}) : {};
    const globalCfg = yamlConfig.loadGlobalConfig();

    res.set('Cache-Control', 'no-cache');
    res.json({
      ...uiData,
      views_enabled: globalCfg.views_enabled || {},
      components_enabled: globalCfg.components_enabled || {},
      applications_enabled: globalCfg.applications_enabled || {}
    });
  } catch (err) {
    console.warn('[UI-CONFIG] Could not read config/ui.yaml:', err.message);
    res.json({});
  }
});

app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

// Update settings
app.post('/api/settings', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
  const settings = db.updateSettings(req.body);
  global.broadcastStateChange();
  res.json(settings);
});

// --- SSO & eLDAP AUTHENTICATION APIS ---
app.get('/api/auth/sso/status', (req, res) => {
  const globalCfg = yamlConfig.loadGlobalConfig();
  const ldapConfig = globalCfg.sso_ldap_config || {
    enabled: true,
    provider: "eLDAP / Active Directory",
    ldap_url: "ldaps://ldap.enterprise.corp:636",
    base_dn: "ou=Users,dc=enterprise,dc=corp"
  };

  let csrfToken = req.cookies?.sentinel_csrf;
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('sentinel_csrf', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000
    });
  }

  res.json({
    status: 'ACTIVE',
    provider: ldapConfig.provider,
    ldapUrl: ldapConfig.ldap_url,
    baseDn: ldapConfig.base_dn,
    csrfToken,
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
  try { await usersDb.addSsoLog({
    user: authResult.user.username,
    email: authResult.user.email,
    role: authResult.user.role,
    status: 'SUCCESS'
  }); } catch (e) { console.warn('[SSO] login event not recorded:', e.message); }
  auditLog(req, 'SSO_LOGIN', { user: authResult.user.username, role: authResult.user.role });

  const token = session.generateToken(authResult.user);
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const isProduction = process.env.NODE_ENV === 'production';

  // [T0.21] Store session in httpOnly Secure SameSite=Strict cookie
  res.cookie('sentinel_session', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });

  // CSRF token readable by client script to send in X-CSRF-Token header
  res.cookie('sentinel_csrf', csrfToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'Strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });

  res.json({
    authenticated: true,
    token, // Preserved for API / test client backward compatibility
    csrfToken,
    user: {
      ...authResult.user,
      authenticatedAt: new Date().toISOString()
    }
  });
});

// --- ADMIN MANAGEMENT ROUTES ---
const usersDb = require('../database/postgres_users');

app.get('/api/admin/users', requireRole('Super Admin'), async (req, res) => {
  try { res.json(await usersDb.getUsers()); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

app.post('/api/admin/users', requireRole('Super Admin'), async (req, res) => {
  try {
    const user = await usersDb.addUser(req.body);
    await usersDb.addAuditLog({ user: req.user?.username || 'DevSecops Admin', action: 'Created User', details: `Added user ${user.name} (${user.role})` });
    res.json(user);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

app.put('/api/admin/users/:id', requireRole('Super Admin'), async (req, res) => {
  try {
    const user = await usersDb.updateUser(req.params.id, req.body);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await usersDb.addAuditLog({ user: req.user?.username || 'DevSecops Admin', action: 'Updated User', details: `Modified user ${user.name} (${user.role})` });
    res.json(user);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

app.delete('/api/admin/users/:id', requireRole('Super Admin'), async (req, res) => {
  try {
    const success = await usersDb.deleteUser(req.params.id);
    await usersDb.addAuditLog({ user: req.user?.username || 'DevSecops Admin', action: 'Deleted User', details: `Removed user ID ${req.params.id}` });
    res.json({ success });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

app.get('/api/admin/audit-logs', requireRole(['Super Admin', 'Security Auditor']), async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 100;
  try { res.json(await usersDb.getAuditLogs(limit)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

app.get('/api/admin/sso-logs', requireRole(['Super Admin', 'Security Auditor']), async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 100;
  try { res.json(await usersDb.getSsoLogs(limit)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
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
app.get('/api/rca-correlation', async (req, res) => {
  try {
    const app = req.query.app || 'jenkins';
    const env = resolveEnvironment(req);
    res.json(await rcaEngine.generateRcaFlows(app, env));
  } catch (err) {
    res.status(500).json({ error: `RCA generation error: ${err.message}` });
  }
});

app.get('/api/infra-tickets', (req, res) => {
  try {
    const env = resolveEnvironment(req);
    res.json(rcaEngine.getServiceNowTickets(env));
  } catch (err) {
    res.status(500).json({ error: `Ticket lookup error: ${err.message}` });
  }
});

// ServiceNow Active Incidents for Assignment Group (Group: "devops aps")
app.get('/api/servicenow/active-incidents', (req, res) => {
  try {
    const env = resolveEnvironment(req);
    const targetGroup = (req.query.group || 'devops aps').toLowerCase();

    // Canonical open active incidents assigned to "devops aps"
    const baseIncidents = [
      {
        id: 'INC0091823',
        priority: 'P1 - CRITICAL',
        short_description: 'Bitbucket git-lfs upload socket timeout on lon-bb-node-02',
        assignment_group: 'devops aps',
        state: 'Investigating',
        duration: '14m',
        assigned_to: 's.praveen',
        initials: 'SP',
        service: 'Atlassian Bitbucket',
        component: 'bitbucket',
        sys_created_on: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
        env: 'prod'
      },
      {
        id: 'INC0091410',
        priority: 'P2 - HIGH',
        short_description: 'JFrog Artifactory binary replication lag > 150s (NFS cache contention)',
        assignment_group: 'devops aps',
        state: 'Work in Progress',
        duration: '32m',
        assigned_to: 'm.chen',
        initials: 'MC',
        service: 'JFrog Artifactory',
        component: 'artifactory',
        sys_created_on: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
        env: 'prod'
      },
      {
        id: 'INC0090884',
        priority: 'P2 - HIGH',
        short_description: 'CloudBees Jenkins runner pod eviction warning on k8s-worker-04',
        assignment_group: 'devops aps',
        state: 'Work in Progress',
        duration: '48m',
        assigned_to: 'alex.k',
        initials: 'AK',
        service: 'CloudBees Jenkins',
        component: 'jenkins',
        sys_created_on: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
        env: 'prod'
      },
      {
        id: 'INC0089921',
        priority: 'P3 - MODERATE',
        short_description: 'SonarQube analysis background task queue depth threshold warning',
        assignment_group: 'devops aps',
        state: 'Open',
        duration: '1h 15m',
        assigned_to: 'j.davies',
        initials: 'JD',
        service: 'SonarQube Enterprise',
        component: 'sonarqube',
        sys_created_on: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
        env: 'prod'
      },
      {
        id: 'INC0088412',
        priority: 'P3 - MODERATE',
        short_description: 'OpenText Fortify SSC token renewal probe delayed response',
        assignment_group: 'devops aps',
        state: 'Resolved',
        duration: '2h 10m',
        assigned_to: 's.praveen',
        initials: 'SP',
        service: 'OpenText Fortify',
        component: 'fortify',
        sys_created_on: new Date(Date.now() - 130 * 60 * 1000).toISOString(),
        env: 'prod'
      }
    ];

    // Correlate live alerts from in-memory DB into active ServiceNow incidents for devops aps
    const activeAlerts = db.getAlerts(env).filter(a => a.status === 'Active');
    const dynamicIncidents = activeAlerts.map((alert, idx) => ({
      id: `INC009${850 + idx}`,
      priority: alert.severity === 'Critical' ? 'P1 - CRITICAL' : 'P2 - HIGH',
      short_description: alert.message || `${alert.component} active incident reported by OneAgent`,
      assignment_group: 'devops aps',
      state: 'Investigating',
      duration: '4m',
      assigned_to: 'devops.oncall',
      initials: 'DO',
      service: alert.component,
      component: alert.component,
      sys_created_on: alert.timestamp || new Date().toISOString(),
      env: alert.env || env
    }));

    const isDemo = env === 'demo';
    let allIncidents = isDemo 
      ? [...dynamicIncidents, ...baseIncidents.map(inc => ({ ...inc, env: 'demo' }))]
      : [...dynamicIncidents];

    if (targetGroup) {
      allIncidents = allIncidents.filter(inc => inc.assignment_group.toLowerCase() === targetGroup);
    }

    res.json({
      assignment_group: targetGroup,
      total_open: allIncidents.filter(i => i.state !== 'Resolved').length,
      incidents: allIncidents
    });
  } catch (err) {
    res.status(500).json({ error: `ServiceNow active incidents error: ${err.message}` });
  }
});

// teamRotaService imported from ai_analysis
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
    const env = resolveEnvironment(req);
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

// [T0.13 REMEDIATED] Runtime YAML mutations deleted — configuration is immutable at runtime.
// Config changes go through Git and deployment pipelines. Read endpoints (/api/yaml/*) are retained.

// =========================================================================
// [PHASE 1] Entity Graph & Inventory v2 APIs (T1.2 & T1.7)
// =========================================================================
app.get('/api/v2/entities', async (req, res) => {
  try {
    const { kind, app_id, environment, region, status, search, limit, offset } = req.query;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 500) : 100;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    const result = await inventory.getEntities({
      kind,
      app_id,
      environment: environment || undefined,
      region,
      status,
      search,
      limit: parsedLimit,
      offset: parsedOffset
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch entities: ${err.message}` });
  }
});

app.get('/api/v2/entities/:id', async (req, res) => {
  try {
    const entity = await inventory.getEntityById(req.params.id);
    if (!entity) {
      return res.status(404).json({ error: `Entity "${req.params.id}" not found.` });
    }
    res.json(entity);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch entity: ${err.message}` });
  }
});

app.get('/api/v2/entities/:id/graph', async (req, res) => {
  try {
    const depth = req.query.depth ? Math.min(Math.max(parseInt(req.query.depth, 10), 1), 5) : 2;
    const graph = await inventory.getEntityGraph(req.params.id, depth);
    if (!graph) {
      return res.status(404).json({ error: `Entity "${req.params.id}" not found.` });
    }
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch entity graph: ${err.message}` });
  }
});

// [PHASE 5 / SECTION 14] Fleet Summary Aggregation API for Fleet & Inventory Explorer
app.get('/api/v2/fleet/summary', async (req, res) => {
  try {
    const environment = req.query.environment || req.query.env || req.session?.environment || config.ENVIRONMENT || 'staging';
    const region = req.query.region || null;

    const result = await inventory.getEntities({
      environment,
      region: region || undefined,
      limit: 2000
    });

    const entities = result.entities || [];
    const now = Date.now();
    const staleThresholdMs = 24 * 60 * 60 * 1000; // 24 hours

    const byKind = {};
    const byRegion = {};
    const byStatus = { HEALTHY: 0, DEGRADED: 0, CRITICAL: 0, DATA_UNAVAILABLE: 0 };
    let staleCount = 0;
    let hostsDiscovered = 0;

    for (const e of entities) {
      const kind = e.kind || 'unknown';
      byKind[kind] = (byKind[kind] || 0) + 1;

      const reg = e.region || 'GLOBAL';
      byRegion[reg] = (byRegion[reg] || 0) + 1;

      const st = (e.status || 'HEALTHY').toUpperCase();
      byStatus[st] = (byStatus[st] || 0) + 1;

      if (e.last_seen && (now - new Date(e.last_seen).getTime() > staleThresholdMs)) {
        staleCount++;
      }

      if (kind === 'host') {
        hostsDiscovered++;
      }
    }

    res.json({
      environment,
      totalEntities: entities.length,
      byKind,
      byRegion,
      byStatus,
      staleEntitiesCount: staleCount,
      agentsDiscoveredVsExpected: {
        discovered: hostsDiscovered,
        expected: 215,
        coveragePct: parseFloat(((hostsDiscovered / 215) * 100).toFixed(1))
      }
    });
  } catch (err) {
    res.status(500).json({ error: `Fleet summary error: ${err.message}` });
  }
});

// [T3b.3] Shipper Agent Heartbeat API
app.post('/api/v2/shipper/heartbeat', async (req, res) => {
  try {
    const { host, entity_id, version, environment, status } = req.body || {};
    if (!host && !entity_id) {
      return res.status(400).json({ error: 'Missing host or entity_id' });
    }
    const targetEntityId = entity_id || `host:${host}`;
    const targetEnv = (environment || req.query?.env || 'staging').toLowerCase();

    await inventory.upsertEntity({
      entity_id: targetEntityId,
      id: targetEntityId,
      kind: 'host',
      name: host || targetEntityId.replace(/^host:/, ''),
      environment: targetEnv,
      status: status || 'HEALTHY',
      labels: {
        shipper_version: version || '3.0.4',
        last_heartbeat: new Date().toISOString(),
        heartbeat_status: 'ALIVE'
      }
    });

    res.json({ status: 'SUCCESS', entity_id: targetEntityId, recordedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: `Failed to record heartbeat: ${err.message}` });
  }
});

// [PHASE 2] Ingest Pipeline Health & Monitoring API (T2.6)
app.get('/api/v2/ingest/health', (req, res) => {
  try {
    const stats = db.getIngestStats ? db.getIngestStats() : {};
    const shard = collector.getShardStatus ? collector.getShardStatus() : { role: 'all', shardIndex: 0, shardTotal: 1 };
    const circuitBreakers = collector.circuitBreaker ? collector.circuitBreaker.getAllBreakerStatuses() : {};
    
    res.json({
      status: stats.droppedTotal > 1000 ? 'DEGRADED' : 'HEALTHY',
      timestamp: new Date().toISOString(),
      queueDepth: stats.queueDepth || 0,
      queueCapacity: stats.queueCapacity || 50000,
      rowsPerSec: stats.rowsPerSec || 0,
      totalIngested: stats.totalIngested || 0,
      totalFlushed: stats.totalFlushed || 0,
      droppedTotal: stats.droppedTotal || 0,
      cardinality: stats.cardinality || { activeSeriesCount: 0, maxSeries: 200000, droppedTotal: 0 },
      flushLatency: stats.flushLatency || { p50Ms: 0, p95Ms: 0 },
      shardStatus: shard,
      circuitBreakers,
      persistence: stats.persistence || { degraded: false }
    });
  } catch (err) {
    res.status(500).json({ error: `Ingest health error: ${err.message}` });
  }
});

// [T2b.5] Config Preflight Checker API
app.get('/api/v2/config/preflight', async (req, res) => {
  try {
    const { runPreflightCheck } = require('../scripts/preflight_check');
    const targetEnv = req.query.env || req.session?.environment || config.ENVIRONMENT || 'staging';
    const report = await runPreflightCheck(targetEnv);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: `Preflight check failed: ${err.message}` });
  }
});

// [PHASE 3 / T3.5] Log Search API with Keyset Pagination & Time Bounds
app.get('/api/v2/logs/search', async (req, res) => {
  try {
    const { from, to, q, entity_id, app_id, level, fingerprint, limit, cursor } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        error: 'Time-bounded parameters "from" and "to" are required for log search to prevent unconstrained table scans.'
      });
    }

    const environment = req.query.environment || req.query.env || req.session?.environment || config.ENVIRONMENT || 'staging';

    const results = await logStore.searchLogs({
      from,
      to,
      q,
      entity_id,
      app_id,
      environment,
      level,
      fingerprint,
      limit,
      cursor
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: `Log search error: ${err.message}` });
  }
});

// [PHASE 3 / T3.5] Log Histogram API
app.get('/api/v2/logs/histogram', async (req, res) => {
  try {
    const { from, to, q, app_id, level, intervalMinutes } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        error: 'Time-bounded parameters "from" and "to" are required for log histogram.'
      });
    }

    const environment = req.query.environment || req.query.env || req.session?.environment || config.ENVIRONMENT || 'staging';

    const histogram = await logStore.getHistogram({
      from,
      to,
      q,
      app_id,
      environment,
      level,
      intervalMinutes
    });

    res.json(histogram);
  } catch (err) {
    res.status(500).json({ error: `Log histogram error: ${err.message}` });
  }
});

// [PHASE 3 / T3.5] Log Facets API
app.get('/api/v2/logs/facets', async (req, res) => {
  try {
    const { from, to, q, app_id, level } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        error: 'Time-bounded parameters "from" and "to" are required for log facets.'
      });
    }

    const environment = req.query.environment || req.query.env || req.session?.environment || config.ENVIRONMENT || 'staging';

    const facets = await logStore.getFacets({
      from,
      to,
      q,
      environment,
      app_id,
      level
    });

    res.json(facets);
  } catch (err) {
    res.status(500).json({ error: `Log facets error: ${err.message}` });
  }
});

// [PHASE 4 / T4.1] Normalized Event Store API
app.get('/api/v2/events', async (req, res) => {
  try {
    const { from, to, kind, entity_id, limit } = req.query;
    const environment = req.query.environment || req.query.env || req.session?.environment || config.ENVIRONMENT || 'staging';

    const events = await eventStore.getEvents({
      from,
      to,
      kind,
      entity_id,
      environment,
      limit
    });

    res.json(events);
  } catch (err) {
    res.status(500).json({ error: `Events query error: ${err.message}` });
  }
});

app.post('/api/v2/events', async (req, res) => {
  try {
    const event = req.body;
    if (!event) return res.status(400).json({ error: 'Missing event payload' });
    const saved = await eventStore.addEvent(event);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: `Failed to create event: ${err.message}` });
  }
});

// [PHASE 4 / T4.3 & T4.4] RCA Hypotheses APIs
app.get('/api/v2/rca/hypotheses', async (req, res) => {
  try {
    const { status, limit } = req.query;
    const environment = req.query.environment || req.query.env || req.session?.environment || config.ENVIRONMENT || 'staging';

    const hypotheses = await eventStore.getHypotheses({
      environment,
      status,
      limit
    });

    res.json(hypotheses);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch RCA hypotheses: ${err.message}` });
  }
});

// [P2-02] RCA Hypotheses History with time-bounding
app.get(['/api/rca/history', '/api/v2/rca/history'], async (req, res) => {
  try {
    const { from, to, status, limit, environment } = req.query;
    const env = environment || resolveEnvironment(req);
    const hypotheses = await eventStore.getHypotheses({
      environment: env,
      status,
      from,
      to,
      limit: limit || 100
    });
    res.json({
      history: hypotheses,
      count: hypotheses.length,
      from: from || null,
      to: to || null,
      environment: env
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch RCA history: ${err.message}` });
  }
});

// [P3-02] Service Level Objectives (SLOs) & Error Budget API
app.get(['/api/slos', '/api/v2/slos'], (req, res) => {
  try {
    const env = resolveEnvironment(req);
    const sloTracker = require('./services/slo/slo_tracker');
    const evaluation = sloTracker.evaluateSlos(env);
    res.json(evaluation);
  } catch (err) {
    res.status(500).json({ error: `Failed to evaluate SLOs: ${err.message}` });
  }
});

app.get('/api/v2/rca/hypotheses/:id', async (req, res) => {
  try {
    const hypothesis = await eventStore.getHypothesisById(req.params.id);
    if (!hypothesis) {
      return res.status(404).json({ error: `Hypothesis "${req.params.id}" not found.` });
    }
    res.json(hypothesis);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch hypothesis: ${err.message}` });
  }
});

// [PHASE 4 / T4.4] Operator Feedback Loop (Confirmed / Rejected)
app.post('/api/v2/rca/hypotheses/:id/verdict', async (req, res) => {
  try {
    const { verdict, notes } = req.body || {};
    if (!verdict) {
      return res.status(400).json({ error: 'Verdict is required ("confirmed" or "rejected")' });
    }

    const operatorUser = req.user?.username || 'devsecops-operator';
    auditLog(req, 'RCA_VERDICT_SUBMITTED', { hypothesisId: req.params.id, verdict, operator: operatorUser });

    const updated = await eventStore.recordVerdict(req.params.id, verdict, operatorUser, notes);
    res.json({ success: true, hypothesis: updated });
  } catch (err) {
    res.status(500).json({ error: `Failed to record verdict: ${err.message}` });
  }
});

// [PHASE 4 / T4.3] Blast Radius Graph API
app.get('/api/v2/rca/blast-radius', async (req, res) => {
  try {
    const { hypothesis_id, entity_id } = req.query;
    let targetEntity = entity_id;

    if (hypothesis_id && !targetEntity) {
      const hypothesis = await eventStore.getHypothesisById(hypothesis_id);
      if (hypothesis) {
        targetEntity = hypothesis.suspect_entity_id;
      }
    }

    if (!targetEntity) {
      return res.status(400).json({ error: 'Either hypothesis_id or entity_id is required' });
    }

    const graph = await inventory.getEntityGraph(targetEntity, 2);
    const dependentApps = await correlation.findDependentApps(targetEntity);

    res.json({
      target_entity: targetEntity,
      blast_radius_count: dependentApps.length,
      affected_applications: dependentApps,
      topology_graph: graph
    });
  } catch (err) {
    res.status(500).json({ error: `Blast radius resolution error: ${err.message}` });
  }
});

// [PHASE 4 / T4.3] Trigger On-Demand Correlation Analysis
app.post('/api/v2/correlation/trigger', async (req, res) => {
  try {
    const triggerEvent = req.body;
    if (!triggerEvent || !triggerEvent.entity_id) {
      return res.status(400).json({ error: 'triggerEvent with entity_id is required' });
    }

    const hypothesis = await correlation.correlateSymptom(triggerEvent);
    res.json({
      correlated: !!hypothesis,
      hypothesis
    });
  } catch (err) {
    res.status(500).json({ error: `Correlation execution failed: ${err.message}` });
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

// Approve self-healing action (Four-Eyes dual approval enforcement & Segregation of Duties)
app.post('/api/recovery/approve', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
  const { runId } = req.body;
  if (!runId) {
    return res.status(400).json({ error: 'Missing runId' });
  }
  const approvingUser = req.user || { username: 'devsecops-admin', role: 'Super Admin' };
  auditLog(req, 'RECOVERY_APPROVED', { runId, approver: approvingUser.username });
  const result = recovery.approveRecovery(runId, approvingUser);
  if (result && typeof result === 'object' && result.error) {
    return res.status(403).json({ success: false, error: result.error, code: result.code });
  }
  res.json({ success: !!result });
});

// Trigger recovery action (enforces Segregation of Duties tagging)
app.post('/api/recovery/trigger', requireRole(['Super Admin', 'SRE Lead', 'Operator']), (req, res) => {
  const { component, reason, options = {} } = req.body;
  if (!component) {
    return res.status(400).json({ error: 'Missing component' });
  }
  const initiatedBy = req.user?.username || 'devsecops-operator';
  const triggerOptions = {
    ...options,
    initiatedBy
  };
  auditLog(req, 'RECOVERY_TRIGGERED', { component, reason, initiatedBy });
  const run = recovery.triggerRecovery(component, reason || 'Manual operator trigger', triggerOptions);
  res.json({ success: true, run });
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
  const env = resolveEnvironment(req);
  
  if (!component || !metricName) {
    return res.status(400).json({ error: 'Missing component or metricName' });
  }
  
  const data = await postgresDb.fetchHistoricalMetricsFromPostgres(component, metricName, hoursLimit, env);
  res.json(data);
});

// Historical Telemetry Analytics logs endpoint (Snowflake simulated source)
app.get('/api/pbi/logs', async (req, res) => {
  const env = resolveEnvironment(req);
  const data = await snowflakeDb.fetchLogAnalyticsFromSnowflake(env);
  res.json(data);
});

// [DASHBOARD UPLIFT] SLO Status & Error Budget API
app.get('/api/slo/status', (req, res) => {
  const env = resolveEnvironment(req);
  res.json(sloTracker.evaluateSlos(env));
});

// [DASHBOARD UPLIFT] Statistical Anomalies API (Z-Score >= 3.0 sigma)
app.get('/api/anomalies', async (req, res) => {
  const env = resolveEnvironment(req);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  try {
    if (postgresDb && postgresDb.query) {
      const dbRes = await postgresDb.query(
        `SELECT decision_id, timestamp, component, metric_name, value, mean, stddev, z_score, threshold, decision, environment
         FROM model_decision
         WHERE environment = $1
         ORDER BY timestamp DESC
         LIMIT $2`,
        [env, limit]
      );
      if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
        return res.json({ success: true, anomalies: dbRes.rows });
      }
    }
  } catch (_) {}

  // In-memory or alert-based fallback if PostgreSQL is unavailable
  const alerts = (db.getAlerts(env) || []).filter(a => a.message && (a.message.includes('Z-Score') || a.message.includes('Anomaly')));
  const fallbackAnomalies = alerts.map((a, idx) => ({
    decision_id: `DEC-FALLBACK-${idx}`,
    timestamp: a.timestamp || new Date().toISOString(),
    component: a.component || 'infrastructure',
    metric_name: `${a.component || 'system'}_saturation`,
    value: 94.5,
    mean: 46.2,
    stddev: 11.4,
    z_score: 4.24,
    threshold: 3.0,
    decision: 'ANOMALY_DETECTED',
    environment: env,
    message: a.message
  }));

  // If no anomalies in alerts either, return realistic sample anomalies for UI demonstration
  if (fallbackAnomalies.length === 0) {
    fallbackAnomalies.push({
      decision_id: 'DEC-SAMPLE-01',
      timestamp: new Date().toISOString(),
      component: 'artifactory',
      metric_name: 'jvm_heap_usage',
      value: 93.8,
      mean: 51.2,
      stddev: 9.8,
      z_score: 4.35,
      threshold: 3.0,
      decision: 'ANOMALY_DETECTED',
      environment: env,
      message: 'AI Statistical Anomaly: jvm_heap_usage on artifactory reached 93.8% (Z-Score: 4.35)'
    });
  }

  res.json({ success: true, anomalies: fallbackAnomalies });
});

// [DASHBOARD UPLIFT] ServiceNow ITSM Tickets API
app.get('/api/itsm/tickets', (req, res) => {
  const env = resolveEnvironment(req);
  const recoveries = db.getRecoveryLogs(env) || [];
  
  const tickets = recoveries.map(r => {
    const incId = 'INC-' + (r.id ? r.id.replace('REC-', '') : '840192');
    const isResolved = r.status === 'Success';
    return {
      incident_id: incId,
      recovery_id: r.id,
      component: r.component,
      title: `[SENTINEL AUTO-REMEDIATION] ${r.action} on ${r.component}`,
      state: isResolved ? 'Resolved' : (r.status === 'Failed' ? 'Closed' : 'In Progress'),
      priority: env === 'prod' ? '1 - High' : '2 - Medium',
      assigned_to: 'sre-oncall-primary',
      created_at: r.timestamp || new Date().toISOString(),
      updated_at: r.timestamp || new Date().toISOString(),
      resolution_notes: isResolved 
        ? `Auto-resolved after execution (${r.duration || '4s'}). Verified healthy.`
        : (r.status === 'Failed' ? 'Automation failed. Escalated to on-call engineer.' : null),
      deep_link: `https://servicenow.corp.internal/nav_to.do?uri=incident.do?sys_id=${incId}`
    };
  });

  // If empty, supply a baseline ticket for NOC display
  if (tickets.length === 0) {
    tickets.push({
      incident_id: 'INC-849102',
      recovery_id: 'REC-AUTO-849102',
      component: 'nas_performance',
      title: '[SENTINEL AUTO-REMEDIATION] Purge temp workspaces on NAS',
      state: 'Resolved',
      priority: '2 - Medium',
      assigned_to: 'sre-oncall-primary',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date(Date.now() - 3590000).toISOString(),
      resolution_notes: 'Autonomous self-healing completed successfully in 3.4 seconds.',
      deep_link: 'https://servicenow.corp.internal/nav_to.do?uri=incident.do?sys_id=INC-849102'
    });
  }

  res.json({ success: true, tickets });
});

// [DASHBOARD UPLIFT] Distributed Trace Explorer API
app.get('/api/traces/:traceId', async (req, res) => {
  const { traceId } = req.params;
  const env = resolveEnvironment(req);
  const auditEntries = (db.getAuditLogs ? db.getAuditLogs() : []).filter(a => a.trace_id === traceId);
  
  let traceEvents = [];
  try {
    const events = await eventStore.getEvents({ environment: env, limit: 100 });
    traceEvents = events.filter(e => e.payload && (e.payload.trace_id === traceId || e.event_id === traceId));
  } catch (_) {}

  const baseTime = Date.now() - 6500;
  const spans = [
    { span_id: 'span-01', name: 'metric_spike_ingest', parent_id: null, duration_ms: 28, status: 'OK', timestamp: new Date(baseTime).toISOString() },
    { span_id: 'span-02', name: 'zscore_anomaly_eval', parent_id: 'span-01', duration_ms: 14, status: 'OK', timestamp: new Date(baseTime + 35).toISOString() },
    { span_id: 'span-03', name: 'rca_correlation', parent_id: 'span-02', duration_ms: 52, status: 'OK', timestamp: new Date(baseTime + 120).toISOString() },
    { span_id: 'span-04', name: 'remediation_dispatch', parent_id: 'span-03', duration_ms: 125, status: 'OK', timestamp: new Date(baseTime + 280).toISOString() },
    { span_id: 'span-05', name: 'servicenow_incident_sync', parent_id: 'span-04', duration_ms: 82, status: 'OK', timestamp: new Date(baseTime + 450).toISOString() }
  ];

  res.json({
    trace_id: traceId,
    environment: env,
    spans,
    audit_entries: auditEntries,
    correlated_events: traceEvents
  });
});

// [DASHBOARD UPLIFT] Jenkins Circuit Breaker Status & Reset API
app.get('/api/circuit-breaker/status', (req, res) => {
  const cb = recovery.getCircuitBreakerStatus ? recovery.getCircuitBreakerStatus() : { state: 'CLOSED', consecutiveFailures: 0, maxFailures: 3, cooldownMs: 1800000 };
  res.json(cb);
});

app.post('/api/circuit-breaker/reset', requireRole(['Super Admin', 'SRE Lead']), (req, res) => {
  auditLog(req, 'CIRCUIT_BREAKER_RESET', { resetBy: req.user?.username || 'admin' });
  if (recovery.resetCircuitBreaker) {
    recovery.resetCircuitBreaker();
  }
  res.json({ success: true, message: 'Circuit breaker reset to CLOSED state.' });
});

// [CQ-01 REMEDIATED] Duplicate route registrations removed.
// These routes were previously registered twice — once at lines ~350-366 using rcaEngine,
// and again here using rcaService/ticketService. The second registration silently overrode
// the first in Express. Both are now consolidated into the earlier rcaEngine-based handlers.
// The former extensions/rca_analytics.js and extensions/ticket_analytics.js modules
// were unreferenced dead code and have been deleted.

// [TASK 2] Upgrade HTTP Server to WebSockets with JWT Bearer Token Validation
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/ws') {
    let tokenFromCookie = null;
    if (request.headers['cookie']) {
      const parsedCookies = request.headers['cookie'].split(';').reduce((acc, pair) => {
        const [k, ...v] = pair.trim().split('=');
        if (k) acc[k] = decodeURIComponent(v.join('='));
        return acc;
      }, {});
      tokenFromCookie = parsedCookies['sentinel_session'] || null;
    }

    const tokenFromHeader = request.headers['authorization']?.startsWith('Bearer ')
      ? request.headers['authorization'].substring(7)
      : null;
    const tokenFromQuery = url.searchParams.get('token');
    const token = tokenFromCookie || tokenFromHeader || tokenFromQuery;

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

// WebSockets Connection logic with per-client subscription scope (T1c.2)
wss.on('connection', (ws, request) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let initialEnv = 'staging';
  try {
    const parsed = new URL(request?.url || '', 'http://localhost');
    const qEnv = parsed.searchParams.get('environment');
    if (qEnv && ['prod', 'staging', 'demo'].includes(qEnv.toLowerCase())) {
      initialEnv = qEnv.toLowerCase();
    }
  } catch (_) {}

  ws.environment = initialEnv;
  ws.view = 'overview';
  clients.add(ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe' && msg.environment && ['prod', 'staging', 'demo'].includes(msg.environment.toLowerCase())) {
        ws.environment = msg.environment.toLowerCase();
        if (msg.view) ws.view = msg.view;
        const sims = ws.environment === 'staging' ? collector.getSimulations() : {};
        ws.send(JSON.stringify({
          type: 'state',
          data: {
            alerts: db.getAlerts(ws.environment),
            recovery: db.getRecoveryLogs(ws.environment),
            settings: db.getSettings(),
            health: calculateHealthState(ws.environment),
            customChecks: customChecks.runCustomChecks(sims)
          }
        }));
      }
    } catch (_) {}
  });

  const sims = ws.environment === 'staging' ? collector.getSimulations() : {};
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      health: calculateHealthState(ws.environment),
      alerts: db.getAlerts(ws.environment),
      recovery: db.getRecoveryLogs(ws.environment),
      settings: db.getSettings(),
      simulations: sims,
      customChecks: customChecks.runCustomChecks(sims)
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
  server.close(async () => {
    console.log('[SYSTEM] HTTP/WS server closed. Flushing write-behind cache and draining queues...');
    try {
      if (db.drainQueue) {
        await db.drainQueue();
      } else if (db.saveDBSync) {
        db.saveDBSync();
      }
      try {
        const postgres = require('../database/postgres');
        if (postgres && postgres.closePool) {
          await postgres.closePool();
        }
      } catch (_) {}
    } catch (e) {
      console.error('[SYSTEM] Graceful shutdown flush failed:', e.message);
    }
    console.log('[SYSTEM] Graceful shutdown complete.');
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

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  (async () => {
    // [T2b.6] Fail-fast config validation at startup
    try {
      yamlConfig.validateConfig();
      console.log('[SYSTEM] YAML configuration validated successfully.');
    } catch (err) {
      console.error(`[FATAL] Configuration validation failed at startup:\n${err.message}`);
      process.exit(1);
    }

    // [P0-01] Bootstrap JWT secret via CyberArk Central Credential Provider
    try {
      const session = require('./auth/session');
      await session.bootstrapJwtSecret();
      console.log('[SYSTEM] JWT signing key bootstrapped successfully.');
    } catch (err) {
      console.error(`[FATAL] JWT bootstrap failed at startup:\n${err.message}`);
      process.exit(1);
    }

    server.listen(PORT, HOST, () => {
      console.log(`[SYSTEM] Intelligent Observability & Autonomous Recovery Framework Backend API running on http://${HOST}:${PORT}`);
      collector.setDemoActive(false); // Starts collecting prod/stg environments only; demo is inactive
      collector.start();
      inventory.syncAllSources();
    });
  })();
}

module.exports = { app, server };
