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

const environment = process.env.ENVIRONMENT || globalConfig.environment || 'staging';
const isProd = environment.toLowerCase() === 'production';

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
    const currentEnv = global.runtimeEnvironment || environment;
    if (currentEnv === 'prod' || currentEnv === 'production') {
      return prodUrls;
    }
    return stgUrls;
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

  isApplicationEnabled: (appKey) => {
    const apps = globalConfig.applications_enabled || {};
    if (apps[appKey] !== undefined) {
      return Boolean(apps[appKey]);
    }
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
  }
};

