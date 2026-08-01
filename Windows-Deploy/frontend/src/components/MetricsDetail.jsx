import React, { useState } from 'react';
import CustomChart from './CustomChart';

const componentMetadata = {
  // Infrastructure Layers
  sso_gateway: {
    name: 'SSO & eLDAP Gateway',
    icon: '🔑',
    desc: 'Identity provider gateway validating logins and synchronization against Active Directory LDAP directories.',
    runbooks: ['Restart directory sync daemon', 'Flush session security tokens', 'Scale auth proxy replicas']
  },
  avi_load_balancer: { 
    name: 'Ingress Routing (AVI)', 
    icon: '🌐', 
    desc: 'Ingress load balancer routing traffic across multi-cluster virtual services and API ports.',
    runbooks: ['Dynamic scaling connection threads', 'Flush connection tables', 'Activate secondary ingress gateway']
  },
  database: { 
    name: 'PostgreSQL & Snowflake DB', 
    icon: '🗄️', 
    desc: 'Relational database clusters and cold Snowflake log analytics data lake stores.',
    runbooks: ['Scale connection thread limits', 'Failover database to replica node', 'Flush memory pools']
  },
  linux_servers: { 
    name: 'Linux Compute Hosts (K8s)', 
    icon: '🐧', 
    desc: 'Linux hypervisor farm executing dockerized container clusters and OneAgent observers.',
    runbooks: ['Rolling rollout pods restart', 'Garbage Collection recycle JVM', 'Evict zombie shell threads']
  },
  windows_servers: { 
    name: 'Windows Host Clusters', 
    icon: '💻', 
    desc: 'Windows server pool hosting security scanners and background IIS processes.',
    runbooks: ['Restart Fortify scanning tasks', 'Clear IIS thread locks', 'Restart administrative IIS pool']
  },
  nas_performance: { 
    name: 'NAS Storage Volumes', 
    icon: '💾', 
    desc: 'Network Attached Storage volume shares mapping persistent log folder systems.',
    runbooks: ['Auto-purge temporary build workspaces', 'Compress daily historical logs', 'Trigger disk storage compactors']
  },
  s3_storage: { 
    name: 'Object Storage (S3)', 
    icon: '☁️', 
    desc: 'AWS S3 object storage buckets archiving project artifacts and logs.',
    runbooks: ['Switch read operations to replica CDN', 'Flush multipart uploads cache', 'Run index sync tasks']
  },
  network_latency: {
    name: 'Network Latency Probe',
    icon: '⚡',
    desc: 'TCP network latency routing checks and packet loss timings tracking.',
    runbooks: ['Reroute traffic via backup ISP', 'Clear network switch arp tables', 'Toggle packet tracer log diagnostics']
  },
  // Application Layers
  bitbucket: {
    name: 'Atlassian Bitbucket',
    icon: '📦',
    desc: 'Atlassian Bitbucket enterprise source code repository and Git management server.',
    runbooks: ['Clean Git cache indices', 'Restart VCS webhooks listener', 'Run local filesystem check']
  },
  artifactory: {
    name: 'JFrog Artifactory',
    icon: '🗃️',
    desc: 'JFrog Artifactory universal binary package registry hosting artifacts, npm, and maven targets.',
    runbooks: ['Clean storage garbage collection', 'Purge snapshot dependencies', 'Restart Artifactory system JVM']
  },
  argocd_k8s: {
    name: 'ArgoCD Hub',
    icon: '🐙',
    desc: 'ArgoCD GitOps continuous deployment controller syncing state to K8s nodes.',
    runbooks: ['Re-sync cluster credentials', 'Flush sync caches', 'Restart controller manager deployment']
  },
  argoworkflows_k8s: {
    name: 'Argo Workflows Engine',
    icon: '🔄',
    desc: 'Argo Workflows Kubernetes-native workflow engine orchestrating automation steps.',
    runbooks: ['Re-run failed workflow step', 'Flush engine queue logs', 'Restart workflow executor pods']
  },
  jenkins_k8s: {
    name: 'CloudBees Jenkins CI',
    icon: '👴',
    desc: 'CloudBees Jenkins Enterprise build automation master controller.',
    runbooks: ['Clear build queues', 'Kill orphaned executor nodes', 'Restart master build instance']
  },
  teamcity: {
    name: 'JetBrains TeamCity',
    icon: '🏗️',
    desc: 'JetBrains TeamCity continuous integration build agent cluster farm.',
    runbooks: ['Restart build agent daemon', 'Clean work cache folder', 'Re-register build agent node']
  },
  sonarqube: {
    name: 'SonarQube Enterprise',
    icon: '🔍',
    desc: 'SonarQube continuous code quality and static security vulnerability analysis engine.',
    runbooks: ['Recycle scan indices', 'Purge old scanning reports', 'Restart Sonar JVM host']
  },
  nexusiq: {
    name: 'Sonatype NexusIQ',
    icon: '🛡️',
    desc: 'Sonatype NexusIQ open-source vulnerability audit and software supply chain policy scanner.',
    runbooks: ['Flush index database pool', 'Re-index vulnerability feeds', 'Recycle NexusIQ service']
  },
  fortify: {
    name: 'OpenText Fortify SSC',
    icon: '🔒',
    desc: 'OpenText / Micro Focus Fortify Software Security Center (SSC) SAST audit engine.',
    runbooks: ['Kill blocked scanning runs', 'Flush result buffer queues', 'Restart Fortify server pool']
  },
  github: {
    name: 'GitHub Enterprise',
    icon: '🐈',
    desc: 'GitHub Enterprise source code repository access portal and Actions runner pool.',
    runbooks: ['Flush credentials sync pool', 'Re-run webhook triggers', 'Toggle failover mirror replica']
  },
  bitbucket_external: {
    name: 'Atlassian Bitbucket External',
    icon: '🌍',
    desc: 'Atlassian Bitbucket external-facing repository instance for partner federation.',
    runbooks: ['Purge external cache indices', 'Restart federation sync daemon', 'Rotate external access tokens']
  },
  otkr: {
    name: 'OTKR Security Engine',
    icon: '🔐',
    desc: 'OTKR Operational Vulnerability & Compliance security scanning engine.',
    runbooks: ['Re-index vulnerability database', 'Flush scan result queue', 'Restart OTKR scan engine']
  },
  performance_center: {
    name: 'Micro Focus Performance Center',
    icon: '📊',
    desc: 'Micro Focus LoadRunner Performance Center enterprise load testing platform.',
    runbooks: ['Clear test execution queue', 'Restart load generator agents', 'Flush test results cache']
  }
};

