const path = require('path');
// =========================================================================
// GLOBAL CONFIGURATION MODULE: INTELLIGENT OBSERVABILITY & AUTONOMOUS RECOVERY
// =========================================================================

module.exports = {
  // TOGGLE: Set to true to run mock/simulated data collectors (for demonstration/NOC sandbox).
  // Set to false (or process.env.USE_SIMULATED_COLLECTORS=false) to initiate real HTTP API queries and database pings.
  USE_SIMULATED_COLLECTORS: process.env.USE_SIMULATED_COLLECTORS !== undefined ? process.env.USE_SIMULATED_COLLECTORS === 'true' : true,

  // Production (PROD) Environment Endpoint registry placeholders
  PROD_URLS: {
    bitbucket_api: process.env.PROD_BITBUCKET_API || "https://bitbucket-prod.internal.corp/rest/api/1.0",
    artifactory_api: process.env.PROD_ARTIFACTORY_API || "https://artifactory-prod.internal.corp/artifactory/api",
    argocd_api: process.env.PROD_ARGOCD_API || "https://argocd-prod.internal.corp/api/v1",
    argoworkflows_api: process.env.PROD_ARGOWORKFLOWS_API || "https://argo-workflows-prod.internal.corp/api/v1",
    jenkins_master_url: process.env.PROD_JENKINS_MASTER_URL || "https://jenkins-prod.internal.corp/job",
    teamcity_api: process.env.PROD_TEAMCITY_API || "https://teamcity-prod.internal.corp/app/rest",
    sonarqube_api: process.env.PROD_SONARQUBE_API || "https://sonarqube-prod.internal.corp/api",
    nexusiq_api: process.env.PROD_NEXUSIQ_API || "https://nexusiq-prod.internal.corp/api/v2",
    fortify_api: process.env.PROD_FORTIFY_API || "https://fortify-prod.internal.corp/ssc/api/v1",
    avi_api: process.env.PROD_AVI_API || "https://avi-prod.internal.corp/api/v1/telemetry",
    sso_api: process.env.PROD_SSO_API || "https://sso-auth-prod.internal.corp/oauth2/token",
    nas_mount: process.env.PROD_NAS_MOUNT || "d:\\production_shares\\nas_logs",
    windows_api: process.env.PROD_WINDOWS_API || "https://win-compute-prod.internal.corp/api/v1/metrics",
    unix_api: process.env.PROD_UNIX_API || "https://linux-compute-prod.internal.corp/api/v1/metrics",
    db_jdbc: process.env.PROD_DB_JDBC || "jdbc:postgresql://db-prod-primary.internal.corp:5432/telemetry_db",
    k8s_api: process.env.PROD_K8S_API || "https://k8s-apiserver-prod.internal.corp:6443",
    network_latency_hosts: [
      "sso-auth-prod.internal.corp",
      "avi-prod.internal.corp",
      "db-prod-primary.internal.corp"
    ],
    s3_endpoint: process.env.PROD_S3_ENDPOINT || "https://s3.us-east-1.amazonaws.com",
    bitbucket_external_api: process.env.PROD_BITBUCKET_EXTERNAL_API || "https://bitbucket-external-prod.internal.corp/rest/api/1.0",
    otkr_api: process.env.PROD_OTKR_API || "https://otkr-prod.internal.corp/api/v1",
    performance_center_api: process.env.PROD_PERFORMANCE_CENTER_API || "https://perfcenter-prod.internal.corp/api/v2",

    // Application-specific infrastructure/network layer endpoints
    applications: {
      bitbucket: {
        avi_api: "https://avi-prod-bitbucket.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-prod-bitbucket.internal.corp:5432/bitbucket_db",
        nas_mount: "d:\\production_shares\\nas_logs\\bitbucket",
        servers: [
          { node: "bitbucket-node-1", type: "linux", api: "https://linux-compute-prod-bitbucket-1.internal.corp/api/v1/metrics" },
          { node: "bitbucket-node-2", type: "linux", api: "https://linux-compute-prod-bitbucket-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.prod-bitbucket-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-prod-bitbucket.internal.corp/oauth2/token",
        network_latency_hosts: ["bitbucket-prod.internal.corp"]
      },
      jenkins_k8s: {
        avi_api: "https://avi-prod-jenkins.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-prod-jenkins.internal.corp:5432/jenkins_db",
        nas_mount: "d:\\production_shares\\nas_logs\\jenkins",
        servers: [
          { node: "jenkins-node-1", type: "linux", api: "https://linux-compute-prod-jenkins-1.internal.corp/api/v1/metrics" },
          { node: "jenkins-node-2", type: "linux", api: "https://linux-compute-prod-jenkins-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.prod-jenkins-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-prod-jenkins.internal.corp/oauth2/token",
        network_latency_hosts: ["jenkins-prod.internal.corp"]
      },
      artifactory: {
        avi_api: "https://avi-prod-artifactory.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-prod-artifactory.internal.corp:5432/artifactory_db",
        nas_mount: "d:\\production_shares\\nas_logs\\artifactory",
        servers: [
          { node: "artifactory-node-1", type: "linux", api: "https://linux-compute-prod-artifactory-1.internal.corp/api/v1/metrics" },
          { node: "artifactory-node-2", type: "linux", api: "https://linux-compute-prod-artifactory-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.prod-artifactory-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-prod-artifactory.internal.corp/oauth2/token",
        network_latency_hosts: ["artifactory-prod.internal.corp"]
      },
      nexusiq: {
        servers: [
          { node: "nexusiq-node-1", type: "linux", api: "https://linux-compute-prod-nexusiq-1.internal.corp/api/v1/metrics" },
          { node: "nexusiq-node-2", type: "linux", api: "https://linux-compute-prod-nexusiq-2.internal.corp/api/v1/metrics" }
        ],
        nas_mount: "d:\\production_shares\\nas_logs\\nexusiq",
        sso_api: "https://sso-auth-prod-nexusiq.internal.corp/oauth2/token",
        network_latency_hosts: ["nexusiq-prod.internal.corp"]
      },
      fortify: {
        servers: [
          { node: "fortify-node-1", type: "windows", api: "https://win-compute-prod-fortify-1.internal.corp/api/v1/metrics" },
          { node: "fortify-node-2", type: "windows", api: "https://win-compute-prod-fortify-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.prod-fortify-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-prod-fortify.internal.corp/oauth2/token",
        network_latency_hosts: ["fortify-prod.internal.corp"]
      },
      teamcity: {
        avi_api: "https://avi-prod-teamcity.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-prod-teamcity.internal.corp:5432/teamcity_db",
        servers: [
          { node: "teamcity-node-1", type: "linux", api: "https://linux-compute-prod-teamcity-1.internal.corp/api/v1/metrics" },
          { node: "teamcity-node-2", type: "linux", api: "https://linux-compute-prod-teamcity-2.internal.corp/api/v1/metrics" }
        ],
        nas_mount: "d:\\production_shares\\nas_logs\\teamcity",
        s3_endpoint: "https://s3.prod-teamcity-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-prod-teamcity.internal.corp/oauth2/token",
        network_latency_hosts: ["teamcity-prod.internal.corp"]
      },
      argocd_k8s: {
        avi_api: "https://avi-prod-argocd.internal.corp/api/v1/telemetry",
        servers: [
          { node: "argocd-node-1", type: "linux", api: "https://linux-compute-prod-argocd-1.internal.corp/api/v1/metrics" }
        ],
        sso_api: "https://sso-auth-prod-argocd.internal.corp/oauth2/token",
        network_latency_hosts: ["argocd-prod.internal.corp"]
      },
      mcp_server_k8s: {
        servers: [
          { node: "mcp-node-1", type: "linux", api: "https://linux-compute-prod-mcp-1.internal.corp/api/v1/metrics" }
        ],
        sso_api: "https://sso-auth-prod-mcp.internal.corp/oauth2/token",
        network_latency_hosts: ["mcp-gateway-prod.internal.corp"]
      },
      argoworkflows_k8s: {
        sso_api: "https://sso-auth-prod-argoworkflows.internal.corp/oauth2/token",
        network_latency_hosts: ["argo-workflows-prod.internal.corp"]
      },
      sonarqube: {
        sso_api: "https://sso-auth-prod-sonarqube.internal.corp/oauth2/token",
        network_latency_hosts: ["sonarqube-prod.internal.corp"]
      },
      github: {
        sso_api: "https://sso-auth-prod-github.internal.corp/oauth2/token",
        network_latency_hosts: ["github.com"]
      },
      bitbucket_external: {
        avi_api: "https://avi-prod-bitbucket-ext.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-prod-bitbucket-ext.internal.corp:5432/bitbucket_ext_db",
        nas_mount: "d:\\production_shares\\nas_logs\\bitbucket_external",
        servers: [
          { node: "bitbucket-ext-node-1", type: "linux", api: "https://linux-compute-prod-bitbucket-ext-1.internal.corp/api/v1/metrics" },
          { node: "bitbucket-ext-node-2", type: "linux", api: "https://linux-compute-prod-bitbucket-ext-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.prod-bitbucket-ext-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-prod-bitbucket-ext.internal.corp/oauth2/token",
        network_latency_hosts: ["bitbucket-external-prod.internal.corp"]
      },
      otkr: {
        avi_api: "https://avi-prod-otkr.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-prod-otkr.internal.corp:5432/otkr_db",
        nas_mount: "d:\\production_shares\\nas_logs\\otkr",
        servers: [
          { node: "otkr-node-1", type: "linux", api: "https://linux-compute-prod-otkr-1.internal.corp/api/v1/metrics" },
          { node: "otkr-node-2", type: "linux", api: "https://linux-compute-prod-otkr-2.internal.corp/api/v1/metrics" }
        ],
        sso_api: "https://sso-auth-prod-otkr.internal.corp/oauth2/token",
        network_latency_hosts: ["otkr-prod.internal.corp"]
      },
      performance_center: {
        avi_api: "https://avi-prod-perfcenter.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-prod-perfcenter.internal.corp:5432/perfcenter_db",
        nas_mount: "d:\\production_shares\\nas_logs\\performance_center",
        servers: [
          { node: "perfcenter-node-1", type: "windows", api: "https://win-compute-prod-perfcenter-1.internal.corp/api/v1/metrics" },
          { node: "perfcenter-node-2", type: "windows", api: "https://win-compute-prod-perfcenter-2.internal.corp/api/v1/metrics" }
        ],
        sso_api: "https://sso-auth-prod-perfcenter.internal.corp/oauth2/token",
        network_latency_hosts: ["perfcenter-prod.internal.corp"]
      }
    }
  },

  // Staging (STG) Environment Endpoint registry
  STG_URLS: {
    // Infrastructure
    avi_api: "https://avi-stg.internal.corp/api/v1/telemetry",
    db_jdbc: "jdbc:postgresql://db-stg-primary.internal.corp:5432/telemetry_db",
    nas_mount: path.join(__dirname, '../nas_logs'),
    linux_api: "https://linux-compute-stg.internal.corp/api/v1/metrics",
    windows_api: "https://win-compute-stg.internal.corp/api/v1/metrics",
    s3_endpoint: "https://s3.stg-us-east-1.amazonaws.com",
    bitbucket_external_api: "https://bitbucket-external-stg.internal.corp/rest/api/1.0",
    otkr_api: "https://otkr-stg.internal.corp/api/v1",
    performance_center_api: "https://perfcenter-stg.internal.corp/api/v2",

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
    jenkins_remediation_token: "jenkins_user:1120409aed82cf09ec55cf73a5a",

    // Application-specific infrastructure/network layer endpoints
    applications: {
      bitbucket: {
        avi_api: "https://avi-stg-bitbucket.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-stg-bitbucket.internal.corp:5432/bitbucket_db",
        nas_mount: path.join(__dirname, '../nas_logs/bitbucket'),
        servers: [
          { node: "bitbucket-node-1", type: "linux", api: "https://linux-compute-stg-bitbucket-1.internal.corp/api/v1/metrics" },
          { node: "bitbucket-node-2", type: "linux", api: "https://linux-compute-stg-bitbucket-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.stg-bitbucket-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-stg-bitbucket.internal.corp/oauth2/token",
        network_latency_hosts: ["bitbucket-stg.internal.corp"]
      },
      jenkins_k8s: {
        avi_api: "https://avi-stg-jenkins.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-stg-jenkins.internal.corp:5432/jenkins_db",
        nas_mount: path.join(__dirname, '../nas_logs/jenkins'),
        servers: [
          { node: "jenkins-node-1", type: "linux", api: "https://linux-compute-stg-jenkins-1.internal.corp/api/v1/metrics" },
          { node: "jenkins-node-2", type: "linux", api: "https://linux-compute-stg-jenkins-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.stg-jenkins-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-stg-jenkins.internal.corp/oauth2/token",
        network_latency_hosts: ["jenkins-stg.internal.corp"]
      },
      artifactory: {
        avi_api: "https://avi-stg-artifactory.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-stg-artifactory.internal.corp:5432/artifactory_db",
        nas_mount: path.join(__dirname, '../nas_logs/artifactory'),
        servers: [
          { node: "artifactory-node-1", type: "linux", api: "https://linux-compute-stg-artifactory-1.internal.corp/api/v1/metrics" },
          { node: "artifactory-node-2", type: "linux", api: "https://linux-compute-stg-artifactory-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.stg-artifactory-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-stg-artifactory.internal.corp/oauth2/token",
        network_latency_hosts: ["artifactory-stg.internal.corp"]
      },
      nexusiq: {
        servers: [
          { node: "nexusiq-node-1", type: "linux", api: "https://linux-compute-stg-nexusiq-1.internal.corp/api/v1/metrics" },
          { node: "nexusiq-node-2", type: "linux", api: "https://linux-compute-stg-nexusiq-2.internal.corp/api/v1/metrics" }
        ],
        nas_mount: path.join(__dirname, '../nas_logs/nexusiq'),
        sso_api: "https://sso-auth-stg-nexusiq.internal.corp/oauth2/token",
        network_latency_hosts: ["nexusiq-stg.internal.corp"]
      },
      fortify: {
        servers: [
          { node: "fortify-node-1", type: "windows", api: "https://win-compute-stg-fortify-1.internal.corp/api/v1/metrics" },
          { node: "fortify-node-2", type: "windows", api: "https://win-compute-stg-fortify-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.stg-fortify-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-stg-fortify.internal.corp/oauth2/token",
        network_latency_hosts: ["fortify-stg.internal.corp"]
      },
      teamcity: {
        avi_api: "https://avi-stg-teamcity.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-stg-teamcity.internal.corp:5432/teamcity_db",
        servers: [
          { node: "teamcity-node-1", type: "linux", api: "https://linux-compute-stg-teamcity-1.internal.corp/api/v1/metrics" },
          { node: "teamcity-node-2", type: "linux", api: "https://linux-compute-stg-teamcity-2.internal.corp/api/v1/metrics" }
        ],
        nas_mount: path.join(__dirname, '../nas_logs/teamcity'),
        s3_endpoint: "https://s3.stg-teamcity-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-stg-teamcity.internal.corp/oauth2/token",
        network_latency_hosts: ["teamcity-stg.internal.corp"]
      },
      argocd_k8s: {
        avi_api: "https://avi-stg-argocd.internal.corp/api/v1/telemetry",
        servers: [
          { node: "argocd-node-1", type: "linux", api: "https://linux-compute-stg-argocd-1.internal.corp/api/v1/metrics" }
        ],
        sso_api: "https://sso-auth-stg-argocd.internal.corp/oauth2/token",
        network_latency_hosts: ["argocd-stg.internal.corp"]
      },
      mcp_server_k8s: {
        servers: [
          { node: "mcp-node-1", type: "linux", api: "https://linux-compute-stg-mcp-1.internal.corp/api/v1/metrics" }
        ],
        sso_api: "https://sso-auth-stg-mcp.internal.corp/oauth2/token",
        network_latency_hosts: ["mcp-gateway-stg.internal.corp"]
      },
      argoworkflows_k8s: {
        sso_api: "https://sso-auth-stg-argoworkflows.internal.corp/oauth2/token",
        network_latency_hosts: ["argo-workflows-stg.internal.corp"]
      },
      sonarqube: {
        sso_api: "https://sso-auth-stg-sonarqube.internal.corp/oauth2/token",
        network_latency_hosts: ["sonarqube-stg.internal.corp"]
      },
      github: {
        sso_api: "https://sso-auth-stg-github.internal.corp/oauth2/token",
        network_latency_hosts: ["github.com"]
      },
      bitbucket_external: {
        avi_api: "https://avi-stg-bitbucket-ext.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-stg-bitbucket-ext.internal.corp:5432/bitbucket_ext_db",
        nas_mount: path.join(__dirname, '../nas_logs/bitbucket_external'),
        servers: [
          { node: "bitbucket-ext-node-1", type: "linux", api: "https://linux-compute-stg-bitbucket-ext-1.internal.corp/api/v1/metrics" },
          { node: "bitbucket-ext-node-2", type: "linux", api: "https://linux-compute-stg-bitbucket-ext-2.internal.corp/api/v1/metrics" }
        ],
        s3_endpoint: "https://s3.stg-bitbucket-ext-us-east-1.amazonaws.com",
        sso_api: "https://sso-auth-stg-bitbucket-ext.internal.corp/oauth2/token",
        network_latency_hosts: ["bitbucket-external-stg.internal.corp"]
      },
      otkr: {
        avi_api: "https://avi-stg-otkr.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-stg-otkr.internal.corp:5432/otkr_db",
        nas_mount: path.join(__dirname, '../nas_logs/otkr'),
        servers: [
          { node: "otkr-node-1", type: "linux", api: "https://linux-compute-stg-otkr-1.internal.corp/api/v1/metrics" },
          { node: "otkr-node-2", type: "linux", api: "https://linux-compute-stg-otkr-2.internal.corp/api/v1/metrics" }
        ],
        sso_api: "https://sso-auth-stg-otkr.internal.corp/oauth2/token",
        network_latency_hosts: ["otkr-stg.internal.corp"]
      },
      performance_center: {
        avi_api: "https://avi-stg-perfcenter.internal.corp/api/v1/telemetry",
        db_jdbc: "jdbc:postgresql://db-stg-perfcenter.internal.corp:5432/perfcenter_db",
        nas_mount: path.join(__dirname, '../nas_logs/performance_center'),
        servers: [
          { node: "perfcenter-node-1", type: "windows", api: "https://win-compute-stg-perfcenter-1.internal.corp/api/v1/metrics" },
          { node: "perfcenter-node-2", type: "windows", api: "https://win-compute-stg-perfcenter-2.internal.corp/api/v1/metrics" }
        ],
        sso_api: "https://sso-auth-stg-perfcenter.internal.corp/oauth2/token",
        network_latency_hosts: ["perfcenter-stg.internal.corp"]
      }
    }
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
