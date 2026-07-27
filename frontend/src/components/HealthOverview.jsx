import React from 'react';

// Metadata for the 6 core Infrastructure layers
const infraMetadata = {
  avi_load_balancer: { name: 'Ingress Routing (AVI)', icon: '🌐', primary: 'connections', unit: 'conns', desc: 'F5/AVI Load Balancer routing client traffic across multi-cluster ingress gateways.' },
  database: { name: 'Database Clusters', icon: '🗄️', primary: 'cpu', unit: '% CPU', desc: 'Enterprise database clusters serving transaction and storage pools.' },
  nas_performance: { name: 'NAS Storage Volumes', icon: '💾', primary: 'spaceUsed', unit: '% space', desc: 'Network Attached Storage (NAS) share mount volumes tracking filesystem storage capacity.' },
  linux_servers: { name: 'Linux Compute Farm', icon: '🐧', primary: 'cpu', unit: '% CPU', desc: 'RedHat/Ubuntu virtualization hosts executing application cluster pods.' },
  windows_servers: { name: 'Windows Compute Pool', icon: '💻', primary: 'cpu', unit: '% CPU', desc: 'Windows application servers hosting code analysis and administrative IIS services.' },
  s3_storage: { name: 'Object Storage (S3)', icon: '☁️', primary: 'latency', unit: 'ms latency', desc: 'AWS S3 object storage buckets archiving application build artifacts and logs.' }
};

// Metadata for the 10 Application Integration targets
const appMetadata = {
  bitbucket: { name: 'Bitbucket Enterprise', host: 'Linux Compute', icon: '🪣', primary: 'responseTime', unit: 'ms', infraKey: 'linux_servers' },
  jenkins_k8s: { name: 'Jenkins Build Pods', host: 'Linux Compute', icon: '👷', primary: 'queue', unit: 'jobs', infraKey: 'linux_servers' },
  artifactory: { name: 'JFrog Artifactory', host: 'Linux Compute', icon: '📦', primary: 'heap', unit: '% JVM', infraKey: 'linux_servers' },
  nexusiq: { name: 'NexusIQ Scanner', host: 'Linux Compute', icon: '🛡️', primary: 'scanQueue', unit: 'scans', infraKey: 'linux_servers' },
  fortify: { name: 'Fortify Security', host: 'Windows Compute', icon: '🔍', primary: 'scanQueue', unit: 'scans', infraKey: 'windows_servers' },
  teamcity: { name: 'TeamCity Agent Pool', host: 'Linux Compute', icon: '🚀', primary: 'activeBuilds', unit: 'builds', infraKey: 'linux_servers' },
  servicenow: { name: 'ServiceNow Sync', host: 'API Integration', icon: '🎫', primary: 'openTickets', unit: 'tickets', infraKey: 'avi_load_balancer' },
  dynatrace: { name: 'Dynatrace Alerts', host: 'API Integration', icon: '📊', primary: 'alertCount', unit: 'alerts', infraKey: 'avi_load_balancer' },
  mcp_server_k8s: { name: 'MCP K8s Cluster', host: 'Linux Compute', icon: '⚙️', primary: 'cpu', unit: '%', infraKey: 'linux_servers' },
  argocd_k8s: { name: 'ArgoCD GitOps', host: 'Linux Compute', icon: '🐙', primary: 'latency', unit: 'ms', infraKey: 'linux_servers' }
};

