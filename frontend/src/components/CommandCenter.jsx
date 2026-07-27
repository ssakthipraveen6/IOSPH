import React, { useState, useEffect, useRef } from 'react';

export default function CommandCenter({ 
  logs = [], 
  alerts = [], 
  recovery = [], 
  settings = { autonomousMode: true }, 
  simulations = {}, 
  healthData = { score: 100, uptime: '0h 0m 0s', alertsCount: 0 },
  onToggleAutonomous, 
  onSimulate, 
  onApproveRecovery, 
  onClearLogs 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalEndRef = useRef(null);

  // Auto scroll logic for terminal console
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // High-performance log filtering & buffer slicing (keep last 150 lines)
  const filteredLogs = logs
    .filter(log => log.toLowerCase().includes(searchTerm.toLowerCase()))
    .slice(-150);

  // Group tickets vs dynatrace alerts
  const serviceNowTickets = alerts.filter(a => a.component === 'servicenow');
  const dynatraceAlerts = alerts.filter(a => a.component !== 'servicenow');

  // Find if there are any recoveries currently awaiting approval
  const pendingApprovals = recovery.filter(r => r.status === 'Awaiting-Approval');
  const activeRemediation = recovery.find(r => r.status === 'In-Progress' || r.status === 'Awaiting-Approval');

  // Clear Database Cache handler
  const handleClearDbCache = async () => {
    try {
      const res = await fetch('/api/metrics/clear', { method: 'POST' });
      if (res.ok) {
        alert('[SENTINEL AGENT] Telemetry database cache successfully pruned and compacted.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="command-center-container">
      
      {/* Flashing Pending Approval Banner - Spans 3 columns always */}
      {pendingApprovals.length > 0 && (
        <div className="pending-approvals-alert-box animate-pulse" style={{ marginBottom: '1.5rem' }}>
          <div className="alert-box-header">
            <span className="warning-shield">🚨</span>
            <div>
              <h4>ACTION REQUIRED: Self-Healing Approvals Queue</h4>
              <p>Sentinel Agent requires administrator approval to run corrective recovery workflows.</p>
            </div>
          </div>
          <div className="approvals-list">
            {pendingApprovals.map(appr => (
              <div key={appr.id} className="approval-row">
                <div className="appr-details">
                  <span className="appr-comp">{appr.component.toUpperCase()}</span>
                  <span className="appr-action">{appr.action}</span>
                  <p className="appr-reason">Reason: <em>{appr.triggerReason}</em></p>
                </div>
                <div className="appr-actions">
                  <button className="btn-approve" onClick={() => onApproveRecovery(appr.id)}>
                    ✓ Approve Recovery
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Advanced NOC 3x3 Dashboard Grid */}
      <div className="dashboard-3x3-grid">
        
        {/* ROW 1: Control & Health Statistics */}
        
        {/* Panel 1: Mode Config Deck */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>⚙️ Remediation Configuration</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <div className="toggle-row">
              <span className="toggle-label">Self-Healing</span>
              <button 
                className={`toggle-switch ${settings.autonomousMode ? 'on' : 'off'}`}
                onClick={onToggleAutonomous}
              >
                <div className="slider"></div>
                <span className="state-txt">{settings.autonomousMode ? 'AUTO' : 'MANUAL'}</span>
              </button>
            </div>
            <p className="setting-help-text">
              {settings.autonomousMode 
                ? "AUTO: System automatically restarts failed clusters/databases without requiring approval."
                : "MANUAL: Failures are flagged, creating alert hooks awaiting admin authorization."
              }
            </p>
          </div>
        </div>

        {/* Panel 2: Failure Simulation Deck */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>🧪 Failure Simulation Deck</h3>
          </div>
          <div className="simulator-grid">
            <div className="sim-button-group">
              <label>Jenkins</label>
              {simulations.jenkins_k8s ? (
                <button className="btn-sim clear" onClick={() => onSimulate('jenkins_k8s', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" onClick={() => onSimulate('jenkins_k8s', 'outage')}>Outage</button>
              )}
            </div>
            <div className="sim-button-group">
              <label>Artifactory</label>
              {simulations.artifactory ? (
                <button className="btn-sim clear" onClick={() => onSimulate('artifactory', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" onClick={() => onSimulate('artifactory', 'memory_leak')}>Leak</button>
              )}
            </div>
            <div className="sim-button-group">
              <label>NAS Performance</label>
              {simulations.nas_performance ? (
                <button className="btn-sim clear" onClick={() => onSimulate('nas_performance', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" onClick={() => onSimulate('nas_performance', 'disk_full')}>Full</button>
              )}
            </div>
            <div className="sim-button-group">
              <label>Database</label>
              {simulations.database ? (
                <button className="btn-sim clear" onClick={() => onSimulate('database', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" onClick={() => onSimulate('database', 'outage')}>Outage</button>
              )}
            </div>
          </div>
        </div>

        {/* Panel 3: Global Telemetry Stats */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>📊 Global Health Stats</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.8rem' }}>
            <div style={{ background: 'var(--bg-dark)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
              <strong style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', display: 'block' }}>Health Index</strong>
              <span style={{ fontSize: '1rem', fontWeight: 700 }}>{healthData.score}%</span>
            </div>
            <div style={{ background: 'var(--bg-dark)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
              <strong style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', display: 'block' }}>Active Alarms</strong>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: healthData.alertsCount > 0 ? '#ef4444' : 'inherit' }}>{healthData.alertsCount}</span>
            </div>
            <div style={{ background: 'var(--bg-dark)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
              <strong style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', display: 'block' }}>Uptime</strong>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{healthData.uptime}</span>
            </div>
            <div style={{ background: 'var(--bg-dark)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
              <strong style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', display: 'block' }}>Agent status</strong>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981' }}>ONLINE</span>
            </div>
          </div>
        </div>

        {/* ROW 2: Remediation Actions & Maintenance Deck (Above Logs) */}

        {/* Panel 4: Active Remediation Status */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>🛡️ Active Remediation Operations</h3>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
            {activeRemediation ? (
              <div className="animate-pulse" style={{ padding: '8px', border: '1px dashed var(--primary)', borderRadius: '6px', backgroundColor: 'var(--primary-glow)', width: '100%' }}>
                <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 700, display: 'block' }}>Running runbook</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'block', margin: '4px 0' }}>{activeRemediation.action}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Status: {activeRemediation.status}</span>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                🟢 Core systems stable. No runbooks running.
              </div>
            )}
          </div>
        </div>

        {/* Panel 5: Completed Remediation History */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>📜 Completed Recovery Actions</h3>
          </div>
          <div className="recovery-audit-list">
            {recovery.filter(r => r.status !== 'In-Progress' && r.status !== 'Awaiting-Approval').length === 0 ? (
              <div className="audit-empty-state">No recovery records.</div>
            ) : (
              [...recovery].reverse().map(rec => (
                <div key={rec.id} className="audit-card state-success" style={{ padding: '6px' }}>
                  <div className="audit-card-header">
                    <span className="audit-id">{rec.id}</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#10b981' }}>COMPLETED</span>
                  </div>
                  <div style={{ fontSize: '0.75rem' }}>
                    <div><strong>Target:</strong> {rec.component}</div>
                    <div><strong>Duration:</strong> {rec.duration}s</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Panel 6: Cache & Maintenance Deck */}
        <div className="console-panel" style={{ justifyContent: 'space-between' }}>
          <div className="panel-header">
            <h3>🧹 System Maintenance Deck</h3>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            <span>Database Size: </span>
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{(logs.length * 0.15).toFixed(1)} KB</span>
            <p style={{ marginTop: '4px' }}>Clears in-memory metrics buffers and compacts file storage on local Windows Server disk.</p>
          </div>
          <button 
            className="btn-sim trigger"
            onClick={handleClearDbCache}
            style={{ width: '100%', padding: '6px', fontSize: '0.75rem', marginTop: '8px', fontWeight: 700 }}
          >
            Prune Telemetry Cache
          </button>
        </div>

        {/* ROW 3 & 4: Log terminal & Alerts queue (Bottom Layout) */}

        {/* Panel 7: High-Performance Log Terminal */}
        <div className="console-panel grid-span-2-cols grid-span-2-rows">
          <div className="panel-header terminal-header">
            <h3>💻 Live Diagnostics Feed</h3>
            <input 
              type="text" 
              placeholder="Search console..." 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
              className="terminal-search"
            />
            <div>
              <button className="btn-clear-term" onClick={onClearLogs} style={{ marginRight: '4px' }}>Clear</button>
              <button 
                className={`btn-scrolllock ${autoScroll ? 'active' : ''}`} 
                onClick={() => setAutoScroll(!autoScroll)}
              >
                Auto-scroll
              </button>
            </div>
          </div>
          <div className="terminal-body">
            <pre className="terminal-pre">
              {filteredLogs.length === 0 ? '--- Waiting for poller logs ---' : filteredLogs.join('')}
            </pre>
            <div ref={terminalEndRef} />
          </div>
        </div>

        {/* Panel 8: ServiceNow Board */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>🎫 ServiceNow Integration Queue</h3>
          </div>
          <div className="alerts-feed-wrapper">
            {serviceNowTickets.length === 0 ? (
              <div className="alert-empty-text">No active ServiceNow tickets.</div>
            ) : (
              [...serviceNowTickets].reverse().map(tkt => (
                <div key={tkt.id} className="feed-ticket-card">
                  <div className="feed-ticket-top">
                    <span className="ticket-id">{tkt.id || 'INCIDENT'}</span>
                    <span className="ticket-time">{new Date(tkt.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="feed-ticket-msg">{tkt.message}</p>
                  <div className="feed-ticket-footer">
                    <span>Status: <em className={tkt.status === 'Active' ? 'active-ticket' : 'resolved-ticket'}>{tkt.status}</em></span>
                    {tkt.resolvedAt && <span>Closed: {new Date(tkt.resolvedAt).toLocaleTimeString()}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Panel 9: Dynatrace Incidents Board */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>💥 Dynatrace Incident Feed</h3>
          </div>
          <div className="alerts-feed-wrapper">
            {dynatraceAlerts.length === 0 ? (
              <div className="alert-empty-text">No active Dynatrace incidents.</div>
            ) : (
              [...dynatraceAlerts].reverse().map(alt => (
                <div key={alt.id} className={`feed-alert-card severity-${alt.severity.toLowerCase()}`}>
                  <div className="feed-alert-top">
                    <span className="alert-badge">{alt.severity.toUpperCase()}</span>
                    <span className="alert-time">{new Date(alt.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="feed-alert-msg">{alt.message}</p>
                  <div className="feed-alert-footer">
                    <span>Status: <em className={alt.status === 'Active' ? 'active-alert' : 'resolved-alert'}>{alt.status}</em></span>
                    {alt.resolvedAt && <span>Resolved: {new Date(alt.resolvedAt).toLocaleTimeString()}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
