import React, { useState, useEffect } from 'react';
import './SloErrorBudget.css';

export default function SloErrorBudget({ environment = 'prod' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSloData = async () => {
    try {
      const res = await fetch(`/api/slo/status?env=${environment}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSloData();
    const interval = setInterval(fetchSloData, 15000);
    return () => clearInterval(interval);
  }, [environment]);

  if (loading && !data) {
    return (
      <div className="slo-dashboard-container">
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          Loading SLO &amp; Error Budget telemetry...
        </div>
      </div>
    );
  }

  const slos = data?.slos || [];
  const anyFreeze = slos.some(s => s.status === 'BUDGET_EXHAUSTED');

  return (
    <div className="slo-dashboard-container">
      {/* Header Banner */}
      <div className="slo-header-banner">
        <div>
          <div className="slo-header-title">
            <span style={{ fontSize: '1.8rem' }}>🎯</span>
            <div>
              <h2>Service Level Objectives &amp; Error Budgets</h2>
              <div className="slo-header-meta">
                Environment: <strong style={{ color: 'var(--primary)' }}>{environment.toUpperCase()}</strong> · Rolling Window: <strong>{data?.window_days || 30} Days</strong> · Auto-evaluating every 15s
              </div>
            </div>
          </div>
        </div>

        {anyFreeze && (
          <div className="slo-freeze-alert">
            <span style={{ fontSize: '1.4rem' }}>🛑</span>
            <div>
              <div>DEPLOYMENT FREEZE RECOMMENDED</div>
              <div style={{ fontSize: '0.75rem', fontWeight: 'normal', opacity: 0.9 }}>
                One or more critical SLO error budgets exhausted. Emergency CAB required.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Grid of SLO Cards */}
      <div className="slo-grid">
        {slos.map(slo => {
          const budgetPercent = Math.max(0, Math.min(100, slo.error_budget_remaining_percent));
          let fillColor = '#10b981';
          if (budgetPercent < 25) fillColor = '#ef4444';
          else if (budgetPercent < 50) fillColor = '#f59e0b';

          return (
            <div key={slo.id} className="slo-card">
              <div className="slo-card-header">
                <div>
                  <div className="slo-card-name">{slo.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    ID: {slo.id}
                  </div>
                </div>
                <span className={`slo-badge ${slo.status?.toLowerCase()}`}>
                  {slo.status?.replace('_', ' ')}
                </span>
              </div>

              <div className="slo-metrics-row">
                <div>
                  <span className="slo-big-num" style={{ color: slo.current_sli >= slo.target_percentage ? '#10b981' : '#ef4444' }}>
                    {slo.current_sli}%
                  </span>
                </div>
                <div className="slo-target-tag">
                  Target: <strong>{slo.target_percentage}%</strong>
                </div>
              </div>

              {/* Error Budget Bar */}
              <div className="error-budget-bar-wrapper">
                <div className="error-budget-labels">
                  <span>Error Budget Remaining</span>
                  <strong>{budgetPercent.toFixed(1)}%</strong>
                </div>
                <div className="error-budget-track">
                  <div 
                    className="error-budget-fill" 
                    style={{ width: `${budgetPercent}%`, backgroundColor: fillColor }}
                  />
                </div>
              </div>

              <div className="slo-footer-meta">
                <span>
                  Burn Rate:{' '}
                  <span 
                    className="burn-rate-chip"
                    style={{
                      background: slo.burn_rate > 2.0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                      color: slo.burn_rate > 2.0 ? '#ef4444' : '#10b981'
                    }}
                  >
                    {slo.burn_rate}x
                  </span>
                </span>
                <span>30-Day Target</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