// Sparkline component using SVGs
function Sparkline({ data = [], color = '#0d9488' }) {
  if (data.length < 2) return <div className="sparkline-placeholder">--</div>;
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  
  const width = 120;
  const height = 30;
  const padding = 2;
  
  const points = data.map((d, index) => {
    const x = padding + (index / (data.length - 1)) * (width - 2 * padding);
    const y = padding + (height - 2 * padding) - ((d.value - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="sparkline-svg">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points}
      />
    </svg>
  );
}

export default function HealthOverview({ healthData, historicalMetrics, onSelectComponent, activeSimulations }) {
  const { score = 100, componentStatuses = {}, alertsCount = 0, pendingApprovals = 0, uptime = '00:00:00' } = healthData;

  const getStatusColor = (status) => {
    if (status === 'Critical') return '#ef4444';
    if (status === 'Warning') return '#f59e0b';
    return '#0d9488'; // Teal corporate green
  };

  const getStatusClass = (status) => {
    if (status === 'Critical') return 'status-critical';
    if (status === 'Warning') return 'status-warning';
    return 'status-healthy';
  };

  return (
    <div className="health-overview-container">
      
      {/* MNC Metrics Top Ribbon Bar */}
      <div className="metrics-ribbon">
        <div className="ribbon-item main-health">
          <div className="health-gauge">
            <div className="health-circle-outer">
              <svg width="72" height="72" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" className="gauge-bg" />
                <circle 
                  cx="40" 
                  cy="40" 
                  r="34" 
                  className="gauge-val" 
                  style={{
                    strokeDasharray: 213,
                    strokeDashoffset: 213 - (213 * score) / 100,
                    stroke: score > 80 ? '#0d9488' : score > 50 ? '#f59e0b' : '#ef4444'
                  }}
                />
              </svg>
              <div className="gauge-text">{score}%</div>
            </div>
            <div className="gauge-labels">
              <h4>MNC Health Index</h4>
              <p>{score > 90 ? 'All Infrastructure Stable' : score > 70 ? 'Degraded Performance' : 'Emergency Mitigation Mode'}</p>
            </div>
          </div>
        </div>

        <div className="ribbon-item">
          <span className="ribbon-icon">⚠️</span>
          <div className="ribbon-details">
            <h4>ServiceNow Backlog</h4>
            <span className="ribbon-val" style={{ color: alertsCount > 0 ? '#ef4444' : '#0f172a' }}>{alertsCount} Incidents</span>
            <p>Open tickets awaiting closure</p>
          </div>
        </div>

        <div className="ribbon-item">
          <span className="ribbon-icon">🛡️</span>
          <div className="ribbon-details">
            <h4>Remediation Agent</h4>
            <span className="ribbon-val" style={{ color: pendingApprovals > 0 ? '#f59e0b' : '#0d9488' }}>
              {pendingApprovals > 0 ? `${pendingApprovals} Approvals` : 'Active'}
            </span>
            <p>Autonomous self-healing engine</p>
          </div>
        </div>

        <div className="ribbon-item">
          <span className="ribbon-icon">⏱️</span>
          <div className="ribbon-details">
            <h4>Framework Uptime</h4>
            <span className="ribbon-val uptime-font">{uptime}</span>
            <p>Framework agent uptime</p>
          </div>
        </div>
      </div>

      {/* Infrastructure Core Layers (Main Section) */}
      <div className="component-group-section">
        <h2 className="group-title">
          <span className="bullet-indicator cyan"></span>
          Enterprise Core Infrastructure Layers
        </h2>
        <div className="health-grid">
          {Object.keys(infraMetadata).map(key => {
            const meta = infraMetadata[key];
            const status = componentStatuses[key] || 'Healthy';
            const color = getStatusColor(status);
            const cardClass = getStatusClass(status);
            
            // Get historical metrics for sparkline
            const componentMetrics = historicalMetrics[key] || [];
            const primaryMetricName = meta.primary;
            const filteredMetrics = componentMetrics
              .filter(m => m.metricName === primaryMetricName)
              .slice(-15);

            const latestMetricPoint = filteredMetrics[filteredMetrics.length - 1];
            const latestValue = latestMetricPoint ? latestMetricPoint.value : '--';
            const isSimulated = activeSimulations && activeSimulations[key];

            return (
              <div 
                key={key} 
                className={`health-card ${cardClass}`}
                onClick={() => onSelectComponent(key)}
              >
                {isSimulated && <span className="simulated-badge">Simulated</span>}
                <div className="card-top">
                  <span className="card-icon">{meta.icon}</span>
                  <div className="card-status-dot" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}></div>
                </div>
                
                <h3 className="card-title">{meta.name}</h3>
                <p className="card-desc">{meta.desc}</p>
                
                <div className="card-metric-section">
                  <div className="card-metric-val">
                    <span className="val">{latestValue}</span>
                    <span className="unit"> {meta.unit}</span>
                  </div>
                  <div className="card-sparkline">
                    <Sparkline data={filteredMetrics} color={color} />
                  </div>
                </div>
                
                <div className="card-footer">
                  <span className="card-status-text" style={{ color }}>{status}</span>
                  <span className="card-click-prompt">Compare Apps &rarr;</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Application Orchestration Integration Suite (Bottom Section) */}
      <div className="component-group-section">
        <h2 className="group-title">
          <span className="bullet-indicator magenta"></span>
          Integrated Application Suite Health
        </h2>
        <div className="app-integration-table-card">
          <div className="app-list-grid">
            {Object.keys(appMetadata).map(key => {
              const meta = appMetadata[key];
              const status = componentStatuses[key] || 'Healthy';
              const color = getStatusColor(status);
              
              // Get latest primary metric for the application
              const componentMetrics = historicalMetrics[key] || [];
              const filtered = componentMetrics.filter(m => m.metricName === meta.primary);
              const latestPoint = filtered[filtered.length - 1];
              const valStr = latestPoint ? `${latestPoint.value} ${meta.unit}` : '--';
              
              return (
                <div 
                  key={key} 
                  className="app-status-row"
                  onClick={() => onSelectComponent(meta.infraKey)} 
                  style={{ cursor: 'pointer' }}
                  title={`Inspect application infrastructure usage on ${infraMetadata[meta.infraKey].name}`}
                >
                  <div className="app-info-block">
                    <span className="app-icon">{meta.icon}</span>
                    <div className="app-meta">
                      <span className="app-name">{meta.name}</span>
                      <div>
                        <span className="app-host">{meta.host}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="app-status-badge-corp" style={{ color }}>{status}</div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{valStr}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
