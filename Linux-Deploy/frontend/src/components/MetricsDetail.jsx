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
    name: 'Bitbucket Code Repo',
    icon: '📦',
    desc: 'Enterprise source code repository management node.',
    runbooks: ['Clean Git cache indices', 'Restart VCS webhooks listener', 'Run local filesystem check']
  },
  artifactory: {
    name: 'Artifactory Registry',
    icon: '🗃️',
    desc: 'JFrog Artifactory package registry hosting shared libraries and maven targets.',
    runbooks: ['Clean storage garbage collection', 'Purge snapshot dependencies', 'Restart Artifactory system JVM']
  },
  argocd_k8s: {
    name: 'ArgoCD Deployment Hub',
    icon: '🐙',
    desc: 'GitOps continuous deployment controller syncing state to K8s nodes.',
    runbooks: ['Re-sync cluster credentials', 'Flush sync caches', 'Restart controller manager deployment']
  },
  argoworkflows_k8s: {
    name: 'Argo Workflows Pipeline',
    icon: '🔄',
    desc: 'Kubernetes-native workflow engine orchestrating automation steps.',
    runbooks: ['Re-run failed workflow step', 'Flush engine queue logs', 'Restart workflow executor pods']
  },
  jenkins_k8s: {
    name: 'Jenkins Build Master',
    icon: '👴',
    desc: 'Jenkins build automation master coordinator.',
    runbooks: ['Clear build queues', 'Kill orphaned executor nodes', 'Restart master build instance']
  },
  teamcity: {
    name: 'TeamCity Build Agents',
    icon: '🏗️',
    desc: 'JetBrains build executor pools compiling binary templates.',
    runbooks: ['Restart build agent daemon', 'Clean work cache folder', 'Re-register build agent node']
  },
  sonarqube: {
    name: 'SonarQube Quality Gate',
    icon: '🔍',
    desc: 'Static code analyzer assessing code coverage, bugs, and smells.',
    runbooks: ['Recycle scan indices', 'Purge old scanning reports', 'Restart Sonar JVM host']
  },
  nexusiq: {
    name: 'NexusIQ Policy Scanner',
    icon: '🛡️',
    desc: 'Open source vulnerability policy scanner audit engine.',
    runbooks: ['Flush index database pool', 'Re-index vulnerability feeds', 'Recycle NexusIQ service']
  },
  fortify: {
    name: 'Fortify SSC Engine',
    icon: '🔒',
    desc: 'Application security scanner executing Fortify SAST audits.',
    runbooks: ['Kill blocked scanning runs', 'Flush result buffer queues', 'Restart Fortify server pool']
  },
  github: {
    name: 'GitHub Enterprise Pool',
    icon: '🐈',
    desc: 'GitHub enterprise code repository access API portal.',
    runbooks: ['Flush credentials sync pool', 'Re-run webhook triggers', 'Toggle failover mirror replica']
  }
};

