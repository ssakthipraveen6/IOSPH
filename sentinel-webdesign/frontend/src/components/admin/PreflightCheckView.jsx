/**
 * Runs the preflight check (reachability of every configured endpoint) and shows the result table.
 */
import React, { useState, useEffect } from 'react';
import './PreflightCheckView.css';

// Preflight panel: calls the preflight API and lists REACHABLE / AUTH_FAILED / UNREACHABLE per
// endpoint.
export default function PreflightCheckView({ environment = 'staging' }) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL'); // ALL, REACHABLE, AUTH_FAILED, UNREACHABLE, NOT_CONFIGURED
  const [search, setSearch] = useState('');

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/config/preflight?env=${environment}`);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runCheck();
  }, [environment]);

  const results = report?.results || [];
  const filteredResults = results.filter(r => {
    if (filter !== 'ALL' && r.status !== filter) return false;
    if (search.trim() !== '') {
      const q = search.toLowerCase();
      return (
        (r.target && r.target.toLowerCase().includes(q)) ||
        (r.url && r.url.toLowerCase().includes(q)) ||
        (r.reason && r.reason.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'REACHABLE':
        return <span className="pf-badge pf-badge--reachable">✔ REACHABLE</span>;
      case 'AUTH_FAILED':
        return <span className="pf-badge pf-badge--auth-failed">⚠ AUTH_FAILED</span>;
      case 'NOT_CONFIGURED':
        return <span className="pf-badge pf-badge--not-configured">⚪ NOT CONFIGURED</span>;
      case 'UNREACHABLE':
      default:
        return <span className="pf-badge pf-badge--unreachable">✖ UNREACHABLE</span>;
    }
  };

  return (
    <div className="pf-root">
      
      {/* Header and Action Banner */}
      <div className="console-panel pf-panel">
        <div className="pf-header">
          <div>
            <h3 className="pf-title">
              🔍 Endpoint Preflight Verification Engine
              <span className="pf-env-tag">
                {environment.toUpperCase()}
              </span>
            </h3>
            <p className="pf-desc">
              Probes every configured application and infrastructure API endpoint live to verify connectivity, TLS certificates, and CyberArk credential injection before dashboard activation.
            </p>
          </div>

          <button
            className="remediate-trigger-btn pf-run-btn"
            onClick={runCheck}
            disabled={loading}
          >
            {loading ? '⏳ Verifying Endpoints...' : '🚀 Re-run Preflight Check'}
          </button>
        </div>

        {/* KPI Counter Cards */}
        {report && (
          <div className="pf-kpis">
            <div className="pf-kpi">
              <div className="pf-kpi__value">{report.totalTargets}</div>
              <div className="pf-kpi__label">Total Targets</div>
            </div>
            <div className="pf-kpi pf-kpi--reachable">
              <div className="pf-kpi__value">{report.reachable}</div>
              <div className="pf-kpi__label">Reachable (OK)</div>
            </div>
            <div className="pf-kpi pf-kpi--auth-failed">
              <div className="pf-kpi__value">{report.authFailed}</div>
              <div className="pf-kpi__label">Auth Challenges</div>
            </div>
            <div className="pf-kpi pf-kpi--unreachable">
              <div className="pf-kpi__value">{report.unreachable}</div>
              <div className="pf-kpi__label">Unreachable</div>
            </div>
            <div className="pf-kpi pf-kpi--not-configured">
              <div className="pf-kpi__value">{report.notConfigured}</div>
              <div className="pf-kpi__label">Not Configured</div>
            </div>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="pf-error">
          ❌ Preflight check execution failed: {error}
        </div>
      )}

      {/* Results Table Panel */}
      <div className="console-panel pf-panel">
        <div className="pf-toolbar">
          <div className="pf-filters">
            {['ALL', 'REACHABLE', 'AUTH_FAILED', 'UNREACHABLE', 'NOT_CONFIGURED'].map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`pf-filter-btn${filter === s ? ' pf-filter-btn--active' : ''}`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search target, endpoint or reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pf-search"
          />
        </div>

        <table className="pf-table">
          <thead>
            <tr className="pf-table__head-row">
              <th className="pf-table__cell">Target Name</th>
              <th className="pf-table__cell">Endpoint URL</th>
              <th className="pf-table__cell">Status</th>
              <th className="pf-table__cell">HTTP Code</th>
              <th className="pf-table__cell">Latency</th>
              <th className="pf-table__cell">Diagnostic Reason</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr>
                <td colSpan="6" className="pf-table__empty">
                  {loading ? 'Performing live probes...' : 'No targets matching current filter.'}
                </td>
              </tr>
            ) : (
              filteredResults.map((r, i) => (
                <tr key={i} className="pf-table__row">
                  <td className="pf-table__cell pf-table__cell--target">{r.target}</td>
                  <td className={`pf-table__cell pf-table__cell--url${r.url ? ' pf-table__cell--url-set' : ''}`}>
                    {r.url || '(none)'}
                  </td>
                  <td className="pf-table__cell">{getStatusBadge(r.status)}</td>
                  <td className="pf-table__cell pf-table__cell--mono">
                    {r.httpStatus ? r.httpStatus : '-'}
                  </td>
                  <td className="pf-table__cell">
                    {r.latencyMs !== null ? `${r.latencyMs} ms` : '-'}
                  </td>
                  <td className={`pf-table__cell pf-table__cell--reason${r.status === 'REACHABLE' ? ' pf-table__cell--reason-ok' : ''}`}>
                    {r.reason}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
