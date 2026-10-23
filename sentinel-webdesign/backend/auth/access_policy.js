/**
 * Read access and environment entitlement policy (M1.4).
 *
 * Configured in config/global.yaml under `security:`; environment variables win.
 *
 *   security:
 *     require_auth_for_reads: true          # SENTINEL_REQUIRE_AUTH_READS
 *     public_read_paths: ['/api/ui-config']
 *     environment_entitlements:             # role -> environments it may read
 *       Viewer: [staging, demo]
 *
 * Defaults: reads require a session when NODE_ENV=production and stay open
 * otherwise, so local development and the test suites keep working. Roles not
 * listed under environment_entitlements may read every environment, and Super
 * Admin always may.
 */
const yamlConfig = require('../config/yaml_config');

// Needed before a session exists (SPA bootstrap, login, load balancer probes).
const ALWAYS_PUBLIC = new Set([
  '/api/ui-config',
  '/api/healthz',
  '/api/ping',
  '/api/auth/sso/status',
  '/api/environment'
]);

const ENVIRONMENTS = ['prod', 'staging'];

// security section of config/global.yaml (empty object when unreadable).
function securityConfig() {
  try {
    return (yamlConfig.loadGlobalConfig() || {}).security || {};
  } catch (_) {
    return {};
  }
}

// Parses 'true'/'false' strings; undefined when not set.
function parseBool(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

// True when reads need a session (SENTINEL_REQUIRE_AUTH_READS, then config, then production default).
function requiresAuthForReads() {
  const fromEnv = parseBool(process.env.SENTINEL_REQUIRE_AUTH_READS);
  if (fromEnv !== undefined) return fromEnv;
  const fromYaml = parseBool(securityConfig().require_auth_for_reads);
  if (fromYaml !== undefined) return fromYaml;
  return process.env.NODE_ENV === 'production';
}

// True for paths anyone may read (health checks and configured public paths).
function isPublicReadPath(path) {
  if (ALWAYS_PUBLIC.has(path)) return true;
  const extra = securityConfig().public_read_paths;
  return Array.isArray(extra) && extra.includes(path);
}

// Environments a user may read; Super Admin and unauthenticated internal calls get all.
function allowedEnvironments(user) {
  if (!user) return ENVIRONMENTS;
  if (user.role === 'Super Admin') return ENVIRONMENTS;
  const map = securityConfig().environment_entitlements || {};
  const list = map[user.role];
  if (!Array.isArray(list)) return ENVIRONMENTS;
  return list.map(e => String(e).toLowerCase()).filter(e => ENVIRONMENTS.includes(e));
}

// True when the user may read data of this environment.
function isEntitled(user, env) {
  return allowedEnvironments(user).includes(env);
}

module.exports = { requiresAuthForReads, isPublicReadPath, allowedEnvironments, isEntitled, ENVIRONMENTS };
