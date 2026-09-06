import React, { useState, useEffect, useRef } from 'react';
import { MAINTENANCE_CONFIG } from '../../maintenanceConfig';
import { MaintenanceBadge, MaintenanceBanner } from '../shared/MaintenanceNotice';
import AiLogPerformance from '../analytics/AiLogPerformance';
import MiscOperations from './MiscOperations';
import { getStatusColor } from '@sentinel/shared-constants';

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
  onClearLogs,
  environment = 'staging',
  initialSubTab = 'recovery'
}) {
  const currentEnv = environment || healthData?.environment || 'staging';
  const isProdOrStg = currentEnv === 'prod' || currentEnv === 'staging';
  const [activeSubTab, setActiveSubTab] = useState(initialSubTab);
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalEndRef = useRef(null);

  const effectiveLogs = isProdOrStg ? [] : (logs || []);
  const effectiveAlerts = isProdOrStg ? [] : (alerts || []);
  const effectiveRecovery = isProdOrStg ? [] : (recovery || []);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [effectiveLogs, autoScroll]);

  const filteredLogs = effectiveLogs
    .map(log => (typeof log === 'string' ? log : (log ? JSON.stringify(log) : '')))
    .filter(log => log.toLowerCase().includes(searchTerm.toLowerCase()))
    .slice(-150);

  const serviceNowTickets = effectiveAlerts.filter(a => a && a.component === 'servicenow');
  const dynatraceAlerts = effectiveAlerts.filter(a => a && a.component !== 'servicenow');
  const pendingApprovals = effectiveRecovery.filter(r => r && r.status === 'Awaiting-Approval');

  // Compute open vs closed alerts metrics
  const activeAlerts = effectiveAlerts.filter(a => a && a.status === 'Active');
  const resolvedAlerts = effectiveAlerts.filter(a => a && a.status === 'Resolved');

  return (
    <div className="command-center-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* 1. Autonomous Healing & Orchestrator Sub-Navigation Switcher */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '0.9rem 1.25rem',
        background: 'var(--bg-panel)',
        borderRadius: '12px',
        border: '1px solid var(--border-light)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.4rem' }}>⚡</span>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
              Autonomous Healing &amp; Operations Orchestrator
            </h2>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Consolidated Autonomous Triage, Self-Healing Playbook Orchestrator &amp; Operational Runbooks
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-panel-subtle)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          {[
            { id: 'recovery', label: 'Autonomous Recovery Center', icon: '⚡', badge: pendingApprovals.length > 0 ? pendingApprovals.length : null },
            { id: 'playbooks', label: 'Playbook Orchestrator & Logs', icon: '⚙️' },
            { id: 'operations', label: 'Team Operations & Runbooks', icon: '🛠️' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                fontSize: '0.78rem',
                fontWeight: 700,
                borderRadius: '6px',
                cursor: 'pointer',
                border: activeSubTab === tab.id ? '1px solid var(--primary)' : '1px solid transparent',
                background: activeSubTab === tab.id ? 'var(--primary-glass)' : 'transparent',
                color: activeSubTab === tab.id ? '#ffffff' : 'var(--text-muted)',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.badge && (
                <span style={{
                  background: 'var(--critical)',
                  color: '#fff',
                  borderRadius: '10px',
                  padding: '1px 6px',
                  fontSize: '0.65rem',
                  fontWeight: 900
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-Tab 2: Playbook Orchestrator & Logs */}
      {activeSubTab === 'playbooks' && (
        <AiLogPerformance onSimulate={onSimulate} environment={currentEnv} />
      )}

      {/* Sub-Tab 3: Team Operations & Runbooks */}
      {activeSubTab === 'operations' && (
        <MiscOperations environment={currentEnv} />
      )}

      {/* Sub-Tab 1: Autonomous Recovery Center */}
      {activeSubTab === 'recovery' && (
        <>
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
            {pendingApprovals.map(appr => {
              const approvalCount = Array.isArray(appr.approvals) ? appr.approvals.length : 0;
              const approverNames = (appr.approvals || []).map(a => typeof a === 'string' ? a : (a.username || 'Admin')).join(', ');
              return (
                <div key={appr.id || Math.random()} className="approval-row">
                  <div className="appr-details">
                    <span className="appr-comp">{(appr.component || 'SERVICE').toUpperCase()}</span>
                    <span className="appr-action">{appr.action || 'Remediation'}</span>
                    <p className="appr-reason">Trigger Reason: <em>{appr.triggerReason || 'Anomaly detected'}</em></p>
                    <div style={{ fontSize: '0.68rem', color: 'var(--primary)', marginTop: '2px', fontWeight: 600 }}>
                      🛡️ Signatures Collected: {approvalCount} of 2 Required {approvalCount > 0 ? `(Signed by: ${approverNames})` : `(Awaiting initial authorization)`}
                    </div>
                  </div>
                  <div className="appr-actions">
                    <button className="btn-approve" onClick={() => onApproveRecovery && onApproveRecovery(appr.id)}>
                      {approvalCount === 0 ? '✅ Sign Initial Authorization (1st Signature)' : '✅ Sign Dual Authorization (2nd Signature)'}
                    </button>
                  </div>
                </div>
              );
            })}
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
            <div style={{ padding: '10px 12px', background: 'var(--bg-panel-subtle)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderRadius: '8px', border: '1px solid var(--border-light)', fontSize: '0.72rem' }}>
              <span style={{ fontWeight: 800, color: 'var(--primary)' }}>🔒 Four-Eyes Governance:</span>
              <div style={{ color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.4 }}>High-impact recoveries require 2 distinct manager approvals before execution.</div>
            </div>
          </div>
        </div>

        {/* Panel 2: Simulations & Chaos Engineering */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>🧪 Failure & Chaos Engineering Experiments</h3>
            {currentEnv === 'prod' && <span className="status-badge-inline critical" style={{ fontSize: '0.65rem' }}>LOCKED IN PROD</span>}
          </div>
          {currentEnv === 'prod' ? (
            <div style={{ padding: '15px', background: 'var(--critical-glass)', backdropFilter: 'blur(8px)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '8px', fontSize: '0.75rem', color: '#f87171' }}>
              🔒 <strong>Production Safety Guard:</strong> Chaos engineering fault injections are locked in PROD. Switch to <strong>STAGING</strong> to simulate outages, memory leaks, and latency spikes.
            </div>
          ) : (
          <div className="simulator-grid" style={{ display: 'grid', gridTemplateRows: 'repeat(5, 1fr)', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', padding: '4px 6px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontWeight: '700' }}>PostgreSQL Outage</span>
              {simulations.database ? (
                <button className="btn-sim clear" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('database', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('database', 'outage')}>Outage</button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', padding: '4px 6px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontWeight: '700' }}>Artifactory Memory Leak</span>
              {simulations.artifactory ? (
                <button className="btn-sim clear" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('artifactory', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('artifactory', 'memory_leak')}>Leak</button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', padding: '4px 6px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontWeight: '700' }}>NAS Disk Space Full</span>
              {simulations.nas_performance ? (
                <button className="btn-sim clear" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('nas_performance', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('nas_performance', 'disk_full')}>Full</button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', padding: '4px 6px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontWeight: '700' }}>Jenkins K8s Outage</span>
              {simulations.jenkins_k8s ? (
                <button className="btn-sim clear" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('jenkins_k8s', 'clear')}>Clear</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('jenkins_k8s', 'outage')}>Outage</button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', padding: '4px 6px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontWeight: '700', color: 'var(--primary)' }}>⚡ Chaos Network Latency (500ms)</span>
              {simulations.network_latency ? (
                <button className="btn-sim clear" style={{ padding: '3px 10px', fontSize: '0.68rem' }} onClick={() => onSimulate('network_latency', 'clear')}>Reset</button>
              ) : (
                <button className="btn-sim trigger" style={{ padding: '3px 10px', fontSize: '0.68rem', background: '#ec4899', color: '#ffffff' }} onClick={() => onSimulate('network_latency', 'latency_spike')}>Inject Chaos</button>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Panel 3: Stats Summary */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>📊 Alarms & System Summary</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.8rem', textAlign: 'center' }}>
            <div style={{ background: 'var(--bg-panel-subtle)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', padding: '12px 8px', borderRadius: '10px', border: '1px solid var(--border-light)', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: isProdOrStg ? '0.85rem' : '1.4rem', fontWeight: 800, color: isProdOrStg ? 'var(--text-muted)' : 'var(--critical)' }}>{isProdOrStg ? 'Value Not Available' : activeAlerts.length}</div>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Open Alerts</span>
            </div>
            <div style={{ background: 'var(--bg-panel-subtle)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', padding: '12px 8px', borderRadius: '10px', border: '1px solid var(--border-light)', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: isProdOrStg ? '0.85rem' : '1.4rem', fontWeight: 800, color: isProdOrStg ? 'var(--text-muted)' : 'var(--healthy)' }}>{isProdOrStg ? 'Value Not Available' : resolvedAlerts.length}</div>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Closed Alerts</span>
            </div>
            <div style={{ background: 'var(--bg-panel-subtle)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', padding: '12px 8px', borderRadius: '10px', border: '1px solid var(--border-light)', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{healthData.uptime}</div>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Engine Uptime</span>
            </div>
            <div style={{ background: 'var(--bg-panel-subtle)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', padding: '12px 8px', borderRadius: '10px', border: '1px solid var(--border-light)', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: isProdOrStg ? '0.85rem' : '1.4rem', fontWeight: 800, color: isProdOrStg ? 'var(--text-muted)' : 'var(--primary)' }}>{isProdOrStg ? 'Value Not Available' : effectiveRecovery.length}</div>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Healing Triggers</span>
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
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>Value Not Available</div>
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
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>Value Not Available</div>
            ) : (
              [...dynatraceAlerts].reverse().map(alt => {
                const color = getStatusColor(alt.severity);
                return (
                  <div key={alt.id} style={{ padding: '8px', background: 'var(--bg-dark)', borderLeft: `3px solid ${color}`, borderRadius: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 'bold' }}>
                      <span style={{ color }}>{String(alt.severity || '').toUpperCase()}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{new Date(alt.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-main)', marginTop: '4px' }}>{alt.message}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Auto Remediation Jobs status */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>🤖 Jenkins Healing Jobs Status</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto' }}>
            {effectiveRecovery.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>Value Not Available</div>
            ) : (
              [...effectiveRecovery].reverse().map(rec => (
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
          <pre className="terminal-pre" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: isProdOrStg ? '#94a3b8' : '#10b981', maxHeight: '200px', overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
            {filteredLogs.length === 0 ? (isProdOrStg ? `--- Value Not Available: Autonomous healing telemetry is not collected yet for ${currentEnv.toUpperCase()} ---` : '--- Waiting for diagnostics stream ---') : filteredLogs.join('')}
          </pre>
          <div ref={terminalEndRef} />
        </div>
      </div>
      </>
      )}

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
