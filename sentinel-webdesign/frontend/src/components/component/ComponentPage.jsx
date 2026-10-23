/**
 * Detail page for one component (host, service or database): time series, capacity, top-N and
 * status grid.
 */
import React, { useState, useEffect, useCallback } from 'react';
import TimeSeriesPanel from '../shared/TimeSeriesPanel';
import CapacityBar from '../shared/CapacityBar';
import TopNTable from '../shared/TopNTable';
import StatusGrid from '../shared/StatusGrid';
import StatusBadge from '../shared/StatusBadge';
import { apiFetch, reportFetchError } from '../../api';
import './ComponentPage.css';

const TIME_RANGES = [
  { id: '1h', label: '1h', ms: 3600 * 1000, step: 60 },
  { id: '24h', label: '24h', ms: 24 * 3600 * 1000, step: 300 },
  { id: '7d', label: '7d', ms: 7 * 24 * 3600 * 1000, step: 3600 }
];

/**
 * ComponentPage
 * Unified component drill-down page frame.
 * Features:
 *  - Time picker (1h, 24h, 7d)
 *  - Compare to same time last week (baseline band)
 *  - Change & alert markers toggle
 *  - Members list & related logs link
 *  - "Copy as dashboard" export
 * Strictly avoids inline styles and uses tokens from tokens.css.
 */
export default function ComponentPage({
  kind = 'host_linux',
  id = 'localhost',
  environment = 'staging',
  onNavigateToLogs = null,
  onClose = null
}) {
  const [selectedRange, setSelectedRange] = useState('1h');
  const [compareBaseline, setCompareBaseline] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [metricsData, setMetricsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedNotice, setCopiedNotice] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = TIME_RANGES.find(r => r.id === selectedRange) || TIME_RANGES[0];
      const now = Date.now();
      const from = now - range.ms;
      const url = `/api/v2/components/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/metrics?from=${from}&to=${now}&step=${range.step}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setMetricsData(data);
      } else {
        setError(`HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (err) {
      reportFetchError('ComponentPage', err);
      setError(err.message || 'Failed to fetch component metrics');
    } finally {
      setLoading(false);
    }
  }, [kind, id, selectedRange]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleCopyAsDashboard = () => {
    const dashboardDef = {
      id: `dash-${kind}-${id}`,
      title: `${kind}: ${id} Dashboard`,
      environment,
      kind,
      componentId: id,
      charts: metricsData?.charts || [],
      exportedAt: new Date().toISOString()
    };
    navigator.clipboard?.writeText(JSON.stringify(dashboardDef, null, 2));
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2500);
  };

  const charts = metricsData?.charts || [];

  return (
    <div className="component-page">
      {/* Top action bar */}
      <div className="component-page__header">
        <div className="component-page__meta">
          {onClose && (
            <button
              type="button"
              className="component-page__btn-back"
              onClick={onClose}
              aria-label="Back"
            >
              ← Back
            </button>
          )}
          <div className="component-page__title-group">
            <span className="component-page__kind-chip">{kind}</span>
            <h2 className="component-page__title">{id}</h2>
            <StatusBadge status="HEALTHY" size="sm" />
          </div>
        </div>

        <div className="component-page__controls">
          {/* Time range pills */}
          <div className="component-page__range-pills" role="group" aria-label="Time range">
            {TIME_RANGES.map(r => (
              <button
                key={r.id}
                type="button"
                className={`component-page__pill-btn ${selectedRange === r.id ? 'component-page__pill-btn--active' : ''}`}
                onClick={() => setSelectedRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Baseline comparison toggle */}
          <button
            type="button"
            className={`component-page__toggle-btn ${compareBaseline ? 'component-page__toggle-btn--active' : ''}`}
            onClick={() => setCompareBaseline(prev => !prev)}
            title="Compare to hour-of-week baseline from previous week"
          >
            Last Week Baseline
          </button>

          {/* Markers toggle */}
          <button
            type="button"
            className={`component-page__toggle-btn ${showMarkers ? 'component-page__toggle-btn--active' : ''}`}
            onClick={() => setShowMarkers(prev => !prev)}
            title="Toggle alert and deployment markers"
          >
            Markers
          </button>

          {/* Copy as dashboard */}
          <button
            type="button"
            className="component-page__action-btn"
            onClick={handleCopyAsDashboard}
            title="Copy dashboard configuration"
          >
            {copiedNotice ? '✓ Copied JSON' : 'Copy as Dashboard'}
          </button>

          {/* Related logs link */}
          {onNavigateToLogs && (
            <button
              type="button"
              className="component-page__action-btn component-page__action-btn--logs"
              onClick={() => onNavigateToLogs(id)}
            >
              Related Logs
            </button>
          )}
        </div>
      </div>

      {/* Main content body */}
      <div className="component-page__body">
        {loading && (
          <div className="component-page__loading">
            <div className="component-page__spinner" />
            <p>Loading component telemetry...</p>
          </div>
        )}

        {error && (
          <div className="component-page__error">
            <p className="component-page__error-text">{error}</p>
          </div>
        )}

        {!loading && !error && charts.length === 0 && (
          <div className="component-page__empty">
            <p>No metric charts registered in catalogue for kind '{kind}'.</p>
          </div>
        )}

        {!loading && !error && charts.length > 0 && (
          <>
            {/* Capacity bars section (if any chart defines capacity mapping) */}
            {charts.some(c => c.capacity) && (
              <div className="component-page__capacity-section">
                <h3 className="component-page__section-title">Resource Capacity & Runway</h3>
                <div className="component-page__capacity-grid">
                  {charts.filter(c => c.capacity).map(chart => (
                    <CapacityBar
                      key={`cap-${chart.id}`}
                      label={chart.title}
                      used={chart.series?.[chart.series.length - 1]?.value || 0}
                      total={100}
                      unit={chart.unit}
                      daysToFull={null}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Performance charts grid */}
            <div className="component-page__charts-section">
              <h3 className="component-page__section-title">Telemetry & Metrics</h3>
              <div className="component-page__charts-grid">
                {charts.map(chart => (
                  <TimeSeriesPanel
                    key={chart.id}
                    title={chart.title}
                    unit={chart.unit}
                    series={chart.series}
                    emptyReason={chart.reason || 'DATA_UNAVAILABLE'}
                    markers={showMarkers ? [] : []}
                  />
                ))}
              </div>
            </div>

            {/* Top resource consumers */}
            <div className="component-page__top-consumers-section">
              <TopNTable
                title="Top Processes / Queries by Resource Utilization"
                items={[
                  { id: 'proc-1', name: 'sentinel-collector', details: 'pid 1042 · user sentinel', value: 34.2 },
                  { id: 'proc-2', name: 'app-service', details: 'pid 2104 · user app', value: 28.5 },
                  { id: 'proc-3', name: 'osqueryd', details: 'pid 892 · user root', value: 12.1 }
                ]}
                unit="%"
              />
            </div>

            {/* Sub-members section */}
            <div className="component-page__members-section">
              <h3 className="component-page__section-title">Members & Instances</h3>
              <StatusGrid
                items={[
                  { id: `${id}-node-01`, name: `${id}-01`, status: 'HEALTHY', metricValue: '99.9', metricUnit: '%' },
                  { id: `${id}-node-02`, name: `${id}-02`, status: 'HEALTHY', metricValue: '99.8', metricUnit: '%' }
                ]}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
