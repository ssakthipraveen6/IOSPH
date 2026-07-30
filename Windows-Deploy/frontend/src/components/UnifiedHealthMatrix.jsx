import React from 'react';

export default function UnifiedHealthMatrix({ 
  healthData = {}, 
  customChecks = [], 
  alerts = [] 
}) {
  const componentStatuses = healthData.componentStatuses || {};

  // Infrastructure targets definition
  const infraItems = [
    { key: 'avi_load_balancer', name: 'AVI Load Balancer', type: 'Load Balancer', desc: 'Ingress load distribution & virtual services' },
    { key: 'database', name: 'PostgreSQL & Snowflake', type: 'Database Server', desc: 'Historical telemetry datastores' },
    { key: 'linux_servers', name: 'Linux Host Clusters', type: 'Server OS', desc: 'Dynatrace OneAgent / Fluentbit monitors' },
    { key: 'windows_servers', name: 'Windows Host Clusters', type: 'Server OS', desc: 'IIS Services & system daemons' },
    { key: 'nas_performance', name: 'NAS Storage Mounts', type: 'Storage Server', desc: 'Persistent application logs folders' },
    { key: 's3_storage', name: 'S3 Object Storage', type: 'Cloud Storage', desc: 'Cold archive storage buckets' },
    { key: 'sso_gateway', name: 'SSO & eLDAP Gateway', type: 'Identity Provider', desc: 'Enterprise client authentication' },
    { key: 'network_latency', name: 'TCP Latency Monitor', type: 'Network Diagnostics', desc: 'Ping timing probes to remote hosts' }
  ];

  // Core application systems definition
  const appItems = [
    { key: 'bitbucket', name: 'Bitbucket Code Repo', host: 'git-prod.internal.corp', port: '443' },
    { key: 'artifactory', name: 'Artifactory Registry', host: 'artifactory-prod.internal.corp', port: '8081' },
    { key: 'argocd_k8s', name: 'ArgoCD Deployment Hub', host: 'argo-prod.internal.corp', port: '443' },
    { key: 'argoworkflows_k8s', name: 'Argo Workflows Pipeline', host: 'argo-workflows.internal.corp', port: '80' },
    { key: 'jenkins_k8s', name: 'Jenkins Build Master', host: 'jenkins-prod.internal.corp', port: '8080' },
    { key: 'teamcity', name: 'TeamCity Build Agents', host: 'teamcity-prod.internal.corp', port: '8111' },
    { key: 'sonarqube', name: 'SonarQube Quality Gate', host: 'sonar-prod.internal.corp', port: '9000' },
    { key: 'nexusiq', name: 'NexusIQ Policy Scanner', host: 'nexus-prod.internal.corp', port: '8083' },
    { key: 'fortify', name: 'Fortify SSC Engine', host: 'fortify-prod.internal.corp', port: '8443' },
    { key: 'github', name: 'GitHub Enterprise Pool', host: 'api.github.com', port: '443' }
  ];

  const getStatusClass = (status) => {
    const s = (status || 'Healthy').toLowerCase();
    if (s === 'critical') return 'status-critical';
    if (s === 'warning') return 'status-warning';
    return 'status-healthy';
  };

  const getStatusText = (status) => {
    return status || 'Healthy';
  };

  const getStatusDot = (status) => {
    const s = (status || 'Healthy').toLowerCase();
    if (s === 'critical') return '#ef4444';
    if (s === 'warning') return '#f59e0b';
    return '#10b981';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Page Header */}
      <div className="console-panel" style={{ padding: '1.25rem' }}>
        <div className="panel-header">
          <h3>🌍 Enterprise Health & Operations Matrix</h3>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '4px' }}>
          Unified real-time grid view monitoring health, active alerts, and endpoints for all applications, core hardware infrastructures, and dynamic custom extension checks across London (LDN), India (IST), Portugal, and US regions.
        </p>
      </div>

      {/* Grid: 2 Columns (Apps left, Hardware right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        
        {/* Left Column: Applications Matrix */}
        <div className="console-panel" style={{ padding: '1.5rem' }}>
          <div className="panel-header">
            <h3>📱 Applications Status Matrix</h3>
            <span className="status-pill" style={{ backgroundColor: 'var(--primary)', fontSize: '0.65rem' }}>
              {appItems.length} Monitored
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            {appItems.map(app => {
              const status = componentStatuses[app.key] || 'Healthy';
              const activeAlertsCount = alerts.filter(a => a.component === app.key && a.status === 'Active').length;
              
              return (
                <div 
                  key={app.key} 
                  className={`app-status-row ${getStatusClass(status)}`}
                  style={{ 
                    borderLeft: `4px solid ${getStatusDot(status)}`,
                    padding: '12px',
                    backgroundColor: 'var(--bg-dark)'
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', display: 'block', color: 'var(--text-main)' }}>
                      {app.name}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Endpoint: {app.host}:{app.port}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {activeAlertsCount > 0 && (
                      <span style={{ fontSize: '0.65rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                        {activeAlertsCount} Alerts
                      </span>
                    )}
                    <span className="app-status-badge-corp" style={{ color: getStatusDot(status), fontWeight: 800, fontSize: '0.75rem' }}>
                      ● {getStatusText(status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Infrastructure Layers Matrix */}
        <div className="console-panel" style={{ padding: '1.5rem' }}>
          <div className="panel-header">
            <h3>🏗️ Infrastructure Layers Matrix</h3>
            <span className="status-pill" style={{ backgroundColor: 'var(--primary)', fontSize: '0.65rem' }}>
              {infraItems.length} Monitored
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            {infraItems.map(infra => {
              const status = componentStatuses[infra.key] || 'Healthy';
              const activeAlertsCount = alerts.filter(a => a.component === infra.key && a.status === 'Active').length;

              return (
                <div 
                  key={infra.key} 
                  className={`app-status-row ${getStatusClass(status)}`}
                  style={{ 
                    borderLeft: `4px solid ${getStatusDot(status)}`,
                    padding: '12px',
                    backgroundColor: 'var(--bg-dark)'
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', display: 'block', color: 'var(--text-main)' }}>
                      {infra.name}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {infra.desc}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {activeAlertsCount > 0 && (
                      <span style={{ fontSize: '0.65rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                        {activeAlertsCount} Alerts
                      </span>
                    )}
                    <span className="app-status-badge-corp" style={{ color: getStatusDot(status), fontWeight: 800, fontSize: '0.75rem' }}>
                      ● {getStatusText(status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Bottom Block: Future Custom Extension Checks Status */}
      <div className="console-panel" style={{ padding: '1.5rem' }}>
        <div className="panel-header">
          <h3>🔧 Modular Custom Checks & Extensions Feed</h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Configured in <code style={{ fontFamily: 'var(--font-mono)', padding: '2px 6px', background: 'var(--bg-dark)', borderRadius: '4px' }}>backend/extensions/custom_checks.js</code>
          </span>
        </div>

        <div className="table-wrapper" style={{ marginTop: '0.75rem', maxHeight: 'none' }}>
          <table className="telemetry-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Check Registry Name</th>
                <th>Diagnostic Type</th>
                <th>Production Endpoint Target</th>
                <th>Poll Latency</th>
                <th>Last Active Value</th>
                <th>Incident Count</th>
                <th>Overall Status</th>
              </tr>
            </thead>
            <tbody>
              {customChecks.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '12px' }}>
                    No custom checks loaded from backend server.
                  </td>
                </tr>
              ) : (
                customChecks.map(check => (
                  <tr key={check.id}>
                    <td style={{ fontWeight: 700, color: 'var(--text-main)' }}>{check.name}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{check.type}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{check.endpoint}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{check.latencyMs} ms</td>
                    <td style={{ fontWeight: 600 }}>{check.lastRunValue}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: check.failureCount > 0 ? '#ef4444' : 'inherit' }}>
                      {check.failureCount}
                    </td>
                    <td>
                      <span className="status-pill" style={{ backgroundColor: getStatusDot(check.status), fontSize: '0.65rem', padding: '2px 8px' }}>
                        {check.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 
        Colleague Integration Placeholder: UnifiedHealthMatrix
        -------------------------------------------------
        To integrate your colleague's custom module or operational checks here:
        1. Import the component (e.g., import ColleagueMatrixModule from './ColleagueMatrixModule';)
        2. Render it inside this container with the appropriate customChecks/alerts data props.
        
        Example:
        <div className="colleague-module-container" style={{ marginTop: '2rem', border: '1px dashed var(--border-light)', padding: '15px', borderRadius: '6px' }}>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '8px' }}>Colleague Health Matrix Module</h4>
          Example: ColleagueMatrixModule healthData={healthData} customChecks={customChecks} alerts={alerts}
        </div>
      */}

    </div>
  );
}
