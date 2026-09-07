import React, { useState, useEffect } from 'react';
import Sparkline from '../shared/Sparkline';
import { StatusDot } from '../shared/StatusBadge';
import { SEVERITY, getStatusColor as sharedGetStatusColor, normalizeSeverity } from '@sentinel/shared-constants';

export default function HealthOverview({ healthData, historicalMetrics, onSelectComponent, activeSimulations, environment = 'staging', onInspectEntity }) {
  const { score = 100, componentStatuses = {}, alertsCount = 0, pendingApprovals = 0, uptime = '00:00:00' } = healthData;
  const [selectedFlowApp, setSelectedFlowApp] = useState('artifactory');
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState('app');
  const [showMapDetails, setShowMapDetails] = useState(true);
  const [topologyViewMode, setTopologyViewMode] = useState('servicemap'); // 'servicemap' | 'linear'
  const currentEnv = environment || healthData?.environment || 'staging';

  // ServiceNow open active incidents for assignment group "devops aps"
  const [serviceNowIncidents, setServiceNowIncidents] = useState([
    { id: 'INC0091823', priority: 'P1 - CRITICAL', short_description: 'Bitbucket git-lfs upload socket timeout on lon-bb-node-02', assignment_group: 'devops aps', state: 'Investigating', duration: '14m', assigned_to: 's.praveen', initials: 'SP', service: 'Bitbucket', component: 'bitbucket' },
    { id: 'INC0091410', priority: 'P2 - HIGH', short_description: 'JFrog Artifactory binary replication lag > 150s (NFS cache sync)', assignment_group: 'devops aps', state: 'Work in Progress', duration: '32m', assigned_to: 'm.chen', initials: 'MC', service: 'Artifactory', component: 'artifactory' },
    { id: 'INC0090884', priority: 'P2 - HIGH', short_description: 'CloudBees Jenkins build runner pod eviction warning on k8s-worker-04', assignment_group: 'devops aps', state: 'Work in Progress', duration: '48m', assigned_to: 'alex.k', initials: 'AK', service: 'Jenkins', component: 'jenkins' },
    { id: 'INC0089921', priority: 'P3 - MODERATE', short_description: 'SonarQube analysis background task queue depth threshold alert', assignment_group: 'devops aps', state: 'Open', duration: '1h 15m', assigned_to: 'j.davies', initials: 'JD', service: 'SonarQube', component: 'sonarqube' },
    { id: 'INC0088412', priority: 'P3 - MODERATE', short_description: 'OpenText Fortify SSC token renewal probe delayed response', assignment_group: 'devops aps', state: 'Resolved', duration: '2h 10m', assigned_to: 's.praveen', initials: 'SP', service: 'Fortify', component: 'fortify' }
  ]);

  useEffect(() => {
    fetch(`/api/servicenow/active-incidents?group=devops+aps&environment=${encodeURIComponent(currentEnv)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && Array.isArray(data.incidents) && data.incidents.length > 0) {
          setServiceNowIncidents(data.incidents);
        }
      })
      .catch(err => console.warn('ServiceNow active incidents sync fallback:', err));
  }, [currentEnv]);

  const getStatusColor = (status) => sharedGetStatusColor(status);

  const getStatusClass = (status) => {
    const norm = normalizeSeverity(status);
    if (norm === SEVERITY.DATA_UNAVAILABLE) return 'status-unknown';
    if (norm === SEVERITY.CRITICAL) return 'status-critical';
    if (norm === SEVERITY.WARNING || norm === SEVERITY.PREDICTIVE_WARNING) return 'status-warning';
    return 'status-healthy';
  };

  // Exact component specifications mapped from vendor suggested infrastructure layers
  // Every application features dedicated AVI Ingress VIPs and multi-node backend server clusters
  const appRegistry = {
    bitbucket: { 
      name: "Atlassian Bitbucket", 
      login: "SSO Only", 
      server: "12 Linux Servers + Regional Mirrors", 
      avi: "avi-vip-bitbucket.corp (10.240.10.50)", 
      aviShort: "bb-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "Enterprise NFS Mount",
      backendNodes: [
        "lon-bb-lnx-01..04 (EMEA Primary 4-Node Cluster)", 
        "nyc-bb-lnx-05..08 (AMER Regional Mirror 4-Node Cluster)", 
        "sgp-bb-lnx-09..12 (APAC Regional Mirror 4-Node Cluster)"
      ]
    },
    artifactory: { 
      name: "JFrog Artifactory", 
      login: "SSO and eLDAP", 
      server: "4 Linux Servers + 2 Xray Servers + AMER/APAC Mirrors", 
      avi: "avi-vip-artifactory.corp (10.240.10.51)", 
      aviShort: "arty-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "S3 Object Store + Local NVMe Cache",
      backendNodes: [
        "lon-arty-lnx-01..04 (4 Linux Primary HA Nodes)", 
        "lon-xray-srv-01..02 (2 Dedicated Xray Security Engines)", 
        "nyc-arty-mirror (AMER Regional Edge Mirror)", 
        "sgp-arty-mirror (APAC Regional Edge Mirror)"
      ]
    },
    fortify: { 
      name: "OpenText Fortify SSC", 
      login: "SSO and eLDAP", 
      server: "2 ScanCentral Controllers + 10 Sensors + Central DB", 
      avi: "avi-vip-fortify.corp (10.240.10.52)", 
      aviShort: "fort-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "NAS Mount",
      backendNodes: [
        "lon-sc-ctrl-01 (ScanCentral Controller 1)", 
        "lon-sc-ctrl-02 (ScanCentral Controller 2)", 
        "lon-sc-sensor-01..10 (10 Dynamic Scan Sensors)", 
        "lon-fort-db-01 (Dedicated SSC Central DB)"
      ]
    },
    nexusiq: { 
      name: "Sonatype NexusIQ", 
      login: "SSO and eLDAP", 
      server: "Linux Servers + Dedicated PostgreSQL DB", 
      avi: "avi-vip-nexusiq.corp (10.240.10.53)", 
      aviShort: "nx-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "NAS Mount",
      backendNodes: [
        "lon-nx-lnx-01 (Linux Server Node 1)", 
        "lon-nx-lnx-02 (Linux Server Node 2)", 
        "lon-nx-pg-cluster (Dedicated PostgreSQL Cluster)"
      ]
    },
    sonarqube: { 
      name: "SonarQube Enterprise", 
      login: "SSO and eLDAP", 
      server: "2 Enterprise Clustered Nodes", 
      avi: "avi-vip-sonarqube.corp (10.240.10.54)", 
      aviShort: "sq-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "NAS Mount",
      backendNodes: ["lon-sq-01 (10.240.20.51)", "lon-sq-02 (10.240.20.52)"]
    },
    jenkins: { 
      name: "CloudBees Jenkins", 
      login: "SSO Only", 
      server: "1 CJOC K8s + 5 Controllers K8s + 4 Agents K8s + 200 Windows Agents + 10 Linux Servers", 
      avi: "avi-vip-jenkins.corp (10.240.10.55)", 
      aviShort: "jenk-vip-01",
      cert: "URL & license validity check", 
      db: "No", 
      nas: "NAS Mount + Dynamic Workspace PVs",
      backendNodes: [
        "k8s-cjoc-ops-01 (Operations Center Master)", 
        "k8s-jenk-ctrl-01..05 (5 K8s Controllers)", 
        "k8s-jenk-agt-01..04 (4 Dynamic K8s Agents)", 
        "win-bld-agt-001..200 (200 Windows Build Agents)", 
        "lon-lnx-srv-01..10 (10 Dedicated Linux Servers)"
      ]
    },
    teamcity: { 
      name: "JetBrains TeamCity", 
      login: "SSO and eLDAP", 
      server: "5 Linux Servers + 5 Webservers + Build Agents", 
      avi: "avi-vip-teamcity.corp (10.240.10.56)", 
      aviShort: "tc-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "NAS Mount",
      backendNodes: [
        "lon-tc-lnx-01..05 (5 Linux Core Servers)", 
        "lon-tc-web-01..05 (5 Clustered Web Application Servers)", 
        "tc-build-agents-pool (Clustered Agent Farm)"
      ]
    },
    argocd: { 
      name: "ArgoCD Hub", 
      login: "SSO & eLDAP with Dax", 
      server: "Kubernetes (K8s) High-Availability Cluster", 
      avi: "avi-vip-argocd.corp (10.240.10.57)", 
      aviShort: "argo-vip-01",
      cert: "URL & license validity check", 
      db: "No", 
      nas: "No Storage (Stateless GitOps Hub)",
      backendNodes: [
        "k8s-argo-ctrl-plane-01..03 (HA Control Plane)", 
        "argocd-server-ha-01..03 (API & Web Server Pods)", 
        "argocd-repo-server-01..03 (Git Repo Sync Engines)", 
        "argocd-app-controller-01..02 (State Controllers)", 
        "argocd-redis-ha-01..03 (Redis Sentinel Cluster)"
      ]
    },
    argoworkflows: { 
      name: "Argo Workflows", 
      login: "SSO & eLDAP with Dax", 
      server: "4 K8s Controller & Server Pods", 
      avi: "avi-vip-argowf.corp (10.240.10.58)", 
      aviShort: "wf-vip-01",
      cert: "URL & license validity check", 
      db: "No", 
      nas: "No Storage",
      backendNodes: ["workflow-controller-8b4c", "argo-server-9d3f", "workflow-exec-pod-01", "workflow-exec-pod-02"]
    },
    github: { 
      name: "GitHub Enterprise", 
      login: "SSO and eLDAP", 
      server: "Kubernetes (K8s) Cluster + Windows JumpServers", 
      avi: "avi-vip-github.corp (10.240.10.59)", 
      aviShort: "ghe-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "NAS Mount",
      backendNodes: [
        "k8s-ghe-cluster-core (HA Multi-Node Workload Pods)", 
        "win-jumpsrv-01.corp (Secure Windows JumpServer / Bastion)", 
        "win-jumpsrv-02.corp (DMZ Windows JumpServer / Bastion)"
      ]
    },
    bitbucket_external: { 
      name: "Atlassian Bitbucket External", 
      login: "SSO Only", 
      server: "3 DMZ Clustered Nodes", 
      avi: "avi-dmz-bitbucket.corp (10.240.10.60)", 
      aviShort: "bb-dmz-vip",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "NAS Mount",
      backendNodes: ["dmz-bb-01 (172.16.10.11)", "dmz-bb-02 (172.16.10.12)", "dmz-bb-03 (172.16.10.13)"]
    },
    otkr: { 
      name: "OTKR Security Engine", 
      login: "SSO and eLDAP", 
      server: "2 Worker Security Nodes", 
      avi: "avi-vip-otkr.corp (10.240.10.61)", 
      aviShort: "otkr-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "NAS Mount",
      backendNodes: ["lon-otkr-01 (10.240.30.71)", "lon-otkr-02 (10.240.30.72)"]
    },
    performance_center: { 
      name: "Micro Focus Performance Center", 
      login: "SSO and eLDAP", 
      server: "3 Windows Load Controller Servers", 
      avi: "avi-vip-perfcenter.corp (10.240.10.62)", 
      aviShort: "pc-vip-01",
      cert: "URL & license validity check", 
      db: "Yes", 
      nas: "NAS Mount",
      backendNodes: ["lon-pc-ctrl-01", "lon-pc-load-01", "lon-pc-load-02"]
    }
  };

  const appKeys = {
    artifactory: 'artifactory',
    bitbucket: 'bitbucket',
    argocd: 'argocd_k8s',
    argoworkflows: 'argoworkflows_k8s',
    jenkins: 'jenkins_k8s',
    teamcity: 'teamcity',
    fortify: 'fortify',
    nexusiq: 'nexusiq',
    sonarqube: 'sonarqube',
    github: 'github',
    bitbucket_external: 'bitbucket_external',
    otkr: 'otkr',
    performance_center: 'performance_center'
  };

  const noDataDefault = (currentEnv === 'prod' || currentEnv === 'staging') ? 'DATA_UNAVAILABLE' : 'Healthy';
  const activeApp = appRegistry[selectedFlowApp] || appRegistry.artifactory;
  const appStatus = componentStatuses[appKeys[selectedFlowApp]] || noDataDefault;

  const formatStatusText = (st) => {
    if (st === 'DATA_UNAVAILABLE' || st === 'NO_DATA') return 'Value Not Available';
    return st;
  };

  // Compute status colors of adjacent infra layers based on app requirements
  const ssoStatus = componentStatuses['sso_gateway'] || noDataDefault;
  const aviStatus = componentStatuses['avi_load_balancer'] || noDataDefault;
  const dbStatus = activeApp.db === 'Yes' ? (componentStatuses['database'] || noDataDefault) : 'Inactive';
  
  let hostKey = 'linux_servers';
  if (selectedFlowApp === 'fortify' || selectedFlowApp === 'performance_center') hostKey = 'windows_servers';
  const hostStatus = componentStatuses[hostKey] || noDataDefault;
  
  let nasStatus = 'Inactive';
  if (activeApp.nas === 'NAS Mount') nasStatus = componentStatuses['nas_performance'] || noDataDefault;
  if (activeApp.nas === 'S3 Bucket') nasStatus = componentStatuses['s3_storage'] || noDataDefault;

  // Dynamic Application Telemetry Metrics (Scoped to active environment)
  const baseAppConfigs = [
    { key: 'bitbucket', name: 'Atlassian Bitbucket', category: 'Source Control / Git', endpoint: currentEnv === 'prod' ? 'git-prod.internal.corp:443' : (currentEnv === 'demo' ? 'git-demo.internal.corp:443' : 'git-stg.internal.corp:443') },
    { key: 'artifactory', name: 'JFrog Artifactory', category: 'Binary Repository', endpoint: currentEnv === 'prod' ? 'artifactory-prod.internal.corp:8081' : (currentEnv === 'demo' ? 'artifactory-demo.internal.corp:8081' : 'artifactory-stg.internal.corp:8081') },
    { key: 'jenkins', name: 'CloudBees Jenkins', category: 'CI/CD Pipelines', endpoint: currentEnv === 'prod' ? 'jenkins-prod.internal.corp:8080' : (currentEnv === 'demo' ? 'jenkins-demo.internal.corp:8080' : 'jenkins-stg.internal.corp:8080') },
    { key: 'fortify', name: 'OpenText Fortify SSC', category: 'Security Scans', endpoint: currentEnv === 'prod' ? 'fortify-prod.internal.corp:8443' : (currentEnv === 'demo' ? 'fortify-demo.internal.corp:8443' : 'fortify-stg.internal.corp:8443') },
    { key: 'sonarqube', name: 'SonarQube Enterprise', category: 'Code Quality', endpoint: currentEnv === 'prod' ? 'sonar-prod.internal.corp:9000' : (currentEnv === 'demo' ? 'sonar-demo.internal.corp:9000' : 'sonar-stg.internal.corp:9000') },
    { key: 'nexusiq', name: 'Sonatype NexusIQ', category: 'Software Supply Chain', endpoint: currentEnv === 'prod' ? 'nexus-prod.internal.corp:8083' : (currentEnv === 'demo' ? 'nexus-demo.internal.corp:8083' : 'nexus-stg.internal.corp:8083') },
    { key: 'argocd', name: 'ArgoCD Hub', category: 'GitOps CD', endpoint: currentEnv === 'prod' ? 'argo-prod.internal.corp:443' : (currentEnv === 'demo' ? 'argo-demo.internal.corp:443' : 'argo-stg.internal.corp:443') },
    { key: 'github', name: 'GitHub Enterprise', category: 'Source Control', endpoint: 'api.github.com:443' }
  ];

  const demoAppMetricsDefaults = {
    bitbucket: { latency: '24.5ms', errorRate: '0.02%', throughput: '320 req/s', saturation: '45%', status: 'healthy', spark: [22, 24, 26, 25, 28, 24, 25] },
    artifactory: { latency: '85.0ms', errorRate: '0.05%', throughput: '1.4k req/s', saturation: '68%', status: 'warn', spark: [65, 70, 78, 85, 92, 88, 85] },
    jenkins: { latency: '110.0ms', errorRate: '0.12%', throughput: '48 builds/m', saturation: '72%', status: 'healthy', spark: [80, 95, 105, 120, 115, 108, 110] },
    fortify: { latency: '42.0ms', errorRate: '0.00%', throughput: '85 scans/h', saturation: '38%', status: 'healthy', spark: [40, 42, 41, 45, 43, 42, 42] },
    sonarqube: { latency: '54.0ms', errorRate: '0.01%', throughput: '120 jobs/h', saturation: '52%', status: 'healthy', spark: [50, 52, 58, 62, 56, 53, 54] },
    nexusiq: { latency: '38.0ms', errorRate: '0.00%', throughput: '210 evals/h', saturation: '34%', status: 'healthy', spark: [35, 36, 38, 40, 39, 37, 38] },
    argocd: { latency: '18.0ms', errorRate: '0.00%', throughput: '85 syncs/m', saturation: '28%', status: 'healthy', spark: [18, 19, 17, 20, 19, 18, 18] },
    github: { latency: '32.0ms', errorRate: '0.01%', throughput: '640 req/s', saturation: '41%', status: 'healthy', spark: [30, 32, 34, 33, 35, 31, 32] }
  };

  const applicationMetrics = baseAppConfigs.map(cfg => {
    const compKey = appKeys[cfg.key] || cfg.key;
    const rawMetrics = historicalMetrics?.[compKey] || [];
    const validMetrics = rawMetrics.filter(m => 
      (!m.env || m.env === currentEnv) && 
      m.value !== 'Data Not Available' && 
      m.value !== 'Value Not Available' && 
      m.value !== null && 
      m.metricName !== 'status'
    );

    if (currentEnv === 'demo') {
      const demoDefault = demoAppMetricsDefaults[cfg.key] || { latency: '24.5ms', errorRate: '0.00%', throughput: '100 req/s', saturation: '30%', status: 'healthy', spark: [20, 22, 24, 25] };
      return { ...cfg, ...demoDefault };
    }

    // In PROD or STAGING: If no valid live telemetry for this environment, strictly return "Value Not Available"
    if (validMetrics.length === 0) {
      return {
        ...cfg,
        latency: 'Value Not Available',
        errorRate: 'Value Not Available',
        throughput: 'Value Not Available',
        saturation: 'Value Not Available',
        status: 'DATA_UNAVAILABLE',
        spark: []
      };
    }

    // Extract live values from validMetrics
    const latObj = [...validMetrics].reverse().find(m => m.metricName === 'responseTime' || m.metricName === 'latency' || m.metricName === 'avgResponseTime');
    const errObj = [...validMetrics].reverse().find(m => m.metricName === 'errorRate' || m.metricName === 'failures' || m.metricName === 'violations');
    const tputObj = [...validMetrics].reverse().find(m => m.metricName === 'throughput' || m.metricName === 'requests' || m.metricName === 'transactions');
    const satObj = [...validMetrics].reverse().find(m => m.metricName === 'saturation' || m.metricName === 'cpu' || m.metricName === 'load');

    const latencyVal = latObj ? `${parseFloat(latObj.value).toFixed(1)}ms` : 'Value Not Available';
    const errorRateVal = errObj ? `${parseFloat(errObj.value).toFixed(2)}%` : '0.00%';
    const throughputVal = tputObj ? `${parseFloat(tputObj.value).toFixed(0)} req/s` : 'Value Not Available';
    const saturationVal = satObj ? `${parseFloat(satObj.value).toFixed(0)}%` : 'Value Not Available';

    const compStatus = componentStatuses[compKey] || 'healthy';
    const sparkPoints = validMetrics.slice(-10).map(m => typeof m.value === 'number' ? m.value : parseFloat(m.value) || 0);

    return {
      ...cfg,
      latency: latencyVal,
      errorRate: errorRateVal,
      throughput: throughputVal,
      saturation: saturationVal,
      status: compStatus === 'Critical' ? 'critical' : compStatus === 'Warning' ? 'warn' : compStatus === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'healthy',
      spark: sparkPoints.length > 1 ? sparkPoints : []
    };
  });

  const renderMiniSparkline = (data, color = '#14b8a6', width = 70, height = 18) => {
    if (!data || !Array.isArray(data) || data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const step = width / (data.length - 1);
    const points = data.map((val, i) => `${i * step},${height - ((val - min) / range) * (height - 4) - 2}`).join(' ');
    return (
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        <polyline fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" points={points} />
      </svg>
    );
  };

  const openIncidentsCount = serviceNowIncidents.filter(i => i.state !== 'Resolved').length;

  return (
    <div className="health-overview-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* ==================================================================== */}
      {/* ROW 1: 5 KPI SUMMARY CARDS (Linear Minimal Top Row with Sparklines)  */}
      {/* ==================================================================== */}
      <div className="kpi-row-5">
        {/* 1. MNC Health Index with Circular SVG Gauge */}
        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-card-label">MNC Health Index</span>
            <span className={`status-pill ${score > 80 ? 'status-healthy' : 'status-warn'}`}>
              {currentEnv.toUpperCase()}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
            <svg width="44" height="44" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" className="gauge-bg" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
              <circle 
                cx="40" 
                cy="40" 
                r="34" 
                className="gauge-val" 
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                style={{
                  strokeDasharray: 213,
                  strokeDashoffset: 213 - (213 * score) / 100,
                  stroke: score > 80 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444',
                  transform: 'rotate(-90deg)',
                  transformOrigin: '50% 50%',
                  transition: 'stroke-dashoffset 0.8s ease'
                }}
              />
            </svg>
            <div>
              <div className="kpi-val-large">{score}%</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {score > 90 ? 'Nominal Fleet' : 'Degraded Services'}
              </div>
            </div>
          </div>
        </div>

        {/* 2. K8s Pod Health with Sparkline */}
        {(() => {
          const isProdOrStg = currentEnv === 'prod' || currentEnv === 'staging';
          const k8sMetrics = historicalMetrics?.['argocd_k8s'] || historicalMetrics?.['linux_servers'] || [];
          const hasK8sData = k8sMetrics.some(m => (!m.env || m.env === currentEnv) && m.value !== 'Data Not Available' && m.value !== 'Value Not Available' && m.value !== null);
          const podsAvailable = !isProdOrStg || hasK8sData;
          const k8sSpark = (!isProdOrStg) ? [38, 42, 40, 45, 43, 48, 52, 47, 44, 42, 46, 43, 42] : (hasK8sData ? k8sMetrics.slice(-10).map(m => typeof m.value === 'number' ? m.value : parseFloat(m.value) || 0) : []);

          return (
            <div className="kpi-card">
              <div className="kpi-card-header">
                <span className="kpi-card-label">K8s Cluster Pods</span>
                <span className={`status-pill ${podsAvailable ? 'status-healthy' : 'status-unknown'}`}>
                  {podsAvailable ? '42/42 Active' : 'Value Not Available'}
                </span>
              </div>
              <div className="kpi-val-wrap">
                <span className="kpi-val-large">{podsAvailable ? '100%' : 'Value Not Available'}</span>
                {podsAvailable && (
                  <span style={{ fontSize: '10.5px', color: 'var(--healthy)', fontWeight: 700 }}>● 0 crash</span>
                )}
              </div>
              <div style={{ marginTop: '4px' }}>
                {podsAvailable && k8sSpark.length > 1 ? (
                  renderMiniSparkline(k8sSpark, '#10b981', 110, 16)
                ) : (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>—</span>
                )}
              </div>
            </div>
          );
        })()}

        {/* 3. API Latency p95 with Sparkline */}
        {(() => {
          const isProdOrStg = currentEnv === 'prod' || currentEnv === 'staging';
          const validLatencies = [];
          Object.values(historicalMetrics || {}).forEach(arr => {
            if (Array.isArray(arr)) {
              arr.forEach(m => {
                if ((!m.env || m.env === currentEnv) && (m.metricName === 'responseTime' || m.metricName === 'latency' || m.metricName === 'latency_ms') && typeof m.value === 'number') {
                  validLatencies.push(m.value);
                }
              });
            }
          });

          const hasLatData = validLatencies.length > 0;
          const latAvailable = !isProdOrStg || hasLatData;
          const p95Val = hasLatData ? `${Math.round(validLatencies[validLatencies.length - 1])}ms` : '85ms';
          const avgVal = hasLatData ? `avg ${Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)}ms` : 'avg 42ms';
          const latSpark = (!isProdOrStg) ? [78, 82, 85, 80, 84, 92, 110, 88, 86, 84, 85] : (hasLatData ? validLatencies.slice(-10) : []);

          return (
            <div className="kpi-card">
              <div className="kpi-card-header">
                <span className="kpi-card-label">API Latency (p95)</span>
                {latAvailable ? (
                  <span style={{ fontSize: '10px', color: 'var(--healthy)', fontWeight: 700 }}>-4.2ms</span>
                ) : (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Value Not Available</span>
                )}
              </div>
              <div className="kpi-val-wrap">
                <span className="kpi-val-large" style={{ color: latAvailable ? 'var(--primary)' : 'var(--text-muted)' }}>
                  {latAvailable ? p95Val : 'Value Not Available'}
                </span>
                {latAvailable && (
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{avgVal}</span>
                )}
              </div>
              <div style={{ marginTop: '4px' }}>
                {latAvailable && latSpark.length > 1 ? (
                  renderMiniSparkline(latSpark, '#14b8a6', 110, 16)
                ) : (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>—</span>
                )}
              </div>
            </div>
          );
        })()}

        {/* 4. Active Alerts Breakdown - Sourced from ServiceNow for group "devops aps" */}
        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-card-label">Active Incidents</span>
            <span className={`status-pill ${openIncidentsCount > 0 ? 'status-warn' : 'status-healthy'}`}>
              {openIncidentsCount} Open
            </span>
          </div>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'baseline', marginTop: '6px' }}>
            <div>
              <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--critical)' }}>
                {serviceNowIncidents.filter(i => i.priority.includes('CRITICAL') && i.state !== 'Resolved').length}
              </span>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--critical)', marginLeft: '4px' }}>CRIT</span>
            </div>
            <div>
              <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--warning)' }}>
                {serviceNowIncidents.filter(i => !i.priority.includes('CRITICAL') && i.state !== 'Resolved').length}
              </span>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--warning)', marginLeft: '4px' }}>WARN</span>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              devops aps
            </div>
          </div>
        </div>

        {/* 5. Uptime & Pending Approvals */}
        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-card-label">Fleet Uptime</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>SLA 99.96%</span>
          </div>
          <div className="kpi-val-wrap">
            <span className="kpi-val-large" style={{ fontFamily: 'var(--font-mono)', fontSize: '18px' }}>{uptime}</span>
          </div>
          <div style={{ fontSize: '10.5px', color: pendingApprovals > 0 ? 'var(--warning)' : 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>
            {pendingApprovals > 0 ? `⚡ ${pendingApprovals} Action Awaiting Four-Eyes` : '✓ All Playbooks Synced'}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* ROW 2: SERVICE MAP — END-TO-END TOPOLOGY (NOC Interactive Canvas)    */}
      {/* ==================================================================== */}
      <div className="metrics-panel-card" style={{ padding: '1.4rem 1.5rem', marginBottom: '14px' }}>
        <div className="panel-header" style={{ marginBottom: '1.1rem', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
                SERVICE MAP — END-TO-END TOPOLOGY
              </h3>
              <span className="status-pill status-healthy" style={{ fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {activeApp.name}
              </span>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
              Live 2D branching topology mapping Identity SSO Gateway through Dedicated AVI Ingress, Clustered Compute Nodes, App Core, to Database &amp; Storage mounts.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* View Mode Switcher: 2D Service Map vs Linear Path */}
            <div style={{ display: 'flex', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)', padding: '2px' }}>
              <button
                id="btn-view-servicemap"
                onClick={() => setTopologyViewMode('servicemap')}
                style={{
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  background: topologyViewMode === 'servicemap' ? 'var(--primary-glass)' : 'transparent',
                  color: topologyViewMode === 'servicemap' ? 'var(--primary)' : 'var(--text-muted)',
                  transition: 'all 0.15s ease'
                }}
              >
                🗺️ 2D Service Map
              </button>
              <button
                id="btn-view-linear"
                onClick={() => setTopologyViewMode('linear')}
                style={{
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  background: topologyViewMode === 'linear' ? 'var(--primary-glass)' : 'transparent',
                  color: topologyViewMode === 'linear' ? 'var(--primary)' : 'var(--text-muted)',
                  transition: 'all 0.15s ease'
                }}
              >
                ⚡ Linear Path
              </button>
            </div>

            {/* Toggle Details Drawer Button */}
            <button
              id="btn-toggle-map-details"
              className="action-shortcut-btn"
              onClick={() => setShowMapDetails(prev => !prev)}
              style={{ width: 'auto', padding: '4px 12px', fontSize: '11px', borderRadius: '6px', cursor: 'pointer' }}
              title="Toggle Architecture & Backend Server Node Specs"
            >
              {showMapDetails ? '▾ Hide Details' : '▸ Show Details'}
            </button>
          </div>
        </div>

        {/* Application Selector Ribbon */}
        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.85rem' }}>
          {Object.keys(appRegistry).map(key => (
            <button
              key={key}
              onClick={() => setSelectedFlowApp(key)}
              className="nav-tab-btn"
              style={{
                width: 'auto',
                padding: '0.4rem 0.95rem',
                fontSize: '0.74rem',
                fontWeight: 700,
                borderRadius: '8px',
                background: selectedFlowApp === key ? 'linear-gradient(135deg, rgba(13, 148, 136, 0.5) 0%, rgba(6, 182, 212, 0.35) 100%)' : 'var(--bg-panel-subtle)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                color: selectedFlowApp === key ? '#ffffff' : 'var(--text-muted)',
                borderColor: selectedFlowApp === key ? 'rgba(45, 212, 191, 0.7)' : 'var(--border-light)',
                boxShadow: selectedFlowApp === key ? '0 4px 14px var(--primary-glow), inset 0 1px 0 rgba(255,255,255,0.3)' : 'none',
              }}
            >
              {appRegistry[key].name}
            </button>
          ))}
        </div>

        {/* 1. TOPOLOGY VIEW MODE: 2D Branching Service Map (Default) */}
        {topologyViewMode === 'servicemap' && (
          <div className="service-map-canvas-wrap" style={{ position: 'relative', overflowX: 'auto', padding: '24px 20px', minHeight: '175px' }}>
            
            {/* Node 1: Identity (SSO & eLDAP) */}
            <div 
              className="service-node"
              onClick={() => { setSelectedNodeKey('sso'); onSelectComponent('sso_gateway'); }}
              style={{
                border: selectedNodeKey === 'sso' ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                boxShadow: selectedNodeKey === 'sso' ? '0 0 16px var(--primary-glow)' : undefined
              }}
              title="Identity & Authentication Gateway"
            >
              <div className="node-header">
                <span>🔑 SSO &amp; eLDAP</span>
                <span className="node-status-dot" style={{ background: getStatusColor(ssoStatus) }}></span>
              </div>
              <div className="node-subtext">{activeApp.login}</div>
            </div>

            <div style={{ color: 'var(--text-muted)', fontSize: '1.2rem', padding: '0 4px', zIndex: 2 }}>➔</div>

            {/* Node 2: Dedicated AVI Ingress */}
            <div 
              className="service-node"
              onClick={() => { setSelectedNodeKey('avi'); onSelectComponent('avi_load_balancer'); }}
              style={{
                border: selectedNodeKey === 'avi' ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                boxShadow: selectedNodeKey === 'avi' ? '0 0 16px var(--primary-glow)' : undefined
              }}
              title={`Dedicated AVI Ingress VIP: ${activeApp.avi}`}
            >
              <div className="node-header">
                <span>🌐 Dedicated AVI</span>
                <span className="node-status-dot" style={{ background: getStatusColor(aviStatus) }}></span>
              </div>
              <div className="node-subtext">{activeApp.aviShort || 'bb-vip-01'}</div>
            </div>

            <div style={{ color: 'var(--text-muted)', fontSize: '1.2rem', padding: '0 4px', zIndex: 2 }}>➔</div>

            {/* Node 3: Backend Clustered Nodes */}
            <div 
              className="service-node"
              onClick={() => { setSelectedNodeKey('host'); onSelectComponent(selectedFlowApp === 'fortify' ? 'windows_servers' : 'linux_servers'); }}
              style={{
                border: selectedNodeKey === 'host' ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                boxShadow: selectedNodeKey === 'host' ? '0 0 16px var(--primary-glow)' : undefined
              }}
              title={`Clustered Backend Nodes: ${activeApp.server}`}
            >
              <div className="node-header">
                <span>⚙️ Backend Nodes</span>
                <span className="node-status-dot" style={{ background: getStatusColor(hostStatus) }}></span>
              </div>
              <div className="node-subtext" style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeApp.server}
              </div>
            </div>

            <div style={{ color: 'var(--text-muted)', fontSize: '1.2rem', padding: '0 4px', zIndex: 2 }}>➔</div>

            {/* Node 4: Application Core (Prominently Highlighted) */}
            <div 
              className="service-node"
              onClick={() => { setSelectedNodeKey('app'); onSelectComponent(appKeys[selectedFlowApp]); }}
              style={{
                border: '1.5px solid var(--primary)',
                background: 'linear-gradient(135deg, rgba(13, 148, 136, 0.25) 0%, rgba(6, 182, 212, 0.18) 100%)',
                boxShadow: '0 0 20px var(--primary-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
                padding: '12px 18px',
                minWidth: '140px'
              }}
              title={`Application Core: ${activeApp.name}`}
            >
              <div className="node-header">
                <span style={{ color: 'var(--primary)', fontWeight: 800 }}>📦 {activeApp.name.split(' ')[0]}</span>
                <span className="node-status-dot" style={{ background: getStatusColor(appStatus) }}></span>
              </div>
              <div className="node-subtext" style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                {formatStatusText(appStatus)}
              </div>
            </div>

            {/* Forking Branching Connectors to DB & Storage */}
            <div style={{ display: 'flex', alignItems: 'center', margin: '0 4px', zIndex: 2 }}>
              <svg width="45" height="95" viewBox="0 0 45 95" style={{ overflow: 'visible' }}>
                <path d="M 0 47.5 C 22 47.5, 22 22, 42 22" fill="none" stroke="rgba(56, 189, 248, 0.7)" strokeWidth="2" strokeDasharray="3,3" />
                <path d="M 0 47.5 C 22 47.5, 22 73, 42 73" fill="none" stroke="rgba(56, 189, 248, 0.7)" strokeWidth="2" strokeDasharray="3,3" />
                <circle cx="42" cy="22" r="3" fill="var(--primary)" />
                <circle cx="42" cy="73" r="3" fill="var(--primary)" />
              </svg>
            </div>

            {/* Branching Target Column: Database (Upper) & Storage (Lower) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', zIndex: 2 }}>
              {/* Upper Node: Database */}
              <div 
                className="service-node"
                onClick={() => { setSelectedNodeKey('database'); onSelectComponent('database'); }}
                style={{
                  minWidth: '135px',
                  border: selectedNodeKey === 'database' ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                  boxShadow: selectedNodeKey === 'database' ? '0 0 16px var(--primary-glow)' : undefined
                }}
                title="Database Data Store Layer"
              >
                <div className="node-header">
                  <span>🗄️ {activeApp.db === 'Yes' ? 'PostgreSQL' : 'Database'}</span>
                  <span className="node-status-dot" style={{ background: activeApp.db === 'Yes' ? getStatusColor(dbStatus) : '#94a3b8' }}></span>
                </div>
                <div className="node-subtext">
                  {activeApp.db === 'Yes' ? 'DB Connected' : 'Stateless'}
                </div>
              </div>

              {/* Lower Node: Storage */}
              <div 
                className="service-node"
                onClick={() => { setSelectedNodeKey('storage'); onSelectComponent(activeApp.nas === 'S3 Bucket' ? 's3_storage' : 'nas_performance'); }}
                style={{
                  minWidth: '135px',
                  border: selectedNodeKey === 'storage' ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                  boxShadow: selectedNodeKey === 'storage' ? '0 0 16px var(--primary-glow)' : undefined
                }}
                title="Persistent Storage Volume Mount"
              >
                <div className="node-header">
                  <span>💾 Storage</span>
                  <span className="node-status-dot" style={{ background: getStatusColor(nasStatus) }}></span>
                </div>
                <div className="node-subtext">
                  {activeApp.nas}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* 2. TOPOLOGY VIEW MODE: Linear E2E Path (Alternate Mode) */}
        {topologyViewMode === 'linear' && (
          <div style={{ overflowX: 'auto', padding: '1.25rem 0.5rem', background: 'var(--bg-panel-subtle)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderRadius: '12px', border: '1px solid var(--border-light)', marginBottom: '1.25rem', boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', minWidth: '960px', padding: '0 0.5rem', gap: '8px' }}>
              {/* 1. Identity Gateway */}
              <div 
                onClick={() => setSelectedNodeKey('sso')}
                onMouseEnter={() => setHoveredNode('sso')}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ 
                  textAlign: 'center', 
                  flex: 1, 
                  cursor: 'pointer', 
                  padding: '10px 8px', 
                  borderRadius: '10px', 
                  border: selectedNodeKey === 'sso' ? '1px solid var(--primary)' : (hoveredNode === 'sso' ? '1px solid var(--border-focus)' : '1px solid var(--border-light)'),
                  background: selectedNodeKey === 'sso' ? 'var(--primary-glass)' : (hoveredNode === 'sso' ? 'var(--bg-panel-hover)' : 'var(--bg-panel)'),
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: selectedNodeKey === 'sso' || hoveredNode === 'sso' ? 'translateY(-3px)' : 'none',
                  boxShadow: selectedNodeKey === 'sso' ? '0 8px 24px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.25)' : 'var(--glass-shadow)'
                }}
                title="Click to isolate SSO Gateway layer"
              >
                <div style={{ fontSize: '1.4rem', marginBottom: '3px' }}>🔑</div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 2px 0' }}>SSO &amp; eLDAP</h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, margin: '0 0 6px 0' }}>{activeApp.login}</p>
                <span className={`status-badge-inline ${getStatusClass(ssoStatus)}`}>{formatStatusText(ssoStatus)}</span>
              </div>

              <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 700 }}>➜</div>

              {/* 2. Dedicated AVI Ingress VIP */}
              <div 
                onClick={() => setSelectedNodeKey('avi')}
                onMouseEnter={() => setHoveredNode('avi')}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ 
                  textAlign: 'center', 
                  flex: 1, 
                  cursor: 'pointer', 
                  padding: '10px 8px', 
                  borderRadius: '10px', 
                  border: selectedNodeKey === 'avi' ? '1px solid var(--primary)' : (hoveredNode === 'avi' ? '1px solid var(--border-focus)' : '1px solid var(--border-light)'),
                  background: selectedNodeKey === 'avi' ? 'var(--primary-glass)' : (hoveredNode === 'avi' ? 'var(--bg-panel-hover)' : 'var(--bg-panel)'),
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: selectedNodeKey === 'avi' || hoveredNode === 'avi' ? 'translateY(-3px)' : 'none',
                  boxShadow: selectedNodeKey === 'avi' ? '0 8px 24px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.25)' : 'var(--glass-shadow)'
                }}
                title={`Dedicated AVI VIP: ${activeApp.avi}`}
              >
                <div style={{ fontSize: '1.4rem', marginBottom: '3px' }}>🌐</div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 2px 0' }}>Dedicated AVI</h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, margin: '0 0 6px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeApp.aviShort || activeApp.avi}</p>
                <span className={`status-badge-inline ${getStatusClass(aviStatus)}`}>{formatStatusText(aviStatus)}</span>
              </div>

              <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 700 }}>➜</div>

              {/* 3. Host Platform / Clustered Backend Nodes */}
              <div 
                onClick={() => setSelectedNodeKey('host')}
                onMouseEnter={() => setHoveredNode('host')}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ 
                  textAlign: 'center', 
                  flex: 1, 
                  cursor: 'pointer', 
                  padding: '10px 8px', 
                  borderRadius: '10px', 
                  border: selectedNodeKey === 'host' ? '1px solid var(--primary)' : (hoveredNode === 'host' ? '1px solid var(--border-focus)' : '1px solid var(--border-light)'),
                  background: selectedNodeKey === 'host' ? 'var(--primary-glass)' : (hoveredNode === 'host' ? 'var(--bg-panel-hover)' : 'var(--bg-panel)'),
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: selectedNodeKey === 'host' || hoveredNode === 'host' ? 'translateY(-3px)' : 'none',
                  boxShadow: selectedNodeKey === 'host' ? '0 8px 24px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.25)' : 'var(--glass-shadow)'
                }}
                title={`Clustered Backend Nodes: ${activeApp.server}`}
              >
                <div style={{ fontSize: '1.4rem', marginBottom: '3px' }}>⚙️</div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 2px 0' }}>Backend Nodes</h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, margin: '0 0 6px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeApp.server}</p>
                <span className={`status-badge-inline ${getStatusClass(hostStatus)}`}>{formatStatusText(hostStatus)}</span>
              </div>

              <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 700 }}>➜</div>

              {/* 4. Application Core */}
              <div 
                onClick={() => setSelectedNodeKey('app')}
                onMouseEnter={() => setHoveredNode('app')}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ 
                  textAlign: 'center', 
                  flex: 1, 
                  cursor: 'pointer', 
                  padding: '10px 8px', 
                  borderRadius: '10px', 
                  border: selectedNodeKey === 'app' ? '1px solid var(--primary)' : (hoveredNode === 'app' ? '1px solid var(--border-focus)' : '1px solid var(--border-light)'),
                  background: selectedNodeKey === 'app' ? 'linear-gradient(135deg, rgba(13, 148, 136, 0.35) 0%, rgba(6, 182, 212, 0.25) 100%)' : (hoveredNode === 'app' ? 'var(--primary-glass)' : 'var(--bg-panel)'),
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: selectedNodeKey === 'app' || hoveredNode === 'app' ? 'translateY(-3px)' : 'none',
                  boxShadow: selectedNodeKey === 'app' ? '0 8px 24px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.25)' : 'var(--glass-shadow)'
                }}
                title={`Click to isolate ${activeApp.name}`}
              >
                <div style={{ fontSize: '1.4rem', marginBottom: '3px' }}>📦</div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 2px 0' }}>{activeApp.name.split(' ')[0]}</h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, margin: '0 0 6px 0' }}>{activeApp.cert}</p>
                <span className={`status-badge-inline ${getStatusClass(appStatus)}`}>{formatStatusText(appStatus)}</span>
              </div>

              <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 700 }}>➜</div>

              {/* 5. Database */}
              <div 
                onClick={() => setSelectedNodeKey('database')}
                onMouseEnter={() => setHoveredNode('database')}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ 
                  textAlign: 'center', 
                  flex: 1, 
                  cursor: 'pointer', 
                  padding: '10px 8px', 
                  borderRadius: '10px', 
                  border: selectedNodeKey === 'database' ? '1px solid var(--primary)' : (hoveredNode === 'database' ? '1px solid var(--border-focus)' : '1px solid var(--border-light)'),
                  background: selectedNodeKey === 'database' ? 'var(--primary-glass)' : (hoveredNode === 'database' ? 'var(--bg-panel-hover)' : 'var(--bg-panel)'),
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: selectedNodeKey === 'database' || hoveredNode === 'database' ? 'translateY(-3px)' : 'none',
                  boxShadow: selectedNodeKey === 'database' ? '0 8px 24px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.25)' : 'var(--glass-shadow)'
                }}
                title="Click to isolate Database Connector layer"
              >
                <div style={{ fontSize: '1.4rem', marginBottom: '3px' }}>🗄️</div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 2px 0' }}>Database</h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, margin: '0 0 6px 0' }}>{activeApp.db === 'Yes' ? 'PostgreSQL' : 'Stateless'}</p>
                <span className={`status-badge-inline ${getStatusClass(dbStatus)}`}>{formatStatusText(dbStatus)}</span>
              </div>

              <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 700 }}>➜</div>

              {/* 6. Persistent Storage */}
              <div 
                onClick={() => setSelectedNodeKey('storage')}
                onMouseEnter={() => setHoveredNode('storage')}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ 
                  textAlign: 'center', 
                  flex: 1, 
                  cursor: 'pointer', 
                  padding: '10px 8px', 
                  borderRadius: '10px', 
                  border: selectedNodeKey === 'storage' ? '1px solid var(--primary)' : (hoveredNode === 'storage' ? '1px solid var(--border-focus)' : '1px solid var(--border-light)'),
                  background: selectedNodeKey === 'storage' ? 'var(--primary-glass)' : (hoveredNode === 'storage' ? 'var(--bg-panel-hover)' : 'var(--bg-panel)'),
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: selectedNodeKey === 'storage' || hoveredNode === 'storage' ? 'translateY(-3px)' : 'none',
                  boxShadow: selectedNodeKey === 'storage' ? '0 8px 24px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.25)' : 'var(--glass-shadow)'
                }}
                title="Click to isolate Storage Volume layer"
              >
                <div style={{ fontSize: '1.4rem', marginBottom: '3px' }}>💾</div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 2px 0' }}>Storage</h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, margin: '0 0 6px 0' }}>{activeApp.nas}</p>
                <span className={`status-badge-inline ${getStatusClass(nasStatus)}`}>{formatStatusText(nasStatus)}</span>
              </div>
            </div>
          </div>
        )}

        {/* 3. Interactive Pinpoint Root-Cause Triage Box */}
        <div style={{
          marginTop: '1.25rem',
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.75) 0%, rgba(20, 184, 166, 0.08) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--border-focus)',
          borderRadius: '10px',
          padding: '1rem 1.3rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          boxShadow: '0 8px 30px rgba(0,0,0,0.25), 0 0 16px var(--primary-glow), inset 0 1px 0 rgba(255,255,255,0.12)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '1.5rem' }}>
              {selectedNodeKey === 'sso' && '🔑'}
              {selectedNodeKey === 'avi' && '🌐'}
              {selectedNodeKey === 'host' && '⚙️'}
              {selectedNodeKey === 'app' && '📦'}
              {selectedNodeKey === 'database' && '🗄️'}
              {selectedNodeKey === 'storage' && '💾'}
            </span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h4 style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                  Isolated Tier: {selectedNodeKey === 'sso' ? 'Identity Gateway (SSO / eLDAP)' : selectedNodeKey === 'avi' ? `Ingress Controller (${activeApp.avi})` : selectedNodeKey === 'host' ? `Backend Cluster Nodes (${activeApp.server})` : selectedNodeKey === 'app' ? `${activeApp.name} Application Core` : selectedNodeKey === 'database' ? 'Relational Database Engine' : `Persistent Storage (${activeApp.nas})`}
                </h4>
                <span className="linear-status-dot dot-green"></span>
                <span style={{ fontSize: '0.72rem', color: 'var(--healthy)', fontWeight: 700 }}>Nominal</span>
              </div>
              <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '3px', margin: 0 }}>
                Tier Latency: <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                  {(() => {
                    if (currentEnv === 'demo') return '18ms';
                    const compKey = selectedNodeKey === 'sso' ? 'sso_gateway' : selectedNodeKey === 'avi' ? 'avi_load_balancer' : selectedNodeKey === 'host' ? (selectedFlowApp === 'fortify' ? 'windows_servers' : 'linux_servers') : selectedNodeKey === 'app' ? (appKeys[selectedFlowApp] || selectedFlowApp) : selectedNodeKey === 'database' ? 'database' : (activeApp.nas === 'S3 Bucket' ? 's3_storage' : 'nas_performance');
                    const compM = historicalMetrics?.[compKey] || [];
                    const latM = compM.find(m => (!m.env || m.env === currentEnv) && (m.metricName === 'responseTime' || m.metricName === 'latency' || m.metricName === 'authLatency') && typeof m.value === 'number');
                    return latM ? `${parseFloat(latM.value).toFixed(1)}ms` : 'Value Not Available';
                  })()}
                </strong> • Active Incidents: <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>0 Blockers</strong> • Dedicated Ingress VIP: <strong style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{activeApp.avi}</strong>
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => {
                if (selectedNodeKey === 'sso') onSelectComponent('sso_gateway');
                else if (selectedNodeKey === 'avi') onSelectComponent('avi_load_balancer');
                else if (selectedNodeKey === 'host') onSelectComponent(selectedFlowApp === 'fortify' ? 'windows_servers' : 'linux_servers');
                else if (selectedNodeKey === 'app') onSelectComponent(appKeys[selectedFlowApp]);
                else if (selectedNodeKey === 'database') onSelectComponent('database');
                else if (selectedNodeKey === 'storage') onSelectComponent(activeApp.nas === 'S3 Bucket' ? 's3_storage' : 'nas_performance');
              }}
              className="tab-switch-btn active"
              style={{
                padding: '0.45rem 1.15rem',
                fontSize: '0.78rem',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>🔍 View Deep Telemetry</span>
              <kbd className="linear-kbd-badge">↵</kbd>
            </button>

            {onInspectEntity && (
              <button 
                onClick={() => onInspectEntity(`app-${selectedFlowApp}`)}
                style={{
                  padding: '0.45rem 1.15rem',
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid var(--primary)',
                  borderRadius: '8px',
                  color: 'var(--primary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease'
                }}
                title="Open full entity profile in Universal Entity Explorer"
              >
                <span>🧭 Inspect in Entity Explorer</span>
              </button>
            )}
          </div>
        </div>

        {/* 4. Architecture & Clustered Backend Nodes Details Drawer */}
        {showMapDetails && (
          <div style={{
            marginTop: '1rem',
            padding: '14px 18px',
            background: 'var(--bg-panel-subtle)',
            borderRadius: '10px',
            border: '1px solid var(--border-light)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800 }}>AUTH METHOD:</span>
                <div style={{ color: 'var(--text-main)', fontWeight: 700, fontSize: '12px', marginTop: '2px' }}>{activeApp.login}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800 }}>DEDICATED AVI INGRESS VIP:</span>
                <div style={{ color: 'var(--primary)', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '12px', marginTop: '2px' }}>{activeApp.avi}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800 }}>CLUSTER ARCHITECTURE:</span>
                <div style={{ color: 'var(--text-main)', fontWeight: 700, fontSize: '12px', marginTop: '2px' }}>{activeApp.server}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800 }}>STORAGE VOLUME:</span>
                <div style={{ color: 'var(--text-main)', fontWeight: 700, fontSize: '12px', marginTop: '2px' }}>{activeApp.nas}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800 }}>CERTIFICATE &amp; LICENSE:</span>
              <span style={{ color: 'var(--healthy)', fontWeight: 700, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>✓</span> {activeApp.cert}
              </span>
            </div>

            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, marginBottom: '6px' }}>
                ACTIVE BACKEND SERVER NODES ({activeApp.backendNodes ? activeApp.backendNodes.length : 'Multi'}):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {(activeApp.backendNodes || [activeApp.server]).map((node, nIdx) => (
                  <span key={nIdx} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: '6px',
                    padding: '3px 10px',
                    fontSize: '10.5px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-main)'
                  }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--healthy)', boxShadow: '0 0 6px var(--healthy)' }}></span>
                    {node}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* ROW 3: MAIN 2-COLUMN ASYMMETRIC GRID (Linear Minimal Layout)         */}
      {/* Left Column: Active Incidents (ServiceNow for devops aps)            */}
      {/* Right Column: Application Metrics Table (Full Height)                */}
      {/* ==================================================================== */}
      <div className="overview-main-grid">
        {/* LEFT COLUMN */}
        <div className="overview-left-col">
          
          {/* Active Incidents Card - Sourced from ServiceNow for Group "devops aps" */}
          <div className="metrics-panel-card" style={{ padding: '1.1rem 1.25rem', height: '100%' }}>
            <div className="panel-header" style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '0.88rem', margin: 0 }}>Active Incidents (ServiceNow)</h3>
                <span className="panel-badge-green" style={{ fontSize: '9px', padding: '1px 6px' }}>devops aps</span>
                <span className="linear-status-dot dot-warn"></span>
              </div>
              <span className="linear-kbd-badge" style={{ cursor: 'pointer' }} title="Command Search">⌘K</span>
            </div>

            <table className="dense-table">
              <thead>
                <tr>
                  <th style={{ width: '18px' }}></th>
                  <th>ID</th>
                  <th>Priority</th>
                  <th>Summary</th>
                  <th>Component</th>
                  <th>Duration</th>
                  <th>Assignee</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {serviceNowIncidents.slice(0, 7).map((inc, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`linear-status-dot ${inc.priority.includes('CRITICAL') ? 'dot-crit' : 'dot-warn'}`}></span>
                    </td>
                    <td className="mono" style={{ color: 'var(--primary)', fontWeight: 600 }}>{inc.id}</td>
                    <td>
                      <span className={`status-pill ${inc.priority.includes('CRITICAL') ? 'status-crit' : 'status-warn'}`}>
                        {inc.priority.split(' - ')[0]}
                      </span>
                    </td>
                    <td>
                      <div className="incident-title" title={inc.short_description}>
                        {inc.short_description}
                      </div>
                    </td>
                    <td>
                      <span className="panel-badge-green" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                        {inc.component}
                      </span>
                    </td>
                    <td className="mono">{inc.duration}</td>
                    <td>
                      <div className="owner-badge">
                        <span className="avatar-mini">{inc.initials}</span>
                        <span>{inc.assigned_to}</span>
                      </div>
                    </td>
                    <td>
                      <button className="action-shortcut-btn" onClick={() => onSelectComponent('rca')} title="Investigate Root Cause">I</button>
                      <button className="action-shortcut-btn" onClick={() => onSelectComponent(inc.component || 'bitbucket')} title="View Component Metrics">M</button>
                      <button className="action-shortcut-btn" onClick={() => onSelectComponent('timeline')} title="View on Master Timeline ↗">⏱️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>

        {/* RIGHT COLUMN: Full-Height Application Metrics Table */}
        <div className="overview-right-col">
          <div className="metrics-panel-card" style={{ padding: '1.1rem 1.25rem', height: '100%' }}>
            <div className="panel-header" style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '0.88rem', margin: 0 }}>Application Metrics</h3>
                <span className="status-pill status-healthy" style={{ fontSize: '9.5px' }}>Enterprise Apps</span>
              </div>
              <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Real-time</span>
            </div>

            <table className="dense-table">
              <thead>
                <tr>
                  <th style={{ width: '18px' }}></th>
                  <th>Application</th>
                  <th>Latency (p95)</th>
                  <th>Error Rate</th>
                  <th>Throughput</th>
                  <th>Saturation</th>
                  <th style={{ width: '75px' }}>Trend</th>
                  <th style={{ width: '18px' }}></th>
                </tr>
              </thead>
              <tbody>
                {applicationMetrics.map((app, i) => (
                  <tr 
                    key={i} 
                    onClick={() => { setSelectedFlowApp(app.key); setSelectedNodeKey('app'); }}
                    style={{ cursor: 'pointer', background: selectedFlowApp === app.key ? 'rgba(20, 184, 166, 0.08)' : 'transparent' }}
                    title={`Click to inspect ${app.name} topology in Service Map`}
                  >
                    <td>
                      <StatusDot 
                        status={app.status === 'warn' ? 'warning' : app.status === 'critical' ? 'critical' : app.status === 'DATA_UNAVAILABLE' ? 'info' : 'healthy'} 
                        pulse={app.status === 'warn' || app.status === 'critical'} 
                        size={8} 
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 700, color: selectedFlowApp === app.key ? 'var(--primary)' : 'var(--text-main)', fontSize: '11.5px' }}>{app.name}</span>
                        <span className="mono" style={{ fontSize: '9.5px', color: 'var(--text-muted)' }}>{app.endpoint}</span>
                      </div>
                    </td>
                    <td className="mono" style={{ color: app.status === 'warn' ? 'var(--warning)' : app.latency === 'Value Not Available' ? 'var(--text-muted)' : 'var(--text-main)' }}>{app.latency}</td>
                    <td className="mono" style={{ color: app.errorRate === 'Value Not Available' ? 'var(--text-muted)' : 'var(--text-main)' }}>{app.errorRate}</td>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>{app.throughput}</td>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>{app.saturation}</td>
                    <td>
                      {app.spark && app.spark.length > 1 ? (
                        <Sparkline data={app.spark} color={app.status === 'warn' ? '#f59e0b' : '#14b8a6'} width={70} height={16} />
                      ) : (
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>➔</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 
        Colleague Integration Placeholder: HealthOverview
        -------------------------------------------------
        To integrate your colleague's custom module or additional dashboard widget here:
        1. Import the component (e.g., import ColleagueHealthModule from './ColleagueHealthModule';)
        2. Render it inside this container with the appropriate telemetry data props.
        
        Example:
        <div className="colleague-module-container" style={{ marginTop: '2rem', border: '1px dashed var(--border-light)', padding: '15px', borderRadius: '6px' }}>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '8px' }}>Colleague Health Module</h4>
          Example: ColleagueHealthModule component goes here
        </div>
      */}

    </div>
  );
}
