/**
 * Product page: golden journeys, step results and success trend for one product.
 */
import React, { useState, useEffect } from 'react';
import ComponentPage from '../component/ComponentPage';
import './ProductPage.css';

const STEP_TYPE_LABELS = {
  http: 'HTTP',
  browser: 'BROWSER',
  git: 'GIT',
  upload_download: 'ARTIFACT'
};

const KNOWN_LAYERS = ['network', 'app', 'db', 'storage'];

const RANGES = [
  { id: '1h', label: '1h', ms: 3600 * 1000 },
  { id: '24h', label: '24h', ms: 24 * 3600 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 3600 * 1000 }
];

// CSS class for a layer badge.
function layerClass(layer) {
  return `pp-layer--${KNOWN_LAYERS.includes(layer) ? layer : 'other'}`;
}

// CSS class for a journey step type.
function stepTypeClass(type) {
  return `pp-type--${STEP_TYPE_LABELS[type] ? type : 'other'}`;
}

// CSS class for a run status.
function statusClass(status) {
  if (status === 'HEALTHY' || status === 'PASSED' || status === 'OK') return 'pp-status--ok';
  if (status === 'FAILED' || status === 'ERROR') return 'pp-status--fail';
  if (status === 'SKIPPED') return 'pp-status--skip';
  return 'pp-status--unknown';
}

// Milliseconds or a dash.
function fmtMs(v) {
  return v === null || v === undefined ? '—' : `${v}ms`;
}

// Percent or a dash.
function fmtPct(v) {
  return v === null || v === undefined ? '—' : `${v}%`;
}

// Local date/time or a dash.
function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleString() : '—';
}

// Local empty state with a title and reason.
function EmptyState({ title, reason }) {
  return (
    <div className="empty-state pp-empty">
      <h4 className="empty-state__title">{title}</h4>
      {reason && <div className="empty-state__reason"><code>{reason}</code></div>}
    </div>
  );
}

// Summary tiles (runs, success rate, ...).
function SummaryTiles({ summary }) {
  const tiles = [
    { label: 'Runs', value: summary.runs ?? '—' },
    { label: 'Success rate', value: fmtPct(summary.success_rate) },
    { label: 'p95 latency', value: fmtMs(summary.p95_ms) },
    { label: 'p50 latency', value: fmtMs(summary.p50_ms) },
    { label: 'Failures', value: summary.failures ?? '—' },
    { label: 'Last run', value: summary.last_run_ts ? new Date(summary.last_run_ts).toLocaleTimeString() : '—' }
  ];
  return (
    <div className="pp-tiles">
      {tiles.map(t => (
        <div key={t.label} className="stat-tile">
          <span className="stat-tile__label">{t.label}</span>
          <span className="stat-tile__value pp-tile-value">{t.value}</span>
        </div>
      ))}
    </div>
  );
}

// Success-rate trend for the journey.
function SuccessTrend({ trend }) {
  const points = trend?.points || [];
  if (points.length === 0) {
    return <div className="pp-muted pp-trend-empty">{trend?.reason || 'No journey.success points in this range.'}</div>;
  }
  return (
    <div className="pp-trend" role="img" aria-label="Journey success rate per bucket">
      {points.map(p => (
        <div
          key={p.ts}
          className={`pp-trend__bar ${p.success_rate < 100 ? 'pp-trend__bar--degraded' : ''}`}
          style={{ height: `${Math.max(4, p.success_rate)}%` }}
          title={`${new Date(p.ts).toLocaleString()}: ${p.success_rate}%`}
        />
      ))}
    </div>
  );
}

