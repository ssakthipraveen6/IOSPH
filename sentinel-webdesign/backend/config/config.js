/**
 * Runtime configuration derived from config/global.yaml and environment variables: active
 * environment, prod/staging URLs (with PROD_/STG_ overrides), collector mode and telemetry
 * provider.
 */
const path = require('path');
const yamlConfig = require('./yaml_config');

// =========================================================================
// YAML-BACKED GLOBAL CONFIGURATION MODULE
// Dynamically parses global_config.yaml, applications/*.yaml, infrastructure/*.yaml
// =========================================================================

const globalConfig = yamlConfig.loadGlobalConfig();
const appsConfig = yamlConfig.loadAllApplications();
const infraConfig = yamlConfig.loadAllInfrastructureLayers();

const useSimulated = process.env.USE_SIMULATED_COLLECTORS !== undefined 
  ? (process.env.USE_SIMULATED_COLLECTORS === 'true')
  : (globalConfig.use_simulated_collectors !== undefined ? Boolean(globalConfig.use_simulated_collectors) : false);

const runtimeDir = path.resolve(__dirname, '../../.runtime');
const localNasMount = path.join(runtimeDir, 'nas_logs');

// Map applications declared in YAML into the config.applications structure
const applicationsObj = {};
Object.keys(appsConfig).forEach(appId => {
  const app = appsConfig[appId];
  const l = app.layers || {};

  const aviApi = l.avi?.api || l.avi_api;
  const dbJdbc = l.db?.jdbc || l.db_jdbc;
  const nasMount = l.nfs?.mount || l.nas_mount || path.join(localNasMount, appId);
  const s3Endpoint = l.s3?.endpoint || l.s3_endpoint;
  const ssoApi = l.sso?.api || l.sso_api;
  const dockerRegistry = l.docker?.registry_api || l.docker_registry_api;
  const k8sApi = l.k8s?.api || l.k8s_api;

  let serverList = [];
  if (Array.isArray(app.servers)) {
    serverList = app.servers;
  } else if (app.servers && typeof app.servers === 'object') {
    const unixServers = (app.servers.unix || []).map(s => ({ ...s, type: 'linux' }));
    const winServers = (app.servers.windows || []).map(s => ({ ...s, type: 'windows' }));
    serverList = [...unixServers, ...winServers];
  }

  applicationsObj[appId] = {
    id: app.id || appId,
    display_name: app.display_name,
    category: app.category,
    log_tag: app.log_tag,
    endpoints: app.endpoints || {
      prod: { api: app.endpoints?.prod?.api || app.api },
      stg: { api: app.endpoints?.stg?.api || app.api }
    },
    layers: l,
    avi_api: aviApi,
    db_jdbc: dbJdbc,
    nas_mount: nasMount,
    s3_endpoint: s3Endpoint,
    sso_api: ssoApi,
    docker_registry_api: dockerRegistry,
    k8s_api: k8sApi,
    servers: serverList,
    network_latency_hosts: l.network_latency_hosts || [],
    jenkins_remediation_job: app.jenkins_remediation_job
  };
});

// [ENV-TOKEN] The rest of the system speaks exactly three tokens: prod | staging | demo.
// global.yaml historically carried "production", which silently failed every
// `=== 'prod'` comparison -- including the LDAP production guard, which then fell
// through to the staging test-user table and accepted any password. Normalise once,
// here, so no downstream comparison has to guess.
const ENV_ALIASES = {
  prod: 'prod', production: 'prod', prd: 'prod',
  staging: 'staging', stg: 'staging', stage: 'staging', 'non-prod': 'staging'
};

// Normalises any environment spelling (prod, production, stg, staging) to prod or staging.
function normalizeEnvironment(raw, source) {
  if (!raw) return 'staging';
  const key = String(raw).trim().toLowerCase();
  const resolved = ENV_ALIASES[key];
  if (!resolved) {
    console.warn(
      `[CONFIG] Unrecognised environment "${raw}" from ${source}. ` +
      `Expected one of: prod, staging. Falling back to "staging".`
    );
    return 'staging';
  }
  return resolved;
}

const rawEnvironment = process.env.ENVIRONMENT || globalConfig.environment || 'staging';
const environment = normalizeEnvironment(
  rawEnvironment,
  process.env.ENVIRONMENT ? 'ENVIRONMENT env var' : 'config/global.yaml'
);
const isProd = environment === 'prod';

const prodUrls = {
  ...(globalConfig.prod_urls || {}),
  applications: applicationsObj
};

