/**
 * Evidence packs: download the evidence report for a problem.
 */
import React, { useState, useEffect } from 'react';
import DataTable from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import SeverityPill from '../shared/SeverityPill';
import ReadOnlyActionButton from '../shared/ReadOnlyActionButton';
import { apiFetch } from '../../api';
import './Respond.css';

// Evidence packs page.
export default function EvidencePacksView({ environment = 'staging', demoData = null, readOnly = false }) {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);

  // AI draft modal
  const [selectedProblemForAi, setSelectedProblemForAi] = useState(null);
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [aiDraftResult, setAiDraftResult] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    // Demo view: render the supplied sample payload, never call the live API.
    if (demoData) {
      setProblems(demoData.problems || []);
      setLoading(false);
      return () => { active = false; };
    }

    fetch(`/api/problems?environment=${encodeURIComponent(environment)}`)
      .then(r => r.json())
      .then(data => {
        if (active) {
          setProblems(data.problems || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setProblems([]);
          setLoading(false);
        }
      });

    return () => { active = false; };
  }, [environment, demoData]);

  async function handleGenerateAiDraft(problem) {
    if (readOnly || demoData) return;
    setSelectedProblemForAi(problem);
    setAiDraftLoading(true);
    setAiDraftResult(null);

    try {
      const res = await apiFetch('/api/v2/ai/draft-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId: problem.id, evidence: problem })
      });
      const data = await res.json();
      setAiDraftResult(data);
    } catch (err) {
      setAiDraftResult({ error: err.message });
    } finally {
      setAiDraftLoading(false);
    }
  }

  const columns = [
    {
      key: 'id',
      header: 'Problem ID',
      sortable: true,
      render: (val) => <code className="evp-id">{val}</code>
    },
    {
      key: 'title',
      header: 'Incident Title',
      sortable: true,
      render: (val) => <strong>{val}</strong>
    },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (val) => <SeverityPill severity={val} />
    },
    {
      key: 'top_layer',
      header: 'Identified Cause',
      sortable: true,
      render: (val) => <span className="evp-layer">{val || 'General'}</span>
    },
    {
      key: 'actions',
      header: 'Evidence Pack & AI',
      render: (_, row) => readOnly ? (
        <div className="evp-actions">
          <ReadOnlyActionButton className="time-picker__btn time-picker__btn--active">HTML ↗</ReadOnlyActionButton>
          <ReadOnlyActionButton>PDF ↗</ReadOnlyActionButton>
          <ReadOnlyActionButton className="time-picker__btn evp-ai-btn">
            AI Summary ✦
          </ReadOnlyActionButton>
        </div>
      ) : (
        <div className="evp-actions">
          <a
            href={`/api/problems/${row.id}/evidence?format=html`}
            target="_blank"
            rel="noopener noreferrer"
            className="time-picker__btn time-picker__btn--active"
          >
            HTML ↗
          </a>
          <a
            href={`/api/problems/${row.id}/evidence?format=pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="time-picker__btn"
          >
            PDF ↗
          </a>
          <button
            type="button"
            className="time-picker__btn evp-ai-btn"
            onClick={() => handleGenerateAiDraft(row)}
          >
            AI Summary ✦
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="evp-root">
      <div className="evp-card">
        <div className="evp-card-header">
          <h3 className="evp-title">
            Incident Evidence Packs & AI Summaries (Tasks 5.5, 7.3)
          </h3>
          <span className="evp-subtle">
            Automated executive summaries, SVG degradation timelines, prefilled ServiceNow tickets, and internal LLM briefing drafts
          </span>
        </div>

        {loading ? (
          <div className="evp-loading">
            Loading evidence packs...
          </div>
        ) : problems.length === 0 ? (
          <EmptyState
            title="Zero Incidents"
            description={`No problems or evidence packs currently recorded for ${environment}.`}
            environment={environment}
          />
        ) : (
          <DataTable
            columns={columns}
            data={problems}
            rowKey="id"
          />
        )}
      </div>

      {/* AI Draft Summary Modal */}
      {selectedProblemForAi && (
        <div className="evp-modal-backdrop">
          <div className="evp-modal">
            <div className="evp-modal-head">
              <div className="evp-modal-title-row">
                <h3 className="evp-modal-title">Evidence Pack AI Summary</h3>
                <span className="evp-ai-tag">
                  AI draft
                </span>
              </div>
              <button
                type="button"
                className="time-picker__btn"
                onClick={() => setSelectedProblemForAi(null)}
              >
                ✕
              </button>
            </div>

            <div className="evp-subtle">
              Incident: <strong className="evp-strong">{selectedProblemForAi.title}</strong> ({selectedProblemForAi.id})
            </div>

            {aiDraftLoading ? (
              <div className="evp-loading">
                Generating internal LLM briefing summary...
              </div>
            ) : aiDraftResult?.error ? (
              <div className="evp-error">
                {aiDraftResult.error}
              </div>
            ) : (
              <div className="evp-draft">
                {aiDraftResult?.text || 'No summary returned'}
              </div>
            )}

            <div className="evp-modal-foot">
              <button
                type="button"
                className="time-picker__btn time-picker__btn--active"
                onClick={() => setSelectedProblemForAi(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
