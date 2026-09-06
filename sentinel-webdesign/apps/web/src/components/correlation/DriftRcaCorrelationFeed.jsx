import React from 'react';
import { DRIFT_RCA_CORRELATION_STATS } from '../../data/correlationData';

export default function DriftRcaCorrelationFeed({ onSelectEntity, onNavigateToTimeline, environment = 'staging' }) {
  const isProdOrStg = environment === 'prod' || environment === 'staging' || environment === 'stg';

  if (isProdOrStg) {
    return (
      <div className="drift-rca-correlation-feed" style={{ marginTop: '2rem', animation: 'fadeIn 0.2s ease-out' }}>
        <div style={{
          background: 'var(--bg-panel)',
          border: '1px dashed var(--border-light)',
          borderRadius: '12px',
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>⚖️</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>Value Not Available</div>
          <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
            Config-Drift-to-RCA Causality telemetry is not collected yet for {environment ? environment.toUpperCase() : 'this environment'}.
          </div>
        </div>
      </div>
    );
  }

  const stats = DRIFT_RCA_CORRELATION_STATS;

  return (
    <div className="drift-rca-correlation-feed" style={{ marginTop: '2rem', animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* Panel Header & Headline Stat */}
      <div style={{
        background: 'var(--bg-panel)',
        border: '1px solid rgba(245, 158, 11, 0.35)',
        borderRadius: '12px',
        padding: '1.25rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, var(--bg-panel) 100%)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.3rem' }}>⚖️</span>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.2px' }}>
                Config-Drift-to-RCA Causality Feed
              </h3>
              <span style={{
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#f59e0b',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.5px'
              }}>
                PREDICTIVE CAUSALITY
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Cross-references undetected infrastructure config drift against subsequent incident and anomaly timestamps.
            </p>
          </div>

          {/* Headline Metric Card */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            background: 'var(--bg-panel-solid)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '8px',
            padding: '10px 16px'
          }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>
                DRIFT PRECURSOR RATIO
              </div>
              <div style={{ fontSize: '0.72rem', color: '#f59e0b' }}>
                Within {stats.timeWindowMinutes} min before outage
              </div>
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#f59e0b', fontFamily: 'var(--font-display, sans-serif)', lineHeight: 1 }}>
              {stats.headlineStat}
            </div>
          </div>
        </div>

        {/* Narrative Callout */}
        <div style={{
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          fontSize: '0.76rem',
          color: 'var(--text-main)',
          marginBottom: '1rem',
          lineHeight: 1.45
        }}>
          💡 <strong>Architectural Finding:</strong> {stats.driftPrecededIncidentsCount} of {stats.totalIncidentsAnalyzed} production incidents analyzed in the {stats.samplePeriod} were directly preceded by unapproved or out-of-band configuration drift on the exact same asset within {stats.timeWindowMinutes} minutes of incident trigger.
        </div>

        {/* Drift-Linked Incidents Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {stats.driftLinkedIncidents.map(item => (
            <div
              key={item.incidentId}
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                background: 'var(--bg-panel-subtle)',
                border: '1px solid var(--border-light)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '0.78rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    background: item.priority.includes('P1') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                    color: item.priority.includes('P1') ? '#ef4444' : '#f59e0b'
                  }}>
                    {item.priority}
                  </span>
                  <strong style={{ color: 'var(--text-main)' }}>{item.incidentId}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>({item.service})</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    background: 'rgba(20, 184, 166, 0.15)',
                    color: 'var(--sentinel-teal, #14b8a6)',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {item.correlationScore}
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}>
                    Lead Time: <strong>{item.leadTimeMinutes} min</strong>
                  </span>
                </div>
              </div>

              {/* Drift & Incident Timeline Details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', background: 'rgba(0,0,0,0.2)', padding: '8px 10px', borderRadius: '6px' }}>
                <div>
                  <span style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 700, display: 'block' }}>
                    1. PRECEDING CONFIG DRIFT ({item.driftTime}):
                  </span>
                  <span style={{ color: 'var(--text-main)', fontSize: '0.74rem' }}>{item.driftEvent}</span>
                </div>
                <div>
                  <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 700, display: 'block' }}>
                    2. SUBSEQUENT OUTAGE TRIGGER ({item.incidentTime}):
                  </span>
                  <span style={{ color: 'var(--text-main)', fontSize: '0.74rem' }}>Incident paged to on-call roster.</span>
                </div>
              </div>

              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <strong>Causality Explanation:</strong> {item.causalityNote}
              </div>

              {/* Quick Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border-light)', paddingTop: '6px' }}>
                {onSelectEntity && (
                  <button
                    onClick={() => onSelectEntity(item.entityId)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--sentinel-teal, #14b8a6)',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Inspect Entity ({item.entityId}) ↗
                  </button>
                )}
                {onNavigateToTimeline && (
                  <button
                    onClick={() => onNavigateToTimeline(item.entityId)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#f59e0b',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    View on Master Timeline ↗
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

      </div>

    </div>
  );
}
