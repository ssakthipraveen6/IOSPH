import React, { useState } from 'react';
import { NORMALIZED_TIMELINE_EVENTS } from '../../data/correlationData';
import RcaDashboard from '../analytics/RcaDashboard';
import { SEVERITY, normalizeSeverity } from '@sentinel/shared-constants';

export default function UnifiedCorrelationTimeline({ 
  onInspectEntity, 
  focusedEventId = null,
  environment = 'staging',
  initialSubTab = 'timeline'
}) {
  const [activeTimelineTab, setActiveTimelineTab] = useState(initialSubTab);
  const [selectedRange, setSelectedRange] = useState('6h'); // '1h' | '6h' | '24h' | '7d'
  const [selectedTrack, setSelectedTrack] = useState('all');
  const [activeEvent, setActiveEvent] = useState(() => {
    if (focusedEventId) {
      return NORMALIZED_TIMELINE_EVENTS.find(e => e.id === focusedEventId) || NORMALIZED_TIMELINE_EVENTS[0];
    }
    return NORMALIZED_TIMELINE_EVENTS[0];
  });
  const [searchQuery, setSearchQuery] = useState('');

  const tracks = [
    { id: 'all', name: 'All 12 Swim-Lanes', icon: '🌐' },
    { id: 'app_metrics', name: 'App Metric Anomalies', icon: '🚨' },
    { id: 'infra_metrics', name: 'Infra Metric Anomalies', icon: '⚙️' },
    { id: 'avi_lb', name: 'AVI / VIP Pool Flips', icon: '⚖️' },
    { id: 'dns_gslb', name: 'DNS & GSLB Routing', icon: '📡' },
    { id: 'firewall', name: 'Firewall & Security Rules', icon: '🛡️' },
    { id: 'drift', name: 'Config Drift (IaC vs Live)', icon: '⚖️' },
    { id: 'deploy', name: 'Deployments & GitOps', icon: '🚀' },
    { id: 'chg', name: 'ServiceNow CHG Tickets', icon: '🎫' },
    { id: 'certificates', name: 'Certificates & Expiry', icon: '🔒' },
    { id: 'incidents', name: 'Incident Open / Close', icon: '⚠️' }
  ];

  const isProdOrStg = environment === 'prod' || environment === 'staging' || environment === 'stg';

  const filteredEvents = isProdOrStg ? [] : NORMALIZED_TIMELINE_EVENTS.filter(evt => {
    const matchesEnv = (environment === 'demo') || (!evt.env || evt.env === environment);
    const matchesTrack = selectedTrack === 'all' || evt.trackId === selectedTrack;
    const matchesSearch = searchQuery === '' || 
      evt.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      evt.entityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      evt.summary.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesEnv && matchesTrack && matchesSearch;
  });

  const currentActiveEvent = (activeEvent && filteredEvents.some(e => e.id === activeEvent.id))
    ? activeEvent
    : (filteredEvents[0] || null);

  return (
    <div className="unified-correlation-timeline" style={{ animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 0. Streamlined Mode Switcher: Timeline vs RCA Failure Propagation */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '0.85rem 1.25rem',
        background: 'var(--bg-panel)',
        borderRadius: '12px',
        border: '1px solid var(--border-light)',
        marginBottom: '1.25rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.4rem' }}>⏱️</span>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
              Correlation &amp; Root Cause Analytics Engine
            </h2>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Cross-Layer Chronological Causality, Config Drift &amp; AI Anomaly Failure Propagation
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-panel-subtle)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          {[
            { id: 'timeline', label: 'Multi-Track Correlation Timeline', icon: '⏱️' },
            { id: 'rca', label: 'Root Cause Analytics (RCA) Graph', icon: '🧠' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTimelineTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                fontSize: '0.78rem',
                fontWeight: 700,
                borderRadius: '6px',
                cursor: 'pointer',
                border: activeTimelineTab === tab.id ? '1px solid var(--primary)' : '1px solid transparent',
                background: activeTimelineTab === tab.id ? 'var(--primary-glass)' : 'transparent',
                color: activeTimelineTab === tab.id ? '#ffffff' : 'var(--text-muted)',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mode B: Root Cause Analytics Failure Propagation */}
      {activeTimelineTab === 'rca' && (
        <RcaDashboard 
          environment={environment} 
          onInspectEntity={onInspectEntity}
          onNavigateToTimeline={() => setActiveTimelineTab('timeline')}
        />
      )}

      {/* Mode A: Chronological Multi-Track Timeline */}
      {activeTimelineTab === 'timeline' && (
        <>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '1.25rem',
        background: 'var(--bg-panel)',
        borderRadius: '12px',
        border: '1px solid var(--border-light)',
        marginBottom: '1.5rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>⏱️</span>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--text-main)' }}>
              Unified Cross-Layer Correlation Timeline
            </h2>
            <span style={{
              background: 'rgba(20, 184, 166, 0.15)',
              color: 'var(--sentinel-teal, #14b8a6)',
              border: '1px solid rgba(20, 184, 166, 0.3)',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.5px'
            }}>
              SINGLE SHARED TIME-AXIS
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Chronological multi-track causality engine aligning application anomalies, infra saturation, network path flips, config drift, and deployments on one synchronized time axis.
          </p>
        </div>

        {/* Search & Time Window Range Buttons */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Filter events, assets, tickets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '6px 12px',
              background: 'var(--bg-panel-subtle)',
              border: '1px solid var(--border-light)',
              borderRadius: '6px',
              color: 'var(--text-main)',
              fontSize: '0.78rem',
              outline: 'none',
              width: '220px'
            }}
          />

          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-panel-subtle)', padding: '3px', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
            {[
              { id: '1h', label: '1 Hour' },
              { id: '6h', label: '6 Hours' },
              { id: '24h', label: '24 Hours' },
              { id: '7d', label: '7 Days' }
            ].map(range => (
              <button
                key={range.id}
                onClick={() => setSelectedRange(range.id)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  background: selectedRange === range.id ? 'var(--primary, #14b8a6)' : 'transparent',
                  color: selectedRange === range.id ? '#041212' : 'var(--text-muted)',
                  fontWeight: selectedRange === range.id ? 700 : 500,
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Swim-Lane Track Filter Pills */}
      <div style={{
        display: 'flex',
        gap: '6px',
        overflowX: 'auto',
        paddingBottom: '10px',
        marginBottom: '1rem'
      }}>
        {tracks.map(t => (
          <button
            key={t.id}
            onClick={() => setSelectedTrack(t.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid',
              borderColor: selectedTrack === t.id ? 'var(--sentinel-teal, #14b8a6)' : 'var(--border-light)',
              background: selectedTrack === t.id ? 'rgba(20, 184, 166, 0.15)' : 'var(--bg-panel)',
              color: selectedTrack === t.id ? 'var(--sentinel-teal, #14b8a6)' : 'var(--text-muted)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
          >
            <span>{t.icon}</span>
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      {/* 3. Main Split View: Timeline Stream on Left, Event Causality Detail on Right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(500px, 1.4fr) minmax(340px, 1fr)', gap: '1.25rem' }}>
        
        {/* Left Column: Chronological Multi-Track Timeline Stream */}
        <div style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-light)',
          borderRadius: '12px',
          padding: '1.25rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '8px' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
              Chronological Event Sequence ({filteredEvents.length} Events Detected)
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--primary, #14b8a6)', fontFamily: 'var(--font-mono)' }}>
              Range: {selectedRange.toUpperCase()} · Live Synced
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '680px', overflowY: 'auto', paddingRight: '6px' }}>
            {filteredEvents.length === 0 ? (
              <div style={{
                padding: '2.5rem 1rem',
                textAlign: 'center',
                color: 'var(--text-muted)',
                background: 'var(--bg-panel-subtle)',
                borderRadius: '8px',
                border: '1px dashed var(--border-light)'
              }}>
                <div style={{ fontSize: '1.6rem', marginBottom: '8px' }}>⏱️</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>Value Not Available</div>
                <div style={{ fontSize: '0.74rem', marginTop: '4px' }}>
                  {isProdOrStg 
                    ? `Correlation & RCA timeline telemetry is not being collected yet for ${environment ? environment.toUpperCase() : 'this environment'}.`
                    : `No timeline events found for ${environment ? environment.toUpperCase() : 'this environment'}.`}
                </div>
              </div>
            ) : (
              filteredEvents.map(evt => {
                const isSelected = currentActiveEvent && currentActiveEvent.id === evt.id;
                const normSev = normalizeSeverity(evt.severity);
                const isCritical = normSev === SEVERITY.CRITICAL;
                const isWarning = normSev === SEVERITY.WARNING || normSev === SEVERITY.PREDICTIVE_WARNING;

                return (
                  <div
                    key={evt.id}
                    onClick={() => setActiveEvent(evt)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: isSelected 
                        ? 'var(--sentinel-teal, #14b8a6)' 
                        : isCritical 
                          ? 'rgba(239, 68, 68, 0.3)' 
                          : 'var(--border-light)',
                      background: isSelected 
                        ? 'rgba(20, 184, 166, 0.08)' 
                        : isCritical 
                          ? 'rgba(239, 68, 68, 0.04)' 
                          : 'var(--bg-panel-subtle)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.1rem' }}>{evt.icon}</span>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          fontFamily: 'var(--font-mono)',
                          background: isCritical ? 'rgba(239, 68, 68, 0.2)' : isWarning ? 'rgba(245, 158, 11, 0.2)' : 'rgba(20, 184, 166, 0.2)',
                          color: isCritical ? '#ef4444' : isWarning ? '#f59e0b' : '#14b8a6'
                        }}>
                          {evt.badge}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{evt.trackName}</span>
                      </div>

                      <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                        {evt.relativeTime}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                      {evt.title}
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      {evt.summary}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                      <span>Asset: <strong style={{ color: 'var(--text-main)' }}>{evt.entityName}</strong> ({evt.entityType})</span>
                      <span style={{ color: 'var(--sentinel-teal, #14b8a6)', fontWeight: 600 }}>Click to Inspect Causality →</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Deep Event Causality & Context Detail */}
        {currentActiveEvent ? (
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-light)',
            borderRadius: '12px',
            padding: '1.25rem',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--primary, #14b8a6)', letterSpacing: '0.6px' }}>
                  CORRELATION EVENT INSPECTOR
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
                  {currentActiveEvent.title}
                </div>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {currentActiveEvent.timestamp}
              </span>
            </div>

            {/* Target Asset Identity Card */}
            <div style={{
              padding: '12px',
              background: 'var(--bg-panel-subtle)',
              border: '1px solid var(--border-light)',
              borderRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Target Entity / Resource:</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {currentActiveEvent.entityName}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  Type: {currentActiveEvent.entityType} · ID: {currentActiveEvent.entityId}
                </div>
              </div>

              {onInspectEntity && (
                <button
                  onClick={() => onInspectEntity(currentActiveEvent.entityId)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(20, 184, 166, 0.4)',
                    background: 'rgba(20, 184, 166, 0.15)',
                    color: 'var(--sentinel-teal, #14b8a6)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  🔍 Open in Entity Panel ↗
                </button>
              )}
            </div>

            {/* Technical Payload / Diff Viewer */}
            {currentActiveEvent.details && (
              <div style={{
                background: 'var(--bg-dark, #070b14)',
                border: '1px solid var(--border-light)',
                borderRadius: '8px',
                padding: '12px',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.72rem',
                lineHeight: 1.5,
                color: 'var(--text-main)',
                overflowX: 'auto'
              }}>
                <div style={{ color: 'var(--sentinel-teal, #14b8a6)', fontWeight: 700, marginBottom: '6px', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                  // Event Technical Payload & Telemetry Context
                </div>
                {Object.entries(currentActiveEvent.details).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-dim)' }}>{k}: </span>
                    <span style={{ color: k === 'diff' ? '#f59e0b' : 'inherit' }}>
                      {typeof v === 'string' && v.includes('\n') ? <pre style={{ margin: '4px 0', color: '#f59e0b' }}>{v}</pre> : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Causal Chain Links */}
            <div style={{
              background: 'var(--bg-panel-subtle)',
              border: '1px solid var(--border-light)',
              borderRadius: '8px',
              padding: '12px'
            }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
                🔗 Correlated Predecessors &amp; Blast Chain
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.74rem' }}>
                <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)' }}>
                  <span style={{ color: '#f59e0b' }}>▲ Preceding:</span>
                  <span>Config Drift event occurred 33 min prior on the same node pool</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)' }}>
                  <span style={{ color: '#ef4444' }}>▼ Consequent:</span>
                  <span>Triggered P1 Incident INC0091823 affecting 1,850 developers</span>
                </div>
              </div>
            </div>

          </div>
        ) : (
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-light)',
            borderRadius: '12px',
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{ fontSize: '1.6rem', marginBottom: '8px' }}>🔍</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>Value Not Available</div>
            <div style={{ fontSize: '0.74rem', marginTop: '4px' }}>
              {isProdOrStg 
                ? `Correlation event inspection is not being collected yet for ${environment ? environment.toUpperCase() : 'this environment'}.`
                : 'No event available for inspection in this environment.'}
            </div>
          </div>
        )}

      </div>
      </>
      )}

    </div>
  );
}