const appRegistry = {
  artifactory: { key: "artifactory", name: "JFrog Artifactory", login: "SSO and eLDAP", cert: "URL & license validity", nas: "S3 Bucket", db: "Yes", activeSessions: 840, latency: "85ms" },
  bitbucket: { key: "bitbucket", name: "Atlassian Bitbucket", login: "SSO Only", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 1420, latency: "95ms" },
  argocd_k8s: { key: "argocd_k8s", name: "ArgoCD Hub", login: "SSO & eLDAP with Dax", cert: "URL & license validity", nas: "No Storage", db: "No", activeSessions: 220, latency: "55ms" },
  argoworkflows_k8s: { key: "argoworkflows_k8s", name: "Argo Workflows", login: "SSO & eLDAP with Dax", cert: "URL & license validity", nas: "No Storage", db: "No", activeSessions: 150, latency: "70ms" },
  jenkins_k8s: { key: "jenkins_k8s", name: "CloudBees Jenkins", login: "SSO Only", cert: "URL & license validity", nas: "NAS Mount", db: "No", activeSessions: 650, latency: "110ms" },
  teamcity: { key: "teamcity", name: "JetBrains TeamCity", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 480, latency: "120ms" },
  fortify: { key: "fortify", name: "OpenText Fortify SSC", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 90, latency: "125ms" },
  nexusiq: { key: "nexusiq", name: "Sonatype NexusIQ", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 180, latency: "105ms" },
  sonarqube: { key: "sonarqube", name: "SonarQube Enterprise", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 520, latency: "115ms" },
  github: { key: "github", name: "GitHub Enterprise", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Unknown", activeSessions: 2450, latency: "110ms" },
  bitbucket_external: { key: "bitbucket_external", name: "Atlassian Bitbucket External", login: "SSO Only", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 680, latency: "95ms" },
  otkr: { key: "otkr", name: "OTKR Security Engine", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 120, latency: "160ms" },
  performance_center: { key: "performance_center", name: "Micro Focus Performance Center", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 340, latency: "130ms" }
};

export default function MetricsDetail({ selectedComponent, onComponentChange, historicalMetrics, healthData }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedFlowApp, setSelectedFlowApp] = useState('artifactory');
  const [infraViewMode, setInfraViewMode] = useState('comparative');

  const compMeta = componentMetadata[selectedComponent] || componentMetadata.database;
  const status = healthData.componentStatuses[selectedComponent] || 'Healthy';
  const componentMetrics = historicalMetrics[selectedComponent] || [];

  // Helper to retrieve latest metric value with fallback
  const getLatestMetricValue = (metricsArray, metricName, defaultValue) => {
    if (!metricsArray || metricsArray.length === 0) return defaultValue;
    const matching = metricsArray.filter(m => m.metricName === metricName);
    if (matching.length > 0) {
      return matching[matching.length - 1].value;
    }
    return defaultValue;
  };

  // Helper to generate fallback points for smooth charts
  const generateFallbackPoints = (metricName) => {
    const fallbackPoints = [];
    const now = Date.now();
    const rangeHours = timeRange === '1h' ? 1 : timeRange === '6h' ? 6 : 24;
    const step = (rangeHours * 60 * 60 * 1000) / 20;

    let baseVal = 45;
    if (metricName.includes('cpu')) baseVal = 22;
    if (metricName.includes('mem')) baseVal = 18;
    if (metricName.includes('space') || metricName.includes('spaceUsed')) baseVal = 320;
    if (metricName.includes('iops')) baseVal = 420;
    if (metricName.includes('flow') || metricName.includes('ingressFlow')) baseVal = 24;
    if (metricName.includes('connections')) baseVal = 65;

    for (let i = 20; i >= 0; i--) {
      const time = now - i * step;
      const noise = (Math.random() - 0.5) * (baseVal * 0.1);
      fallbackPoints.push({
        timestamp: new Date(time).toISOString(),
        value: parseFloat(Math.max(0, baseVal + noise).toFixed(2))
      });
    }
    return fallbackPoints;
  };

  // Generate historical metric lines
  const getActiveMetrics = (comp = selectedComponent) => {
    const rawData = historicalMetrics[comp] || [];
    if (rawData && rawData.length > 0) {
      return rawData;
    }

    const fallbackMetrics = [];
    const now = Date.now();
    const rangeHours = timeRange === '1h' ? 1 : timeRange === '6h' ? 6 : 24;
    const intervalsCount = 20;
    const step = (rangeHours * 60 * 60 * 1000) / intervalsCount;

    const metricNamesMap = {
      sso_gateway: ['authLatency', 'activeSessions', 'failedAuthentications'],
      avi_load_balancer: ['connections', 'ingressFlow', 'throughput', 'bitbucket_ingressFlow', 'artifactory_ingressFlow', 'jenkins_ingressFlow', 'argocd_ingressFlow', 'bitbucket_external_ingressFlow', 'otkr_ingressFlow', 'performance_center_ingressFlow'],
      database: ['cpu', 'memory', 'transactions', 'iops', 'bitbucket_connections', 'artifactory_connections', 'jenkins_connections', 'teamcity_connections', 'bitbucket_external_connections', 'otkr_connections', 'performance_center_connections'],
      linux_servers: ['cpu', 'memory', 'load', 'bitbucket_cpu', 'artifactory_cpu', 'jenkins_cpu', 'teamcity_cpu', 'nexusiq_cpu', 'bitbucket_external_cpu', 'otkr_cpu'],
      windows_servers: ['cpu', 'memory', 'disk', 'fortify_cpu', 'fortify_mem', 'performance_center_cpu', 'performance_center_mem', 'iis_threads', 'iis_sessions'],
      nas_performance: ['iops', 'throughput', 'spaceUsed', 'bitbucket_spaceUsed', 'artifactory_spaceUsed', 'jenkins_spaceUsed', 'teamcity_spaceUsed', 'nexusiq_spaceUsed', 'bitbucket_external_spaceUsed', 'otkr_spaceUsed', 'performance_center_spaceUsed'],
      s3_storage: ['latency', 'space', 'bandwidth', 'bitbucket_space', 'artifactory_space', 'jenkins_space', 'teamcity_space', 'fortify_space', 'bitbucket_external_space'],
      network_latency: ['packetLoss', 'latency_ms', 'jitter'],
      bitbucket: ['responseTime', 'successRate', 'requests'],
      artifactory: ['heap', 'space', 'latency'],
      argocd_k8s: ['latency', 'clusterCount'],
      argoworkflows_k8s: ['activeWorkflows', 'failedWorkflows', 'responseTime'],
      jenkins_k8s: ['executors', 'queue', 'responseTime'],
      teamcity: ['activeBuilds', 'agents', 'load'],
      sonarqube: ['analysisQueue', 'responseTime'],
      nexusiq: ['scanQueue', 'violations', 'responseTime'],
      fortify: ['scanQueue', 'cpu', 'failures'],
      github: ['apiRateLimitRemaining', 'pendingPullRequests', 'responseTime'],
      bitbucket_external: ['responseTime', 'successRate', 'requests'],
      otkr: ['scanQueue', 'findings', 'responseTime'],
      performance_center: ['activeTests', 'avgResponseTime', 'throughput']
    };

    const targetNames = metricNamesMap[comp] || ['cpu', 'memory', 'load'];

    targetNames.forEach(mName => {
      let baseVal = 50;
      if (mName.includes('cpu')) baseVal = 20;
      if (mName.includes('mem') || mName.includes('heap')) baseVal = 35;
      if (mName.includes('latency') || mName.includes('Time') || mName.includes('responseTime')) baseVal = 45;
      if (mName.includes('connections')) baseVal = 1200;
      if (mName.includes('ingressFlow') || mName.includes('throughput') || mName.includes('bandwidth')) baseVal = 180;
      if (mName.includes('successRate')) baseVal = 99.8;
      if (mName.includes('transactions') || mName.includes('iops')) baseVal = 650;

      for (let i = intervalsCount; i >= 0; i--) {
        const time = now - i * step;
        const noise = (Math.random() - 0.5) * (baseVal * 0.1);
        fallbackMetrics.push({
          timestamp: new Date(time).toISOString(),
          component: comp,
          metricName: mName,
          value: parseFloat(Math.max(0, baseVal + noise).toFixed(2))
        });
      }
    });

    return fallbackMetrics;
  };

  const activeMetrics = getActiveMetrics();

  const getAppDataset = (metricsArray, label, metricName, color) => {
    const points = metricsArray
      .filter(m => m.metricName === metricName)
      .map(m => ({ timestamp: m.timestamp, value: m.value }));
    return { label, points, color };
  };

  const getStatusBadgeColor = (st) => {
    if (st === 'Critical') return '#ef4444';
    if (st === 'Warning') return '#f59e0b';
    return '#0d9488';
  };

  const handleManualRunbookTrigger = async (runbookName) => {
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: selectedComponent, type: 'outage' })
      });
      if (res.ok) {
        alert(`[SENTINEL AGENT] Triggered simulated outage. Running runbook: "${runbookName}"`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownloadCSV = () => {
    if (activeMetrics.length === 0) return;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Timestamp,Component,Metric Name,Value\n";
    
    activeMetrics.forEach(m => {
      csvContent += `${m.timestamp},${m.component},${m.metricName},${m.value}\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${selectedComponent}_metrics_${timeRange}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Check selector layout grouping
  const isInfraLayer = ['sso_gateway', 'avi_load_balancer', 'database', 'linux_servers', 'windows_servers', 'nas_performance', 's3_storage', 'network_latency'].includes(selectedComponent);
  const isApp = !isInfraLayer;

  // Render comparative view for all Infrastructure & Network Layer Components
  const renderInfraComparativeView = () => {
    const infraKey = selectedComponent;
    const infraMetrics = getActiveMetrics(infraKey);

    // Configuration map for every Infrastructure/Network component
    const infraConfigs = {
      sso_gateway: {
        title: "🔑 SSO Identity & Authentication Metrics Across Applications",
        badge: "13 Registered Applications",
        unit: "ms",
        chartTitle: "SSO Authentication Response Time by Application (ms)",
        chartDatasets: [
          { label: 'JFrog Artifactory SSO', compKey: 'artifactory', metricName: 'latency', color: '#3b82f6' },
          { label: 'Bitbucket Server SSO', compKey: 'bitbucket', metricName: 'responseTime', color: '#ec4899' },
          { label: 'CloudBees Jenkins SSO', compKey: 'jenkins_k8s', metricName: 'responseTime', color: '#f59e0b' },
          { label: 'GitHub Enterprise SSO', compKey: 'github', metricName: 'responseTime', color: '#10b981' },
          { label: 'Bitbucket External SSO', compKey: 'bitbucket_external', metricName: 'responseTime', color: '#8b5cf6' },
          { label: 'OTKR Security Scanner SSO', compKey: 'otkr', metricName: 'responseTime', color: '#06b6d4' },
          { label: 'Performance Center SSO', compKey: 'performance_center', metricName: 'avgResponseTime', color: '#e11d48' }
        ],
        tableTitle: "👥 SSO Application Integration Matrix",
        columns: ["Application Name", "Auth Protocol", "AD eLDAP Group Mapping", "Active Sessions", "Sync Latency", "Status"],
        getRowData: (app) => ({
          col1: app.login,
          col2: `cn=sentinel-auth-${app.key}-users,dn=mnc,dn=corp`,
          col3: `${app.activeSessions} sessions`,
          col4: app.latency,
          statusText: (healthData.componentStatuses[app.key] || 'Healthy') === 'Healthy' ? 'CONNECTED' : 'DEGRADED',
          statusClass: (healthData.componentStatuses[app.key] || 'Healthy') === 'Healthy' ? 'status-healthy' : 'status-critical'
        })
      },
      avi_load_balancer: {
        title: "🌐 AVI Ingress Routing & Traffic Flow Across Applications",
        badge: "Multi-Cluster Virtual Services",
        unit: "MB/s",
        chartTitle: "Ingress Traffic Flow Rate by Application (MB/s)",
        chartDatasets: [
          { label: 'Bitbucket Ingress', metricName: 'bitbucket_ingressFlow', color: '#ec4899' },
          { label: 'Artifactory Ingress', metricName: 'artifactory_ingressFlow', color: '#3b82f6' },
          { label: 'Jenkins Ingress', metricName: 'jenkins_ingressFlow', color: '#f59e0b' },
          { label: 'Bitbucket External Ingress', metricName: 'bitbucket_external_ingressFlow', color: '#10b981' },
          { label: 'OTKR Security Ingress', metricName: 'otkr_ingressFlow', color: '#8b5cf6' },
          { label: 'Performance Center Ingress', metricName: 'performance_center_ingressFlow', color: '#06b6d4' }
        ],
        tableTitle: "🌐 AVI Ingress & Virtual Service Routing Matrix",
        columns: ["Application Name", "Virtual Service VIP", "Listener Port", "Ingress Flow", "Routing Latency", "SSL Cert", "VIP Health"],
        getRowData: (app) => {
          const flow = getLatestMetricValue(infraMetrics, `${app.key}_ingressFlow`, 14.5);
          const lat = getLatestMetricValue(infraMetrics, `${app.key}_latency`, 45.0);
          return {
            col1: `vip-${app.key}.internal.corp`,
            col2: app.port || '443',
            col3: `${parseFloat(flow).toFixed(1)} MB/s`,
            col4: `${parseFloat(lat).toFixed(0)} ms`,
            col5: 'Valid (TLS 1.3)',
            statusText: 'UP / HEALTHY',
            statusClass: 'status-healthy'
          };
        }
      },
      database: {
        title: "🗄️ Database Connection Pools & Transaction Performance Across Applications",
        badge: "PostgreSQL & Snowflake Pools",
        unit: "conns",
        chartTitle: "Active DB Connections by Application",
        chartDatasets: [
          { label: 'Artifactory DB Conns', metricName: 'artifactory_connections', color: '#3b82f6' },
          { label: 'Bitbucket DB Conns', metricName: 'bitbucket_connections', color: '#ec4899' },
          { label: 'TeamCity DB Conns', metricName: 'teamcity_connections', color: '#f59e0b' },
          { label: 'Bitbucket External Conns', metricName: 'bitbucket_external_connections', color: '#10b981' },
          { label: 'OTKR DB Conns', metricName: 'otkr_connections', color: '#8b5cf6' },
          { label: 'Performance Center Conns', metricName: 'performance_center_connections', color: '#06b6d4' }
        ],
        tableTitle: "🗄️ Database Application Connection Matrix",
        columns: ["Application Name", "Target DB / Schema", "JDBC Connection Endpoint", "Active Connections", "TPS", "Query Latency", "Pool Status"],
        getRowData: (app) => {
          const isDb = app.db === 'Yes';
          const conns = isDb ? getLatestMetricValue(infraMetrics, `${app.key}_connections`, 38) : 0;
          const tps = isDb ? getLatestMetricValue(infraMetrics, `${app.key}_tps`, 115) : 0;
          const lat = isDb ? getLatestMetricValue(infraMetrics, `${app.key}_dbLatency`, 14.2) : 0;
          return {
            col1: `db_${app.key}_prod`,
            col2: `jdbc:postgresql://db-prod-${app.key}.internal.corp:5432/${app.key}_db`,
            col3: `${parseInt(conns)} conns`,
            col4: `${parseInt(tps)} tps`,
            col5: isDb ? `${parseFloat(lat).toFixed(1)} ms` : 'N/A',
            statusText: isDb ? 'ACTIVE' : 'INACTIVE',
            statusClass: isDb ? 'status-healthy' : 'status-warning'
          };
        }
      },
      linux_servers: {
        title: "🐧 Linux Compute Host Resource Allocation Across Applications",
        badge: "RHEL & K8s Hypervisors",
        unit: "%",
        chartTitle: "CPU Allocation Rate by Application (%)",
        chartDatasets: [
          { label: 'Artifactory CPU', metricName: 'artifactory_cpu', color: '#3b82f6' },
          { label: 'Jenkins CPU', metricName: 'jenkins_cpu', color: '#f59e0b' },
          { label: 'Bitbucket CPU', metricName: 'bitbucket_cpu', color: '#ec4899' },
          { label: 'TeamCity CPU', metricName: 'teamcity_cpu', color: '#8b5cf6' },
          { label: 'Bitbucket External CPU', metricName: 'bitbucket_external_cpu', color: '#10b981' },
          { label: 'OTKR CPU', metricName: 'otkr_cpu', color: '#06b6d4' }
        ],
        tableTitle: "🐧 Linux Compute Load Matrix",
        columns: ["Application Name", "Host Node / Cluster", "OS Environment", "Allocated CPU (%)", "Memory Usage (GB)", "Thread Count", "Node Status"],
        getRowData: (app) => {
          const isWin = app.key === 'fortify' || app.key === 'performance_center';
          const cpu = getLatestMetricValue(infraMetrics, `${app.key}_cpu`, isWin ? 5.2 : 18.4);
          const mem = getLatestMetricValue(infraMetrics, `${app.key}_mem`, isWin ? 2.1 : 8.5);
          return {
            col1: `${app.key}-linux-node.internal.corp`,
            col2: app.server || 'RHEL VM',
            col3: `${parseFloat(cpu).toFixed(1)}%`,
            col4: `${parseFloat(mem).toFixed(1)} GB`,
            col5: `142 threads`,
            statusText: 'ONLINE',
            statusClass: 'status-healthy'
          };
        }
      },
      windows_servers: {
        title: "💻 Windows Compute Host & IIS Application Pool Metrics",
        badge: "Windows Server 2022 Clusters",
        unit: "%",
        chartTitle: "Windows Host CPU & Memory Utilization (%)",
        chartDatasets: [
          { label: 'Fortify SSC CPU', metricName: 'fortify_cpu', color: '#3b82f6' },
          { label: 'Fortify SSC Memory', metricName: 'fortify_mem', color: '#ec4899' },
          { label: 'Performance Center CPU', metricName: 'performance_center_cpu', color: '#10b981' },
          { label: 'Performance Center Memory', metricName: 'performance_center_mem', color: '#06b6d4' }
        ],
        tableTitle: "💻 Windows Host Allocation Matrix",
        columns: ["Application Name", "IIS Pool / Host Node", "Service Module", "Allocated CPU (%)", "Memory Usage (GB)", "IIS Sessions", "Host Status"],
        getRowData: (app) => {
          const isWinApp = app.key === 'fortify' || app.key === 'performance_center';
          const cpu = getLatestMetricValue(infraMetrics, `${app.key}_cpu`, isWinApp ? 22.4 : 4.2);
          const mem = getLatestMetricValue(infraMetrics, `${app.key}_mem`, isWinApp ? 30.2 : 3.8);
          return {
            col1: `${app.key}-win-node.internal.corp`,
            col2: isWinApp ? 'Primary Windows App Host' : 'IIS Proxy Forwarder',
            col3: `${parseFloat(cpu).toFixed(1)}%`,
            col4: `${parseFloat(mem).toFixed(1)} GB`,
            col5: isWinApp ? '1420 active' : 'N/A',
            statusText: 'ONLINE',
            statusClass: 'status-healthy'
          };
        }
      },
      nas_performance: {
        title: "💾 NAS Storage Volume Space & IOPS Across Applications",
        badge: "NFS / SMB Shares",
        unit: "GB",
        chartTitle: "NAS Disk Space Used by Application (GB)",
        chartDatasets: [
          { label: 'Artifactory NAS Space', metricName: 'artifactory_spaceUsed', color: '#3b82f6' },
          { label: 'Bitbucket NAS Space', metricName: 'bitbucket_spaceUsed', color: '#ec4899' },
          { label: 'Jenkins NAS Space', metricName: 'jenkins_spaceUsed', color: '#f59e0b' },
          { label: 'TeamCity NAS Space', metricName: 'teamcity_spaceUsed', color: '#8b5cf6' },
          { label: 'Bitbucket External Space', metricName: 'bitbucket_external_spaceUsed', color: '#10b981' },
          { label: 'OTKR NAS Space', metricName: 'otkr_spaceUsed', color: '#06b6d4' },
          { label: 'Performance Center Space', metricName: 'performance_center_spaceUsed', color: '#e11d48' }
        ],
        tableTitle: "💾 NAS Storage Mount Matrix",
        columns: ["Application Name", "NAS Mount Share Path", "Protocol", "Space Used (GB)", "Active IOPS", "Throughput", "Mount Status"],
        getRowData: (app) => {
          const hasNas = app.nas === 'NAS Mount';
          const space = getLatestMetricValue(infraMetrics, `${app.key}_spaceUsed`, hasNas ? 15.4 : 1.2);
          const iops = getLatestMetricValue(infraMetrics, `${app.key}_iops`, hasNas ? 115 : 8);
          return {
            col1: `d:\\production_shares\\nas_logs\\${app.key}`,
            col2: 'NFS v4.1',
            col3: `${parseFloat(space).toFixed(1)} GB`,
            col4: `${parseInt(iops)} IOPS`,
            col5: '45 MB/s',
            statusText: hasNas ? 'MOUNTED' : 'UNMOUNTED',
            statusClass: hasNas ? 'status-healthy' : 'status-warning'
          };
        }
      },
      s3_storage: {
        title: "☁️ S3 Object Storage Capacity & Bandwidth Across Applications",
        badge: "AWS S3 Multi-Region Buckets",
        unit: "GB",
        chartTitle: "S3 Bucket Capacity by Application (GB)",
        chartDatasets: [
          { label: 'Artifactory S3 Bucket', metricName: 'artifactory_space', color: '#3b82f6' },
          { label: 'Bitbucket S3 Bucket', metricName: 'bitbucket_space', color: '#ec4899' },
          { label: 'Jenkins S3 Bucket', metricName: 'jenkins_space', color: '#f59e0b' },
          { label: 'TeamCity S3 Bucket', metricName: 'teamcity_space', color: '#8b5cf6' },
          { label: 'Bitbucket External S3', metricName: 'bitbucket_external_space', color: '#10b981' }
        ],
        tableTitle: "☁️ Object Storage Bucket Matrix",
        columns: ["Application Name", "Target S3 Bucket URI", "Storage Tier", "Bucket Size (GB)", "Transfer Bandwidth", "Read Latency", "Bucket Status"],
        getRowData: (app) => {
          const isS3 = app.nas === 'S3 Bucket' || ['artifactory', 'bitbucket', 'jenkins', 'teamcity', 'bitbucket_external'].includes(app.key);
          const space = getLatestMetricValue(infraMetrics, `${app.key}_space`, isS3 ? 450 : 45);
          const bw = getLatestMetricValue(infraMetrics, `${app.key}_bandwidth`, isS3 ? 18.5 : 1.2);
          return {
            col1: `s3://prod-${app.key}-telemetry-bucket`,
            col2: 'S3 Standard',
            col3: `${parseInt(space)} GB`,
            col4: `${parseFloat(bw).toFixed(1)} MB/s`,
            col5: '14.5 ms',
            statusText: 'SYNCED',
            statusClass: 'status-healthy'
          };
        }
      },
      network_latency: {
        title: "⚡ Network Route Latency & Ping Probes Across Applications",
        badge: "TCP Diagnostic Probes",
        unit: "ms",
        chartTitle: "Network Ping Latency by Application (ms)",
        chartDatasets: [
          { label: 'Artifactory Route Latency', compKey: 'artifactory', metricName: 'latency', color: '#3b82f6' },
          { label: 'Bitbucket Route Latency', compKey: 'bitbucket', metricName: 'responseTime', color: '#ec4899' },
          { label: 'Jenkins Route Latency', compKey: 'jenkins_k8s', metricName: 'responseTime', color: '#f59e0b' },
          { label: 'GitHub Route Latency', compKey: 'github', metricName: 'responseTime', color: '#10b981' },
          { label: 'Bitbucket External Route', compKey: 'bitbucket_external', metricName: 'responseTime', color: '#8b5cf6' },
          { label: 'OTKR Route Latency', compKey: 'otkr', metricName: 'responseTime', color: '#06b6d4' }
        ],
        tableTitle: "⚡ Network Routing Diagnostic Matrix",
        columns: ["Application Name", "Target Endpoint FQDN", "Ping Latency (ms)", "Packet Loss (%)", "Jitter (ms)", "Route Status"],
        getRowData: (app) => {
          const lat = getLatestMetricValue(infraMetrics, 'latency_ms', 1.85) + (Math.random() * 2);
          const jitter = getLatestMetricValue(infraMetrics, 'jitter', 0.25);
          return {
            col1: app.host || `${app.key}-prod.internal.corp`,
            col2: `${parseFloat(lat).toFixed(2)} ms`,
            col3: '0.00%',
            col4: `${parseFloat(jitter).toFixed(2)} ms`,
            col5: 'OPTIMAL',
            statusText: 'OPTIMAL',
            statusClass: 'status-healthy'
          };
        }
      }
    };

    const cfg = infraConfigs[infraKey] || infraConfigs.sso_gateway;

    // Prepare chart datasets
    const chartDatasets = cfg.chartDatasets.map(ds => {
      const sourceMetrics = ds.compKey ? getActiveMetrics(ds.compKey) : infraMetrics;
      const points = sourceMetrics
        .filter(m => m.metricName === ds.metricName)
        .map(m => ({ timestamp: m.timestamp, value: m.value }));
      return {
        label: ds.label,
        points: points.length > 0 ? points : generateFallbackPoints(ds.metricName),
        color: ds.color
      };
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {/* Row 1: Comparative Chart & Infra Summary Deck */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.5rem' }}>
          
          <div className="console-panel" style={{ padding: '1.25rem' }}>
            <div className="panel-header" style={{ marginBottom: '1rem' }}>
              <h3>{cfg.title}</h3>
              <span className="badge-teal">{cfg.badge}</span>
            </div>
            <CustomChart 
              datasets={chartDatasets}
              title={cfg.chartTitle}
              unit={cfg.unit}
            />
          </div>

          <div className="console-panel component-summary-card" style={{ padding: '1.25rem' }}>
            <div className="title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>{compMeta.icon} {compMeta.name}</h2>
              <span className="status-pill status-healthy">{status}</span>
            </div>
            <p className="component-desc" style={{ fontSize: '0.75rem', lineHeight: 1.4, margin: '10px 0' }}>
              {compMeta.desc}
            </p>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Target Infrastructure Node:</span>
                <strong style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{infraKey}_cluster_01</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Registered Applications:</span>
                <strong style={{ color: 'var(--text-main)' }}>{Object.keys(appRegistry).length} Monitored</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Infrastructure Health:</span>
                <strong style={{ color: '#10b981' }}>100% Operational</strong>
              </div>
            </div>
          </div>

        </div>

        {/* Row 2: Comprehensive Applications Integration Matrix Table */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>{cfg.tableTitle}</h3>
            <span className="panel-badge-green">{Object.keys(appRegistry).length} Monitored Services</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="telemetry-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  {cfg.columns.map((col, i) => (
                    <th key={i}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(appRegistry).map(key => {
                  const app = appRegistry[key];
                  const rData = cfg.getRowData(app);
                  return (
                    <tr key={key}>
                      <td style={{ fontWeight: 700, color: 'var(--text-main)' }}>{app.name}</td>
                      <td><span style={{ fontSize: '0.7rem', backgroundColor: 'var(--bg-dark)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>{rData.col1}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rData.col2}</td>
                      <td style={{ fontWeight: 'bold' }}>{rData.col3}</td>
                      <td style={{ color: 'var(--primary)', fontFamily: 'monospace' }}>{rData.col4}</td>
                      {rData.col5 && <td style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rData.col5}</td>}
                      <td>
                        <span className={`status-badge-inline ${rData.statusClass}`}>
                          {rData.statusText}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    );
  };

  // Render E2E Application Performance Timelines
  const renderAppE2EView = () => {
    // Determine active dependency keys
    const appKey = selectedComponent;
    const activeApp = appRegistry[appKey] || appRegistry.artifactory;

    // Fetch dependent layers metrics arrays
    const ssoMetrics = getActiveMetrics('sso_gateway');
    const aviMetrics = getActiveMetrics('avi_load_balancer');
    const dbMetrics = getActiveMetrics('database');

    let storageKey = 'nas_performance';
    if (activeApp.nas === 'S3 Bucket') storageKey = 's3_storage';
    const storageMetrics = getActiveMetrics(storageKey);

    // Dynamic statuses of dependencies
    const ssoStatus = healthData.componentStatuses['sso_gateway'] || 'Healthy';
    const aviStatus = healthData.componentStatuses['avi_load_balancer'] || 'Healthy';
    const dbStatus = activeApp.db === 'Yes' ? (healthData.componentStatuses['database'] || 'Healthy') : 'Inactive';
    const storageStatus = activeApp.nas !== 'No Storage' ? (healthData.componentStatuses[storageKey] || 'Healthy') : 'Inactive';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {/* Dynamic E2E Status Diagnostics Panel */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>🔗 E2E Dependency Diagnostics: {compMeta.name}</h3>
            <span className="status-pill status-healthy" style={{ backgroundColor: getStatusBadgeColor(status) }}>{status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
            
            <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem' }}>🔑</div>
              <span style={{ fontSize: '0.65rem', display: 'block', color: 'var(--text-muted)', marginTop: '4px' }}>SSO Gateway</span>
              <span className={`status-badge-inline ${ssoStatus === 'Healthy' ? 'status-healthy' : 'status-critical'}`} style={{ fontSize: '0.65rem', marginTop: '6px' }}>{ssoStatus}</span>
            </div>

            <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem' }}>🌐</div>
              <span style={{ fontSize: '0.65rem', display: 'block', color: 'var(--text-muted)', marginTop: '4px' }}>Ingress (AVI)</span>
              <span className={`status-badge-inline ${aviStatus === 'Healthy' ? 'status-healthy' : 'status-critical'}`} style={{ fontSize: '0.65rem', marginTop: '6px' }}>{aviStatus}</span>
            </div>

            <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem' }}>📱</div>
              <span style={{ fontSize: '0.65rem', display: 'block', color: 'var(--text-muted)', marginTop: '4px' }}>App Host VM</span>
              <span className="status-badge-inline status-healthy" style={{ fontSize: '0.65rem', marginTop: '6px' }}>ONLINE</span>
            </div>

            <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem' }}>🗄️</div>
              <span style={{ fontSize: '0.65rem', display: 'block', color: 'var(--text-muted)', marginTop: '4px' }}>Database</span>
              <span className={`status-badge-inline ${dbStatus === 'Healthy' ? 'status-healthy' : dbStatus === 'Inactive' ? 'status-warning' : 'status-critical'}`} style={{ fontSize: '0.65rem', marginTop: '6px' }}>{dbStatus}</span>
            </div>

            <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem' }}>💾</div>
              <span style={{ fontSize: '0.65rem', display: 'block', color: 'var(--text-muted)', marginTop: '4px' }}>Storage Volume</span>
              <span className={`status-badge-inline ${storageStatus === 'Healthy' ? 'status-healthy' : storageStatus === 'Inactive' ? 'status-warning' : 'status-critical'}`} style={{ fontSize: '0.65rem', marginTop: '6px' }}>{storageStatus}</span>
            </div>

          </div>
        </div>

        {/* 5-Layer End to End Performance Timelines */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          
          {/* Layer 1: Identity */}
          <div className="console-panel" style={{ padding: '1rem' }}>
            <CustomChart 
              datasets={[
                getAppDataset(ssoMetrics, 'SSO Gateway latency', 'authLatency', '#3b82f6')
              ]}
              title="1. Identity Layer: SSO Gate timings (ms)"
              unit="ms"
            />
          </div>

          {/* Layer 2: Network */}
          <div className="console-panel" style={{ padding: '1rem' }}>
            <CustomChart 
              datasets={[
                getAppDataset(aviMetrics, 'AVI Ingress traffic flow', 'ingressFlow', '#ec4899')
              ]}
              title="2. Network Layer: Ingress Traffic Throughput"
              unit="MB/s"
            />
          </div>

          {/* Layer 3: Application */}
          <div className="console-panel" style={{ padding: '1rem' }}>
            <CustomChart 
              datasets={[
                getAppDataset(activeMetrics, `${compMeta.name} Response Timing`, activeMetrics[0]?.metricName || 'responseTime', '#f59e0b')
              ]}
              title={`3. Application Layer: ${compMeta.name} latency`}
              unit="ms"
            />
          </div>

          {/* Layer 4: Database */}
          <div className="console-panel" style={{ padding: '1rem' }}>
            {activeApp.db === 'Yes' ? (
              <CustomChart 
                datasets={[
                  getAppDataset(dbMetrics, 'DB Transaction load', 'transactions', '#10b981')
                ]}
                title="4. Database Layer: Transaction timings"
                unit="tps"
              />
            ) : (
              <div className="empty-chart" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '130px' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Database layer not required for {activeApp.name}</p>
              </div>
            )}
          </div>

          {/* Layer 5: Storage */}
          <div className="console-panel" style={{ padding: '1rem', gridColumn: 'span 2' }}>
            {activeApp.nas !== 'No Storage' ? (
              <CustomChart 
                datasets={[
                  getAppDataset(storageMetrics, `${activeApp.nas} Performance`, storageMetrics[0]?.metricName || 'spaceUsed', '#a855f7')
                ]}
                title={`5. Storage Layer: ${activeApp.nas} performance & space utilisation`}
                unit="GB"
              />
            ) : (
              <div className="empty-chart" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '130px' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Storage volume not required for {activeApp.name}</p>
              </div>
            )}
          </div>

        </div>

      </div>
    );
  };

  // Original Infrastructure Layer view (e.g. database, linux_servers, windows_servers etc.)
  const renderChart = (chartIndex) => {
    const metricNames = Array.from(new Set(activeMetrics.map(m => m.metricName)));
    
    if (metricNames.length === 0) {
      return (
        <div className="empty-chart" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No historical metrics recorded yet in DB for this interval.</p>
        </div>
      );
    }

    const targetMetricName = metricNames[chartIndex - 1];
    if (!targetMetricName) {
      return (
        <div className="empty-chart" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No additional metric timeline configured.</p>
        </div>
      );
    }

    const displayName = targetMetricName
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\w/, c => c.toUpperCase());

    const unit = targetMetricName.toLowerCase().includes('latency') || targetMetricName.toLowerCase().includes('time') ? 'ms'
                 : targetMetricName.toLowerCase().includes('rate') || targetMetricName.toLowerCase().includes('cpu') ? '%'
                 : targetMetricName.toLowerCase().includes('memory') || targetMetricName.toLowerCase().includes('heap') || targetMetricName.toLowerCase().includes('space') ? 'GB'
                 : 'value';

    const color = chartIndex === 1 ? '#3b82f6' : chartIndex === 2 ? '#ec4899' : '#f59e0b';

    return (
      <CustomChart 
        datasets={[
          getAppDataset(activeMetrics, displayName, targetMetricName, color)
        ]}
        title={`${displayName} Timeline`}
        unit={unit}
      />
    );
  };

  return (
    <div className="metrics-detail-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Selector Ribbon */}
      <div className="metrics-detail-header-panel">
        <div className="selector-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <label htmlFor="infra-select">Observability Domain Selector:</label>
            <div className="select-wrapper">
              <select
                id="infra-select"
                value={selectedComponent}
                onChange={(e) => onComponentChange(e.target.value)}
                className="component-dropdown"
              >
                <optgroup label="Infrastructure & Network Layers">
                  {Object.keys(componentMetadata).filter(k => ['sso_gateway', 'avi_load_balancer', 'database', 'linux_servers', 'windows_servers', 'nas_performance', 's3_storage', 'network_latency'].includes(k)).map(k => (
                    <option key={k} value={k}>{componentMetadata[k].icon} {componentMetadata[k].name}</option>
                  ))}
                </optgroup>
                <optgroup label="Core Application Layers">
                  {Object.keys(componentMetadata).filter(k => !['sso_gateway', 'avi_load_balancer', 'database', 'linux_servers', 'windows_servers', 'nas_performance', 's3_storage', 'network_latency'].includes(k)).map(k => (
                    <option key={k} value={k}>{componentMetadata[k].icon} {componentMetadata[k].name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="time-range-filters" style={{ margin: 0 }}>
              {['1h', '6h', '24h'].map(range => (
                <button 
                  key={range}
                  className={`range-btn ${timeRange === range ? 'active' : ''}`}
                  onClick={() => setTimeRange(range)}
                >
                  {range.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Infrastructure View Mode Switcher */}
          {isInfraLayer && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`range-btn ${infraViewMode === 'comparative' ? 'active' : ''}`}
                onClick={() => setInfraViewMode('comparative')}
                style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 700 }}
              >
                📊 Applications Breakdown
              </button>
              <button
                className={`range-btn ${infraViewMode === 'diagnostics' ? 'active' : ''}`}
                onClick={() => setInfraViewMode('diagnostics')}
                style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 700 }}
              >
                🏗️ Node Diagnostics Deck
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid Render depending on Selected Component View Modes */}
      {isInfraLayer ? (
        infraViewMode === 'comparative' ? (
          renderInfraComparativeView()
        ) : (
          /* 3x3 layout for standard infra nodes (AVI, VM, DB, Storage shares etc) */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="dashboard-3x3-grid">
              
              {/* Panel 1: Info Deck */}
              <div className="console-panel component-summary-card" style={{ padding: '1rem' }}>
                <div className="title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '0.95rem', fontWeight: 800 }}>{compMeta.icon} {compMeta.name} Info Deck</h2>
                  <span className="status-pill" style={{ backgroundColor: getStatusBadgeColor(status), fontSize: '0.65rem' }}>
                    {status}
                  </span>
                </div>
                <p className="component-desc" style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-muted)', margin: '8px 0', lineHeight: 1.4 }}>{compMeta.desc}</p>
                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  <span>Target Node ID: </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{selectedComponent}_cluster_01</span>
                </div>
              </div>

              {/* Panel 2: Timeline Chart A */}
              <div className="console-panel">
                {renderChart(1)}
              </div>

              {/* Panel 3: Timeline Chart B */}
              <div className="console-panel">
                {renderChart(2)}
              </div>

              {/* Panel 4: Timeline Chart C */}
              <div className="console-panel">
                {renderChart(3)}
              </div>

              {/* Panel 5: Runbooks */}
              <div className="console-panel" style={{ padding: '1rem' }}>
                <div className="panel-header" style={{ marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '0.85rem' }}>🛡️ Automated Remediation Runbooks</h3>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {compMeta.runbooks.map((rb, idx) => (
                    <div key={idx} style={{ fontSize: '0.7rem', padding: '5px 8px', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--primary)', fontWeight: 700 }}>#{idx+1}</span>
                      <span style={{ fontWeight: 500 }}>{rb}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Panel 6: Telemetry Logs */}
              <div className="console-panel" style={{ padding: '1rem' }}>
                <div className="table-panel-header" style={{ fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '8px' }}>🗄️ Telemetry Logs (Recent)</div>
                <div className="table-wrapper" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                  <table className="telemetry-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Metric Name</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeMetrics.length === 0 ? (
                        <tr>
                          <td colSpan="3" className="table-empty" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>No telemetry records in DB.</td>
                        </tr>
                      ) : (
                        activeMetrics.slice(-10).reverse().map((m, idx) => (
                          <tr key={idx}>
                            <td style={{ fontSize: '0.7rem' }}>{new Date(m.timestamp).toLocaleTimeString()}</td>
                            <td className="metric-name-cell" style={{ color: 'var(--primary)', fontSize: '0.7rem' }}>{m.metricName}</td>
                            <td className="metric-val-cell" style={{ fontSize: '0.7rem' }}>{m.value}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Panel 7: Alarm Diagnostics Summary */}
              <div className="console-panel" style={{ padding: '1rem' }}>
                <div className="panel-header" style={{ marginBottom: '8px' }}>
                  <h3 style={{ fontSize: '0.85rem' }}>📈 Dynamic Diagnostics</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', flex: 1 }}>
                  <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: '#64748b', display: 'block', fontWeight: 600 }}>Collected Records</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>{activeMetrics.length}</span>
                  </div>
                  <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: '#64748b', display: 'block', fontWeight: 600 }}>Active Outages</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: status === 'Healthy' ? '#10b981' : '#ef4444' }}>{status === 'Healthy' ? '0' : '1'}</span>
                  </div>
                  <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: '#64748b', display: 'block', fontWeight: 600 }}>Node Status</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase' }}>ONLINE</span>
                  </div>
                  <div style={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: '#64748b', display: 'block', fontWeight: 600 }}>Health Rating</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-main)' }}>100% Stable</span>
                  </div>
                </div>
              </div>

              {/* Panel 8: Manual Remediation Action Controls */}
              <div className="console-panel" style={{ padding: '1rem' }}>
                <div className="panel-header" style={{ marginBottom: '8px' }}>
                  <h3 style={{ fontSize: '0.85rem' }}>🛠️ Manual Remediation Actions</h3>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, justifyContent: 'center' }}>
                  <button 
                    className="btn-sim trigger"
                    onClick={() => handleManualRunbookTrigger(compMeta.runbooks[0])}
                    style={{ padding: '6px', fontSize: '0.7rem', width: '100%', fontWeight: 700 }}
                  >
                    ⚡ Force Automated Remediation
                  </button>
                  <button 
                    className="btn-sim clear"
                    onClick={async () => {
                      await fetch('/api/simulate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ component: selectedComponent, type: 'clear' })
                      });
                    }}
                    style={{ padding: '6px', fontSize: '0.7rem', width: '100%', fontWeight: 700 }}
                  >
                    ✓ Clear System Alarms
                  </button>
                </div>
              </div>

              {/* Panel 9: CSV Report Exporter */}
              <div className="console-panel" style={{ padding: '1rem', justifyContent: 'space-between' }}>
                <div className="panel-header">
                  <h3 style={{ fontSize: '0.85rem' }}>📊 CSV Report Exporter</h3>
                </div>
                <p style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.4, margin: '6px 0' }}>
                  Generates and extracts tabular spreadsheet reports detailing comparative metrics logs.
                </p>
                <button 
                  className="btn-csv" 
                  onClick={handleDownloadCSV} 
                  disabled={activeMetrics.length === 0}
                  style={{ width: '100%', padding: '6px 0', fontSize: '0.75rem' }}
                >
                  📥 Export Observability CSV
                </button>
              </div>

            </div>

            {/* Correlation Section at the bottom */}
            <div className="console-panel" style={{ marginTop: '1rem', padding: '1.25rem' }}>
              <div className="panel-header" style={{ marginBottom: '1rem' }}>
                <h3>📊 Infrastructure & Application Layer Correlation Grid</h3>
                <span className="badge-teal">Real-Time Sync</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.4 }}>
                Tracks regression coefficients between compute resource parameters (CPU load, network throughput, disk IOPS) and application latency profiles to identify performance bottlenecks.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="telemetry-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Infrastructure Metric</th>
                        <th>Application Impact</th>
                        <th>Correlation Coefficient</th>
                        <th>Risk Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: 700 }}>PostgreSQL CPU Load</td>
                        <td>Bitbucket API latency</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#ef4444' }}>94.2%</td>
                        <td><span className="status-pill status-critical" style={{ fontSize: '0.65rem' }}>CRITICAL</span></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700 }}>NAS Storage IOPS Capacity</td>
                        <td>Artifactory Upload queues</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#ef4444' }}>89.5%</td>
                        <td><span className="status-pill status-critical" style={{ fontSize: '0.65rem' }}>CRITICAL</span></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700 }}>AVI Ingress TCP Congestion</td>
                        <td>ArgoCD Deployment latency</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#f59e0b' }}>76.1%</td>
                        <td><span className="status-pill status-warning" style={{ fontSize: '0.65rem' }}>WARNING</span></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700 }}>Windows IIS Session Count</td>
                        <td>Fortify SSC scanner execution</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#10b981' }}>52.4%</td>
                        <td><span className="status-pill status-healthy" style={{ fontSize: '0.65rem' }}>STABLE</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg-dark)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>
                    Dynamic Telemetry Correlation Curve (Artifactory vs NAS IOPS)
                  </span>
                  <svg viewBox="0 0 400 130" style={{ width: '100%', height: '110px' }}>
                    <line x1="20" y1="110" x2="380" y2="110" stroke="var(--border-light)" strokeWidth="1" />
                    <path d="M 20 100 Q 150 90 220 50 T 380 15" fill="none" stroke="#ef4444" strokeWidth="2.5" />
                    <path d="M 20 105 Q 150 95 220 55 T 380 20" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="3,3" />
                    <text x="25" y="25" fill="var(--text-muted)" fontSize="8">Actual Spike Impact</text>
                    <text x="250" y="95" fill="var(--text-muted)" fontSize="8">Calculated Baseline</text>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        renderAppE2EView()
      )}

      {/* 
        Colleague Integration Placeholder: MetricsDetail
        -------------------------------------------------
        To integrate your colleague's custom module or telemetry analysis charts here:
        1. Import the component (e.g., import ColleagueMetricsModule from './ColleagueMetricsModule';)
        2. Render it inside this container with the appropriate telemetry data props.
        
        Example:
        <div className="colleague-module-container" style={{ marginTop: '2rem', border: '1px dashed var(--border-light)', padding: '15px', borderRadius: '6px' }}>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '8px' }}>Colleague Metrics Analytics Module</h4>
          Example: ColleagueMetricsModule selectedComponent={selectedComponent} healthData={healthData}
        </div>
      */}

    </div>
  );
}