const appRegistry = {
  artifactory: { key: "artifactory", name: "JFrog Artifactory", login: "SSO and eLDAP", cert: "URL & license validity", nas: "S3 Bucket", db: "Yes", activeSessions: 840, latency: "85ms" },
  bitbucket: { key: "bitbucket", name: "Bitbucket Server", login: "SSO Only", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 1420, latency: "95ms" },
  argocd_k8s: { key: "argocd_k8s", name: "ArgoCD GitOps", login: "SSO & eLDAP with Dax", cert: "URL & license validity", nas: "No Storage", db: "No", activeSessions: 220, latency: "55ms" },
  argoworkflows_k8s: { key: "argoworkflows_k8s", name: "Argo Workflows", login: "SSO & eLDAP with Dax", cert: "URL & license validity", nas: "No Storage", db: "No", activeSessions: 150, latency: "70ms" },
  jenkins_k8s: { key: "jenkins_k8s", name: "CloudBees Jenkins", login: "SSO Only", cert: "URL & license validity", nas: "NAS Mount", db: "No", activeSessions: 650, latency: "110ms" },
  teamcity: { key: "teamcity", name: "TeamCity Build Pool", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 480, latency: "120ms" },
  fortify: { key: "fortify", name: "Fortify SSC scans", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 90, latency: "125ms" },
  nexusiq: { key: "nexusiq", name: "NexusIQ Scanner", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 180, latency: "105ms" },
  sonarqube: { key: "sonarqube", name: "SonarQube Quality Gate", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Yes", activeSessions: 520, latency: "115ms" },
  github: { key: "github", name: "GitHub Enterprise", login: "SSO and eLDAP", cert: "URL & license validity", nas: "NAS Mount", db: "Unknown", activeSessions: 2450, latency: "110ms" }
};

export default function MetricsDetail({ selectedComponent, onComponentChange, historicalMetrics, healthData }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedFlowApp, setSelectedFlowApp] = useState('artifactory');

  const compMeta = componentMetadata[selectedComponent] || componentMetadata.database;
  const status = healthData.componentStatuses[selectedComponent] || 'Healthy';
  const componentMetrics = historicalMetrics[selectedComponent] || [];

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
      avi_load_balancer: ['connections', 'ingressFlow', 'throughput'],
      database: ['cpu', 'memory', 'transactions', 'iops'],
      linux_servers: ['cpu', 'memory', 'load'],
      windows_servers: ['cpu', 'memory', 'disk'],
      nas_performance: ['iops', 'throughput', 'spaceUsed'],
      s3_storage: ['latency', 'space', 'bandwidth'],
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
      github: ['apiRateLimitRemaining', 'pendingPullRequests', 'responseTime']
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
  const isSSO = selectedComponent === 'sso_gateway';
  const isApp = !isInfraLayer;

  // Render comparative SSO layouts
  const renderSSOComparativeView = () => {
    // Generate latency datasets for multiple core apps
    const artifactorySSOMetrics = getActiveMetrics('artifactory');
    const bitbucketSSOMetrics = getActiveMetrics('bitbucket');
    const jenkinsSSOMetrics = getActiveMetrics('jenkins_k8s');
    const githubSSOMetrics = getActiveMetrics('github');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {/* Row 1: Comparison Graph & Description */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.5rem' }}>
          
          <div className="console-panel" style={{ padding: '1.25rem' }}>
            <div className="panel-header" style={{ marginBottom: '1rem' }}>
              <h3>📈 Comparative SSO Authentication Latency</h3>
              <span className="badge-teal">Enterprise Applications</span>
            </div>
            <CustomChart 
              datasets={[
                { label: 'JFrog Artifactory SSO', points: artifactorySSOMetrics.filter(m => m.metricName === 'latency').map(m => ({ timestamp: m.timestamp, value: m.value })), color: '#3b82f6' },
                { label: 'Bitbucket Server SSO', points: bitbucketSSOMetrics.filter(m => m.metricName === 'responseTime').map(m => ({ timestamp: m.timestamp, value: m.value * 0.85 })), color: '#ec4899' },
                { label: 'CloudBees Jenkins SSO', points: jenkinsSSOMetrics.filter(m => m.metricName === 'responseTime').map(m => ({ timestamp: m.timestamp, value: m.value * 0.9 })), color: '#f59e0b' },
                { label: 'GitHub Enterprise SSO', points: githubSSOMetrics.filter(m => m.metricName === 'responseTime').map(m => ({ timestamp: m.timestamp, value: m.value * 0.75 })), color: '#10b981' }
              ]}
              title="Auth Response Time timings by Application (ms)"
              unit="ms"
            />
          </div>

          <div className="console-panel component-summary-card" style={{ padding: '1.25rem' }}>
            <div className="title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>🔑 SSO Identity Gateway Status</h2>
              <span className="status-pill status-healthy">Healthy</span>
            </div>
            <p className="component-desc" style={{ fontSize: '0.75rem', lineHeight: 1.4, margin: '10px 0' }}>
              Provides unified security gateway verification validating SAML assertions, OAuth tokens, and eLDAP sync schedules across multi-datacenter deployment clusters.
            </p>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Auth Cache Hit Rate:</span>
                <strong style={{ color: 'var(--text-main)' }}>98.42%</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Active AD LDAP connections:</span>
                <strong style={{ color: 'var(--text-main)' }}>4 / 4 Pools Online</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Directory Sync Daemon:</span>
                <strong style={{ color: '#10b981' }}>OK (Synced 4s ago)</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Comprehensive Applications SSO Integration Table */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>👥 SSO Application Integration Matrix</h3>
            <span className="panel-badge-green">10 Registered Services</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="telemetry-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Application Name</th>
                  <th>Authentication Protocol</th>
                  <th>AD eLDAP Mapping Group</th>
                  <th>Active Sessions</th>
                  <th>Average Sync Latency</th>
                  <th>Integration Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(appRegistry).map(key => {
                  const app = appRegistry[key];
                  const appHealth = healthData.componentStatuses[app.key] || 'Healthy';
                  return (
                    <tr key={key}>
                      <td style={{ fontWeight: 700 }}>{app.name}</td>
                      <td><span style={{ fontSize: '0.7rem', backgroundColor: 'var(--bg-dark)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>{app.login}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>cn=sentinel-auth-{app.key}-users,dn=mnc,dn=corp</td>
                      <td style={{ fontWeight: 'bold' }}>{app.activeSessions} sessions</td>
                      <td style={{ color: 'var(--primary)' }}>{app.latency}</td>
                      <td>
                        <span className={`status-badge-inline ${appHealth === 'Healthy' ? 'status-healthy' : 'status-critical'}`}>
                          {appHealth === 'Healthy' ? 'CONNECTED' : 'DEGRADED'}
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
        <div className="selector-block">
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
      </div>

      {/* Dependent App E2E Status Widget (Infra selected only, not SSO) */}
      {isInfraLayer && !isSSO && (
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <h3 style={{ fontSize: '0.9rem' }}>🔗 Dependent Application E2E Status</h3>
              <select 
                value={selectedFlowApp} 
                onChange={(e) => setSelectedFlowApp(e.target.value)}
                className="component-dropdown"
                style={{ padding: '4px 10px', fontSize: '0.75rem', width: '220px' }}
              >
                {Object.keys(appRegistry).map(key => (
                  <option key={key} value={appRegistry[key].key}>{appRegistry[key].name}</option>
                ))}
              </select>
            </div>
            <span className="badge-teal">Dynamic Dependency Path</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', background: 'var(--bg-dark)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '1.2rem' }}>{compMeta.icon}</span>
              <h4 style={{ fontSize: '0.75rem', marginTop: '4px' }}>{compMeta.name}</h4>
              <span className={`status-badge-inline ${status === 'Healthy' ? 'status-healthy' : 'status-critical'}`} style={{ fontSize: '0.6rem', marginTop: '4px' }}>{status}</span>
            </div>
            <div style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>➜</div>
            <div style={{ textAlign: 'center', background: 'var(--primary-glow)', padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--primary)' }}>
              <span style={{ fontSize: '1.2rem' }}>📱</span>
              <h4 style={{ fontSize: '0.75rem', marginTop: '4px' }}>{appRegistry[selectedFlowApp]?.name}</h4>
              <span className={`status-badge-inline ${healthData.componentStatuses[selectedFlowApp] === 'Healthy' ? 'status-healthy' : 'status-critical'}`} style={{ fontSize: '0.6rem', marginTop: '4px' }}>{healthData.componentStatuses[selectedFlowApp] || 'Healthy'}</span>
            </div>
            <div style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>➜</div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '1.2rem' }}>💾</span>
              <h4 style={{ fontSize: '0.75rem', marginTop: '4px' }}>Storage ({appRegistry[selectedFlowApp]?.nas})</h4>
              <span className="status-badge-inline status-healthy" style={{ fontSize: '0.6rem', marginTop: '4px' }}>Active</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid Render depending on Selected Component View Modes */}
      {isSSO ? (
        renderSSOComparativeView()
      ) : isApp ? (
        renderAppE2EView()
      ) : (
        /* Original 3x3 layout for standard infra nodes (AVI, VM, DB, Storage shares etc) */
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
