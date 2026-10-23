#!/usr/bin/env node
/**
 * agent/probe/index.js
 *
 * SENTINEL Local Prober (sentinel-probe):
 * Measures local application health (localhost URL), NAS read/write/list/stat
 * latency on mounted shares, and exports standard OTLP metrics.
 *
 * CLI (Phase A2):
 *   node agent/probe/index.js --config /etc/sentinel/probe.json [--once]
 *   node agent/probe/index.js --config probe.json --write-collector-config /etc/sentinel/collector.yaml [--role cluster]
 *     (pulls the host's served collector config once and writes it; used by the
 *      service pre-start step and the Helm init containers)
 *
 * Every `interval_seconds` it:
 *   1. pulls its host config from the SENTINEL app (GET /api/v2/agent/config) every
 *      `config_refresh_seconds`, keeping the last good copy when the pull fails;
 *   2. probes each localhost target (`agent.localhost_ms`, `agent.localhost_up`) and
 *      each share (`nas.stat_ms`, `nas.list_ms`, `nas.read_ms`, `nas.write_ms`, `nas.up`);
 *   3. pushes them as OTLP/HTTP JSON (default: the local collector on 127.0.0.1:4318);
 *   4. sends a heartbeat (POST /api/v2/shipper/heartbeat) with agent_version,
 *      config_hash and os;
 *   5. forwards new osquery file events (pack file_changes) to
 *      POST /api/v2/changes/events (Phase A5).
 *
 * Auth convention (Phase A1):
 *   - to the SENTINEL app: `X-Sentinel-Api-Key: <ingest key>` (scope agent + heartbeat;
 *     + metrics when pushing straight to the app);
 *   - to the OTel gateway: `Authorization: Bearer <gateway token>`;
 *   - to the local collector: nothing.
 * The environment is never sent: SENTINEL takes it from the ingest key.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const tls = require('tls');
const net = require('net');

const AGENT_VERSION = '2.4.0';
const MAX_PENDING_EVENTS = 5000;

/**
 * Measure localhost HTTP/S endpoint latency and health.
 */
