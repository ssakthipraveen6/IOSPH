/**
 * Dashboard builder: create, edit and view custom dashboards.
 */
import React, { useState, useEffect } from 'react';
import StatTile from '../shared/StatTile';
import DataTable from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import ReadOnlyActionButton from '../shared/ReadOnlyActionButton';
import { apiFetch } from '../../api';
import './DashboardBuilderView.css';

// Dashboard builder page.
export default function DashboardBuilderView({ environment = 'production', demoData = null, readOnly = false }) {
  const [dashboards, setDashboards] = useState([]);
  const [activeDashboardId, setActiveDashboardId] = useState(null);
  const [currentDashboard, setCurrentDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  // SentinelQL interactive query console
  const [consoleQuery, setConsoleQuery] = useState('metrics where metric = "journey.step.duration_ms" | percentile(95) by step every 5m since 24h');
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [queryError, setQueryError] = useState(null);

  // Import / Export modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importError, setImportError] = useState(null);

  useEffect(() => {
    fetchDashboards();
  }, [environment, demoData]);

  async function fetchDashboards() {
    setLoading(true);
    // Demo view: render the supplied sample payload, never call the live API.
    if (demoData) {
      const list = demoData.dashboards || [];
      setDashboards(list);
      if (list.length > 0 && !activeDashboardId) {
        selectDashboard(list[0].id || list[0].slug);
      }
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/dashboards?environment=${environment}`);
      if (res.ok) {
        const data = await res.json();
        setDashboards(data || []);
        if (data && data.length > 0 && !activeDashboardId) {
          selectDashboard(data[0].id || data[0].slug);
        }
      }
    } catch (_) {
      setDashboards([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectDashboard(idOrSlug) {
    setActiveDashboardId(idOrSlug);
    if (demoData) {
      setCurrentDashboard((demoData.dashboards || []).find(d => (d.id || d.slug) === idOrSlug) || null);
      return;
    }
    try {
      const res = await fetch(`/api/dashboards/${idOrSlug}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentDashboard(data);
      }
    } catch (_) {
      setCurrentDashboard(null);
    }
  }

  async function executeConsoleQuery(queryToRun) {
    const q = queryToRun || consoleQuery;
    if (!q || !q.trim() || readOnly || demoData) return;

    setQueryRunning(true);
    setQueryError(null);
    setQueryResult(null);

    try {
      const res = await apiFetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, environment })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setQueryError(data.error || 'Query execution failed');
      } else {
        setQueryResult(data);
      }
    } catch (err) {
      setQueryError(err.message);
    } finally {
      setQueryRunning(false);
    }
  }

  async function handleImportSubmit(e) {
    e.preventDefault();
    if (readOnly || demoData) return;
    setImportError(null);
    try {
      const parsed = JSON.parse(importJsonText);
      const res = await apiFetch('/api/dashboards/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import failed');
      }
      const imported = await res.json();
      setShowImportModal(false);
      setImportJsonText('');
      await fetchDashboards();
      selectDashboard(imported.id || imported.slug);
    } catch (err) {
      setImportError(err.message);
    }
  }

  return (
    <div className="dash-root">
      {/* Top Header & Dashboard Selector */}
      <div className="dash-card dash-card--header">
        <div className="dash-row">
          <div>
            <h3 className="dash-title">
              Dashboards & SentinelQL Analytics (Task 7.2)
            </h3>
            <span className="dash-hint">
              Parameterised ClickHouse compilation, custom JSON layout engine, and zero-leak query governance
            </span>
          </div>

          {dashboards.length > 0 && (
            <select
              value={activeDashboardId || ''}
              onChange={(e) => selectDashboard(e.target.value)}
              className="time-picker__btn dash-select"
            >
              {dashboards.map(d => (
                <option key={d.id || d.slug} value={d.id || d.slug}>
                  {d.title} ({d.panel_count || (d.panels ? d.panels.length : 0)} panels)
                </option>
              ))}
            </select>
          )}
        </div>

        {readOnly ? (
          <div className="dash-btn-group">
            {currentDashboard && <ReadOnlyActionButton>Export JSON ⤓</ReadOnlyActionButton>}
            <ReadOnlyActionButton className="time-picker__btn time-picker__btn--active">Import JSON ⤒</ReadOnlyActionButton>
          </div>
        ) : (
        <div className="dash-btn-group">
          {currentDashboard && (
            <a
              href={`/api/dashboards/${currentDashboard.id || currentDashboard.slug}/export`}
              download={`${currentDashboard.slug || 'dashboard'}.json`}
              className="time-picker__btn dash-link"
            >
              Export JSON ⤓
            </a>
          )}
          <button
            type="button"
            className="time-picker__btn time-picker__btn--active"
            onClick={() => setShowImportModal(true)}
          >
            Import JSON ⤒
          </button>
        </div>
        )}
      </div>

      {/* Active Dashboard Panels Grid */}
      {currentDashboard && (
        <div className="dash-card">
          <div className="dash-panel-head">
            <h4 className="dash-subtitle">
              {currentDashboard.title}
            </h4>
            <p className="dash-desc">
              {currentDashboard.description}
            </p>
          </div>

          <div className="dash-grid">
            {(currentDashboard.panels || []).map((panel, idx) => (
              <div
                key={panel.id || idx}
                className="dash-panel"
                style={{ gridColumn: `span ${Math.min(panel.layout?.w || 6, 12)}` }}
              >
                <div className="dash-row dash-row--between">
                  <span className="dash-panel__title">
                    {panel.title}
                  </span>
                  <span className="dash-panel__type">
                    {panel.type}
                  </span>
                </div>

                <div className="dash-panel__query">
                  {panel.query}
                </div>

                <div className="dash-panel__footer">
                  {readOnly ? (
                    <ReadOnlyActionButton className="time-picker__btn time-picker__btn--active dash-small-btn">
                      Run Panel Query ▶
                    </ReadOnlyActionButton>
                  ) : (
                  <button
                    type="button"
                    className="time-picker__btn time-picker__btn--active dash-small-btn"
                    onClick={() => {
                      setConsoleQuery(panel.query);
                      executeConsoleQuery(panel.query);
                    }}
                  >
                    Run Panel Query ▶
                  </button>
                  )}
                  {panel.options?.unit && (
                    <span className="dash-hint">
                      Unit: {panel.options.unit}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SentinelQL Interactive Query Console */}
      <div className="dash-card dash-card--console">
        <div>
          <h4 className="dash-subtitle">
            SentinelQL Interactive Analytics Console (Task 7.1)
          </h4>
          <span className="dash-hint">
            Read-only queries parsed to AST and compiled to ClickHouse SQL with server-side environment constraints
          </span>
        </div>

        <div className="dash-query-box">
          <textarea
            value={consoleQuery}
            onChange={(e) => setConsoleQuery(e.target.value)}
            readOnly={readOnly}
            rows={3}
            className="dash-textarea dash-textarea--console"
            placeholder="e.g. metrics where product = &quot;artifactory&quot; | percentile(95) by step every 5m since 24h"
          />

          <div className="dash-row dash-row--between">
            <span className="dash-hint">
              Environment: <strong className="dash-brand">{environment}</strong> (injected automatically)
            </span>
            {readOnly ? (
              <ReadOnlyActionButton className="time-picker__btn time-picker__btn--active">Execute Query ▶</ReadOnlyActionButton>
            ) : (
              <button
                type="button"
                className="time-picker__btn time-picker__btn--active"
                disabled={queryRunning}
                onClick={() => executeConsoleQuery()}
              >
                {queryRunning ? 'Compiling & Running...' : 'Execute Query ▶'}
              </button>
            )}
          </div>
        </div>

        {queryError && (
          <div className="dash-error">
            <strong>Query Error:</strong> {queryError}
          </div>
        )}

        {queryResult && (
          <div className="dash-result">
            <div className="dash-result__meta">
              <span>Rows Returned: <strong className="dash-strong">{queryResult.meta?.rowCount ?? 0}</strong></span>
              <span>Execution Time: <strong className="dash-strong">{queryResult.meta?.executionTimeMs ?? 0}ms</strong></span>
            </div>

            {queryResult.meta?.compiledSql && (
              <div className="dash-result__sql">
                <span className="dash-brand">Compiled SQL:</span> {queryResult.meta.compiledSql}
              </div>
            )}

            {queryResult.meta?.status === 'DATA_UNAVAILABLE' ? (
              <EmptyState
                title="Data Not Available"
                description={queryResult.meta?.reason || 'Telemetry store returned DATA_UNAVAILABLE'}
                environment={environment}
              />
            ) : queryResult.data && queryResult.data.length > 0 ? (
              <div className="dash-result__scroll">
                <DataTable
                  columns={Object.keys(queryResult.data[0]).map(k => ({ key: k, header: k, sortable: true }))}
                  data={queryResult.data}
                  rowKey={(row, i) => i}
                />
              </div>
            ) : (
              <div className="dash-result__empty">
                Query executed successfully. 0 rows returned.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && !readOnly && (
        <div className="dash-modal-backdrop">
          <div className="dash-modal">
            <h3 className="dash-modal__title">Import Dashboard JSON</h3>
            <textarea
              rows={10}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="Paste dashboard JSON definition here..."
              className="dash-textarea dash-textarea--import"
            />
            {importError && (
              <div className="dash-modal__error">
                {importError}
              </div>
            )}
            <div className="dash-modal__actions">
              <button
                type="button"
                className="time-picker__btn"
                onClick={() => setShowImportModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="time-picker__btn time-picker__btn--active"
                onClick={handleImportSubmit}
              >
                Import & Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
