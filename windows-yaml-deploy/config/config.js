const path = require('path');
const yamlConfig = require('./yaml_config');

// =========================================================================
// YAML-BACKED GLOBAL CONFIGURATION MODULE
// Dynamically parses global_config.yaml and applications/*.yaml
// =========================================================================

const globalConfig = yamlConfig.loadGlobalConfig();
const appsConfig = yamlConfig.loadAllApplications();

const useSimulated = process.env.USE_SIMULATED_COLLECTORS !== undefined 
  ? (process.env.USE_SIMULATED_COLLECTORS === 'true')
  : (globalConfig.use_simulated_collectors !== undefined ? globalConfig.use_simulated_collectors : true);

// Map applications declared in YAML into the config.applications structure
const applicationsObj = {};
Object.keys(appsConfig).forEach(appId => {
  const app = appsConfig[appId];
  applicationsObj[appId] = {
    avi_api: app.layers ? app.layers.avi_api : undefined,
    db_jdbc: app.layers ? app.layers.db_jdbc : undefined,
    nas_mount: app.layers ? app.layers.nas_mount : path.join(__dirname, '../nas_logs', appId),
    servers: app.servers || [],
    s3_endpoint: app.layers ? app.layers.s3_endpoint : undefined,
    sso_api: app.layers ? app.layers.sso_api : undefined,
    network_latency_hosts: app.layers ? app.layers.network_latency_hosts : [],
    jenkins_remediation_job: app.jenkins_remediation_job
  };
});

module.exports = {
  USE_SIMULATED_COLLECTORS: useSimulated,
  
  // Expose parsed YAML data structures directly
  GLOBAL_YAML: globalConfig,
  APPLICATIONS_YAML: appsConfig,

  PROD_URLS: {
    ...(globalConfig.prod_urls || {}),
    applications: applicationsObj
  },

  STG_URLS: {
    ...(globalConfig.stg_urls || {}),
    nas_mount: path.join(__dirname, '../nas_logs'),
    applications: applicationsObj
  },

  POSTGRES_STG_CONFIG: globalConfig.postgres_stg_config || {
    host: "postgres-stg-srv.internal.corp",
    port: 5432,
    database: "telemetry_historical",
    user: "stg_admin",
    password: "STG_PASSWORD_SECURE_HASH"
  }
};
