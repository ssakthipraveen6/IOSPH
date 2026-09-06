import React, { useState } from 'react';
import { MASTER_ENTITY_CATALOG } from '../../data/correlationData';
import { getStatusColor, normalizeSeverity, SEVERITY } from '@sentinel/shared-constants';

export default function EntityDrillDownPanel({ 
  entityId, 
  isOpen, 
  onClose, 
  onNavigateToTimeline,
  environment = 'staging',
  historicalMetrics = null
}) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'signals' | 'nodes' | 'drift' | 'topology' | 'incidents' | 'security'

  if (!isOpen || !entityId) return null;

  // Flexible entity resolver that handles 'app-bitbucket', 'bitbucket', or any sub-entity ID
  const entity = MASTER_ENTITY_CATALOG.find(e => 
    e.id === entityId || 
    e.id === `app-${entityId}` || 
    e.id.replace('app-', '') === entityId ||
    e.appKey === entityId ||
    e.id.toLowerCase().includes(entityId.toLowerCase())
  ) || MASTER_ENTITY_CATALOG[0];

  const isProdOrStg = environment === 'prod' || environment === 'staging' || environment === 'stg';

  const metrics = isProdOrStg
    ? {
        p95Latency: 'Value Not Available',
        errorRate: 'Value Not Available',
        throughput: 'Value Not Available',
        saturation: 'Value Not Available'
      }
    : (entity.metrics || { p95Latency: '24 ms', errorRate: '0.00%', throughput: '320 req/s', saturation: '38%' });

  const displayStatus = isProdOrStg ? 'DATA_UNAVAILABLE' : entity.status;
  const driftStatus = isProdOrStg 
    ? { drifted: false, count: 0, summary: 'Value Not Available (Config drift auditing not collected yet for this environment)' }
    : (entity.driftStatus || { drifted: false, count: 0, summary: 'In sync with GitOps baseline' });
  const dependencies = isProdOrStg ? { fanIn: [], fanOut: [] } : (entity.dependencies || { fanIn: [], fanOut: [] });
  const recentIncidents = isProdOrStg ? [] : (entity.recentIncidents || []);
  const recentChanges = isProdOrStg ? [] : (entity.recentChanges || []);
  const expiryItems = isProdOrStg ? [] : (entity.expiryItems || [{ name: 'TLS Certificate', daysLeft: 180, status: 'healthy', issuer: 'DigiCert Corporate CA', autoRenew: 'Automated ACME' }]);
  const backendNodes = isProdOrStg ? [] : (entity.backendNodes || [entity.hostOrIp]);

  return (
    <div 
      className="entity-panel-backdrop" 
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'fadeIn 0.18s ease-out'
      }}
    >
      <div 
        className="entity-panel-slideover"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '620px',
          height: '100%',
          background: 'var(--bg-panel-solid, #0b1329)',
          borderLeft: '1px solid var(--border-light)',
          boxShadow: '-12px 0 45px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          padding: '1.5rem',
          gap: '1.1rem'
        }}
      >
        {/* Header with Close */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-light)', paddingBottom: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>{entity.icon}</span>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.2px' }}>
                {entity.name}
              </h3>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
              ID: <strong style={{ color: 'var(--primary)' }}>{entity.id}</strong> · Type: {entity.type} · Tier: {entity.tier}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-panel-subtle)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-muted)',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 700,
              transition: 'all 0.15s ease'
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Live Health Status & Owner Banner */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          background: displayStatus === 'DATA_UNAVAILABLE' ? 'rgba(148, 163, 184, 0.1)' : `${getStatusColor(displayStatus)}1a`,
          border: `1px solid ${displayStatus === 'DATA_UNAVAILABLE' ? 'rgba(148, 163, 184, 0.25)' : `${getStatusColor(displayStatus)}4d`}`,
          borderRadius: '8px'
        }}>
          <div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>LIVE HEALTH STATUS</div>
            <div style={{ fontSize: '0.92rem', fontWeight: 800, color: displayStatus === 'DATA_UNAVAILABLE' ? '#94a3b8' : getStatusColor(displayStatus), display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: displayStatus === 'DATA_UNAVAILABLE' ? '#94a3b8' : getStatusColor(displayStatus) }}></span>
              {displayStatus === 'DATA_UNAVAILABLE' ? 'Value Not Available' : String(displayStatus || '').toUpperCase()}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>OWNER ASSIGNMENT</div>
            <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{entity.owner}</div>
          </div>
        </div>

        {/* Entity Internal Tabs Navigation Bar */}
        <div style={{
          display: 'flex',
          gap: '5px',
          overflowX: 'auto',
          paddingBottom: '4px',
          borderBottom: '1px solid var(--border-light)'
        }}>
          {[
            { id: 'overview', label: '360° Overview', icon: '🌐' },
            { id: 'signals', label: 'Golden Signals', icon: '📊' },
            { id: 'nodes', label: `Nodes (${backendNodes.length})`, icon: '⚙️' },
            { id: 'drift', label: 'Config Drift', icon: '⚖️' },
            { id: 'topology', label: `Topology (${dependencies.fanIn.length + dependencies.fanOut.length})`, icon: '🔄' },
            { id: 'incidents', label: `Incidents (${recentIncidents.length})`, icon: '⚠️' },
            { id: 'security', label: `Certs (${expiryItems.length})`, icon: '🔒' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: activeTab === tab.id ? 'var(--primary)' : 'transparent',
                background: activeTab === tab.id ? 'rgba(20, 184, 166, 0.15)' : 'transparent',
                color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-muted)',
                fontSize: '0.74rem',
                fontWeight: activeTab === tab.id ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{tab.icon} {tab.label}</span>
            </button>
          ))}
        </div>

        {/* TAB 1: 360° OVERVIEW OR SIGNALS */}
        {(activeTab === 'overview' || activeTab === 'signals') && (
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
              📊 Telemetry &amp; Golden Signals
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <div style={{ padding: '10px 12px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>p95 Latency</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{metrics.p95Latency}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Error Rate</div>
                <div style={{
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  color: (metrics.errorRate === 'Value Not Available' || metrics.errorRate === 'Data Not Available')
                    ? 'var(--text-muted)'
                    : (metrics.errorRate.startsWith('0') ? '#14b8a6' : '#ef4444'),
                  fontFamily: 'var(--font-mono)'
                }}>
                  {metrics.errorRate}
                </div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Throughput</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{metrics.throughput}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Saturation</div>
                <div style={{
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  color: (metrics.saturation === 'Value Not Available' || metrics.saturation === 'Data Not Available')
                    ? 'var(--text-muted)'
                    : (metrics.saturation.includes('9') ? '#ef4444' : '#14b8a6'),
                  fontFamily: 'var(--font-mono)'
                }}>
                  {metrics.saturation}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: BACKEND NODES & ARCHITECTURE */}
        {(activeTab === 'overview' || activeTab === 'nodes') && (
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
              ⚙️ Clustered Backend Nodes &amp; Architecture ({backendNodes.length})
            </div>
            <div style={{
              padding: '12px',
              borderRadius: '8px',
              background: 'var(--bg-panel-subtle)',
              border: '1px solid var(--border-light)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Architecture Specification: <strong style={{ color: 'var(--text-main)' }}>{entity.hostOrIp}</strong>
              </div>
              {backendNodes.length === 0 ? (
                <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                  Value Not Available (Backend nodes telemetry not collected yet for {environment ? environment.toUpperCase() : 'this environment'})
                </div>
              ) : (
                backendNodes.map((node, nIdx) => (
                  <div key={nIdx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'rgba(56, 189, 248, 0.06)',
                    border: '1px solid rgba(56, 189, 248, 0.18)',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-main)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--healthy)' }}></span>
                      <span>{node}</span>
                    </div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--primary)', fontWeight: 700 }}>ACTIVE</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: CONFIG DRIFT & IACOPS */}
        {(activeTab === 'overview' || activeTab === 'drift') && (
          <div style={{
            padding: '12px',
            borderRadius: '8px',
            background: isProdOrStg ? 'var(--bg-panel-subtle)' : (driftStatus.drifted ? 'rgba(245, 158, 11, 0.08)' : 'rgba(20, 184, 166, 0.05)'),
            border: `1px solid ${isProdOrStg ? 'var(--border-light)' : (driftStatus.drifted ? 'rgba(245, 158, 11, 0.3)' : 'var(--border-light)')}`
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: isProdOrStg ? 'var(--text-muted)' : (driftStatus.drifted ? '#f59e0b' : '#14b8a6') }}>
                ⚖️ CONFIG DRIFT &amp; GITOPS AUDIT
              </div>
              <span style={{ fontSize: '0.68rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: isProdOrStg ? 'rgba(148, 163, 184, 0.15)' : (driftStatus.drifted ? '#f59e0b' : '#14b8a6'), color: isProdOrStg ? '#94a3b8' : '#041212' }}>
                {isProdOrStg ? 'VALUE NOT AVAILABLE' : (driftStatus.drifted ? 'DRIFT DETECTED' : 'IN SYNC')}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-main)', marginTop: '4px' }}>
              {driftStatus.summary}
            </div>
            {!isProdOrStg && driftStatus.diff && (
              <pre style={{
                margin: '8px 0 0 0',
                padding: '8px',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontFamily: 'var(--font-mono)',
                color: driftStatus.drifted ? '#fbbf24' : '#34d399',
                overflowX: 'auto'
              }}>
                {driftStatus.diff}
              </pre>
            )}
            {!isProdOrStg && driftStatus.iacFile && (
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '6px' }}>
                Manifest: {driftStatus.iacFile}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: TOPOLOGY & DEPENDENCIES */}
        {(activeTab === 'overview' || activeTab === 'topology') && (
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
              🔄 Topology Fan-In &amp; Fan-Out
            </div>
            {isProdOrStg ? (
              <div style={{ padding: '12px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                Value Not Available (Topology telemetry not collected yet for {environment ? environment.toUpperCase() : 'this environment'})
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem' }}>
                <div style={{ padding: '10px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                  <strong style={{ color: 'var(--primary, #14b8a6)', display: 'block', marginBottom: '4px', fontSize: '0.74rem' }}>▲ Ingress / Upstream ({dependencies.fanIn.length}):</strong>
                  {dependencies.fanIn.length > 0 ? (
                    dependencies.fanIn.map((fi, idx) => (
                      <div key={idx} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', margin: '2px 0' }}>• {fi}</div>
                    ))
                  ) : (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Direct Edge Ingress</div>
                  )}
                </div>
                <div style={{ padding: '10px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                  <strong style={{ color: '#f59e0b', display: 'block', marginBottom: '4px', fontSize: '0.74rem' }}>▼ Downstream / Storage ({dependencies.fanOut.length}):</strong>
                  {dependencies.fanOut.length > 0 ? (
                    dependencies.fanOut.map((fo, idx) => (
                      <div key={idx} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', margin: '2px 0' }}>• {fo}</div>
                    ))
                  ) : (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Stateless / Terminal Node</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: LINKED INCIDENTS & RECENT CHANGES */}
        {(activeTab === 'overview' || activeTab === 'incidents') && (
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
              ⚠️ Recent Linked Incidents &amp; Deployments
            </div>
            {isProdOrStg ? (
              <div style={{ padding: '12px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                Value Not Available (Incident history not collected yet for {environment ? environment.toUpperCase() : 'this environment'})
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {recentIncidents.length > 0 ? (
                  recentIncidents.map((inc, idx) => (
                    <div key={idx} style={{ padding: '8px 10px', background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '6px', fontSize: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                        <span style={{ color: '#ef4444' }}>{inc.id} ({inc.priority})</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{inc.status} {inc.duration ? `• ${inc.duration}` : ''}</span>
                      </div>
                      <div style={{ color: 'var(--text-main)', marginTop: '2px' }}>{inc.title}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '8px 10px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', fontSize: '0.74rem', color: 'var(--healthy)' }}>
                    ✓ 0 Open Incidents for this Entity
                  </div>
                )}
                {recentChanges.map((chg, idx) => (
                  <div key={idx} style={{ padding: '8px 10px', background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: '6px', fontSize: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span style={{ color: 'var(--primary, #14b8a6)' }}>{chg.id}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{chg.type}</span>
                    </div>
                    <div style={{ color: 'var(--text-main)', marginTop: '2px' }}>{chg.desc}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 6: CERTIFICATES & SECURITY */}
        {(activeTab === 'overview' || activeTab === 'security') && (
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
              🔒 TLS Certificates &amp; Secret Authority ({expiryItems.length})
            </div>
            {isProdOrStg ? (
              <div style={{ padding: '12px', background: 'var(--bg-panel-subtle)', borderRadius: '6px', border: '1px solid var(--border-light)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                Value Not Available (Certificate authority telemetry not collected yet for {environment ? environment.toUpperCase() : 'this environment'})
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {expiryItems.map((item, idx) => (
                  <div key={idx} style={{
                    padding: '8px 12px',
                    background: 'var(--bg-panel-subtle)',
                    borderRadius: '6px',
                    border: '1px solid var(--border-light)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.75rem'
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{item.name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Issuer: {item.issuer || 'Enterprise PKI'} · Auto-Renew: {item.autoRenew || 'Automated'}
                      </div>
                    </div>
                    <span style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      fontFamily: 'var(--font-mono)',
                      background: `${getStatusColor(item.status)}33`,
                      color: getStatusColor(item.status)
                    }}>
                      {item.daysLeft} days left
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Button: View on Master Timeline */}
        <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
          <button
            onClick={() => {
              if (onNavigateToTimeline) onNavigateToTimeline(entity.id);
              onClose();
            }}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--primary, #14b8a6)',
              color: '#041212',
              fontWeight: 800,
              fontSize: '0.82rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px var(--primary-glow)'
            }}
          >
            <span>⏱️</span>
            <span>View All Events for this Entity on Master Timeline ↗</span>
          </button>
        </div>

      </div>
    </div>
  );
}