async function probeLocalHealth(targetUrl, timeoutMs = 5000) {
  if (!targetUrl) {
    return { status: 'DATA_UNAVAILABLE', latency_ms: null, httpStatus: null, error: 'No target URL configured' };
  }

  const start = process.hrtime.bigint();
  try {
    const url = new URL(targetUrl);
    const client = url.protocol === 'https:' ? https : http;

    return await new Promise((resolve) => {
      const req = client.get(targetUrl, {
        timeout: timeoutMs,
        rejectUnauthorized: false
      }, (res) => {
        // Read response body
        res.on('data', () => {});
        res.on('end', () => {
          const end = process.hrtime.bigint();
          const latencyMs = Number(end - start) / 1e6;
          resolve({
            status: res.statusCode < 400 ? 'HEALTHY' : 'DEGRADED',
            latency_ms: parseFloat(latencyMs.toFixed(2)),
            httpStatus: res.statusCode,
            error: null
          });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('Local probe request timed out'));
      });

      req.on('error', (err) => {
        resolve({
          status: 'DATA_UNAVAILABLE',
          latency_ms: null,
          httpStatus: null,
          error: err.message
        });
      });
    });
  } catch (err) {
    return {
      status: 'DATA_UNAVAILABLE',
      latency_ms: null,
      httpStatus: null,
      error: err.message
    };
  }
}

/**
 * Measure NAS share operations (stat, list, read, write canary).
 */
async function probeNasShare(sharePath, options = {}) {
  if (!sharePath) {
    return { status: 'DATA_UNAVAILABLE', path: sharePath, error: 'Missing share path' };
  }

  const result = {
    path: sharePath,
    stat_ms: null,
    list_ms: null,
    read_ms: null,
    write_ms: null,
    status: 'DATA_UNAVAILABLE',
    error: null
  };

  try {
    // 1. Stat latency
    const t0 = process.hrtime.bigint();
    const stat = await fs.promises.stat(sharePath);
    const t1 = process.hrtime.bigint();
    result.stat_ms = parseFloat((Number(t1 - t0) / 1e6).toFixed(2));

    if (!stat.isDirectory()) {
      result.error = 'Share path is not a directory';
      return result;
    }

    // 2. Directory listing latency
    const t2 = process.hrtime.bigint();
    await fs.promises.readdir(sharePath);
    const t3 = process.hrtime.bigint();
    result.list_ms = parseFloat((Number(t3 - t2) / 1e6).toFixed(2));

    // 3. Canary file write & read
    const canaryName = `.sentinel_probe_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.tmp`;
    const canaryPath = path.join(sharePath, canaryName);
    const canaryContent = `SENTINEL_PROBE_${new Date().toISOString()}`;

    // Write latency
    const t4 = process.hrtime.bigint();
    await fs.promises.writeFile(canaryPath, canaryContent, 'utf8');
    const t5 = process.hrtime.bigint();
    result.write_ms = parseFloat((Number(t5 - t4) / 1e6).toFixed(2));

    // Read latency
    const t6 = process.hrtime.bigint();
    await fs.promises.readFile(canaryPath, 'utf8');
    const t7 = process.hrtime.bigint();
    result.read_ms = parseFloat((Number(t7 - t6) / 1e6).toFixed(2));

    // Clean up canary file
    try {
      await fs.promises.unlink(canaryPath);
    } catch (_) {}

    result.status = 'HEALTHY';
    return result;
  } catch (err) {
    result.error = err.message;
    return result;
  }
}

/**
 * Measure SMB/CIFS share operations on Windows hosts (presence, free %, latency) [F20].
 */
async function probeSmbShare(sharePath, options = {}) {
  if (!sharePath) {
    return { status: 'DATA_UNAVAILABLE', path: sharePath, present: false, error: 'Missing SMB share path' };
  }

  const result = {
    path: sharePath,
    is_smb: true,
    present: false,
    free_pct: null,
    latency_ms: null,
    status: 'DATA_UNAVAILABLE',
    error: null
  };

  try {
    const t0 = process.hrtime.bigint();
    const stat = await fs.promises.stat(sharePath);
    const t1 = process.hrtime.bigint();
    result.latency_ms = parseFloat((Number(t1 - t0) / 1e6).toFixed(2));
    result.present = stat.isDirectory();

    if (!result.present) {
      result.error = 'SMB path is not a directory or mount point';
      return result;
    }

    if (options.mockFreePct !== undefined) {
      result.free_pct = options.mockFreePct;
    } else if (typeof fs.promises.statfs === 'function') {
      try {
        const sfs = await fs.promises.statfs(sharePath);
        if (sfs.blocks > 0) {
          result.free_pct = parseFloat(((sfs.bavail / sfs.blocks) * 100).toFixed(1));
        }
      } catch (_) {}
    }

    result.status = 'HEALTHY';
    return result;
  } catch (err) {
    result.error = err.message;
    result.present = false;
    return result;
  }
}

/**

 * Parse NTP offset from chronyc tracking, ntpq, or ntpstat command output.
 */
function parseNtpOffset(text) {
  if (!text || typeof text !== 'string') return { offset_ms: null, error: 'Empty NTP text' };
  // chronyc tracking: "RMS offset : 0.000012345 s" or "Last offset : +0.000543210 s"
  let m = /RMS\s+offset\s*:\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*s/i.exec(text);
  if (!m) m = /Last\s+offset\s*:\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*s/i.exec(text);
  if (m) {
    const sec = parseFloat(m[1]);
    return { offset_ms: parseFloat((sec * 1000).toFixed(4)), error: null };
  }
  // chronyc or ntpq in ms: "offset\s*[:=]\s*([+-]?\d+(?:\.\d+)?)\s*(?:ms)?"
  m = /offset\s*[:=]\s*([+-]?\d+(?:\.\d+)?)\s*(?:ms)?/i.exec(text);
  if (m) {
    return { offset_ms: parseFloat(parseFloat(m[1]).toFixed(4)), error: null };
  }
  return { offset_ms: null, error: 'Could not parse NTP offset from output' };
}

/**
 * Parse Linux /proc/sys/fs/file-nr format: <allocated> <allocated_unused> <max>
 */
function parseFileNr(text) {
  if (!text || typeof text !== 'string') return { used: null, max: null, utilization_pct: null, error: 'Empty file-nr text' };
  const parts = text.trim().split(/\s+/);
  if (parts.length >= 3) {
    const allocated = parseInt(parts[0], 10);
    const unusedAllocated = parseInt(parts[1], 10);
    const max = parseInt(parts[2], 10);
    const used = allocated - unusedAllocated;
    const utilizationPct = max > 0 ? parseFloat(((used / max) * 100).toFixed(2)) : 0;
    return {
      used: isNaN(used) ? null : used,
      allocated: isNaN(allocated) ? null : allocated,
      max: isNaN(max) ? null : max,
      utilization_pct: utilizationPct,
      error: null
    };
  }
  return { used: null, max: null, utilization_pct: null, error: 'Invalid file-nr format' };
}

const TCP_STATE_MAP = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING'
};

