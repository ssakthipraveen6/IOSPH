import React, { useState, useEffect, useRef } from 'react';
import { MAINTENANCE_CONFIG } from '../maintenanceConfig';
import { MaintenanceBadge, MaintenanceBanner } from './MaintenanceNotice';

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

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = (logs || [])
    .map(log => (typeof log === 'string' ? log : (log ? JSON.stringify(log) : '')))
    .filter(log => log.toLowerCase().includes(searchTerm.toLowerCase()))
    .slice(-150);

  const serviceNowTickets = (alerts || []).filter(a => a && a.component === 'servicenow');
  const dynatraceAlerts = (alerts || []).filter(a => a && a.component !== 'servicenow');
  const pendingApprovals = (recovery || []).filter(r => r && r.status === 'Awaiting-Approval');

  // Compute open vs closed alerts metrics
  const activeAlerts = (alerts || []).filter(a => a && a.status === 'Active');
  const resolvedAlerts = (alerts || []).filter(a => a && a.status === 'Resolved');

  return (
    <div className="command-center-container" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Flashing Pending Approval Banner with Four-Eyes Dual Authorization Governance */}
      {pendingApprovals.length > 0 && (
        <div className="pending-approvals-alert-box animate-pulse">
          <div className="alert-box-header">
            <span className="warning-shield">🔒</span>
            <div>
              <h4>ACTION REQUIRED: Four-Eyes Dual Authorization Governance Queue</h4>
              <p>Sentinel Agent requires dual-manager approval (Super Admin & SRE Lead) to execute high-impact corrective recovery actions.</p>
            </div>
          </div>
          <div className="approvals-list">
            {pendingApprovals.map(appr => (
              <div key={appr.id || Math.random()} className="approval-row">
                <div className="appr-details">
                  <span className="appr-comp">{(appr.component || 'SERVICE').toUpperCase()}</span>
                  <span className="appr-action">{appr.action || 'Remediation'}</span>
                  <p className="appr-reason">Trigger Reason: <em>{appr.triggerReason || 'Anomaly detected'}</em></p>
                  <div style={{ fontSize: '0.68rem', color: 'var(--primary)', marginTop: '2px', fontWeight: 600 }}>
                    🛡️ Signatures Collected: 1 of 2 Required (DevSecOps Admin signed at {new Date().toLocaleTimeString()})
                  </div>
                </div>
                <div className="appr-actions">
                  <button className="btn-approve" onClick={() => onApproveRecovery && onApproveRecovery(appr.id)}>
                    ✅ Grant Dual Manager Authorization (Four-Eyes)
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section Header */}
      <div className="section-header-group">
        <h3 className="section-subtitle">NOC CONTROL & INCIDENTS CORE</h3>
        <h2 className="section-title">Command Center Console</h2>
        <p className="section-description">
          Monitor active production alarms, configure automated recovery pipelines, execute Chaos Engineering experiments, and trace execution logs.
        </p>
      </div>

      {/* Row 1: Configurations, Simulations & Health Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: '1.5rem' }}>
        
        {/* Panel 1: Remediation Config & Four-Eyes Security */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>⚙️ Remediation & Security Governance</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', gap: '10px' }}>
            <div className="toggle-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="toggle-label" style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>Self-Healing Mode</span>
              <button 
                className={`toggle-switch ${settings.autonomousMode ? 'on' : 'off'}`}
                onClick={onToggleAutonomous}
              >
                <div className="slider"></div>
                <span className="state-txt" style={{ fontSize: '0.65rem' }}>{settings.autonomousMode ? 'AUTO' : 'MANUAL'}</span>
              </button>
            </div>
            <p className="setting-help-text" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {settings.autonomousMode 
                ? "AUTO: Autonomous recovery scripts execute immediately upon alarm detection."
                : "MANUAL: Alarms trigger hooks requiring explicit dual manager approval to resolve."
              }
            </p>
            <div style={{ padding: '8px', background: 'var(--bg-dark)', borderRadius: '4px', border: '1px solid var(--border-light)', fontSize: '0.7rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>🔒 Four-Eyes Governance:</span>
              <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>High-impact recoveries require 2 distinct manager approvals before execution.</div>
            </div>
          </div>
        </div>

        {/* Panel 2: Simulations & Chaos Engineering */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>🧪 Failure & Chaos Engineering Experiments</h3>
          </div>
          <div className="simulator-grid" style={{ display: 'grid', gridTemplateRows: 'repeat(5, 1fr)', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
              <span style={{ fontWeight: 'bold' }}>PostgreSQL Outage</span>
              {simulations.database ? (
                <button className="btn-sim clear" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('database', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('database', 'outage')}>Outage</button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
              <span style={{ fontWeight: 'bold' }}>Artifactory Memory Leak</span>
              {simulations.artifactory ? (
                <button className="btn-sim clear" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('artifactory', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('artifactory', 'memory_leak')}>Leak</button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
              <span style={{ fontWeight: 'bold' }}>NAS Disk Space Full</span>
              {simulations.nas_performance ? (
                <button className="btn-sim clear" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('nas_performance', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('nas_performance', 'disk_full')}>Full</button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
              <span style={{ fontWeight: 'bold' }}>Jenkins K8s Outage</span>
              {simulations.jenkins_k8s ? (
                <button className="btn-sim clear" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('jenkins_k8s', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('jenkins_k8s', 'outage')}>Outage</button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
              <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>⚡ Chaos Network Latency (500ms)</span>
              {simulations.network_latency ? (
                <button className="btn-sim clear" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => onSimulate('network_latency', 'clear')}>Reset</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '2px 8px', fontSize: '0.65rem', background: '#ec4899' }} onClick={() => onSimulate('network_latency', 'latency_spike')}>Inject Chaos</button>
              )}
            </div>
          </div>
        </div>

        {/* Panel 3: Stats Summary */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>📊 Alarms & System Summary</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.8rem', textAlign: 'center' }}>
            <div style={{ background: 'var(--bg-dark)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#ef4444' }}>{activeAlerts.length}</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Open Alerts</span>
            </div>
            <div style={{ background: 'var(--bg-dark)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>{resolvedAlerts.length}</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Closed Alerts</span>
            </div>
            <div style={{ background: 'var(--bg-dark)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--primary)' }}>{healthData.uptime}</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Engine Uptime</span>
            </div>
            <div style={{ background: 'var(--bg-dark)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--primary)' }}>{recovery.length}</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Healing Triggers</span>
            </div>
          </div>
        </div>

      </div>

      {/* Row 2: Alert Feeds & Jobs execution grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
        
        {/* ServiceNow Incidents list */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>
              🎫 ServiceNow Integration Queue
              {MAINTENANCE_CONFIG.tiles.serviceNowTile && <MaintenanceBadge />}
            </h3>
          </div>
          {MAINTENANCE_CONFIG.tiles.serviceNowTile && (
            <div style={{ fontSize: '0.7rem', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '6px 10px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)', marginBottom: '8px', fontWeight: 600 }}>
              🛠️ Under Maintenance — ServiceNow ITSM API sync in progress.
            </div>
          )}
          <div className="alerts-feed-wrapper" style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {serviceNowTickets.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>No active ServiceNow tickets.</div>
            ) : (
              [...serviceNowTickets].reverse().map(tkt => (
                <div key={tkt.id} style={{ padding: '8px', background: 'var(--bg-dark)', borderLeft: '3px solid var(--primary)', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 'bold' }}>
                    <span style={{ color: 'var(--primary)' }}>{tkt.id}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{new Date(tkt.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-main)', marginTop: '4px' }}>{tkt.message}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Dynatrace alerts list */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>💥 Dynatrace Incident Feed</h3>
          </div>
          <div className="alerts-feed-wrapper" style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {dynatraceAlerts.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>No active Dynatrace alerts.</div>
            ) : (
              [...dynatraceAlerts].reverse().map(alt => (
                <div key={alt.id} style={{ padding: '8px', background: 'var(--bg-dark)', borderLeft: `3px solid ${alt.severity === 'Critical' ? '#ef4444' : '#f59e0b'}`, borderRadius: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 'bold' }}>
                    <span style={{ color: alt.severity === 'Critical' ? '#ef4444' : '#f59e0b' }}>{alt.severity.toUpperCase()}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{new Date(alt.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-main)', marginTop: '4px' }}>{alt.message}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Auto Remediation Jobs status */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>🤖 Jenkins Healing Jobs Status</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto' }}>
            {recovery.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>No healing executions.</div>
            ) : (
              [...(recovery || [])].reverse().map(rec => (
                <div key={rec.id || Math.random()} style={{ padding: '8px', background: 'var(--bg-dark)', borderRadius: '4px', borderLeft: `3px solid ${rec.status === 'Success' ? '#10b981' : rec.status === 'In-Progress' ? '#f59e0b' : '#ef4444'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 'bold' }}>
                    <span>{rec.action || 'Remediation Runbook'}</span>
                    <span style={{ color: rec.status === 'Success' ? '#10b981' : '#f59e0b' }}>{rec.status || 'Pending'}</span>
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>Target: {(rec.component || 'SYSTEM').toUpperCase()} | Reason: {rec.triggerReason || 'Anomaly'}</p>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Row 3: Live Diagnostics Terminal Window (At the bottom!) */}
      <div className="console-panel" style={{ padding: '1.5rem' }}>
        <div className="panel-header" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1 }}>
            <h3>💻 Live Diagnostics Feed</h3>
            <input 
              type="text" 
              placeholder="Filter terminal output..." 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
              className="terminal-search"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-light)',
                borderRadius: '4px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                color: 'var(--text-main)',
                width: '240px'
              }}
            />
          </div>
          <div>
            <button className="btn-clear-term" onClick={onClearLogs} style={{ marginRight: '8px', background: 'none', border: '1px solid var(--border-light)', color: 'var(--text-muted)', padding: '2px 10px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer' }}>Clear</button>
            <button 
              className={`btn-scrolllock ${autoScroll ? 'active' : ''}`} 
              onClick={() => setAutoScroll(!autoScroll)}
              style={{ background: autoScroll ? 'var(--primary)' : 'none', border: '1px solid var(--border-light)', color: autoScroll ? '#ffffff' : 'var(--text-muted)', padding: '2px 10px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer' }}
            >
              Auto-scroll
            </button>
          </div>
        </div>

        <div className="terminal-body" style={{ background: '#090d16', padding: '15px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.02)' }}>
          <pre className="terminal-pre" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#10b981', maxHeight: '200px', overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
            {filteredLogs.length === 0 ? '--- Waiting for diagnostics stream ---' : filteredLogs.join('')}
          </pre>
          <div ref={terminalEndRef} />
        </div>
      </div>

      {/* 
        Colleague Integration Placeholder: CommandCenter
        -------------------------------------------------
        To integrate your colleague's custom module or automated action controls here:
        1. Import the component (e.g., import ColleagueCommandModule from './ColleagueCommandModule';)
        2. Render it inside this container with the appropriate logs/alerts data props.
        
        Example:
        <div className="colleague-module-container" style={{ marginTop: '2rem', border: '1px dashed var(--border-light)', padding: '15px', borderRadius: '6px' }}>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '8px' }}>Colleague Command Controls Module</h4>
          Example: ColleagueCommandModule alerts={alerts} recovery={recovery} settings={settings}
        </div>
      */}

    </div>
  );
}
