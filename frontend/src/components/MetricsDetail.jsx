import React, { useState } from 'react';
import CustomChart from './CustomChart';

const infraMetadata = {
  avi_load_balancer: { 
    name: 'Ingress Routing (AVI)', 
    icon: '🌐', 
    desc: 'Ingress load balancer routing traffic across multi-cluster gateways.',
    runbooks: ['Dynamic scaling connection threads', 'Flush connection tables', 'Activate secondary ingress gateway']
  },
  database: { 
    name: 'Database Clusters', 
    icon: '🗄️', 
    desc: 'Relational database clusters serving core application transaction pools.',
    runbooks: ['Scale connection thread limits', 'Failover database to replica node', 'Flush memory pools']
  },
  nas_performance: { 
    name: 'NAS Storage Volumes', 
    icon: '💾', 
    desc: 'Network Attached Storage volume shares mapping persistent filesystems.',
    runbooks: ['Auto-purge temporary build workspaces', 'Compress daily historical logs', 'Trigger disk storage compactors']
  },
  linux_servers: { 
    name: 'Linux Compute Farm', 
    icon: '🐧', 
    desc: 'Linux hypervisor farm executing dockerized container clusters.',
    runbooks: ['Rolling rollout pods restart', 'Garbage Collection recycle JVM', 'Evict zombie shell threads']
  },
  windows_servers: { 
    name: 'Windows Compute Pool', 
    icon: '💻', 
    desc: 'Windows server pool hosting security scanners and background IIS processes.',
    runbooks: ['Restart Fortify scanning tasks', 'Clear IIS thread locks', 'Restart administrative IIS pool']
  },
  s3_storage: { 
    name: 'Object Storage (S3)', 
    icon: '☁️', 
    desc: 'AWS S3 buckets archiving project artifacts and database snapshots.',
    runbooks: ['Switch read operations to replica CDN', 'Flush multipart uploads cache', 'Run index sync tasks']
  }
};