// Product page component.
export default function ProductPage({ environment = 'staging', demoData = null, selectedProduct = null, onSelectProduct = null }) {
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(selectedProduct);
  const [journeysData, setJourneysData] = useState(null);
  const [runsData, setRunsData] = useState([]);
  const [rangeId, setRangeId] = useState('24h');
  const [expandedJourneyId, setExpandedJourneyId] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [screenshotModal, setScreenshotModal] = useState(null); // { url, stepName, traceId }
  const [screenshotError, setScreenshotError] = useState(false);

  const selectProduct = (id) => {
    setSelectedProductId(id);
    if (onSelectProduct) onSelectProduct(id);
  };

  // Load products list
  useEffect(() => {
    let mounted = true;
    // Demo view: render the supplied sample payload, never call the live API.
    if (demoData) {
      const list = demoData.products || [];
      setProducts(list);
      setSelectedProductId(prev => prev || (list[0] ? list[0].id : null));
      return () => { mounted = false; };
    }
    async function loadProducts() {
      try {
        const res = await fetch(`/api/products?environment=${environment}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) {
          const list = Array.isArray(data) ? data : [];
          setProducts(list);
          setSelectedProductId(prev => prev || (list[0] ? list[0].id : null));
        }
      } catch (err) {
        console.error('Failed to load products:', err);
      }
    }
    loadProducts();
    return () => { mounted = false; };
  }, [environment, demoData]);

  // Load journeys (ClickHouse summary over the range) and recent runs for the selected product
  useEffect(() => {
    if (!selectedProductId) return;
    let mounted = true;

    if (demoData) {
      const byProduct = demoData.details?.[selectedProductId] || {};
      const runs = byProduct.runs || [];
      setJourneysData({
        journeys: byProduct.journeys || [],
        summary: byProduct.summary || null,
        failures: byProduct.failures || [],
        trend: byProduct.trend || null,
        status: byProduct.summary ? undefined : 'DATA_UNAVAILABLE',
        reason: byProduct.summary ? undefined : 'The demo fixture carries no span summary for this product.'
      });
      setRunsData(runs);
      setSelectedRun(runs[0] || null);
      return () => { mounted = false; };
    }

    async function loadProductDetails() {
      const range = RANGES.find(r => r.id === rangeId) || RANGES[1];
      const to = Date.now();
      const qs = `environment=${environment}&from=${to - range.ms}&to=${to}`;
      try {
        const [jRes, rRes] = await Promise.all([
          fetch(`/api/products/${selectedProductId}/journeys?${qs}`),
          fetch(`/api/products/${selectedProductId}/runs?${qs}&limit=10`)
        ]);

        if (jRes.ok) {
          const jData = await jRes.json();
          if (mounted) setJourneysData(jData);
        } else if (mounted) {
          setJourneysData(null);
        }
        if (rRes.ok) {
          const rData = await rRes.json();
          if (mounted) {
            const runs = rData.runs || [];
            setRunsData(runs);
            setSelectedRun(prev => runs.find(r => r.run_id === prev?.run_id) || runs[0] || null);
          }
        }
      } catch (err) {
        console.error('Failed loading product details:', err);
      }
    }

    loadProductDetails();
    const interval = setInterval(loadProductDetails, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [selectedProductId, environment, demoData, rangeId]);

  const currentProduct = products.find(p => p.id === selectedProductId) || products[0] || null;
  const journeys = journeysData?.journeys || [];
  const unavailable = !journeysData || journeysData.status === 'DATA_UNAVAILABLE' || !journeysData.summary;
  const failures = journeysData?.failures || [];

  return (
    <div className="pp-page">
      {/* Top Banner / Product Selector */}
      <div className="pp-card">
        <div className="pp-header">
          <div>
            <div className="pp-row">
              <span className="pp-icon">📦</span>
              <h2 className="pp-title">Toolchain Products &amp; Golden Journeys</h2>
            </div>
            <div className="pp-subtitle">
              Synthetic canary probes verifying toolchain health, version drift, and multi-tier SLAs as a real user.
            </div>
          </div>

          <div className="pp-row">
            <span className="pp-muted pp-small">Environment:</span>
            <span className={`pp-env ${environment === 'prod' ? 'pp-env--prod' : ''}`}>{environment}</span>
            {!demoData && (
              <div className="time-picker">
                <div className="time-picker__presets">
                  {RANGES.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      className={`time-picker__btn ${r.id === rangeId ? 'time-picker__btn--active' : ''}`}
                      onClick={() => setRangeId(r.id)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Product Pills Carousel */}
        <div className="pp-pills">
          {products.length === 0 && <span className="pp-muted pp-small">No products configured.</span>}
          {products.map(p => {
            const isSelected = p.id === selectedProductId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProduct(p.id)}
                className={`pp-pill ${isSelected ? 'pp-pill--active' : ''}`}
              >
                <span>{p.name}</span>
                {p.version && <span className="pp-pill__version">v{p.version}</span>}
                {p.alert_count > 0 && <span className="pp-pill__alerts">{p.alert_count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {currentProduct && (
        <>
          {/* Product Header Card */}
          <div className="pp-card pp-header">
            <div>
              <div className="pp-row pp-row--wide">
                <h3 className="pp-product-name">{currentProduct.name}</h3>
                <span className="pp-chip pp-mono">{currentProduct.id}</span>
                <span className="pp-badge pp-status--ok">{currentProduct.tier}</span>
              </div>
              <div className="pp-subtitle">
                Configured in <code className="pp-mono">config/apps/{currentProduct.id}.yaml</code>
              </div>
            </div>

            <div className="pp-row pp-row--wide pp-wrap">
              <div className="pp-kpi">
                <div className="pp-kpi__label">Detected Version</div>
                <div className={`pp-kpi__value pp-mono ${currentProduct.version ? 'pp-text--ok' : 'pp-muted'}`}>
                  {currentProduct.version ? `v${currentProduct.version}` : 'Not Detected'}
                </div>
              </div>
              <div className={`pp-kpi ${currentProduct.alert_count > 0 ? 'pp-kpi--fail' : 'pp-kpi--ok'}`}>
                <div className="pp-kpi__label">Active Alerts</div>
                <div className={`pp-kpi__value ${currentProduct.alert_count > 0 ? 'pp-text--fail' : 'pp-text--ok'}`}>
                  {currentProduct.alert_count > 0 ? `${currentProduct.alert_count} Alerts` : 'Healthy (0)'}
                </div>
              </div>
            </div>
          </div>

          {/* Span summary over the range (ClickHouse) */}
          <div className="pp-card">
            <div className="pp-section-head">
              <div>
                <h4 className="pp-section-title">Journey Health</h4>
                <div className="pp-muted pp-small">
                  {journeysData?.range
                    ? `${fmtTime(journeysData.range.from)} – ${fmtTime(journeysData.range.to)} · p95 computed by ClickHouse over journey spans`
                    : 'p95 computed by ClickHouse over journey spans'}
                </div>
              </div>
            </div>
            {unavailable ? (
              <EmptyState
                title="No journey telemetry for this range"
                reason={journeysData?.reason || 'Journey data has not loaded.'}
              />
            ) : (
              <>
                <SummaryTiles summary={journeysData.summary} />
                <div className="pp-subhead">Success rate ({journeysData.trend?.step_seconds ? `${Math.round(journeysData.trend.step_seconds / 60)} min buckets` : 'per bucket'})</div>
                <SuccessTrend trend={journeysData.trend} />
              </>
            )}
          </div>

          {/* Golden Journeys Table */}
          <div className="pp-card">
            <div className="pp-section-head">
              <div>
                <h4 className="pp-section-title">Synthetics &amp; Golden Journeys</h4>
                <div className="pp-muted pp-small">
                  Probes executing on schedule across network, application, database, and storage layers.
                </div>
              </div>
              <span className="pp-chip pp-mono">{journeys.length} Journeys Defined</span>
            </div>

            {journeys.length === 0 ? (
              <div className="pp-placeholder">
                No Golden Journeys configured for this product. Add a <code>journeys:</code> section to its YAML manifest.
              </div>
            ) : (
              <div className="pp-scroll-x">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Journey</th>
                      <th>Tier</th>
                      <th>Interval</th>
                      <th>Last Run</th>
                      <th>Status</th>
                      <th>Success</th>
                      <th>P95 Latency</th>
                      <th>Steps</th>
                      <th className="pp-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journeys.map(j => {
                      const isExpanded = expandedJourneyId === j.id;
                      return (
                        <React.Fragment key={j.id}>
                          <tr className={isExpanded ? 'pp-table__row--expanded' : ''}>
                            <td>
                              <div className="pp-strong">{j.name}</div>
                              <div className="pp-mono pp-muted pp-xs">{j.id}</div>
                            </td>
                            <td><span className="pp-badge pp-badge--info">{j.tier}</span></td>
                            <td className="pp-mono pp-small">{j.interval_seconds}s</td>
                            <td className="pp-small pp-muted">
                              {j.last_run_ts ? new Date(j.last_run_ts).toLocaleTimeString() : 'No data'}
                            </td>
                            <td><span className={`pp-badge pp-badge--bordered ${statusClass(j.last_status)}`}>{j.last_status}</span></td>
                            <td className="pp-mono">{fmtPct(j.success_rate)}</td>
                            <td className="pp-mono pp-strong">{fmtMs(j.p95_latency_ms)}</td>
                            <td><span className="pp-chip pp-mono">{j.steps?.length || 0} steps</span></td>
                            <td className="pp-right">
                              <button type="button" className="pp-button" onClick={() => setExpandedJourneyId(isExpanded ? null : j.id)}>
                                {isExpanded ? 'Hide Steps ▲' : 'View Steps ▼'}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Step-by-Step Breakdown */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={9} className="pp-steps-cell">
                                <div className="pp-subhead">JOURNEY STEP SEQUENCE &amp; TIER FINGERPRINT</div>
                                <div className="pp-steps-grid">
                                  {(j.steps || []).map((s, idx) => (
                                    <div key={s.id} className="pp-step-card">
                                      <div className="pp-between">
                                        <div className="pp-row pp-row--tight">
                                          <span className="pp-mono pp-muted pp-xs">#{idx + 1}</span>
                                          <span className="pp-strong pp-small">{s.name}</span>
                                        </div>
                                        <span className={`pp-badge ${stepTypeClass(s.type)}`}>{STEP_TYPE_LABELS[s.type] || s.type}</span>
                                      </div>
                                      <div className="pp-between pp-xs">
                                        <span className={`pp-layer-tag ${layerClass(s.layer)}`}>Layer: {s.layer}</span>
                                        <span className="pp-mono pp-muted">
                                          P95: {fmtMs(s.p95_latency_ms)} · OK: {fmtPct(s.success_rate)}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Last 10 failures (ClickHouse spans) */}
          <div className="pp-card">
            <div className="pp-section-head">
              <div>
                <h4 className="pp-section-title">Last 10 Failures</h4>
                <div className="pp-muted pp-small">Failed journey runs from stored spans, newest first</div>
              </div>
              <span className="pp-chip pp-mono">{failures.length}</span>
            </div>
            {failures.length === 0 ? (
              <div className="pp-placeholder">
                {unavailable ? 'No journey spans stored for this range.' : 'No failed runs in this range.'}
              </div>
            ) : (
              <div className="pp-scroll-x">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Journey</th>
                      <th>Failing Step</th>
                      <th>Error</th>
                      <th>Duration</th>
                      <th>Trace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failures.map(f => (
                      <tr key={f.trace_id}>
                        <td className="pp-small pp-nowrap">{fmtTime(f.ts)}</td>
                        <td className="pp-strong">{f.journey_name || f.journey_id || '—'}</td>
                        <td>{f.step_name || f.step_id || '—'}</td>
                        <td className="pp-text--fail pp-mono pp-xs">{f.error || '—'}</td>
                        <td className="pp-mono">{fmtMs(f.duration_ms)}</td>
                        <td className="pp-mono pp-xs" title={f.trace_id}>{f.trace_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Runs and Trace Waterfall Grid */}
          <div className="pp-runs-grid">
            {/* Last 10 Runs List */}
            <div className="pp-card pp-card--compact">
              <div className="pp-section-head">
                <div>
                  <h4 className="pp-section-title">Recent Executions</h4>
                  <div className="pp-muted pp-xs">Last 10 runs with W3C trace identifiers</div>
                </div>
                <span className="pp-mono pp-muted pp-xs">{runsData.length} Runs</span>
              </div>

              {runsData.length === 0 ? (
                <div className="pp-placeholder">
                  No execution runs stored for this range. Probes run on scheduled intervals.
                </div>
              ) : (
                <div className="pp-run-list">
                  {runsData.map(run => {
                    const isSelected = selectedRun?.run_id === run.run_id;
                    const failedStep = (run.steps || []).find(st => st.status === 'FAILED' || st.status === 'ERROR');
                    const screenshotStep = (run.steps || []).find(st => st.screenshot_url);

                    return (
                      <div
                        key={run.run_id}
                        onClick={() => setSelectedRun(run)}
                        className={`pp-run ${isSelected ? 'pp-run--active' : ''}`}
                      >
                        <div className="pp-between">
                          <span className="pp-strong pp-small">{run.journey_name || run.journey_id}</span>
                          <span className={`pp-badge ${statusClass(run.status)}`}>{run.status}</span>
                        </div>

                        <div className="pp-between pp-xs pp-muted">
                          <span className="pp-mono">
                            {run.start_ts ? new Date(run.start_ts).toLocaleTimeString() : '—'} ({fmtMs(run.duration_ms)})
                          </span>
                          <span className="pp-mono">{String(run.run_id).slice(0, 12)}...</span>
                        </div>

                        {failedStep && (
                          <div className="pp-run__failure">
                            <span>Failing Step: <strong>{failedStep.name || failedStep.step_id}</strong></span>
                            {screenshotStep && (
                              <button
                                type="button"
                                className="pp-button pp-button--danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setScreenshotError(false);
                                  setScreenshotModal({
                                    url: screenshotStep.screenshot_url,
                                    stepName: screenshotStep.name || screenshotStep.step_id,
                                    traceId: run.run_id
                                  });
                                }}
                              >
                                View Screenshot 📸
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Trace Waterfall Breakdown (Span Flamegraph) */}
            <div className="pp-card pp-card--compact">
              <div className="pp-section-head">
                <div>
                  <h4 className="pp-section-title">Execution Trace Waterfall</h4>
                  <div className="pp-muted pp-xs">End-to-end W3C Span waterfall with per-tier latency breakdown</div>
                </div>
                {selectedRun && <span className="pp-chip pp-mono pp-xs">Trace: {selectedRun.run_id}</span>}
              </div>

              {!selectedRun ? (
                <div className="pp-placeholder">
                  Select an execution run from the left panel to inspect its trace waterfall.
                </div>
              ) : (
                <div className="pp-waterfall">
                  <div className="pp-waterfall__root">
                    <span><strong>Root:</strong> {selectedRun.journey_name || selectedRun.journey_id}</span>
                    <span className="pp-strong">{fmtMs(selectedRun.duration_ms)} (100%)</span>
                  </div>

                  <div className="pp-waterfall__steps">
                    {(selectedRun.steps || []).map((st, sIdx) => {
                      const pct = Math.max(8, Math.min(100, ((st.duration_ms || 0) / (selectedRun.duration_ms || 1)) * 100));
                      const isFailed = st.status === 'FAILED' || st.status === 'ERROR';
                      const isSkipped = st.status === 'SKIPPED';
                      const barClass = isFailed ? 'pp-bar--fail' : (isSkipped ? 'pp-bar--skip' : layerClass(st.layer));

                      return (
                        <div key={st.step_id || sIdx} className="pp-waterfall__step">
                          <div className="pp-between pp-xs">
                            <div className="pp-row pp-row--tight">
                              <span className={`severity-dot ${isFailed ? 'severity-dot--critical' : (isSkipped ? 'severity-dot--warning' : 'severity-dot--healthy')}`} />
                              <span className="pp-strong">{st.name || st.step_id}</span>
                              <span className={`pp-layer-label ${layerClass(st.layer)}`}>[{st.layer}]</span>
                            </div>
                            <span className="pp-mono pp-muted">{fmtMs(st.duration_ms)}</span>
                          </div>

                          <div className="pp-bar">
                            <div className={`pp-bar__fill ${barClass}`} style={{ width: `${pct}%` }} />
                          </div>

                          {isFailed && st.error && (
                            <div className="pp-waterfall__error pp-mono">Error: {st.error}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* JVM Telemetry Section (rendered when JVM data is available or jvm.jmx_port is configured) */}
          {(currentProduct.has_jvm || currentProduct.jvm || currentProduct.jvm_jmx_port) && (
            <div className="pp-card">
              <div className="pp-section-head">
                <div>
                  <h4 className="pp-section-title">JVM Telemetry</h4>
                  <div className="pp-muted pp-xs">
                    Heap memory, non-heap &amp; metaspace, GC pause duration, and thread deadlocks
                    {currentProduct.jvm_jmx_port ? ` (JMX Port: ${currentProduct.jvm_jmx_port})` : ''}
                  </div>
                </div>
                <span className="pp-chip pp-mono pp-xs">kind: jvm</span>
              </div>
              <ComponentPage
                kind="jvm"
                id={currentProduct.id}
                environment={environment}
              />
            </div>
          )}
        </>
      )}

      {/* Failure Screenshot Modal */}
      {screenshotModal && (
        <div className="pp-modal" onClick={() => setScreenshotModal(null)}>
          <div className="pp-modal__dialog" onClick={e => e.stopPropagation()}>
            <div className="pp-modal__head">
              <div>
                <h4 className="pp-section-title">Failure Screenshot: {screenshotModal.stepName}</h4>
                <div className="pp-mono pp-muted pp-xs">Trace: {screenshotModal.traceId}</div>
              </div>
              <button type="button" className="pp-modal__close" onClick={() => setScreenshotModal(null)}>✕</button>
            </div>
            <div className="pp-modal__body">
              {screenshotError ? (
                <div className="pp-text--fail">Screenshot artifact could not be loaded.</div>
              ) : (
                <img
                  src={screenshotModal.url}
                  alt="Canary probe failure screenshot"
                  className="pp-modal__img"
                  onError={() => setScreenshotError(true)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