/**
 * Parse TCP connection states from /proc/net/tcp hex dumps or text state summaries.
 */
function parseTcpConnections(text) {
  const counts = {
    ESTABLISHED: 0,
    SYN_SENT: 0,
    SYN_RECV: 0,
    FIN_WAIT1: 0,
    FIN_WAIT2: 0,
    TIME_WAIT: 0,
    CLOSE: 0,
    CLOSE_WAIT: 0,
    LAST_ACK: 0,
    LISTEN: 0,
    CLOSING: 0
  };
  if (!text || typeof text !== 'string') return counts;

  const lines = text.trim().split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length > 3 && parts[3].length === 2 && /^[0-9A-Fa-f]{2}$/.test(parts[3])) {
      const stateHex = parts[3].toUpperCase();
      const stateName = TCP_STATE_MAP[stateHex];
      if (stateName && counts[stateName] !== undefined) {
        counts[stateName]++;
      }
    } else {
      for (const stateName of Object.keys(counts)) {
        if (new RegExp(`\\b${stateName}\\b`, 'i').test(line)) {
          counts[stateName]++;
          break;
        }
      }
    }
  }
  return counts;
}

/**
 * Probe local product TLS listener (https://127.0.0.1:<port>).
 */
async function probeLocalTls(target, timeoutMs = 5000) {
  let port = null;
  let host = '127.0.0.1';

  if (typeof target === 'object' && target !== null) {
    port = target.port;
    if (target.host) host = target.host;
    if (target.timeoutMs) timeoutMs = target.timeoutMs;
  } else if (typeof target === 'number' || typeof target === 'string') {
    if (String(target).startsWith('http')) {
      try {
        const u = new URL(target);
        host = u.hostname || '127.0.0.1';
        port = u.port || (u.protocol === 'https:' ? 443 : 80);
      } catch (_) {}
    } else {
      port = Number(target);
    }
  }

  if (!port) {
    return {
      status: 'DATA_UNAVAILABLE',
      error: 'Missing port for TLS probe',
      subject: null,
      san: null,
      not_after: null,
      chain: [],
      tls_version: null,
      cipher: null
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({
      host,
      port: Number(port),
      rejectUnauthorized: false,
      servername: net.isIP(host) ? undefined : host
    }, () => {
      if (settled) return;
      settled = true;
      try {
        const cert = socket.getPeerCertificate(true);
        const protocol = socket.getProtocol();
        const cipher = socket.getCipher();
        socket.end();

        if (!cert || !cert.subject) {
          return resolve({
            status: 'DATA_UNAVAILABLE',
            error: 'No peer certificate presented',
            subject: null,
            san: null,
            not_after: null,
            chain: [],
            tls_version: protocol,
            cipher: cipher ? cipher.name : null
          });
        }

        const subjectCN = (cert.subject && (cert.subject.CN || cert.subject.O || JSON.stringify(cert.subject))) || null;
        let sanList = [];
        if (cert.subjectaltname) {
          sanList = cert.subjectaltname.split(',').map(s => s.trim().replace(/^(DNS|IP Address):/i, ''));
        }
        const notAfter = cert.valid_to ? new Date(cert.valid_to).toISOString() : null;

        const chain = [];
        let curr = cert;
        const seen = new Set();
        while (curr && curr.fingerprint && !seen.has(curr.fingerprint)) {
          seen.add(curr.fingerprint);
          chain.push({
            subject: curr.subject ? (curr.subject.CN || JSON.stringify(curr.subject)) : null,
            issuer: curr.issuer ? (curr.issuer.CN || JSON.stringify(curr.issuer)) : null,
            not_after: curr.valid_to ? new Date(curr.valid_to).toISOString() : null,
            fingerprint: curr.fingerprint
          });
          curr = curr.issuerCertificate && curr.issuerCertificate !== curr ? curr.issuerCertificate : null;
        }

        resolve({
          status: 'HEALTHY',
          subject: subjectCN,
          san: sanList,
          not_after: notAfter,
          chain,
          tls_version: protocol,
          cipher: cipher ? cipher.name : null,
          error: null
        });
      } catch (err) {
        resolve({
          status: 'DATA_UNAVAILABLE',
          error: err.message,
          subject: null,
          san: null,
          not_after: null,
          chain: [],
          tls_version: null,
          cipher: null
        });
      }
    });

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        status: 'DATA_UNAVAILABLE',
        error: 'TLS connection timed out',
        subject: null,
        san: null,
        not_after: null,
        chain: [],
        tls_version: null,
        cipher: null
      });
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({
        status: 'DATA_UNAVAILABLE',
        error: err.message,
        subject: null,
        san: null,
        not_after: null,
        chain: [],
        tls_version: null,
        cipher: null
      });
    });
  });
}

