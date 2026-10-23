/**
 * Host detail page: CPU, memory, disk and processes for one host.
 */
import React, { useState, useEffect } from 'react';
import ComponentPage from '../component/ComponentPage';
import CapacityBar from '../shared/CapacityBar';
import StatusBadge from '../shared/StatusBadge';
import { apiFetch } from '../../api';
import './HostDetailView.css';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'resources', label: 'Resources' },
  { id: 'jvm', label: 'JVM Telemetry' },
  { id: 'processes', label: 'Processes & Capacity' },
  { id: 'logs', label: 'Logs' },
  { id: 'changes', label: 'Changes & Security' }
];

/**
 * Observe › Infrastructure › Linux | Windows › Host Detail.
 *
 * Full host observability view wrapping ComponentPage with dedicated tabs:
 * Overview, Resources, Processes & Capacity, Logs, and Changes & Security.
 */
export default function HostDetailView({
  host = 'localhost',
  hostData = null,
  os = 'linux',
  environment = 'staging',
  onBack = null,
  onNavigateToLogs = null
}) {
  const [activeTab, setActiveTab] = useState('resources');
  const [topProcesses, setTopProcesses] = useState([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [dumpStatus, setDumpStatus] = useState({});
  const kind = os === 'windows' ? 'host_windows' : 'host_linux';
  const hostName = typeof host === 'string' ? host : (host && (host.host || host.name)) || 'localhost';

  useEffect(() => {
    if (activeTab === 'processes') {
      setLoadingProcesses(true);
      apiFetch(`/api/v2/infra/hosts/${encodeURIComponent(hostName)}/processes?limit=5`)
        .then(res => res.json())
        .then(data => {
          setTopProcesses(Array.isArray(data.processes) ? data.processes : []);
        })
        .catch(() => setTopProcesses([]))
        .finally(() => setLoadingProcesses(false));
    }
  }, [activeTab, hostName, environment]);

  const handleCaptureDump = (pid) => {
    setDumpStatus(prev => ({ ...prev, [pid]: 'Requesting...' }));
    apiFetch(`/api/v2/infra/hosts/${encodeURIComponent(hostName)}/processes/${pid}/dump`, {
      method: 'POST'
    })
      .then(res => res.json())
      .then(data => {
        setDumpStatus(prev => ({
          ...prev,
          [pid]: `Queued (${data.attachment_id || 'OK'})`
        }));
      })
      .catch(err => {
        setDumpStatus(prev => ({ ...prev, [pid]: `Failed: ${err.message}` }));
      });
  };

  return (
    <div className="host-detail-view">
      <div className="host-detail-breadcrumbs">
        <button type="button" className="host-breadcrumb-link" onClick={onBack}>
          Infrastructure
        </button>
        <span className="host-breadcrumb-sep">/</span>
        <button type="button" className="host-breadcrumb-link" onClick={onBack}>
          {os === 'windows' ? 'Windows' : 'Linux'}
        </button>
        <span className="host-breadcrumb-sep">/</span>
        <span className="host-breadcrumb-current">{hostName}</span>
      </div>

      <div className="host-detail-header">
        <div className="host-detail-title-group">
          <div className="host-detail-title-row">
            <h2 className="host-detail-title">{hostName}</h2>
            <StatusBadge status={(hostData && hostData.status) || 'HEALTHY'} />
          </div>
          <div className="host-detail-meta">
            <span>OS: {os.toUpperCase()}</span>
            <span>•</span>
            <span>Kind: {kind}</span>
            <span>•</span>
            <span>Environment: {environment}</span>
            {hostData && hostData.product && (
              <>
                <span>•</span>
                <span>Product: {hostData.product}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="host-detail-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`host-tab-btn ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="host-detail-content">
        {activeTab === 'overview' && (
          <div className="host-overview-grid">
            <div className="host-info-card">
              <h3 className="host-info-title">System Information</h3>
              <div className="host-info-row">
                <span className="host-info-label">Hostname</span>
                <span className="host-info-value">{hostName}</span>
              </div>
              <div className="host-info-row">
                <span className="host-info-label">Operating System</span>
                <span className="host-info-value">{os === 'windows' ? 'Windows Server' : 'Linux'}</span>
              </div>
              <div className="host-info-row">
                <span className="host-info-label">Product Owner</span>
                <span className="host-info-value">{(hostData && hostData.product) || 'Unassigned'}</span>
              </div>
              <div className="host-info-row">
                <span className="host-info-label">Current Status</span>
                <span className="host-info-value">{(hostData && hostData.status) || 'HEALTHY'}</span>
              </div>
            </div>

            <div className="host-info-card">
              <h3 className="host-info-title">Agent Telemetry</h3>
              <div className="host-info-row">
                <span className="host-info-label">Agent Reporting</span>
                <span className="host-info-value">
                  {hostData && hostData.agent_state && hostData.agent_state.has_agent ? 'Active' : 'No Agent'}
                </span>
              </div>
              <div className="host-info-row">
                <span className="host-info-label">Agent Version</span>
                <span className="host-info-value">
                  {(hostData && hostData.agent_state && hostData.agent_state.agent_version) || '—'}
                </span>
              </div>
              <div className="host-info-row">
                <span className="host-info-label">Config Drift</span>
                <span className="host-info-value">
                  {(hostData && hostData.agent_state && hostData.agent_state.drift) || 'in_sync'}
                </span>
              </div>
              <div className="host-info-row">
                <span className="host-info-label">Last Heartbeat</span>
                <span className="host-info-value">
                  {(hostData && hostData.agent_state && hostData.agent_state.last_seen)
                    ? new Date(hostData.agent_state.last_seen).toLocaleTimeString()
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'resources' && (
          <ComponentPage
            kind={kind}
            id={hostName}
            environment={environment}
            onNavigateToLogs={onNavigateToLogs}
          />
        )}

        {activeTab === 'jvm' && (
          <ComponentPage
            kind="jvm"
            id={hostName}
            environment={environment}
            onNavigateToLogs={onNavigateToLogs}
          />
        )}

        {activeTab === 'processes' && (
          <div className="host-overview-grid">
            <div className="host-info-card">
              <h3 className="host-info-title">Capacity &amp; Resource Runway</h3>
              <div className="host-info-row">
                <span className="host-info-label">CPU Utilization</span>
                <span className="host-info-value">
                  {typeof (hostData && hostData.cpu_latest) === 'number' ? `${hostData.cpu_latest.toFixed(1)}%` : '—'}
                </span>
              </div>
              <CapacityBar
                used={typeof (hostData && hostData.cpu_latest) === 'number' ? hostData.cpu_latest : 0}
                total={100}
                unit="%"
                label="CPU Usage"
              />
              <div className="host-info-row">
                <span className="host-info-label">Memory Utilization</span>
                <span className="host-info-value">
                  {typeof (hostData && hostData.memory_latest) === 'number' ? `${hostData.memory_latest.toFixed(1)}%` : '—'}
                </span>
              </div>
              <CapacityBar
                used={typeof (hostData && hostData.memory_latest) === 'number' ? hostData.memory_latest : 0}
                total={100}
                unit="%"
                label="Memory Usage"
              />
              <div className="host-info-row">
                <span className="host-info-label">Worst Filesystem</span>
                <span className="host-info-value">
                  {typeof (hostData && hostData.worst_filesystem_pct) === 'number' ? `${hostData.worst_filesystem_pct.toFixed(1)}%` : '—'}
                </span>
              </div>
              <CapacityBar
                used={typeof (hostData && hostData.worst_filesystem_pct) === 'number' ? hostData.worst_filesystem_pct : 0}
                total={100}
                unit="%"
                label="Disk Fill %"
              />
            </div>

            <div className="host-processes-card">
              <div className="host-processes-header">
                <h3 className="host-info-title">Top Processes (CPU &amp; Memory)</h3>
                <span className="host-info-label">Default: Top 5</span>
              </div>
              {loadingProcesses ? (
                <p className="host-info-label">Loading process telemetry...</p>
              ) : topProcesses.length === 0 ? (
                <p className="host-info-label">No process telemetry collected for this host.</p>
              ) : (
                <div className="host-processes-table-wrapper">
                  <table className="host-processes-table">
                    <thead>
                      <tr>
                        <th>PID</th>
                        <th>Name</th>
                        <th>User</th>
                        <th>CPU %</th>
                        <th>Memory</th>
                        <th>I/O Read/Write</th>
                        <th>FDs / Limit</th>
                        <th>Threads</th>
                        <th>State</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProcesses.map(p => (
                        <tr key={p.pid}>
                          <td>{p.pid}</td>
                          <td><strong>{p.name}</strong></td>
                          <td>{p.user || 'system'}</td>
                          <td>{typeof p.cpu_pct === 'number' ? `${p.cpu_pct.toFixed(1)}%` : '—'}</td>
                          <td>{typeof p.memory_rss_bytes === 'number' ? `${(p.memory_rss_bytes / (1024 * 1024)).toFixed(1)} MB` : (typeof p.memory_pct === 'number' ? `${p.memory_pct.toFixed(1)}%` : '—')}</td>
                          <td>{typeof p.io_read_bytes === 'number' ? `${(p.io_read_bytes / 1024).toFixed(0)}KB / ${(p.io_write_bytes / 1024).toFixed(0)}KB` : '—'}</td>
                          <td>{typeof p.fds_open === 'number' ? `${p.fds_open} / ${p.fds_limit || '—'}` : '—'}</td>
                          <td>{p.threads !== undefined ? p.threads : '—'}</td>
                          <td>{p.state || 'R'}</td>
                          <td>
                            <button
                              type="button"
                              className="host-dump-btn"
                              onClick={() => handleCaptureDump(p.pid)}
                              disabled={dumpStatus[p.pid] && dumpStatus[p.pid].startsWith('Queued')}
                            >
                              {dumpStatus[p.pid] || 'Capture Dump'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="host-placeholder-card">
            <p>Structured logs filtered by host <code>{hostName}</code>.</p>
            {onNavigateToLogs && (
              <button
                type="button"
                className="host-tab-btn active"
                onClick={() => onNavigateToLogs(`host:${hostName}`)}
              >
                Open in Logs Explorer →
              </button>
            )}
          </div>
        )}

        {activeTab === 'changes' && (
          <div className="host-placeholder-card">
            <p>File modifications, package updates &amp; security posture for <code>{hostName}</code>.</p>
          </div>
        )}
      </div>
    </div>
  );
}
