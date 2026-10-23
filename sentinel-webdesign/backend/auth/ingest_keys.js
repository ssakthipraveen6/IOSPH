/**
 * Ingest API keys (M1.5).
 *
 * Every telemetry push (OTLP metrics and logs, shipper heartbeat, the custom
 * metrics API) presents a key in `X-Sentinel-Api-Key` (or `Authorization: ApiKey <key>`).
 * The key decides the environment the data is stored under, so an agent cannot
 * write into prod by setting an attribute or a query parameter.
 *
 * Keys are stored only as SHA-256 hashes, from two sources:
 *   - Postgres table `ingest_api_key` (migration 010), managed with scripts/ingest_key.js
 *   - env SENTINEL_INGEST_API_KEYS = "name:env:sha256hex,name2:env:sha256hex"
 *     for hosts without a database (hashes only, never raw keys)
 *
 * Mode (env SENTINEL_INGEST_AUTH_MODE, else security.ingest.mode in global.yaml):
 *   enforce  reject pushes without a valid key (default when NODE_ENV=production)
 *   warn     accept them with the legacy environment rules and log a warning (default otherwise)
 *   off      do not check keys
 */
const crypto = require('crypto');
const postgres = require('../../database/postgres');
const yamlConfig = require('../config/yaml_config');

const ENVIRONMENTS = ['prod', 'staging'];
const POSITIVE_TTL_MS = 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 1000;
const LAST_USED_WRITE_MS = 5 * 60 * 1000;
const WARN_INTERVAL_MS = 60 * 1000;

const cache = new Map(); // hash -> { key|null, expires }
const lastUsedWritten = new Map();
let lastWarnAt = 0;

// SHA-256 of a raw key; only hashes are stored.
function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

// New random ingest key (snk_ prefix).
function generateKey() {
  return 'snk_' + crypto.randomBytes(24).toString('base64url');
}

// Ingest auth mode: enforce, warn or off (env var, then config, then enforce in production).
function mode() {
  const fromEnv = (process.env.SENTINEL_INGEST_AUTH_MODE || '').toLowerCase();
  if (['enforce', 'warn', 'off'].includes(fromEnv)) return fromEnv;
  let fromYaml;
  try {
    fromYaml = String((((yamlConfig.loadGlobalConfig() || {}).security || {}).ingest || {}).mode || '').toLowerCase();
  } catch (_) { fromYaml = ''; }
  if (['enforce', 'warn', 'off'].includes(fromYaml)) return fromYaml;
  return process.env.NODE_ENV === 'production' ? 'enforce' : 'warn';
}

// Keys supplied in SENTINEL_INGEST_API_KEYS (name:env:hash:scopes:allowedEnvs, comma separated).
function envKeys() {
  const out = new Map();
  (process.env.SENTINEL_INGEST_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean).forEach(entry => {
    const parts = entry.split(':').map(s => (s || '').trim());
    const [name, env, hash] = parts;
    const scopesRaw = parts[3];
    const allowedRaw = parts[4];
    if (name && /^[a-f0-9]{64}$/i.test(hash || '')) {
      const scopes = scopesRaw ? scopesRaw.split(';') : ['metrics', 'logs', 'heartbeat'];
      const allowedEnvironments = allowedRaw ? allowedRaw.split(';').map(e => e.toLowerCase()) : null;
      out.set(hash.toLowerCase(), {
        name,
        environment: (env || 'staging').toLowerCase(),
        scopes,
        allowed_environments: allowedEnvironments,
        source: 'env'
      });
    }
  });
  return out;
}

// Key from the X-Sentinel-Api-Key header or a Bearer token.
function extractKey(req) {
  const header = req.headers['x-sentinel-api-key'];
  if (header) return String(header).trim();
  const auth = req.headers['authorization'] || '';
  const m = /^(?:ApiKey|Api-Key)\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : null;
}

// Finds a key by hash: environment variable first, then PostgreSQL (cached).
async function lookup(hash) {
  const fromEnv = envKeys().get(hash);
  if (fromEnv) return fromEnv;

  const cached = cache.get(hash);
  if (cached && cached.expires > Date.now()) return cached.key;

  let key = null;
  try {
    const res = await postgres.query(
      'SELECT name, environment, scopes, allowed_environments FROM ingest_api_key WHERE key_hash = $1 AND revoked_at IS NULL',
      [hash]
    );
    if (res && res.rows && res.rows[0]) {
      const r = res.rows[0];
      key = {
        name: r.name,
        environment: r.environment,
        scopes: r.scopes || [],
        allowed_environments: Array.isArray(r.allowed_environments) ? r.allowed_environments : null,
        source: 'postgres'
      };
    }
  } catch (_) {
    // Database unreachable: env keys still work; do not cache the miss for long.
    cache.set(hash, { key: null, expires: Date.now() + 5000 });
    return null;
  }
  cache.set(hash, { key, expires: Date.now() + (key ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });

  if (key && (lastUsedWritten.get(hash) || 0) + LAST_USED_WRITE_MS < Date.now()) {
    lastUsedWritten.set(hash, Date.now());
    postgres.query('UPDATE ingest_api_key SET last_used_at = now() WHERE key_hash = $1', [hash]).catch(() => {});
  }
  return key;
}

// Checks the request's key and scope; returns the key's environment on success.
async function authenticate(req, scope) {
  const raw = extractKey(req);
  if (!raw) return { ok: false, reason: 'missing' };
  const key = await lookup(hashKey(raw));
  if (!key) return { ok: false, reason: 'invalid' };
  if (scope && Array.isArray(key.scopes) && key.scopes.length > 0) {
    let effectiveScopes = key.scopes;
    if (key.scopes.includes('gateway')) {
      effectiveScopes = [...effectiveScopes, 'metrics', 'logs', 'agent'];
    }
    if (key.scopes.includes('admin')) {
      effectiveScopes = [...effectiveScopes, 'metrics', 'logs', 'heartbeat', 'agent', 'gateway'];
    }
    if (!effectiveScopes.includes(scope)) {
      return { ok: false, reason: 'scope' };
    }
  }
  return { ok: true, key };
}

/**
 * Express middleware. On success sets req.ingestKey and req.ingestEnv.
 */
function requireIngestKey(scope) {
  return async (req, res, next) => {
    const currentMode = mode();
    if (currentMode === 'off') return next();
    let result;
    try {
      result = await authenticate(req, scope);
    } catch (err) {
      result = { ok: false, reason: err.message };
    }
    if (result.ok) {
      req.ingestKey = result.key;
      req.ingestEnv = result.key.environment;
      return next();
    }
    if (currentMode === 'enforce') {
      return res.status(401).json({ error: 'Valid ingest API key required (X-Sentinel-Api-Key).', reason: result.reason });
    }
    if (Date.now() - lastWarnAt > WARN_INTERVAL_MS) {
      lastWarnAt = Date.now();
      console.warn(`[INGEST AUTH] Accepting ${req.method} ${req.path} without a valid ingest key (${result.reason}); mode=warn. Set SENTINEL_INGEST_AUTH_MODE=enforce once agents have keys.`);
    }
    return next();
  };
}

// Clears the key lookup cache.
function clearCache() {
  cache.clear();
}

module.exports = { hashKey, generateKey, mode, authenticate, requireIngestKey, extractKey, clearCache, ENVIRONMENTS };
