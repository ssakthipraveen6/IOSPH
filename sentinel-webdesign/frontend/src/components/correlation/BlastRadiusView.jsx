/**
 * Blast radius view: RCA hypotheses, affected entities, and confirm/reject verdicts.
 */
import React, { useState, useEffect } from 'react';
import ReadOnlyActionButton from '../shared/ReadOnlyActionButton';
import { apiFetch } from '../../api';
import './BlastRadiusView.css';

// Sends the user's verdict on an RCA hypothesis to the API.
async function recordHypothesisVerdict(hypothesisId, verdict, notes = '') {
  try {
    const res = await apiFetch(`/api/v2/rca/hypotheses/${hypothesisId}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict, notes })
    });
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

// Blast radius page.
export default function BlastRadiusView({ environment = 'staging', onInspectEntity, demoData = null, readOnly = false }) {
  const [hypotheses, setHypotheses] = useState([]);
  const [selectedHypothesis, setSelectedHypothesis] = useState(null);
  const [blastRadiusData, setBlastRadiusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verdictLoading, setVerdictLoading] = useState(false);
  const [verdictFeedback, setVerdictFeedback] = useState('');
  const [operatorNotes, setOperatorNotes] = useState('');

  const currentEnv = environment || 'staging';

  useEffect(() => {
    // Demo view: render the supplied sample payload, never call the live API.
    if (demoData) {
      const list = demoData.hypotheses || [];
      setHypotheses(list);
      setSelectedHypothesis(list[0] || null);
      setLoading(false);
      return;
    }

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
  }, [currentEnv, demoData]);

  useEffect(() => {
    if (!selectedHypothesis) {
      setBlastRadiusData(null);
      return;
    }

    if (demoData) {
      setBlastRadiusData((demoData.blastRadius || {})[selectedHypothesis.hypothesis_id] || null);
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
  }, [selectedHypothesis, demoData]);

  const handleVerdict = async (verdict) => {
    if (!selectedHypothesis || readOnly || demoData) return;
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
    <div className="blast-radius-view blast-root">
      
      {/* 1. Header Row */}
      <div className="blast-header">
        <h2 className="blast-title">
          Root Cause & Blast Radius Propagation Analyzer
        </h2>
        <div className="blast-subtitle">
          Automated Shared-Infrastructure Fan-Out Engine: Graph Proximity, Causality Direction & Blast Radius Evidence
        </div>
      </div>

      {loading ? (
        <div className="blast-loading">
          🔄 Resolving active root cause hypotheses...
        </div>
      ) : hypotheses.length === 0 ? (
        <div className="blast-empty">
          <div className="blast-empty-icon">🛡️</div>
          <div className="blast-empty-title">No Active Anomalous Hypotheses</div>
          <div className="blast-empty-text">
            All downstream application dependencies and shared storage tiers are operating within nominal thresholds in <strong>{currentEnv.toUpperCase()}</strong>.
          </div>
        </div>
      ) : (
        <div className="blast-layout">
          
          {/* Left Column: Hypothesis Selector List */}
          <div className="blast-panel blast-panel--list">
            <div className="blast-list-label">
              Candidate Hypotheses ({hypotheses.length})
            </div>

            <div className="blast-list">
              {hypotheses.map(hypo => {
                const isSelected = selectedHypothesis && selectedHypothesis.hypothesis_id === hypo.hypothesis_id;
                const confPct = Math.round(hypo.confidence * 100);
                const statusTone = hypo.status === 'confirmed' ? ' blast-hypo-status--confirmed' : (hypo.status === 'rejected' ? ' blast-hypo-status--rejected' : '');

                return (
                  <div
                    key={hypo.hypothesis_id}
                    onClick={() => { setSelectedHypothesis(hypo); setVerdictFeedback(''); }}
                    className={`blast-hypo${isSelected ? ' blast-hypo--selected' : ''}`}
                  >
                    <div className="blast-hypo-head">
                      <span className="blast-hypo-name">
                        {hypo.suspect_entity_id}
                      </span>
                      <span className={`blast-hypo-conf${confPct >= 75 ? ' blast-hypo-conf--high' : ''}`}>
                        {confPct}% Conf.
                      </span>
                    </div>
                    <div className="blast-hypo-radius">
                      Blast Radius: <strong>{hypo.blast_radius} apps degraded</strong>
                    </div>
                    <div className={`blast-hypo-status${statusTone}`}>
                      Status: {hypo.status || 'open'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detailed Blast Radius & Evidence Chain */}
          {selectedHypothesis && (
            <div className="blast-detail">
              
              {/* Top Banner: Suspect Resource & Metrics */}
              <div className="blast-banner">
                <div>
                  <div className="blast-banner-kicker">
                    🚨 IDENTIFIED ROOT CAUSE INFRASTRUCTURE
                  </div>
                  <div className="blast-banner-entity">
                    {selectedHypothesis.suspect_entity_id}
                  </div>
                  <div className="blast-banner-trigger">
                    Trigger Event: <code className="blast-teal">{selectedHypothesis.trigger_event_id}</code>
                  </div>
                </div>

                <div className="blast-metrics">
                  <div className="blast-metric">
                    <div className="blast-metric-label">BLAST RADIUS</div>
                    <div className="blast-metric-value">
                      {selectedHypothesis.blast_radius} <span className="blast-metric-unit">APPS</span>
                    </div>
                  </div>
                  <div className="blast-metric">
                    <div className="blast-metric-label">CONFIDENCE</div>
                    <div className="blast-metric-value blast-metric-value--healthy">
                      {Math.round(selectedHypothesis.confidence * 100)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Affected Applications List */}
              {blastRadiusData && blastRadiusData.affected_applications && (
                <div className="blast-panel">
                  <div className="blast-section-title">
                    Degraded Downstream Applications ({blastRadiusData.affected_applications.length})
                  </div>
                  <div className="blast-apps">
                    {blastRadiusData.affected_applications.map(app => (
                      <span
                        key={app}
                        onClick={() => onInspectEntity && onInspectEntity(app)}
                        className="blast-app-chip"
                      >
                        <span>📦</span> {app}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Ordered Evidence Chain */}
              <div className="blast-panel">
                <div className="blast-section-title blast-section-title--12">
                  Ordered Evidence Chain (Citing Live Event IDs)
                </div>

                <div className="blast-evidence-list">
                  {Array.isArray(selectedHypothesis.rationale) && selectedHypothesis.rationale.map((item, idx) => (
                    <div
                      key={idx}
                      className="blast-evidence"
                    >
                      <div className="blast-evidence-head">
                        <span>STEP {item.step || (idx + 1)}: {item.entity_id || 'System'}</span>
                        {item.event_id && (
                          <span className="blast-evidence-id">
                            ID: {item.event_id}
                          </span>
                        )}
                      </div>
                      <div className="blast-evidence-text">
                        {item.observation || item.claim || JSON.stringify(item)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Operator Feedback & Verdict Loop (T4.4) */}
              <div className="blast-panel">
                <div className="blast-section-title blast-section-title--8">
                  Operator Verification & Feedback Loop (T4.4)
                </div>
                <div className="blast-verdict-help">
                  Submit confirmation or rejection to feed the correlation weight optimizer and fine-tune future scoring.
                </div>

                <div className="blast-verdict-row">
                  <input
                    type="text"
                    placeholder="Optional operator notes (e.g. Storage array failover confirmed by SRE)..."
                    value={operatorNotes}
                    onChange={(e) => setOperatorNotes(e.target.value)}
                    disabled={readOnly}
                    className="blast-notes-input"
                  />
                  {readOnly ? (
                    <>
                      <ReadOnlyActionButton className="blast-verdict-btn blast-verdict-btn--confirm">
                        ✓ Confirm Cause
                      </ReadOnlyActionButton>
                      <ReadOnlyActionButton className="blast-verdict-btn blast-verdict-btn--reject">
                        ✗ Reject
                      </ReadOnlyActionButton>
                    </>
                  ) : (
                  <>
                  <button
                    onClick={() => handleVerdict('confirmed')}
                    disabled={verdictLoading}
                    className="blast-verdict-btn blast-verdict-btn--confirm"
                  >
                    ✓ Confirm Cause
                  </button>
                  <button
                    onClick={() => handleVerdict('rejected')}
                    disabled={verdictLoading}
                    className="blast-verdict-btn blast-verdict-btn--reject"
                  >
                    ✗ Reject
                  </button>
                  </>
                  )}
                </div>

                {verdictFeedback && (
                  <div className="blast-feedback">
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
