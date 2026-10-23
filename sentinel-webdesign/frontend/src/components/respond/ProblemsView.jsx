/**
 * Problems view: open problems with affected entities and details.
 */
import React, { useState, useEffect } from 'react';
import SeverityPill from '../shared/SeverityPill';
import EntityChip from '../shared/EntityChip';
import DataTable from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import ReadOnlyActionButton from '../shared/ReadOnlyActionButton';
import './Respond.css';

// Problems page.
export default function ProblemsView({ environment = 'staging', demoData = null, readOnly = false }) {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProblem, setSelectedProblem] = useState(null);

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

  const columns = [
    {
      key: 'id',
      header: 'Problem ID',
      sortable: true,
      render: (val) => <code className="prb-id">{val}</code>
    },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (val) => <SeverityPill severity={val} />
    },
    {
      key: 'title',
      header: 'Incident Title',
      sortable: true,
      render: (val, row) => (
        <div>
          <div className="prb-row-title">{val}</div>
          <div className="prb-subtle">
            Detected: {row.created_at ? new Date(row.created_at).toLocaleString() : 'Recent'}
          </div>
        </div>
      )
    },
    {
      key: 'top_layer',
      header: 'Diagnosis Layer',
      sortable: true,
      render: (val, row) => (
        <EntityChip
          entityId={row.suspect_entity || val || 'general'}
          layer={val}
        />
      )
    },
    {
      key: 'confidence',
      header: 'RCA Confidence',
      sortable: true,
      render: (val) => (
        <span className="prb-mono">
          {val ? `${Math.round(val * 100)}%` : '—'}
        </span>
      )
    },
    {
      key: 'alert_count',
      header: 'Folded Alerts',
      sortable: true,
      render: (val) => (
        <span className="prb-mono prb-semibold">{val || 1}</span>
      )
    },
    {
      key: 'actions',
      header: 'Evidence Pack',
      render: (_, row) => readOnly ? (
        <div className="prb-actions">
          <ReadOnlyActionButton className="time-picker__btn time-picker__btn--active">HTML</ReadOnlyActionButton>
          <ReadOnlyActionButton>PDF</ReadOnlyActionButton>
        </div>
      ) : (
        <div className="prb-actions">
          <a
            href={`/api/problems/${row.id}/evidence?format=html`}
            target="_blank"
            rel="noopener noreferrer"
            className="time-picker__btn time-picker__btn--active"
          >
            HTML
          </a>
          <a
            href={`/api/problems/${row.id}/evidence?format=pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="time-picker__btn"
          >
            PDF
          </a>
        </div>
      )
    }
  ];

  return (
    <div className="prb-root">
      <div className="prb-card">
        <div className="prb-card-header">
          <h3 className="prb-title">
            Grouped Problems & Incidents (Task 5.4)
          </h3>
          <span className="prb-subtle">
            Alerts in the same topology neighborhood folded into singular root-cause incidents
          </span>
        </div>

        {loading ? (
          <div className="prb-loading">
            Loading active problems...
          </div>
        ) : problems.length === 0 ? (
          <EmptyState
            title="Zero Active Problems"
            description={`No grouped incidents or multi-layer degradations detected in ${environment}.`}
            environment={environment}
          />
        ) : (
          <DataTable
            columns={columns}
            data={problems}
            rowKey="id"
            onRowClick={(row) => setSelectedProblem(row)}
          />
        )}
      </div>

      {selectedProblem && (
        <div className="prb-detail">
          <div className="prb-detail-head">
            <div>
              <div className="prb-detail-tags">
                <SeverityPill severity={selectedProblem.severity} />
                <code className="prb-detail-id">{selectedProblem.id}</code>
              </div>
              <h4 className="prb-detail-title">
                {selectedProblem.title}
              </h4>
            </div>
            <button
              type="button"
              className="time-picker__btn"
              onClick={() => setSelectedProblem(null)}
            >
              ✕ Close
            </button>
          </div>

          <div className="prb-detail-grid">
            <div>
              <span className="prb-subtle">Suspect Entity:</span>
              <div><EntityChip entityId={selectedProblem.suspect_entity || 'unknown'} layer={selectedProblem.top_layer} /></div>
            </div>
            <div>
              <span className="prb-subtle">Diagnosis Layer:</span>
              <div className="prb-semibold">{selectedProblem.top_layer || 'Unassigned'}</div>
            </div>
            <div>
              <span className="prb-subtle">Confidence:</span>
              <div className="prb-mono">{selectedProblem.confidence ? `${Math.round(selectedProblem.confidence * 100)}%` : '—'}</div>
            </div>
            <div>
              <span className="prb-subtle">Folded Alerts:</span>
              <div className="prb-mono">{selectedProblem.alert_count || 1}</div>
            </div>
          </div>

          {readOnly ? (
            <div className="prb-detail-actions">
              <ReadOnlyActionButton className="time-picker__btn time-picker__btn--active prb-pack-btn">
                Open HTML Evidence Pack ↗
              </ReadOnlyActionButton>
              <ReadOnlyActionButton className="time-picker__btn prb-pack-btn">
                Download PDF ↗
              </ReadOnlyActionButton>
            </div>
          ) : (
          <div className="prb-detail-actions">
            <a
              href={`/api/problems/${selectedProblem.id}/evidence?format=html`}
              target="_blank"
              rel="noopener noreferrer"
              className="time-picker__btn time-picker__btn--active prb-pack-btn"
            >
              Open HTML Evidence Pack ↗
            </a>
            <a
              href={`/api/problems/${selectedProblem.id}/evidence?format=pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="time-picker__btn prb-pack-btn"
            >
              Download PDF ↗
            </a>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
