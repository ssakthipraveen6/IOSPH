/**
 * Home scorecard: product health tiles, open problems and quick links.
 */
import React, { useState, useEffect } from 'react';
import StatTile from '../shared/StatTile';
import SeverityPill from '../shared/SeverityPill';
import DataTable from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import EntityChip from '../shared/EntityChip';
import './HomeScorecardView.css';

// Home page component.
export default function HomeScorecardView({
  environment = 'staging',
  onSelectProduct,
  onNavigateTab,
  demoData = null,
  readOnly = false
}) {
  const [scorecards, setScorecards] = useState([]);
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Which feeds failed to load: a failed feed shows "Data unavailable", never a healthy zero.
  const [failed, setFailed] = useState({ scorecards: false, problems: false });

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setFailed({ scorecards: false, problems: false });

    // Demo view: render the supplied sample payload, never call the live API.
    if (demoData) {
      setScorecards(demoData.scorecards || []);
      setProblems(demoData.problems || []);
      setLoading(false);
      return () => { isMounted = false; };
    }

    async function loadData() {
      try {
        // A non-2xx answer or a network error marks that feed as failed (null).
        const load = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
        const [scRes, prbRes] = await Promise.all([
          load(`/api/scorecards?environment=${encodeURIComponent(environment)}`),
          load(`/api/problems?environment=${encodeURIComponent(environment)}`)
        ]);

        if (isMounted) {
          setScorecards((scRes && scRes.scorecards) || []);
          setProblems((prbRes && prbRes.problems) || []);
          setFailed({ scorecards: scRes === null, problems: prbRes === null });
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    loadData();
    return () => { isMounted = false; };
  }, [environment, demoData]);

  const activeProblems = problems.filter(p => !p.resolved_at && p.status !== 'Resolved');

  const allColumns = [
    {
      key: 'product_id',
      header: 'Product Toolchain',
      sortable: true,
      render: (val, row) => (
        <div className="home-product-cell">
          <strong className="home-text-primary">{row.product_name || val}</strong>
          <span className="home-product-id">{val}</span>
        </div>
      )
    },
    {
      key: 'availability_pct',
      header: 'Availability',
      sortable: true,
      render: (val) => {
        const num = typeof val === 'number' ? val : parseFloat(val);
        const sev = isNaN(num) ? 'info' : (num >= 99.9 ? 'healthy' : num >= 99.0 ? 'warning' : 'critical');
        return (
          <SeverityPill
            severity={sev}
            label={isNaN(num) ? '—' : `${num.toFixed(2)}%`}
          />
        );
      }
    },
    {
      key: 'p95_ms',
      header: 'p95 Journey Latency',
      sortable: true,
      render: (val, row) => {
        const delta = row.p95_change_pct;
        return (
          <div>
            <span className="home-mono-strong">
              {val != null ? `${Number(val).toFixed(1)} ms` : '—'}
            </span>
            {delta != null && (
              <span className={`home-delta${delta > 0 ? ' home-delta--up' : ''}`}>
                {delta > 0 ? `+${delta}%` : `${delta}%`}
              </span>
            )}
          </div>
        );
      }
    },
    {
      key: 'change_points_count',
      header: 'Change Points',
      sortable: true,
      render: (val) => (
        <span className="home-mono">{val ?? 0}</span>
      )
    },
    {
      key: 'open_cves_count',
      header: 'Open CVEs',
      sortable: true,
      render: (val) => {
        const count = val ?? 0;
        return (
          <span className={`home-cves${count > 0 ? ' home-cves--open' : ''}`}>
            {count}
          </span>
        );
      }
    },
    {
      key: 'top_cause',
      header: 'Dominant Cause Layer',
      sortable: true,
      render: (val) => (
        <EntityChip
          entityId={val || 'general'}
          layer={val}
        />
      )
    },
    {
      key: 'actions',
      header: '',
      render: (_, row) => (
        <button
          type="button"
          className="time-picker__btn time-picker__btn--active"
          onClick={() => onSelectProduct && onSelectProduct(row.product_id)}
        >
          Inspect
        </button>
      )
    }
  ];
  const columns = readOnly ? allColumns.filter(c => c.key !== 'actions') : allColumns;

  return (
    <div className="home-scorecard-view">
      {/* Executive Summary Stats */}
      <div className="home-stats">
        <StatTile
          label="Tracked Toolchain Products"
          value={!failed.scorecards && scorecards.length > 0 ? scorecards.length : '—'}
          severity={failed.scorecards ? 'info' : null}
          subtext={failed.scorecards ? 'Data unavailable' : 'Golden journeys active'}
        />
        <StatTile
          label="Active Problems"
          value={failed.problems ? '—' : activeProblems.length}
          severity={failed.problems ? 'info' : activeProblems.length > 0 ? 'critical' : 'healthy'}
          subtext={failed.problems ? 'Data unavailable' : activeProblems.length > 0 ? 'Layer contention detected' : 'All layers operating within baseline'}
          onClick={() => onNavigateTab && onNavigateTab('problems')}
        />
        <StatTile
          label="Environment"
          value={environment.toUpperCase()}
          severity={environment === 'prod' ? 'critical' : environment === 'staging' ? 'warning' : 'info'}
          subtext="Isolated runtime boundary"
        />
      </div>

      {/* Active Problems Banner */}
      {activeProblems.length > 0 && (
        <div className="home-problems-banner">
          <div className="home-problems-head">
            <div className="home-row-sm">
              <SeverityPill severity="critical" label={`${activeProblems.length} Active Problem(s)`} />
              <span className="home-problems-note">
                Downstream layer contention requiring SRE investigation
              </span>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                className="time-picker__btn"
                onClick={() => onNavigateTab('problems')}
              >
                View All Problems →
              </button>
            )}
          </div>
          <div className="home-problem-list">
            {activeProblems.slice(0, 3).map(prob => (
              <div
                key={prob.id}
                className="home-problem-row"
              >
                <div className="home-row-md">
                  <code className="home-problem-id">{prob.id}</code>
                  <span className="home-semibold">{prob.title || 'Multi-Layer Contention'}</span>
                </div>
                <div className="home-row-sm">
                  <EntityChip entityId={prob.suspect_entity || 'unknown'} layer={prob.top_layer} />
                  <SeverityPill severity={prob.severity} size="sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly Product Scorecards Table */}
      <div className="home-card">
        <div className="home-card-header">
          <div>
            <h3 className="home-title">
              Weekly Product Scorecard
            </h3>
            <span className="home-subtle">
              Availability, journey step p95 vs last week, change points, and dominant root causes
            </span>
          </div>
        </div>

        {loading ? (
          <div className="home-loading">
            Loading scorecard metrics...
          </div>
        ) : scorecards.length === 0 ? (
          <EmptyState
            title="No Scorecards Available"
            description={`Zero weekly scorecards recorded for ${environment}. The weekly scorecard job runs every Monday at 06:00.`}
            reason="WAITING_FOR_WEEKLY_JOB"
            environment={environment}
          />
        ) : (
          <DataTable
            columns={columns}
            data={scorecards}
            rowKey="product_id"
            onRowClick={(row) => onSelectProduct && onSelectProduct(row.product_id)}
          />
        )}
      </div>
    </div>
  );
}