export default function MetricsDetail({ selectedComponent, onComponentChange, historicalMetrics, healthData }) {
  const [timeRange, setTimeRange] = useState('24h');
  const infraMeta = infraMetadata[selectedComponent] || infraMetadata.database;
  const status = healthData.componentStatuses[selectedComponent] || 'Healthy';
  const componentMetrics = historicalMetrics[selectedComponent] || [];

  // Helper to compile datasets for CustomChart
  const getAppDataset = (label, metricName, color) => {
    const points = componentMetrics
      .filter(m => m.metricName === metricName)
      .map(m => ({ timestamp: m.timestamp, value: m.value }));
    return { label, points, color };
  };

  const getStatusBadgeColor = (st) => {
    if (st === 'Critical') return '#ef4444';
    if (st === 'Warning') return '#f59e0b';
    return '#0d9488';
  };

  // Trigger manual self-healing action
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
    if (componentMetrics.length === 0) return;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Timestamp,Infrastructure,Metric Name,Value\n";
    
    componentMetrics.forEach(m => {
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

  // Compile the 3 dynamic comparative charts based on selected infra
  const renderChart = (chartIndex) => {
    if (selectedComponent === 'database') {
      if (chartIndex === 1) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket DB', 'bitbucket_connections', '#3b82f6'),
              getAppDataset('Jenkins DB', 'jenkins_connections', '#ef4444'),
              getAppDataset('Artifactory DB', 'artifactory_connections', '#ec4899'),
              getAppDataset('TeamCity DB', 'teamcity_connections', '#f59e0b')
            ]}
            title="Active DB Connections pool"
            unit="conns"
          />
        );
      }
      if (chartIndex === 2) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket TPS', 'bitbucket_tps', '#3b82f6'),
              getAppDataset('Jenkins TPS', 'jenkins_tps', '#ef4444'),
              getAppDataset('Artifactory TPS', 'artifactory_tps', '#ec4899'),
              getAppDataset('TeamCity TPS', 'teamcity_tps', '#f59e0b')
            ]}
            title="Database Transaction Load (TPS)"
            unit="tps"
          />
        );
      }
      if (chartIndex === 3) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket Latency', 'bitbucket_dbLatency', '#3b82f6'),
              getAppDataset('Jenkins Latency', 'jenkins_dbLatency', '#ef4444'),
              getAppDataset('Artifactory Latency', 'artifactory_dbLatency', '#ec4899'),
              getAppDataset('TeamCity Latency', 'teamcity_dbLatency', '#f59e0b')
            ]}
            title="App-to-DB Response Latency"
            unit="ms"
          />
        );
      }
    }

    if (selectedComponent === 'linux_servers') {
      if (chartIndex === 1) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket', 'bitbucket_cpu', '#3b82f6'),
              getAppDataset('Jenkins', 'jenkins_cpu', '#ef4444'),
              getAppDataset('Artifactory', 'artifactory_cpu', '#ec4899'),
              getAppDataset('NexusIQ', 'nexusiq_cpu', '#14b8a6'),
              getAppDataset('TeamCity', 'teamcity_cpu', '#f59e0b'),
              getAppDataset('MCP Server', 'mcp_cpu', '#8b5cf6'),
              getAppDataset('ArgoCD', 'argocd_cpu', '#0d9488')
            ]}
            title="Container Cluster CPU Allocation"
            unit="%"
          />
        );
      }
      if (chartIndex === 2) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket', 'bitbucket_mem', '#3b82f6'),
              getAppDataset('Jenkins', 'jenkins_mem', '#ef4444'),
              getAppDataset('Artifactory', 'artifactory_mem', '#ec4899'),
              getAppDataset('NexusIQ', 'nexusiq_mem', '#14b8a6'),
              getAppDataset('TeamCity', 'teamcity_mem', '#f59e0b'),
              getAppDataset('MCP Server', 'mcp_mem', '#8b5cf6'),
              getAppDataset('ArgoCD', 'argocd_mem', '#0d9488')
            ]}
            title="Compute Memory Allocation"
            unit="GB"
          />
        );
      }
      if (chartIndex === 3) {
        // Linux compute load factor
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket', 'bitbucket_cpu', '#3b82f6'),
              getAppDataset('Jenkins', 'jenkins_cpu', '#ef4444'),
              getAppDataset('Artifactory', 'artifactory_cpu', '#ec4899')
            ]}
            title="Linux Container Host Load Factor"
            unit="load"
          />
        );
      }
    }

    if (selectedComponent === 'nas_performance') {
      if (chartIndex === 1) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket Storage', 'bitbucket_spaceUsed', '#3b82f6'),
              getAppDataset('Jenkins Jobs', 'jenkins_spaceUsed', '#ef4444'),
              getAppDataset('Artifactory Binaries', 'artifactory_spaceUsed', '#ec4899'),
              getAppDataset('NexusIQ Cache', 'nexusiq_spaceUsed', '#14b8a6'),
              getAppDataset('TeamCity Builds', 'teamcity_spaceUsed', '#f59e0b')
            ]}
            title="NAS Disk Capacity Space Allocation"
            unit="%"
          />
        );
      }
      if (chartIndex === 2) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket IOPS', 'bitbucket_iops', '#3b82f6'),
              getAppDataset('Jenkins IOPS', 'jenkins_iops', '#ef4444'),
              getAppDataset('Artifactory IOPS', 'artifactory_iops', '#ec4899'),
              getAppDataset('NexusIQ IOPS', 'nexusiq_iops', '#14b8a6'),
              getAppDataset('TeamCity IOPS', 'teamcity_iops', '#f59e0b')
            ]}
            title="NAS Mount Disk I/O Operations"
            unit="iops"
          />
        );
      }
      if (chartIndex === 3) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket', 'bitbucket_iops', '#3b82f6'),
              getAppDataset('Jenkins', 'jenkins_iops', '#ef4444'),
              getAppDataset('Artifactory', 'artifactory_iops', '#ec4899')
            ]}
            title="NAS Disk Throughput Volume"
            unit="MB/s"
          />
        );
      }
    }

    if (selectedComponent === 'avi_load_balancer') {
      if (chartIndex === 1) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket Ingress', 'bitbucket_ingressFlow', '#3b82f6'),
              getAppDataset('Jenkins Ingress', 'jenkins_ingressFlow', '#ef4444'),
              getAppDataset('Artifactory Ingress', 'artifactory_ingressFlow', '#ec4899'),
              getAppDataset('ArgoCD Ingress', 'argocd_ingressFlow', '#0d9488')
            ]}
            title="Ingress Traffic Routing Flow Rate"
            unit="Mbps"
          />
        );
      }
      if (chartIndex === 2) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket Client', 'bitbucket_latency', '#3b82f6'),
              getAppDataset('Jenkins Client', 'jenkins_latency', '#ef4444'),
              getAppDataset('Artifactory Client', 'artifactory_latency', '#ec4899'),
              getAppDataset('ArgoCD Client', 'argocd_latency', '#0d9488')
            ]}
            title="API Client Round-Trip Response Latency"
            unit="ms"
          />
        );
      }
      if (chartIndex === 3) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket connections', 'bitbucket_ingressFlow', '#3b82f6'),
              getAppDataset('Jenkins connections', 'jenkins_ingressFlow', '#ef4444'),
              getAppDataset('Artifactory connections', 'artifactory_ingressFlow', '#ec4899')
            ]}
            title="Active Ingress Client Connections"
            unit="conns"
          />
        );
      }
    }

    if (selectedComponent === 's3_storage') {
      if (chartIndex === 1) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket Backups', 'bitbucket_space', '#3b82f6'),
              getAppDataset('Jenkins Bundles', 'jenkins_space', '#ef4444'),
              getAppDataset('Artifactory Store', 'artifactory_space', '#ec4899'),
              getAppDataset('Fortify Reports', 'fortify_space', '#f59e0b'),
              getAppDataset('TeamCity Builds', 'teamcity_space', '#8b5cf6')
            ]}
            title="AWS S3 Object Capacity Consumed"
            unit="GB"
          />
        );
      }
      if (chartIndex === 2) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket', 'bitbucket_bandwidth', '#3b82f6'),
              getAppDataset('Jenkins', 'jenkins_bandwidth', '#ef4444'),
              getAppDataset('Artifactory', 'artifactory_bandwidth', '#ec4899')
            ]}
            title="AWS S3 Object Transfer Bandwidth"
            unit="MB/s"
          />
        );
      }
      if (chartIndex === 3) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Bitbucket', 'bitbucket_bandwidth', '#3b82f6'),
              getAppDataset('Jenkins', 'jenkins_bandwidth', '#ef4444'),
              getAppDataset('Artifactory', 'artifactory_bandwidth', '#ec4899')
            ]}
            title="AWS S3 Bucket API HTTP Requests Rate"
            unit="req/s"
          />
        );
      }
    }

    if (selectedComponent === 'windows_servers') {
      if (chartIndex === 1) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Fortify Scan CPU', 'fortify_cpu', '#f59e0b')
            ]}
            title="Fortify Windows Compute CPU Utilization"
            unit="%"
          />
        );
      }
      if (chartIndex === 2) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('Fortify Scan Memory', 'fortify_mem', '#f59e0b')
            ]}
            title="Fortify Windows Compute Memory Allocation"
            unit="GB"
          />
        );
      }
      if (chartIndex === 3) {
        return (
          <CustomChart 
            datasets={[
              getAppDataset('IIS Threads', 'iis_threads', '#3b82f6'),
              getAppDataset('IIS Active Sessions', 'iis_sessions', '#10b981')
            ]}
            title="IIS Active Web Threads & Sessions"
            unit="count"
          />
        );
      }
    }

    return <div className="empty-chart"><p>No chart timeline configured.</p></div>;
  };

  return (
    <div className="metrics-detail-container">
      
      {/* Dynamic Selector Ribbon */}
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
              {Object.keys(infraMetadata).map(k => (
                <option key={k} value={k}>{infraMetadata[k].icon} {infraMetadata[k].name}</option>
              ))}
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

      {/* Advanced NOC 3x3 Dashboard Grid */}
      <div className="dashboard-3x3-grid">
        
        {/* Panel 1: Infra Description Deck */}
        <div className="console-panel component-summary-card">
          <div className="title-row">
            <h2>{infraMeta.icon} {infraMeta.name} Info Deck</h2>
            <span className="status-pill" style={{ backgroundColor: getStatusBadgeColor(status) }}>
              {status}
            </span>
          </div>
          <p className="component-desc" style={{ flex: 1 }}>{infraMeta.desc}</p>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
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

        {/* Panel 5: Self-Healing Runbook Status */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>🛡️ Automated Remediation Runbooks</h3>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {infraMeta.runbooks.map((rb, idx) => (
              <div key={idx} style={{ fontSize: '0.75rem', padding: '6px 10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#0d9488', fontWeight: 700 }}>#{idx+1}</span>
                <span style={{ fontWeight: 500 }}>{rb}</span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '6px' }}>
            Remediation Trigger: Active Telemetry Outage Event.
          </span>
        </div>

        {/* Panel 6: Raw Telemetry Logs Table */}
        <div className="console-panel">
          <div className="table-panel-header">🗄️ Telemetry Logs (Recent)</div>
          <div className="table-wrapper">
            <table className="telemetry-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Metric Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {componentMetrics.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="table-empty">No telemetry records in DB.</td>
                  </tr>
                ) : (
                  componentMetrics.slice(-10).reverse().map((m, idx) => (
                    <tr key={idx}>
                      <td>{new Date(m.timestamp).toLocaleTimeString()}</td>
                      <td className="metric-name-cell" style={{ color: '#0d9488' }}>{m.metricName}</td>
                      <td className="metric-val-cell">{m.value}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Panel 7: Alarm Diagnostics Summary */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>📈 Dynamic Diagnostics</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1 }}>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', display: 'block', fontWeight: 600 }}>Collected Records</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>{componentMetrics.length}</span>
            </div>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', display: 'block', fontWeight: 600 }}>Active Outages</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: status === 'Healthy' ? '#10b981' : '#ef4444' }}>{status === 'Healthy' ? '0' : '1'}</span>
            </div>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', display: 'block', fontWeight: 600 }}>Node Status</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0d9488', textTransform: 'uppercase' }}>ONLINE</span>
            </div>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', display: 'block', fontWeight: 600 }}>Aggregated Health</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>100% Stable</span>
            </div>
          </div>
        </div>

        {/* Panel 8: Manual Remediation Action Controls */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>🛠️ Manual Remediation Actions</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, justifyContent: 'center' }}>
            <button 
              className="btn-sim trigger"
              onClick={() => handleManualRunbookTrigger(infraMeta.runbooks[0])}
              style={{ padding: '8px', fontSize: '0.75rem', width: '100%', fontWeight: 700 }}
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
              style={{ padding: '8px', fontSize: '0.75rem', width: '100%', fontWeight: 700 }}
            >
              ✓ Clear System Alarms & Diagnostics
            </button>
          </div>
        </div>

        {/* Panel 9: CSV Report Exporter */}
        <div className="console-panel" style={{ justifyContent: 'space-between' }}>
          <div className="panel-header">
            <h3>📊 CSV Report Exporter</h3>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4, margin: '8px 0' }}>
            Generates and extracts tabular spreadsheet reports detailing comparative metrics logs.
          </p>
          <button 
            className="btn-csv" 
            onClick={handleDownloadCSV} 
            disabled={componentMetrics.length === 0}
            style={{ width: '100%', padding: '8px 0', fontSize: '0.8rem' }}
          >
            📥 Export Observability CSV
          </button>
        </div>

      </div>
    </div>
  );
}