const stgUrls = {
  ...(globalConfig.stg_urls || {}),
  nas_mount: localNasMount,
  applications: applicationsObj
};

const telemetryProvider = process.env.TELEMETRY_PROVIDER || globalConfig.telemetry_provider || 'hybrid';

module.exports = {
  normalizeEnvironment,
  ENVIRONMENT: environment,
  IS_PROD: isProd,
  USE_SIMULATED_COLLECTORS: useSimulated,
  TELEMETRY_PROVIDER: telemetryProvider.toLowerCase(),
  
  GLOBAL_YAML: globalConfig,
  APPLICATIONS_YAML: appsConfig,
  INFRASTRUCTURE_YAML: infraConfig,

  // [FIX-1] Dynamic getter — resolves at call time so runtime environment switches
  // via POST /api/environment take effect immediately for ALL collectors.
  // Previously ACTIVE_URLS was a static constant frozen at startup.
  get ACTIVE_URLS() {
    const currentEnv = global.collectorEnvironment || global.runtimeEnvironment || environment;
    const isP = (currentEnv === 'prod' || currentEnv === 'production');
    const base = isP ? prodUrls : stgUrls;
    const prefix = isP ? 'PROD' : 'STG';
    const dynamicUrls = { ...base };
    Object.keys(base).forEach(k => {
      if (typeof base[k] === 'string') {
        const prefKey = `${prefix}_${k}`.toUpperCase();
        const directKey = k.toUpperCase();
        if (process.env[prefKey]) dynamicUrls[k] = process.env[prefKey];
        else if (process.env[directKey]) dynamicUrls[k] = process.env[directKey];
      }
    });
    Object.keys(process.env).forEach(envKey => {
      if (envKey.startsWith(`${prefix}_`)) {
        const key = envKey.substring(prefix.length + 1).toLowerCase();
        dynamicUrls[key] = process.env[envKey];
      }
    });
    return dynamicUrls;
  },

  PROD_URLS: prodUrls,
  STG_URLS: stgUrls,

  POSTGRES_STG_CONFIG: globalConfig.postgres_stg_config || {
    host: "postgres-stg-srv.internal.corp",
    port: 5432,
    database: "telemetry_historical",
    user: "stg_admin"
  },

  // Granular Toggle Helper Functions
  isCollectorEnabled: (name) => {
    const colls = globalConfig.collectors || {};
    if (colls[name] && colls[name].enabled !== undefined) {
      return Boolean(colls[name].enabled);
    }
    return true;
  },

  isComponentEnabled: (compKey) => {
    const comps = globalConfig.components_enabled || {};
    if (comps[compKey] !== undefined) {
      return Boolean(comps[compKey]);
    }
    return true;
  },

  // Precedence, most specific first:
  //   1. applications_enabled.<id> in global.yaml  -- operator override, flips
  //      everything at once without touching 17 manifests
  //   2. `enabled:` in the app's own manifest      -- the app declares itself,
  //      so adding an application means adding ONE file
  //   3. true                                      -- default for older manifests
  isApplicationEnabled: (appKey) => {
    const override = (globalConfig.applications_enabled || {})[appKey];
    if (override !== undefined) return Boolean(override);

    const manifest = appsConfig[appKey];
    if (manifest && manifest.enabled !== undefined) return Boolean(manifest.enabled);

    return true;
  },

  isDynatraceEnabled: () => {
    return Boolean(globalConfig.collectors?.dynatrace?.enabled);
  },

  isPythonMetricsEnabled: () => {
    if (globalConfig.collectors?.python_metrics?.enabled !== undefined) {
      return Boolean(globalConfig.collectors.python_metrics.enabled);
    }
    return true;
  },

  isViewEnabled: (viewKey) => {
    if (!viewKey) return true;
    const views = globalConfig.views_enabled || {};
    const normalizedKey = String(viewKey).replace(/-/g, '_');
    if (views[viewKey] !== undefined) return Boolean(views[viewKey]);
    if (views[normalizedKey] !== undefined) return Boolean(views[normalizedKey]);
    return true;
  },

  isLayerEnabled: (appKey, layerKey) => {
    if (!appKey || !layerKey) return true;
    const manifest = appsConfig[appKey];
    if (manifest && manifest.layers && manifest.layers[layerKey]) {
      const layerDef = manifest.layers[layerKey];
      if (layerDef.enabled !== undefined) {
        return Boolean(layerDef.enabled);
      }
    }
    return true;
  }
};

