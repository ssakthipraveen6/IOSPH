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
 *     environment_groups:                   # group DN -> environments granted
 *       "cn=sentinel-env-prod,ou=Groups,dc=enterprise,dc=corp": [prod]
 *       "cn=sentinel-env-staging,ou=Groups,dc=enterprise,dc=corp": [staging]
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

// Union of mapped environments for memberOf DNs, or null when environment_groups is empty or absent.
function environmentsFromGroups(memberOf) {
  const groupsMap = securityConfig().environment_groups;
  if (!groupsMap || typeof groupsMap !== 'object' || Object.keys(groupsMap).length === 0) {
    return null;
  }
  const normalizedMap = new Map();
  for (const [dn, envs] of Object.entries(groupsMap)) {
    if (Array.isArray(envs)) {
      normalizedMap.set(dn.toLowerCase().trim(), envs);
    }
  }
  const granted = new Set();
  const groups = Array.isArray(memberOf) ? memberOf : [];
  for (const group of groups) {
    const key = String(group).toLowerCase().trim();
    if (normalizedMap.has(key)) {
      for (const env of normalizedMap.get(key)) {
        const clean = String(env).toLowerCase().trim();
        if (ENVIRONMENTS.includes(clean)) granted.add(clean);
      }
    }
  }
  return Array.from(granted);
}

// Decides the default environment after sign-in based on configured default and allowed environments.
function defaultEnvironment(user, configured) {
  const allowed = allowedEnvironments(user);
  if (!allowed || allowed.length === 0) return null;
  const normConfig = configured ? String(configured).toLowerCase().trim() : null;
  if (normConfig && allowed.includes(normConfig)) return normConfig;
  for (const preferred of ['prod', 'staging']) {
    if (allowed.includes(preferred)) return preferred;
  }
  return allowed[0] || null;
}

// Environments a user may read; Super Admin and unauthenticated internal calls get all.
function allowedEnvironments(user) {
  if (!user) return ENVIRONMENTS;
  if (user.role === 'Super Admin') return ENVIRONMENTS;
  if (Array.isArray(user.environments)) {
    return user.environments
      .map(e => String(e).toLowerCase().trim())
      .filter(e => ENVIRONMENTS.includes(e));
  }
  const map = securityConfig().environment_entitlements || {};
  const list = map[user.role];
  if (!Array.isArray(list)) return ENVIRONMENTS;
  return list.map(e => String(e).toLowerCase().trim()).filter(e => ENVIRONMENTS.includes(e));
}

// True when the user may read data of this environment.
function isEntitled(user, env) {
  return allowedEnvironments(user).includes(env);
}

module.exports = {
  requiresAuthForReads,
  isPublicReadPath,
  environmentsFromGroups,
  defaultEnvironment,
  allowedEnvironments,
  isEntitled,
  ENVIRONMENTS
};
