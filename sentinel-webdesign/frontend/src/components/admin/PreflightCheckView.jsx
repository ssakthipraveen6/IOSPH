import React, { useState, useEffect } from 'react';

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
        return <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid #10b981', padding: '3px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>✔ REACHABLE</span>;
      case 'AUTH_FAILED':
        return <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid #f59e0b', padding: '3px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>⚠ AUTH_FAILED</span>;
      case 'NOT_CONFIGURED':
        return <span style={{ background: 'rgba(148,163,184,0.15)', color: '#94a3b8', border: '1px solid #94a3b8', padding: '3px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>⚪ NOT CONFIGURED</span>;
      case 'UNREACHABLE':
      default:
        return <span style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid #ef4444', padding: '3px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>✖ UNREACHABLE</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header and Action Banner */}
      <div className="console-panel" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              🔍 Endpoint Preflight Verification Engine
              <span style={{ fontSize: '0.75rem', background: 'var(--primary)', color: '#fff', padding: '2px 8px', borderRadius: '4px' }}>
                {environment.toUpperCase()}
              </span>
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Probes every configured application and infrastructure API endpoint live to verify connectivity, TLS certificates, and CyberArk credential injection before dashboard activation.
            </p>
          </div>

          <button
            className="remediate-trigger-btn"
            onClick={runCheck}
            disabled={loading}
            style={{ padding: '8px 18px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {loading ? '⏳ Verifying Endpoints...' : '🚀 Re-run Preflight Check'}
          </button>
        </div>

        {/* KPI Counter Cards */}
        {report && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginTop: '1.25rem' }}>
            <div style={{ background: 'var(--bg-dark)', padding: '12px', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{report.totalTargets}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total Targets</div>
            </div>
            <div style={{ background: 'rgba(16,185,129,0.08)', padding: '12px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(16,185,129,0.3)' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981' }}>{report.reachable}</div>
              <div style={{ fontSize: '0.7rem', color: '#10b981' }}>Reachable (OK)</div>
            </div>
            <div style={{ background: 'rgba(245,158,11,0.08)', padding: '12px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(245,158,11,0.3)' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f59e0b' }}>{report.authFailed}</div>
              <div style={{ fontSize: '0.7rem', color: '#f59e0b' }}>Auth Challenges</div>
            </div>
            <div style={{ background: 'rgba(239,68,68,0.08)', padding: '12px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(239,68,68,0.3)' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ef4444' }}>{report.unreachable}</div>
              <div style={{ fontSize: '0.7rem', color: '#ef4444' }}>Unreachable</div>
            </div>
            <div style={{ background: 'rgba(148,163,184,0.08)', padding: '12px', borderRadius: '6px', textAlign: 'center', border: '1px solid rgba(148,163,184,0.3)' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#94a3b8' }}>{report.notConfigured}</div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Not Configured</div>
            </div>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '6px', color: '#ef4444', fontSize: '0.85rem' }}>
          ❌ Preflight check execution failed: {error}
        </div>
      )}

      {/* Results Table Panel */}
      <div className="console-panel" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['ALL', 'REACHABLE', 'AUTH_FAILED', 'UNREACHABLE', 'NOT_CONFIGURED'].map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: filter === s ? 'var(--primary)' : 'var(--bg-dark)',
                  color: filter === s ? '#fff' : 'var(--text-muted)',
                  border: '1px solid var(--border-light)'
                }}
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
            style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-light)', fontSize: '0.8rem', width: '260px' }}
          />
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-light)', textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '10px 8px' }}>Target Name</th>
              <th style={{ padding: '10px 8px' }}>Endpoint URL</th>
              <th style={{ padding: '10px 8px' }}>Status</th>
              <th style={{ padding: '10px 8px' }}>HTTP Code</th>
              <th style={{ padding: '10px 8px' }}>Latency</th>
              <th style={{ padding: '10px 8px' }}>Diagnostic Reason</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  {loading ? 'Performing live probes...' : 'No targets matching current filter.'}
                </td>
              </tr>
            ) : (
              filteredResults.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{r.target}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: r.url ? 'var(--text-main)' : 'var(--text-muted)' }}>
                    {r.url || '(none)'}
                  </td>
                  <td style={{ padding: '10px 8px' }}>{getStatusBadge(r.status)}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>
                    {r.httpStatus ? r.httpStatus : '-'}
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    {r.latencyMs !== null ? `${r.latencyMs} ms` : '-'}
                  </td>
                  <td style={{ padding: '10px 8px', color: r.status === 'REACHABLE' ? '#10b981' : 'var(--text-muted)', fontSize: '0.75rem' }}>
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
