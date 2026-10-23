/**
 * Health checks view: results of endpoint and synthetic checks.
 */
import React, { useState, useEffect } from 'react';
import { apiFetch, reportFetchError } from '../../api';
import StatusBadge from '../shared/StatusBadge';
import { LoadingState, DataUnavailableState } from '../shared/PrototypeNotice';
import './HealthChecksView.css';

/**
 * HealthChecksView (Phase O6.1 / R1)
 * Restored Enterprise Health Matrix screen.
 * Displays synthetic health checks grid across the environment:
 * status, latency, last failure, 24-hour strip, run history.
 */
export default function HealthChecksView({ environment = 'staging' }) {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [runningAll, setRunningAll] = useState(false);
  const [selectedCheckId, setSelectedCheckId] = useState(null);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchOverview = () => {
    setLoading(true);
    setError(null);
    apiFetch('/api/v2/health-checks/overview')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        setChecks(Array.isArray(data.checks) ? data.checks : []);
      })
      .catch(err => {
        reportFetchError('HealthChecksView', err);
        setError(err.message || 'Failed to fetch health checks');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchOverview();
  }, [environment]);

  const handleRunAll = async () => {
    setRunningAll(true);
    try {
      await apiFetch('/api/v2/health-checks/run-all', { method: 'POST' });
      fetchOverview();
    } catch (err) {
      reportFetchError('HealthChecksView.runAll', err);
    } finally {
      setRunningAll(false);
    }
  };

  const handleRunSingle = async (checkId) => {
    try {
      await apiFetch(`/api/v2/health-checks/${encodeURIComponent(checkId)}/run`, { method: 'POST' });
      fetchOverview();
      if (selectedCheckId === checkId) {
        loadHistory(checkId);
      }
    } catch (err) {
      reportFetchError('HealthChecksView.runSingle', err);
    }
  };

  const loadHistory = (checkId) => {
    setSelectedCheckId(checkId);
    setLoadingHistory(true);
    apiFetch(`/api/v2/health-checks/${encodeURIComponent(checkId)}/history`)
      .then(res => res.ok ? res.json() : { runs: [] })
      .then(data => {
        setHistoryRuns(Array.isArray(data.runs) ? data.runs : []);
      })
      .catch(err => {
        reportFetchError('HealthChecksView.history', err);
      })
      .finally(() => {
        setLoadingHistory(false);
      });
  };

  return (
    <div className="health-checks-view">
      {/* Header */}
      <div className="hc-header">
        <div>
          <h2 className="hc-title">
            <span>🛡️ Enterprise Synthetic Health Matrix</span>
          </h2>
          <div className="hc-subtitle">
            Observe › Health Checks · Leader-executed 1-step synthetic probes across {environment.toUpperCase()}
          </div>
        </div>

        <div className="hc-actions">
          <button
            onClick={handleRunAll}
            disabled={runningAll}
            className="hc-btn-primary"
          >
            {runningAll ? 'Running Probes…' : '⚡ Run All Checks Now'}
          </button>
        </div>
      </div>

      {loading && <LoadingState label="Loading synthetic health checks…" />}
      {error && !loading && <DataUnavailableState environment={environment} reason={error} />}

      {!loading && !error && (
        <div className="hc-table-card">
          <div className="hc-table-container">
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Check / Target</th>
                  <th>App / Layer</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>24h History Strip</th>
                  <th>Last Failure</th>
                  <th>Success Rate</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {checks.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="hc-endpoint-cell">
                      No synthetic health checks configured or registered for this environment.
                    </td>
                  </tr>
                ) : (
                  checks.map(c => (
                    <tr key={c.id}>
                      <td>
                        <div className="hc-name-cell">{c.name}</div>
                        <div className="hc-endpoint-cell">{c.endpoint}</div>
                      </td>
                      <td>{c.app_id}</td>
                      <td>{c.type}</td>
                      <td>
                        <StatusBadge status={c.status} size="sm" />
                      </td>
                      <td className="hc-latency-cell">
                        {typeof c.latency === 'number' ? `${c.latency} ms` : '—'}
                      </td>
                      <td>
                        <div className="hc-strip" title={`${c.history_24h?.length || 0} recent executions`}>
                          {(c.history_24h || []).map((t, idx) => (
                            <span
                              key={idx}
                              className={`hc-strip-tick ${t.status === 'SUCCESS' ? 'hc-strip-tick--success' : 'hc-strip-tick--failed'}`}
                            />
                          ))}
                          {(!c.history_24h || c.history_24h.length === 0) && (
                            <span className="hc-endpoint-cell">No runs yet</span>
                          )}
                        </div>
                      </td>
                      <td className="hc-endpoint-cell">
                        {c.last_failure ? new Date(c.last_failure).toLocaleTimeString() : 'None'}
                      </td>
                      <td>
                        {typeof c.success_rate === 'number' ? `${c.success_rate}%` : '—'}
                      </td>
                      <td>
                        <div className="hc-actions">
                          <button
                            onClick={() => handleRunSingle(c.id)}
                            className="hc-run-btn"
                          >
                            Probe
                          </button>
                          <button
                            onClick={() => loadHistory(c.id)}
                            className="hc-run-btn"
                          >
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* History drawer */}
          {selectedCheckId && (
            <div className="hc-history-drawer">
              <div className="hc-history-title">
                Run History: <code>{selectedCheckId}</code>
              </div>
              {loadingHistory && <div className="hc-endpoint-cell">Loading runs…</div>}
              {!loadingHistory && historyRuns.length === 0 && (
                <div className="hc-endpoint-cell">No stored runs for this check in {environment}.</div>
              )}
              {!loadingHistory && historyRuns.length > 0 && (
                <table className="hc-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Status</th>
                      <th>Latency</th>
                      <th>Status Code</th>
                      <th>Error / Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRuns.slice(0, 10).map(run => (
                      <tr key={run.id}>
                        <td className="hc-endpoint-cell">{new Date(run.timestamp).toLocaleString()}</td>
                        <td><StatusBadge status={run.status} size="sm" /></td>
                        <td className="hc-latency-cell">{run.latency} ms</td>
                        <td>{run.status_code || '—'}</td>
                        <td className="hc-endpoint-cell">{run.error || 'Clean assertion'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
