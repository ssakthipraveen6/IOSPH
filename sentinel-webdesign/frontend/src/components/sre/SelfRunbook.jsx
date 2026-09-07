import React, { useState } from 'react';

const RUNBOOKS_REGISTRY = [
  {
    id: "RB-001",
    name: "Artifactory JVM GC Compactor",
    trigger: "JVM Heap Utilization > 92% (OutOfMemory leak pattern)",
    target: "RHEL VM (Artifactory Nodes)",
    job: "artifactory-jvm-recycle",
    status: "Idle",
    lastRun: "2026-07-27 14:12:05",
    description: "Compact memory pools and force garbage collection sweep without packet drop."
  },
  {
    id: "RB-002",
    name: "Postgres Connection Pool Flush",
    trigger: "PostgreSQL active sessions pool saturation (Lock Anomaly)",
    target: "PostgreSQL Primary Node",
    job: "db-connection-flush",
    status: "Idle",
    lastRun: "2026-07-26 10:15:33",
    description: "Terminate locked idle backend processes and flush TCP socket buffer queues."
  },
  {
    id: "RB-003",
    name: "NAS Disk Space log compact",
    trigger: "Disk utilization > 98% (log spillage signature)",
    target: "NAS volumes /dev/shm",
    job: "nas-log-purge",
    status: "Idle",
    lastRun: "2026-07-27 16:32:00",
    description: "Purge archived debug logs and compact build workspaces."
  },
  {
    id: "RB-004",
    name: "ArgoCD Cluster Sync Revive",
    trigger: "ArgoCD GitOps Sync OutOfSync loop failure",
    target: "Kubernetes Core API",
    job: "argocd-cluster-sync",
    status: "Idle",
    lastRun: "Never",
    description: "Re-synchronize cluster node maps and force refresh cached manifest files."
  },
  {
    id: "RB-005",
    name: "SSO Latency Cache Refresh",
    trigger: "LDAP Auth Response Delay > 5000ms",
    target: "SSO Gateway Auth Proxy",
    job: "sso-cache-evict",
    status: "Idle",
    lastRun: "2026-07-25 18:22:11",
    description: "Clear authenticated session caches and reload credential schemas."
  }
];

export default function SelfRunbook({ onSimulate }) {
  const [runbooks, setRunbooks] = useState(RUNBOOKS_REGISTRY);
  const [runningId, setRunningId] = useState(null);

  const handleTriggerRunbook = (id, jobName, componentKey) => {
    setRunningId(id);
    setRunbooks(prev => prev.map(rb => rb.id === id ? { ...rb, status: "Running" } : rb));
    
    // Simulate recovery trigger backend call
    setTimeout(() => {
      setRunbooks(prev => prev.map(rb => rb.id === id ? { 
        ...rb, 
        status: "Success", 
        lastRun: new Date().toISOString().replace('T', ' ').substring(0, 19) 
      } : rb));
      setRunningId(null);
      
      // Inject alert trigger callback if simulation is active
      if (onSimulate) {
        onSimulate(componentKey || 'database', 'clear');
      }
    }, 4000);
  };

  return (
    <div className="runbooks-container" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div className="section-header-group">
        <h3 className="section-subtitle">AUTONOMOUS RUNBOOKS DECK</h3>
        <h2 className="section-title">Self-Healing Runbooks & Manual Overrides</h2>
        <p className="section-description">
          Contains pre-approved automation policies and self-healing scripts that execute automatically during alerts, or can be triggered manually by operators.
        </p>
      </div>

      <div className="metrics-panel-card">
        <div className="panel-header">
          <h3>Registered Automation Runbooks</h3>
          <span className="badge-teal">{runbooks.length} Active Runbooks</span>
        </div>

        <table className="sentinel-table" style={{ width: '100%', marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Runbook Name</th>
              <th>Trigger Condition</th>
              <th>Target Scope</th>
              <th>Jenkins Job Name</th>
              <th>Last Executed</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {runbooks.map(rb => (
              <tr key={rb.id}>
                <td style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{rb.id}</td>
                <td>
                  <div style={{ fontWeight: '600' }}>{rb.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{rb.description}</div>
                </td>
                <td style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: '500' }}>{rb.trigger}</td>
                <td><span className="badge-gray">{rb.target}</span></td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{rb.job}</td>
                <td>{rb.lastRun}</td>
                <td>
                  <span className={`status-indicator-dot ${
                    rb.status === 'Running' ? 'warning' : rb.status === 'Success' ? 'healthy' : 'idle'
                  }`}></span>
                  {rb.status}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="action-btn-primary"
                    disabled={runningId !== null}
                    onClick={() => {
                      let comp = 'database';
                      if (rb.id === 'RB-001') comp = 'artifactory';
                      if (rb.id === 'RB-003') comp = 'nas_performance';
                      if (rb.id === 'RB-004') comp = 'argocd_k8s';
                      if (rb.id === 'RB-005') comp = 'sso_gateway';
                      handleTriggerRunbook(rb.id, rb.job, comp);
                    }}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                  >
                    {rb.status === 'Running' ? 'Running...' : 'Execute Now'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 
        Colleague Integration Placeholder: SelfRunbook
        -------------------------------------------------
        To integrate your colleague's custom module or automated runbook lists here:
        1. Import the component (e.g., import ColleagueRunbookModule from './ColleagueRunbookModule';)
        2. Render it inside this container with the appropriate runbook actions/triggers data props.
        
        Example:
        <div className="colleague-module-container" style={{ marginTop: '2rem', border: '1px dashed var(--border-light)', padding: '15px', borderRadius: '6px' }}>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '8px' }}>Colleague Runbooks Module</h4>
          Example: ColleagueRunbookModule onSimulate={onSimulate}
        </div>
      */}

    </div>
  );
}
