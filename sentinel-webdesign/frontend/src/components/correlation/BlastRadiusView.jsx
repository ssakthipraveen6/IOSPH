import React, { useState, useEffect } from 'react';
import { recordHypothesisVerdict } from '../../data/correlationData';

export default function BlastRadiusView({ environment = 'staging', onInspectEntity }) {
  const [hypotheses, setHypotheses] = useState([]);
  const [selectedHypothesis, setSelectedHypothesis] = useState(null);
  const [blastRadiusData, setBlastRadiusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verdictLoading, setVerdictLoading] = useState(false);
  const [verdictFeedback, setVerdictFeedback] = useState('');
  const [operatorNotes, setOperatorNotes] = useState('');

  const currentEnv = environment || 'staging';

  useEffect(() => {
    async function loadHypotheses() {
      setLoading(true);
      try {
        const res = await fetch(`/api/v2/rca/hypotheses?environment=${currentEnv}`);
        if (res.ok) {
          const list = await res.json();
          setHypotheses(list || []);
          if (list.length > 0) {
            setSelectedHypothesis(list[0]);
          }
        }
      } catch (_) {}
      finally {
        setLoading(false);
      }
    }

    loadHypotheses();
  }, [currentEnv]);

  useEffect(() => {
    if (!selectedHypothesis) {
      setBlastRadiusData(null);
      return;
    }

    async function loadBlastRadius() {
      try {
        const res = await fetch(`/api/v2/rca/blast-radius?hypothesis_id=${selectedHypothesis.hypothesis_id}`);
        if (res.ok) {
          const data = await res.json();
          setBlastRadiusData(data);
        }
      } catch (_) {}
    }

    loadBlastRadius();
  }, [selectedHypothesis]);

  const handleVerdict = async (verdict) => {
    if (!selectedHypothesis) return;
    setVerdictLoading(true);
    setVerdictFeedback('');

    try {
      const res = await recordHypothesisVerdict(selectedHypothesis.hypothesis_id, verdict, operatorNotes);
      if (res && res.success) {
        setVerdictFeedback(`✓ Verdict recorded: Hypothesis marked as "${verdict.toUpperCase()}" by Operator.`);
        setSelectedHypothesis(prev => ({ ...prev, status: verdict }));
      } else {
        setVerdictFeedback(`⚠️ Could not save verdict: ${res.error || 'Server error'}`);
      }
    } catch (err) {
      setVerdictFeedback(`⚠️ ${err.message}`);
    } finally {
      setVerdictLoading(false);
    }
  };

  return (
    <div className="blast-radius-view" style={{ animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Header Row */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
          Root Cause & Blast Radius Propagation Analyzer
        </h2>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          Automated Shared-Infrastructure Fan-Out Engine: Graph Proximity, Causality Direction & Blast Radius Evidence
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          🔄 Resolving active root cause hypotheses...
        </div>
      ) : hypotheses.length === 0 ? (
        <div style={{
          padding: '3rem',
          textAlign: 'center',
          color: 'var(--text-muted)',
          background: 'var(--bg-panel)',
          borderRadius: '12px',
          border: '1px dashed var(--border-light)'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🛡️</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>No Active Anomalous Hypotheses</div>
          <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
            All downstream application dependencies and shared storage tiers are operating within nominal thresholds in <strong>{currentEnv.toUpperCase()}</strong>.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px' }}>
          
          {/* Left Column: Hypothesis Selector List */}
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-light)',
            borderRadius: '12px',
            padding: '1rem',
            height: 'fit-content'
          }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase' }}>
              Candidate Hypotheses ({hypotheses.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {hypotheses.map(hypo => {
                const isSelected = selectedHypothesis && selectedHypothesis.hypothesis_id === hypo.hypothesis_id;
                const confPct = Math.round(hypo.confidence * 100);

                return (
                  <div
                    key={hypo.hypothesis_id}
                    onClick={() => { setSelectedHypothesis(hypo); setVerdictFeedback(''); }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: isSelected ? 'rgba(20, 184, 166, 0.12)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isSelected ? 'var(--sentinel-teal, #14b8a6)' : 'var(--border-light)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {hypo.suspect_entity_id}
                      </span>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        color: confPct >= 75 ? '#10b981' : '#f59e0b'
                      }}>
                        {confPct}% Conf.
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Blast Radius: <strong>{hypo.blast_radius} apps degraded</strong>
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      marginTop: '6px',
                      textTransform: 'uppercase',
                      color: hypo.status === 'confirmed' ? '#10b981' : (hypo.status === 'rejected' ? '#ef4444' : '#94a3b8'),
                      fontWeight: 700
                    }}>
                      Status: {hypo.status || 'open'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detailed Blast Radius & Evidence Chain */}
          {selectedHypothesis && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Top Banner: Suspect Resource & Metrics */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, var(--bg-panel) 100%)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: '12px',
                padding: '1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#ef4444', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    🚨 IDENTIFIED ROOT CAUSE INFRASTRUCTURE
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
                    {selectedHypothesis.suspect_entity_id}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Trigger Event: <code style={{ color: 'var(--sentinel-teal, #14b8a6)' }}>{selectedHypothesis.trigger_event_id}</code>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>BLAST RADIUS</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#ef4444' }}>
                      {selectedHypothesis.blast_radius} <span style={{ fontSize: '0.85rem' }}>APPS</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CONFIDENCE</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#10b981' }}>
                      {Math.round(selectedHypothesis.confidence * 100)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Affected Applications List */}
              {blastRadiusData && blastRadiusData.affected_applications && (
                <div style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '12px',
                  padding: '1.25rem'
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '10px' }}>
                    Degraded Downstream Applications ({blastRadiusData.affected_applications.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {blastRadiusData.affected_applications.map(app => (
                      <span
                        key={app}
                        onClick={() => onInspectEntity && onInspectEntity(app)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.12)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#f87171',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span>📦</span> {app}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Ordered Evidence Chain */}
              <div style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-light)',
                borderRadius: '12px',
                padding: '1.25rem'
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '12px' }}>
                  Ordered Evidence Chain (Citing Live Event IDs)
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {Array.isArray(selectedHypothesis.rationale) && selectedHypothesis.rationale.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: 'rgba(0,0,0,0.25)',
                        borderLeft: '4px solid var(--sentinel-teal, #14b8a6)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span>STEP {item.step || (idx + 1)}: {item.entity_id || 'System'}</span>
                        {item.event_id && (
                          <span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>
                            ID: {item.event_id}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '4px' }}>
                        {item.observation || item.claim || JSON.stringify(item)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Operator Feedback & Verdict Loop (T4.4) */}
              <div style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-light)',
                borderRadius: '12px',
                padding: '1.25rem'
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
                  Operator Verification & Feedback Loop (T4.4)
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  Submit confirmation or rejection to feed the correlation weight optimizer and fine-tune future scoring.
                </div>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px' }}>
                  <input
                    type="text"
                    placeholder="Optional operator notes (e.g. Storage array failover confirmed by SRE)..."
                    value={operatorNotes}
                    onChange={(e) => setOperatorNotes(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: 'var(--bg-dark)',
                      border: '1px solid var(--border-light)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem'
                    }}
                  />
                  <button
                    onClick={() => handleVerdict('confirmed')}
                    disabled={verdictLoading}
                    style={{
                      background: '#10b981',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    ✓ Confirm Cause
                  </button>
                  <button
                    onClick={() => handleVerdict('rejected')}
                    disabled={verdictLoading}
                    style={{
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#ef4444',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    ✗ Reject
                  </button>
                </div>

                {verdictFeedback && (
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--sentinel-teal, #14b8a6)' }}>
                    {verdictFeedback}
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
}