/**
 * List keystore entries (JKS / PKCS12) returning aliases and not_after only.
 * If format requires a password to read, reports UNREADABLE.
 */
function listKeystoreEntries(keystorePath, options = {}) {
  if (!keystorePath || !fs.existsSync(keystorePath)) {
    return {
      path: keystorePath,
      status: 'DATA_UNAVAILABLE',
      entries: [],
      error: 'Keystore file not found'
    };
  }

  let buf;
  try {
    buf = fs.readFileSync(keystorePath);
  } catch (err) {
    return {
      path: keystorePath,
      status: 'DATA_UNAVAILABLE',
      entries: [],
      error: err.message
    };
  }

  // JKS magic bytes: 0xfeedfeed
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xfeedfeed) {
    return {
      path: keystorePath,
      status: 'UNREADABLE',
      entries: [],
      error: 'JKS format requires password to read entries'
    };
  }

  // PKCS12 / DER certificate scanner
  try {
    const entries = [];
    let offset = 0;
    while (offset < buf.length - 4) {
      if (buf[offset] === 0x30 && buf[offset + 1] === 0x82) {
        const len = (buf[offset + 2] << 8) | buf[offset + 3];
        const totalLen = len + 4;
        if (totalLen > 100 && offset + totalLen <= buf.length) {
          const slice = buf.slice(offset, offset + totalLen);
          try {
            const cert = new crypto.X509Certificate(slice);
            if (cert && cert.validTo) {
              const alias = cert.subject ? (cert.subject.replace(/^CN=/i, '').split('\n')[0] || 'cert') : 'cert';
              const notAfter = new Date(cert.validTo).toISOString();
              if (!entries.some(e => e.not_after === notAfter && e.alias === alias)) {
                entries.push({ alias, not_after: notAfter });
              }
            }
          } catch (_) {}
        }
      }
      offset++;
    }

    if (entries.length > 0) {
      return {
        path: keystorePath,
        status: 'HEALTHY',
        entries,
        error: null
      };
    }

    return {
      path: keystorePath,
      status: 'UNREADABLE',
      entries: [],
      error: 'PKCS12 encrypted or requires password'
    };
  } catch (err) {
    return {
      path: keystorePath,
      status: 'UNREADABLE',
      entries: [],
      error: err.message
    };
  }
}

/**
 * Build standard OpenTelemetry OTLP JSON metrics payload.
 */
function buildOtlpPayload(metricsList, resourceAttrs = {}) {
  const timestampNano = String(BigInt(Date.now()) * 1000000n);

  const attributes = Object.entries(resourceAttrs).map(([k, v]) => ({
    key: k,
    value: { stringValue: String(v) }
  }));

  const otlpMetrics = metricsList
    .filter(m => m.value !== null && typeof m.value === 'number')
    .map(m => ({
      name: m.name,
      description: m.description || '',
      gauge: {
        dataPoints: [{
          timeUnixNano: timestampNano,
          asDouble: m.value,
          attributes: Object.entries(m.attributes || {}).map(([k, v]) => ({
            key: k,
            value: { stringValue: String(v) }
          }))
        }]
      }
    }));

  return {
    resourceMetrics: [{
      resource: { attributes },
      scopeMetrics: [{
        scope: { name: 'sentinel-probe', version: AGENT_VERSION },
        metrics: otlpMetrics
      }]
    }]
  };
}

/**
 * Headers for one destination. `auth` is 'api_key' (SENTINEL app), 'bearer' (OTel
 * gateway) or 'none' (local collector).
 */
