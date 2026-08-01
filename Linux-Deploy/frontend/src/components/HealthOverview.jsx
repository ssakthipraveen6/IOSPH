import React, { useState } from 'react';

// Registry of infra parameters from image table
const infraRegistry = {
  sso: { name: "Identity (SSO & eLDAP)", icon: "🔑", status: "Healthy" },
  avi: { name: "Network Ingress (AVI)", icon: "🌐", status: "Healthy" },
  compute: { name: "Cluster Compute (K8s/RHEL)", icon: "⚙️", status: "Healthy" },
  storage: { name: "Persistent Storage (S3/NAS)", icon: "💾", status: "Healthy" }
};

export default function HealthOverview({ healthData, historicalMetrics, onSelectComponent, activeSimulations }) {
  const { score = 100, componentStatuses = {}, alertsCount = 0, pendingApprovals = 0, uptime = '00:00:00' } = healthData;
  const [selectedFlowApp, setSelectedFlowApp] = useState('artifactory');
  const [hoveredNode, setHoveredNode] = useState(null);

  const getStatusColor = (status) => {
    if (status === 'Critical') return '#ef4444';
    if (status === 'Warning') return '#f59e0b';
    return '#10b981';
  };

  const getStatusClass = (status) => {
    if (status === 'Critical') return 'status-critical';
    if (status === 'Warning') return 'status-warning';
    return 'status-healthy';
  };

  // Exact component specifications mapped from vendor suggested infrastructure layers
  const appRegistry = {
    bitbucket: { name: "Atlassian Bitbucket", login: "SSO Only", server: "RHEL VM", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "NAS Mount" },
    artifactory: { name: "JFrog Artifactory", login: "SSO and eLDAP", server: "RHEL VM", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "S3 Bucket" },
    fortify: { name: "OpenText Fortify SSC", login: "SSO and eLDAP", server: "Windows Server", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "NAS Mount" },
    nexusiq: { name: "Sonatype NexusIQ", login: "SSO and eLDAP", server: "RHEL VM", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "NAS Mount" },
    sonarqube: { name: "SonarQube Enterprise", login: "SSO and eLDAP", server: "RHEL VM", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "NAS Mount" },
    jenkins: { name: "CloudBees Jenkins", login: "SSO Only", server: "Kubernetes (K8s)", avi: "External & Internal AVI", cert: "URL & license validity check", db: "No", nas: "NAS Mount" },
    teamcity: { name: "JetBrains TeamCity", login: "SSO and eLDAP", server: "RHEL VM", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "NAS Mount" },
    argocd: { name: "ArgoCD Hub", login: "SSO & eLDAP with Dax", server: "Kubernetes (K8s)", avi: "External & Internal AVI", cert: "URL & license validity check", db: "No", nas: "No Storage" },
    argoworkflows: { name: "Argo Workflows", login: "SSO & eLDAP with Dax", server: "Kubernetes (K8s)", avi: "External & Internal AVI", cert: "URL & license validity check", db: "No", nas: "No Storage" },
    github: { name: "GitHub Enterprise", login: "SSO and eLDAP", server: "Kubernetes (K8s)", avi: "External & Internal AVI", cert: "URL & license validity check", db: "Unknown", nas: "NAS Mount" },
    bitbucket_external: { name: "Atlassian Bitbucket External", login: "SSO Only", server: "RHEL VM", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "NAS Mount" },
    otkr: { name: "OTKR Security Engine", login: "SSO and eLDAP", server: "RHEL VM", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "NAS Mount" },
    performance_center: { name: "Micro Focus Performance Center", login: "SSO and eLDAP", server: "Windows Server", avi: "External AVI", cert: "URL & license validity check", db: "Yes", nas: "NAS Mount" }
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

  const activeApp = appRegistry[selectedFlowApp];
  const appStatus = componentStatuses[appKeys[selectedFlowApp]] || 'Healthy';

  // Compute status colors of adjacent infra layers based on app requirements
  const ssoStatus = componentStatuses['sso_gateway'] || 'Healthy';
  const aviStatus = componentStatuses['avi_load_balancer'] || 'Healthy';
  const dbStatus = activeApp.db === 'Yes' ? (componentStatuses['database'] || 'Healthy') : 'Inactive';
  
  let hostKey = 'linux_servers';
  if (selectedFlowApp === 'fortify' || selectedFlowApp === 'performance_center') hostKey = 'windows_servers';
  const hostStatus = componentStatuses[hostKey] || 'Healthy';
  
  let nasStatus = 'Inactive';
  if (activeApp.nas === 'NAS Mount') nasStatus = componentStatuses['nas_performance'] || 'Healthy';
  if (activeApp.nas === 'S3 Bucket') nasStatus = componentStatuses['s3_storage'] || 'Healthy';

  return (
    <div className="health-overview-container" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
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
                    stroke: score > 80 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444'
                  }}
                />
              </svg>
              <div className="gauge-text">{score}%</div>
            </div>
            <div className="gauge-labels">
              <h4>MNC Health Index</h4>
              <p>{score > 90 ? 'All Production Systems Stable' : score > 70 ? 'Degraded Performance' : 'Emergency Mitigation Mode'}</p>
            </div>
          </div>
        </div>

        <div className="ribbon-item">
          <div className="ribbon-text-group">
            <span className="ribbon-label">Active Alerts</span>
            <span className="ribbon-value" style={{ color: alertsCount > 0 ? '#ef4444' : 'inherit' }}>{alertsCount}</span>
          </div>
        </div>

        <div className="ribbon-item">
          <div className="ribbon-text-group">
            <span className="ribbon-label">Uptime Diagnostic</span>
            <span className="ribbon-value" style={{ fontFamily: 'monospace' }}>{uptime}</span>
          </div>
        </div>

        <div className="ribbon-item">
          <div className="ribbon-text-group">
            <span className="ribbon-label">Pending Remediations</span>
            <span className="ribbon-value" style={{ color: pendingApprovals > 0 ? '#f59e0b' : 'inherit' }}>{pendingApprovals}</span>
          </div>
        </div>
      </div>

      {/* Global E2E Dependency Flow Mapper */}
      <div className="metrics-panel-card" style={{ padding: '1.5rem' }}>
        <div className="panel-header" style={{ marginBottom: '1.25rem' }}>
          <div>
            <h3>Global E2E Dependency Flow Mapper</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Maps live production component relationships. Select an application key to highlight its end-to-end dependency chain from gateway access down to physical storage mounts.
            </p>
          </div>
          <span className="panel-badge-green">Infrastructure + Application Topology</span>
        </div>

        {/* Application Selector Tabs */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '2rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '1rem' }}>
          {Object.keys(appRegistry).map(key => (
            <button
              key={key}
              onClick={() => setSelectedFlowApp(key)}
              className="nav-tab-btn"
              style={{
                width: 'auto',
                padding: '0.4rem 1rem',
                fontSize: '0.75rem',
                background: selectedFlowApp === key ? 'var(--primary)' : 'rgba(255,255,255,0.02)',
                color: selectedFlowApp === key ? '#ffffff' : 'var(--text-muted)',
                borderColor: selectedFlowApp === key ? 'var(--primary)' : 'var(--border-light)',
              }}
            >
              {appRegistry[key].name}
            </button>
          ))}
        </div>

        {/* E2E Horizontal Path Diagram */}
        <div style={{ overflowX: 'auto', padding: '1.5rem 0', background: 'var(--bg-dark)', borderRadius: '8px', border: '1px solid var(--border-light)', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', minWidth: '950px', padding: '0 1rem' }}>
            
            {/* 1. Identity Gateway */}
            <div 
              onClick={() => onSelectComponent('sso_gateway')}
              onMouseEnter={() => setHoveredNode('sso')}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ 
                textAlign: 'center', 
                flex: 1, 
                cursor: 'pointer', 
                padding: '10px', 
                borderRadius: '6px', 
                border: hoveredNode === 'sso' ? '1px solid var(--primary)' : '1px solid transparent',
                background: hoveredNode === 'sso' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                transition: 'all 0.2s',
                boxShadow: hoveredNode === 'sso' ? '0 4px 12px rgba(0, 0, 0, 0.15)' : 'none'
              }}
              title="Click to view detailed metrics for SSO Gateway"
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🔑</div>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>SSO & eLDAP</h4>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{activeApp.login}</p>
              <span className={`status-badge-inline ${getStatusClass(ssoStatus)}`} style={{ marginTop: '6px' }}>{ssoStatus}</span>
            </div>

            <div style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>➜</div>

            {/* 2. Load Balancer */}
            <div 
              onClick={() => onSelectComponent('avi_load_balancer')}
              onMouseEnter={() => setHoveredNode('avi')}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ 
                textAlign: 'center', 
                flex: 1, 
                cursor: 'pointer', 
                padding: '10px', 
                borderRadius: '6px', 
                border: hoveredNode === 'avi' ? '1px solid var(--primary)' : '1px solid transparent',
                background: hoveredNode === 'avi' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                transition: 'all 0.2s',
                boxShadow: hoveredNode === 'avi' ? '0 4px 12px rgba(0, 0, 0, 0.15)' : 'none'
              }}
              title="Click to view detailed metrics for AVI Load Balancer"
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🌐</div>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>AVI Ingress</h4>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{activeApp.avi}</p>
              <span className={`status-badge-inline ${getStatusClass(aviStatus)}`} style={{ marginTop: '6px' }}>{aviStatus}</span>
            </div>

            <div style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>➜</div>

            {/* 3. Host Platform */}
            <div 
              onClick={() => onSelectComponent(selectedFlowApp === 'fortify' ? 'windows_servers' : 'linux_servers')}
              onMouseEnter={() => setHoveredNode('host')}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ 
                textAlign: 'center', 
                flex: 1, 
                cursor: 'pointer', 
                padding: '10px', 
                borderRadius: '6px', 
                border: hoveredNode === 'host' ? '1px solid var(--primary)' : '1px solid transparent',
                background: hoveredNode === 'host' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                transition: 'all 0.2s',
                boxShadow: hoveredNode === 'host' ? '0 4px 12px rgba(0, 0, 0, 0.15)' : 'none'
              }}
              title="Click to view detailed metrics for compute nodes"
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>💻</div>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>Server VM/K8s</h4>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{activeApp.server}</p>
              <span className={`status-badge-inline ${getStatusClass(hostStatus)}`} style={{ marginTop: '6px' }}>{hostStatus}</span>
            </div>

            <div style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>➜</div>

            {/* 4. Application Service */}
            <div 
              onClick={() => onSelectComponent(appKeys[selectedFlowApp])}
              onMouseEnter={() => setHoveredNode('app')}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ 
                textAlign: 'center', 
                flex: 1, 
                cursor: 'pointer',
                padding: '10px', 
                borderRadius: '6px', 
                border: hoveredNode === 'app' ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                background: hoveredNode === 'app' ? 'rgba(13, 148, 136, 0.15)' : 'var(--primary-glow)',
                transition: 'all 0.2s',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
              }}
              title={`Click to view detailed metrics for ${activeApp.name}`}
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📱</div>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>{activeApp.name}</h4>
              <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{activeApp.cert}</p>
              <span className={`status-badge-inline ${getStatusClass(appStatus)}`} style={{ marginTop: '6px' }}>{appStatus}</span>
            </div>

            <div style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>➜</div>

            {/* 5. Database */}
            <div 
              onClick={() => onSelectComponent('database')}
              onMouseEnter={() => setHoveredNode('database')}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ 
                textAlign: 'center', 
                flex: 1, 
                cursor: 'pointer', 
                padding: '10px', 
                borderRadius: '6px', 
                border: hoveredNode === 'database' ? '1px solid var(--primary)' : '1px solid transparent',
                background: hoveredNode === 'database' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                transition: 'all 0.2s',
                boxShadow: hoveredNode === 'database' ? '0 4px 12px rgba(0, 0, 0, 0.15)' : 'none'
              }}
              title="Click to view database metrics"
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🗄️</div>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>DB Connector</h4>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Required: {activeApp.db}</p>
              <span className={`status-badge-inline ${getStatusClass(dbStatus)}`} style={{ marginTop: '6px' }}>{dbStatus}</span>
            </div>

            <div style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>➜</div>

            {/* 6. Storage Share */}
            <div 
              onClick={() => onSelectComponent(activeApp.nas === 'S3 Bucket' ? 's3_storage' : 'nas_performance')}
              onMouseEnter={() => setHoveredNode('storage')}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ 
                textAlign: 'center', 
                flex: 1, 
                cursor: 'pointer', 
                padding: '10px', 
                borderRadius: '6px', 
                border: hoveredNode === 'storage' ? '1px solid var(--primary)' : '1px solid transparent',
                background: hoveredNode === 'storage' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                transition: 'all 0.2s',
                boxShadow: hoveredNode === 'storage' ? '0 4px 12px rgba(0, 0, 0, 0.15)' : 'none'
              }}
              title="Click to view storage volume metrics"
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>💾</div>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>Storage Mount</h4>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{activeApp.nas}</p>
              <span className={`status-badge-inline ${getStatusClass(nasStatus)}`} style={{ marginTop: '6px' }}>{nasStatus}</span>
            </div>

          </div>
        </div>

        {/* Highlight details box */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1rem' }}>
          <div style={{ padding: '1rem', background: 'var(--bg-dark)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
            <h4 style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--primary)', marginBottom: '6px' }}>Application Access Control & Ingress VIPs</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Traffic passes through the F5/AVI load balancer VIP mapping to reach the target pool. Authenticators require SSO assertion sync against the corporate LDAP directory. Dax authentication layers are invoked dynamically for ArgoCD credentials assertions.
            </p>
          </div>
          <div style={{ padding: '1rem', background: 'var(--bg-dark)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
            <h4 style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--primary)', marginBottom: '6px' }}>Persistent Storage & Licensing Claims</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Artifactory mounts AWS S3 buckets dynamically to host binary repositories, bypassing local storage limits. GitHub, Bitbucket, and Jenkins use physical NAS mount shares to track active pipelines, job history records, and version logs.
            </p>
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
