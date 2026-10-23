/**
 * SLO and error budget per service.
 */
import React, { useState, useEffect } from 'react';
import './SloErrorBudget.css';

// SLO page; loads SLO data for the environment.
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
        <div className="slo-loading">
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
            <span className="slo-header-icon">🎯</span>
            <div>
              <h2>Service Level Objectives &amp; Error Budgets</h2>
              <div className="slo-header-meta">
                Environment: <strong className="slo-env-name">{environment.toUpperCase()}</strong> · Rolling Window: <strong>{data?.window_days || 30} Days</strong> · Auto-evaluating every 15s
              </div>
            </div>
          </div>
        </div>

        {anyFreeze && (
          <div className="slo-freeze-alert">
            <span className="slo-freeze-icon">🛑</span>
            <div>
              <div>DEPLOYMENT FREEZE RECOMMENDED</div>
              <div className="slo-freeze-note">
                One or more critical SLO error budgets exhausted. Emergency CAB required.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Grid of SLO Cards */}
      <div className="slo-grid">
        {slos.map(slo => {
          // Unknown SLOs (no measurements yet) show a dash, never a made-up 0.0% budget.
          const hasSli = Number.isFinite(Number(slo.current_sli)) && slo.current_sli !== null;
          const hasBudget = hasSli && Number.isFinite(Number(slo.error_budget_remaining_percent)) && slo.error_budget_remaining_percent !== null;
          const hasBurn = hasSli && Number.isFinite(Number(slo.burn_rate)) && slo.burn_rate !== null;
          const budgetPercent = hasBudget ? Math.max(0, Math.min(100, Number(slo.error_budget_remaining_percent))) : 0;
          let fillColor = '#10b981';
          if (budgetPercent < 25) fillColor = '#ef4444';
          else if (budgetPercent < 50) fillColor = '#f59e0b';

          return (
            <div key={slo.id} className="slo-card">
              <div className="slo-card-header">
                <div>
                  <div className="slo-card-name">{slo.name}</div>
                  <div className="slo-card-id">
                    ID: {slo.id}
                  </div>
                </div>
                <span className={`slo-badge ${slo.status?.toLowerCase()}`}>
                  {slo.status?.replace('_', ' ')}
                </span>
              </div>

              <div className="slo-metrics-row">
                <div>
                  <span className={`slo-big-num ${!hasSli ? 'slo-big-num--none' : slo.current_sli >= slo.target_percentage ? 'slo-big-num--ok' : 'slo-big-num--breach'}`}>
                    {hasSli ? `${slo.current_sli}%` : '—'}
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
                  <strong>{hasBudget ? `${budgetPercent.toFixed(1)}%` : '—'}</strong>
                </div>
                <div className="error-budget-track">
                  <div 
                    className="error-budget-fill" 
                    style={{ width: hasBudget ? `${budgetPercent}%` : '0%', backgroundColor: fillColor }}
                  />
                </div>
              </div>

              <div className="slo-footer-meta">
                <span>
                  Burn Rate:{' '}
                  <span 
                    className={`burn-rate-chip ${!hasBurn ? 'slo-burn--none' : slo.burn_rate > 2.0 ? 'slo-burn--hot' : 'slo-burn--ok'}`}
                  >
                    {hasBurn ? `${slo.burn_rate}x` : '—'}
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