function authHeaders({ auth = 'none', apiKey = '', gatewayToken = '' } = {}) {
  if (auth === 'api_key') return apiKey ? { 'X-Sentinel-Api-Key': apiKey } : {};
  if (auth === 'bearer') return gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {};
  return {};
}

// HTTP request returning parsed JSON.
async function httpJson(method, url, { body, headers = {}, timeoutMs = 10000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, data };
}

/**
 * Export metrics via OTLP/HTTP JSON. Returns { ok, status, error }.
 * `endpoint` is the base URL (…/v1/metrics is appended).
 */
async function pushOtlpMetrics(endpoint, payload, options = {}) {
  if (!endpoint) return { ok: false, status: null, error: 'No OTLP endpoint configured' };
  const url = `${String(endpoint).replace(/\/+$/, '')}/v1/metrics`;
  try {
    const r = await httpJson('POST', url, { body: payload, headers: authHeaders(options), timeoutMs: options.timeoutMs || 10000 });
    return { ok: r.ok, status: r.status, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, status: null, error: err.message };
  }
}

// linux, windows or kubernetes.
function detectOs(platform = process.platform) {
  if (process.env.KUBERNETES_SERVICE_HOST || process.env.K8S_NODE_NAME) return 'kubernetes';
  return platform === 'win32' ? 'windows' : 'linux';
}

// SHA-256 of a file, or null.
function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return null;
  }
}

/** Reads the probe config file (JSON) and fills defaults + secrets from the environment. */
function loadProbeConfig(file, env = process.env) {
  const raw = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const readSecret = (inline, fileKey, envKey) => {
    if (env[envKey]) return String(env[envKey]).trim();
    if (raw[fileKey]) {
      try { return fs.readFileSync(raw[fileKey], 'utf8').trim(); } catch (_) { return ''; }
    }
    return inline ? String(inline) : '';
  };
  return {
    sentinelUrl: env.SENTINEL_APP_URL || raw.sentinel_url || '',
    // host/os can be pinned by the deployment (K8s passes the node or cluster name).

    apiKey: readSecret(raw.api_key, 'api_key_file', 'SENTINEL_INGEST_KEY'),
    gatewayToken: readSecret(raw.gateway_token, 'gateway_token_file', 'SENTINEL_GATEWAY_TOKEN'),
    host: raw.host || env.SENTINEL_AGENT_HOST || env.K8S_NODE_NAME || os.hostname(),
    os: raw.os || detectOs(),
    intervalSeconds: Math.max(Number(raw.interval_seconds) || 60, 5),
    configRefreshSeconds: Math.max(Number(raw.config_refresh_seconds) || 300, 30),
    otlpEndpoint: raw.otlp_endpoint || 'http://127.0.0.1:4318',
    otlpAuth: raw.otlp_auth || 'none',
    timeoutMs: Number(raw.timeout_ms) || 5000,
    collectorConfigPath: raw.collector_config_path || env.SENTINEL_COLLECTOR_CONFIG || '',
    role: raw.role === 'cluster' ? 'cluster' : 'node',
    osqueryResultsPath: raw.osquery_results_path !== undefined ? raw.osquery_results_path
      : (detectOs() === 'windows' ? 'C:/ProgramData/SentinelAgent/osquery/log/osqueryd.results.log' : '/var/log/osquery/osqueryd.results.log'),
    stateFile: raw.state_file || '',
    maxEventsPerCycle: Number(raw.max_events_per_cycle) || 500,
    extraShares: Array.isArray(raw.shares) ? raw.shares : [],
    extraTargets: Array.isArray(raw.localhost_targets) ? raw.localhost_targets : []
  };
}

// Runs the probe loop on a host: local health, shares, TLS, file events and the heartbeat to Sentinel.
class ProbeRunner {
  // Creates the runner from the probe config.
  constructor(cfg, deps = {}) {
    this.cfg = cfg;
    this.probeLocal = deps.probeLocalHealth || probeLocalHealth;
    this.probeShare = deps.probeNasShare || probeNasShare;
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || ((msg) => console.log(`[sentinel-probe] ${msg}`));
    this.hostConfig = null;
    this.lastConfigPull = 0;
    this.timer = null;
    this.lastCycle = null;
    this.osqueryOffset = this.loadState().osqueryOffset || 0;
    this.pendingEvents = [];
  }

