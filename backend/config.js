// =========================================================================
// GLOBAL CONFIGURATION MODULE: INTELLIGENT OBSERVABILITY & AUTONOMOUS RECOVERY
// =========================================================================

module.exports = {
  // TOGGLE: Set to true to run mock/simulated data collectors (for demonstration/NOC sandbox).
  // Set to false to initiate real HTTP API queries and database pings to staging.
  USE_SIMULATED_COLLECTORS: true,

  // Staging (STG) Environment Endpoint registry
  STG_URLS: {
    // Infrastructure
    avi_api: "https://avi-stg.internal.corp/api/v1/telemetry",
    db_jdbc: "jdbc:postgresql://db-stg-primary.internal.corp:5432/telemetry_db",
    nas_mount: "c:\\Users\\sspra\\OneDrive\\Desktop\\iosph2\\nas_logs",
    linux_api: "https://linux-compute-stg.internal.corp/api/v1/metrics",
    windows_api: "https://win-compute-stg.internal.corp/api/v1/metrics",
    s3_endpoint: "https://s3.stg-us-east-1.amazonaws.com",

    // Integrated Applications
    bitbucket_api: "https://bitbucket-stg.internal.corp/rest/api/1.0",
    artifactory_api: "https://artifactory-stg.internal.corp/artifactory/api",
    nexusiq_api: "https://nexusiq-stg.internal.corp/api/v2",
    fortify_api: "https://fortify-stg.internal.corp/ssc/api/v1",
    teamcity_api: "https://teamcity-stg.internal.corp/app/rest",
    argocd_api: "https://argocd-stg.internal.corp/api/v1",
    mcp_api: "https://mcp-gateway-stg.internal.corp/api",

    // Dynatrace OneAgent & Telemetry
    dynatrace_api_endpoint: "https://dynatrace-stg.internal.corp/api/v2/problems",
    dynatrace_api_token: "dt0c01.STG_TELEMETRY_TOKEN_VAL",

    // Fluentd / Fluent-bit
    fluentd_http_endpoint: "http://fluentd-stg.internal.corp:8888/app.logs",
    fluentd_log_path: "c:\\ProgramData\\fluentbit\\logs\\app.log",

    // Jenkins Master
    jenkins_master_url: "https://jenkins-stg.internal.corp/job",
    jenkins_remediation_token: "jenkins_user:1120409aed82cf09ec55cf73a5a"
  },

  // PostgreSQL Connection Config
  POSTGRES_STG_CONFIG: {
    host: "postgres-stg-srv.internal.corp",
    port: 5432,
    database: "telemetry_historical",
    user: "stg_admin",
    password: "STG_PASSWORD_SECURE_HASH"
  },

  // Snowflake Analytical Data Lake Config
  SNOWFLAKE_STG_CONFIG: {
    account: "corp_stg_lake.us-east-1",
    warehouse: "TELEMETRY_WH",
    database: "LAKE_DB",
    schema: "MONITORING",
    username: "STG_INGEST_USER",
    password: "STG_SF_SECURE_PASSWORD"
  }
};