  // Reads saved state (osquery offset).
  loadState() {
    if (!this.cfg.stateFile) return {};
    try { return JSON.parse(fs.readFileSync(this.cfg.stateFile, 'utf8')) || {}; } catch (_) { return {}; }
  }

  // Saves state.
  saveState() {
    if (!this.cfg.stateFile) return;
    try { fs.writeFileSync(this.cfg.stateFile, JSON.stringify({ osqueryOffset: this.osqueryOffset })); } catch (_) {}
  }

  /** Reads osquery result lines appended since the last cycle (handles rotation). */
  readNewOsqueryLines() {
    const file = this.cfg.osqueryResultsPath;
    if (!file || !fs.existsSync(file)) return [];
    const size = fs.statSync(file).size;
    if (size < this.osqueryOffset) this.osqueryOffset = 0; // rotated or truncated
    if (size === this.osqueryOffset) return [];
    const fd = fs.openSync(file, 'r');
    try {
      const len = Math.min(size - this.osqueryOffset, 8 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.osqueryOffset);
      const text = buf.toString('utf8');
      const lastNl = text.lastIndexOf('\n');
      if (lastNl < 0) return [];
      this.osqueryOffset += Buffer.byteLength(text.slice(0, lastNl + 1));
      return text.slice(0, lastNl).split('\n').filter(Boolean);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Turns osquery file_events / ntfs_journal_events results into SENTINEL change events. */
  fileEventsFromLines(lines) {
    const knownProducts = new Set(((this.hostConfig && this.hostConfig.apps) || []).map(a => a.id));
    const events = [];
    for (const line of lines) {
      let rec;
      try { rec = JSON.parse(line); } catch (_) { continue; }
      if (!rec || !/file_events$/.test(rec.name || '') || rec.action === 'removed') continue;
      const rows = rec.columns ? [rec.columns] : (rec.snapshot || (rec.diffResults && rec.diffResults.added) || []);
      for (const c of rows) {
        if (!c || !c.target_path) continue;
        const unix = Number(c.time || rec.unixTime);
        events.push({
          path: c.target_path,
          productId: knownProducts.has(c.category) ? c.category : null,
          category: c.category || null,
          action: c.action || null,
          host: this.cfg.host,
          afterHash: c.sha256 || c.md5 || null,
          user: c.uid !== undefined ? String(c.uid) : null,
          process: null,
          timestamp: Number.isFinite(unix) && unix > 0 ? new Date(unix * 1000).toISOString() : null
        });
      }
    }
    return events;
  }

  // Sends new osquery file-change events to Sentinel.
  async forwardFileEvents() {
    if (!this.cfg.sentinelUrl) return { ok: true, sent: 0 };
    // Unsent events stay queued (bounded) and go first next cycle.
    const pending = [...this.pendingEvents, ...this.fileEventsFromLines(this.readNewOsqueryLines())];
    this.saveState();
    let sent = 0;
    while (pending.length > 0) {
      const batch = pending.slice(0, this.cfg.maxEventsPerCycle);
      let error = null;
      try {
        const r = await httpJson('POST', `${this.cfg.sentinelUrl.replace(/\/+$/, '')}/api/v2/changes/events`, {
          headers: this.appHeaders(), body: { events: batch }, timeoutMs: this.cfg.timeoutMs * 2
        });
        if (!r.ok) error = `HTTP ${r.status}`;
      } catch (err) {
        error = err.message;
      }
      if (error) {
        this.pendingEvents = pending.slice(-MAX_PENDING_EVENTS);
        return { ok: false, sent, queued: this.pendingEvents.length, error };
      }
      pending.splice(0, batch.length);
      sent += batch.length;
    }
    this.pendingEvents = [];
    return { ok: true, sent };
  }

  appHeaders() {
    return authHeaders({ auth: 'api_key', apiKey: this.cfg.apiKey });
  }

  /** Pulls /api/v2/agent/config. Keeps the previous copy on failure. */
  async refreshConfig(force = false) {
    if (!force && this.hostConfig && this.now() - this.lastConfigPull < this.cfg.configRefreshSeconds * 1000) {
      return { refreshed: false };
    }
    if (!this.cfg.sentinelUrl) return { refreshed: false, error: 'sentinel_url not configured' };
    const q = new URLSearchParams({ host: this.cfg.host, os: this.cfg.os, agent_version: AGENT_VERSION });
    if (this.cfg.role === 'cluster') q.set('role', 'cluster');
    try {
      const r = await httpJson('GET', `${this.cfg.sentinelUrl.replace(/\/+$/, '')}/api/v2/agent/config?${q}`, {
        headers: this.appHeaders(), timeoutMs: this.cfg.timeoutMs * 2
      });
      if (!r.ok || !r.data) return { refreshed: false, error: `config pull failed: HTTP ${r.status}` };
      this.hostConfig = r.data;
      this.lastConfigPull = this.now();
      return { refreshed: true };
    } catch (err) {
      return { refreshed: false, error: `config pull failed: ${err.message}` };
    }
  }

  // Probe targets from the server config plus local extras.
  targets() {
    const fromServer = (this.hostConfig && this.hostConfig.probe_targets) || [];
    const all = [...fromServer, ...this.cfg.extraTargets];
    const seen = new Set();
    return all.filter(t => t && t.url && !seen.has(`${t.productId}|${t.url}`) && seen.add(`${t.productId}|${t.url}`));
  }

  // Shares to check from the server config plus local extras.
  shares() {
    const fromServer = (this.hostConfig && this.hostConfig.shares) || [];
    return Array.from(new Set([...fromServer, ...this.cfg.extraShares].filter(Boolean)));
  }

  /** Hash of the collector config this host runs (what P10 compares with the served one). */
  configHash() {
    if (this.cfg.collectorConfigPath) return sha256File(this.cfg.collectorConfigPath);
    return null;
  }

  /** One probe cycle. Returns { metrics, push, heartbeat, errors }. */
  async runOnce() {
    const errors = [];
    const cfgResult = await this.refreshConfig();
    if (cfgResult.error) errors.push(cfgResult.error);

    // One OTLP resource per product so SENTINEL files each series under that product.
    const byProduct = new Map();
    const add = (productId, metric) => {
      const key = productId || '';
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(metric);
    };

    for (const t of this.targets()) {
      const r = await this.probeLocal(t.url, this.cfg.timeoutMs);
      const attrs = { url: t.url, http_status: r.httpStatus === null ? '' : r.httpStatus };
      add(t.productId, { name: 'agent.localhost_up', value: r.status === 'HEALTHY' ? 1 : 0, attributes: attrs });
      if (r.latency_ms !== null) add(t.productId, { name: 'agent.localhost_ms', value: r.latency_ms, attributes: attrs });
      if (r.error) errors.push(`${t.productId || 'localhost'} ${t.url}: ${r.error}`);
    }

    for (const share of this.shares()) {
      const r = await this.probeShare(share);
      const attrs = { share };
      add('', { name: 'nas.up', value: r.status === 'HEALTHY' ? 1 : 0, attributes: attrs });
      for (const [field, metric] of [['stat_ms', 'nas.stat_ms'], ['list_ms', 'nas.list_ms'], ['read_ms', 'nas.read_ms'], ['write_ms', 'nas.write_ms']]) {
        if (typeof r[field] === 'number') add('', { name: metric, value: r[field], attributes: attrs });
      }
      if (r.error) errors.push(`share ${share}: ${r.error}`);
    }

    const payload = { resourceMetrics: [] };
    for (const [productId, metrics] of byProduct) {
      const resourceAttrs = { 'host.name': this.cfg.host, 'sentinel.agent.version': AGENT_VERSION, 'sentinel.agent.os': this.cfg.os };
      if (productId) resourceAttrs['application.id'] = productId;
      payload.resourceMetrics.push(...buildOtlpPayload(metrics, resourceAttrs).resourceMetrics);
    }
    const metricCount = payload.resourceMetrics.reduce((n, rm) => n + rm.scopeMetrics[0].metrics.length, 0);

    let push = { ok: true, status: null, error: null, skipped: true };
    if (metricCount > 0) {
      push = await pushOtlpMetrics(this.cfg.otlpEndpoint, payload, {
        auth: this.cfg.otlpAuth, apiKey: this.cfg.apiKey, gatewayToken: this.cfg.gatewayToken, timeoutMs: this.cfg.timeoutMs * 2
      });
      if (!push.ok) errors.push(`OTLP push failed: ${push.error}`);
    }

    const fileEvents = await this.forwardFileEvents();
    if (!fileEvents.ok) errors.push(`file events not forwarded: ${fileEvents.error}`);

    const heartbeat = await this.sendHeartbeat(errors.length === 0 ? 'HEALTHY' : 'DEGRADED');
    if (!heartbeat.ok) errors.push(`heartbeat failed: ${heartbeat.error}`);

    this.lastCycle = { at: new Date(this.now()).toISOString(), metrics: metricCount, errors };
    return { metrics: metricCount, payload, push, fileEvents, heartbeat, errors };
  }

  // Sends the heartbeat (status, version) to Sentinel.
  async sendHeartbeat(status) {
    if (!this.cfg.sentinelUrl) return { ok: false, error: 'sentinel_url not configured' };
    try {
      const r = await httpJson('POST', `${this.cfg.sentinelUrl.replace(/\/+$/, '')}/api/v2/shipper/heartbeat`, {
        headers: this.appHeaders(),
        body: { host: this.cfg.host, agent_version: AGENT_VERSION, config_hash: this.configHash(), os: this.cfg.os, status },
        timeoutMs: this.cfg.timeoutMs * 2
      });
      return { ok: r.ok, status: r.status, error: r.ok ? null : `HTTP ${r.status}` };
    } catch (err) {
      return { ok: false, status: null, error: err.message };
    }
  }

  // Starts the probe loop.
  start() {
    const tick = async () => {
      try {
        const r = await this.runOnce();
        this.log(`cycle: ${r.metrics} metrics, ${r.errors.length} errors${r.errors.length ? ' - ' + r.errors.join('; ') : ''}`);
      } catch (err) {
        this.log(`cycle failed: ${err.message}`);
      }
      this.timer = setTimeout(tick, this.cfg.intervalSeconds * 1000);
    };
    tick();
  }

  // Stops the probe loop.
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

// Command-line options.
function parseArgs(argv) {
  const out = { config: '', once: false, writeCollectorConfig: '', role: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i] || '';
    else if (argv[i].startsWith('--config=')) out.config = argv[i].slice('--config='.length);
    else if (argv[i] === '--once') out.once = true;
    else if (argv[i] === '--write-collector-config') out.writeCollectorConfig = argv[++i] || '';
    else if (argv[i] === '--role') out.role = argv[++i] || '';
  }
  return out;
}

/** Pulls the served collector config and writes it atomically. Returns an exit code. */
async function writeCollectorConfig(runner, target) {
  const r = await runner.refreshConfig(true);
  if (!r.refreshed || !runner.hostConfig || !runner.hostConfig.config_yaml) {
    console.error(`[sentinel-probe] ${r.error || 'config pull returned no config_yaml'}; keeping the existing ${target}`);
    return fs.existsSync(target) ? 0 : 1;
  }
  const tmp = `${target}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, runner.hostConfig.config_yaml, { mode: 0o640 });
  fs.renameSync(tmp, target);
  console.log(`[sentinel-probe] wrote ${target} (config_hash ${runner.hostConfig.config_hash})`);
  return 0;
}

// Entry point: loads the config, then runs once or in a loop.
async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cfg = loadProbeConfig(args.config);
  if (!cfg.sentinelUrl) {
    console.error('[sentinel-probe] sentinel_url (or SENTINEL_APP_URL) is required.');
    return 2;
  }
  if (args.role === 'cluster') cfg.role = 'cluster';
  const runner = new ProbeRunner(cfg);
  if (args.writeCollectorConfig) return writeCollectorConfig(runner, args.writeCollectorConfig);
  if (args.once) {
    const r = await runner.runOnce();
    console.log(JSON.stringify({ metrics: r.metrics, push: r.push, heartbeat: r.heartbeat, errors: r.errors }));
    return r.errors.length === 0 ? 0 : 1;
  }
  runner.start();
  const shutdown = () => { runner.stop(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return null;
}

module.exports = {
  AGENT_VERSION,
  probeLocalHealth,
  probeNasShare,
  probeSmbShare,
  parseNtpOffset,
  parseFileNr,
  parseTcpConnections,
  probeLocalTls,
  listKeystoreEntries,
  TCP_STATE_MAP,
  buildOtlpPayload,
  pushOtlpMetrics,
  authHeaders,
  loadProbeConfig,
  parseArgs,
  writeCollectorConfig,
  ProbeRunner,
  main
};

if (require.main === module) {
  main().then(code => { if (code !== null) process.exit(code); });
}
