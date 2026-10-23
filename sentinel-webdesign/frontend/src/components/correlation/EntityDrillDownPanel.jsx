/**
 * Side panel with details, relations and recent events for one entity.
 */
import React, { useState, useEffect } from 'react';
import { apiFetch, reportFetchError } from '../../api';
import './EntityDrillDownPanel.css';

/**
 * EntityDrillDownPanel (Phase O5.4)
 * Slide-over showing component summary telemetry from O1.2 (/api/v2/components/:kind/:id/metrics)
 * and a direct link to the full component page.
 *
 * Zero fabricated data: unobserved telemetry renders as '—'.
 * Zero inline styles: 100% styled via EntityDrillDownPanel.css.
 * Zero 'Value Not Available' literals.
 */

function resolveKindAndId(rawEntityId) {
  if (!rawEntityId) return { kind: 'product', id: 'unknown', icon: '🧭' };
  const str = String(rawEntityId);
  if (str.startsWith('host:')) return { kind: 'host_linux', id: str.slice(5), icon: '🖥️' };
  if (str.startsWith('vip:')) return { kind: 'vip', id: str.slice(4), icon: '🌐' };
  if (str.startsWith('db:')) return { kind: 'db_postgresql', id: str.slice(3), icon: '🗄️' };
  if (str.startsWith('storage:')) return { kind: 'storage_share', id: str.slice(8), icon: '💾' };
  if (str.startsWith('sso:')) return { kind: 'sso', id: str.slice(4), icon: '🔑' };
  if (str.startsWith('k8s:') || str.startsWith('cluster:')) return { kind: 'k8s_cluster', id: str.replace(/^(k8s:|cluster:)/, ''), icon: '☸️' };
  if (str.startsWith('app:')) return { kind: 'product', id: str.slice(4), icon: '📦' };
  return { kind: 'product', id: str, icon: '🧭' };
}

// Entity drill-down panel; loads the entity when opened.
export default function EntityDrillDownPanel({
  entityId,
  isOpen,
  onClose,
  onNavigateToTimeline,
  onNavigateToComponent = null,
  environment = 'staging'
}) {
  const [metricsData, setMetricsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { kind, id, icon } = resolveKindAndId(entityId);

  useEffect(() => {
    if (!isOpen || !entityId) return;
    let active = true;
    setLoading(true);
    setError(null);

    const now = Date.now();
    const from = now - 3600 * 1000;
    const url = `/api/v2/components/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/metrics?from=${from}&to=${now}&step=60`;

    apiFetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (active) setMetricsData(data);
      })
      .catch(err => {
        if (active) {
          reportFetchError('EntityDrillDownPanel', err);
          setError(err.message);
          setMetricsData(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [isOpen, entityId, kind, id, environment]);

  if (!isOpen || !entityId) return null;

  const charts = Array.isArray(metricsData?.charts) ? metricsData.charts : [];
  const status = metricsData?.status || 'DATA_UNAVAILABLE';
  const statusModifier = `edp-health--${status.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;

  return (
    <div className="entity-panel-backdrop edp-backdrop" onClick={onClose}>
      <div className="entity-panel-slideover edp-slideover" onClick={e => e.stopPropagation()}>
        {/* Header with Close */}
        <div className="edp-header">
          <div>
            <div className="edp-title-row">
              <span className="edp-icon">{icon}</span>
              <h3 className="edp-title">{id}</h3>
            </div>
            <div className="edp-subtitle">
              ID: <strong className="edp-primary">{entityId}</strong> · Kind: {kind} · Env: {environment}
            </div>
          </div>

          <button onClick={onClose} className="edp-close-btn">
            ✕ Close
          </button>
        </div>

        {/* Live Health Status & Owner Banner */}
        <div className={`edp-health ${statusModifier}`}>
          <div>
            <div className="edp-health-label">LIVE COMPONENT STATUS</div>
            <div className="edp-health-value">
              <span className="edp-health-dot"></span>
              {status}
            </div>
          </div>
          <div className="edp-align-right">
            <div className="edp-health-label">TARGET KIND</div>
            <div className="edp-owner">{kind}</div>
          </div>
        </div>

        {/* Actions bar */}
        <div className="edp-primary-actions">
          {onNavigateToComponent && (
            <button
              onClick={() => {
                onNavigateToComponent({ kind, id, environment });
                if (onClose) onClose();
              }}
              className="edp-action-btn edp-action-btn--primary"
            >
              ↗ Open Full Component Page
            </button>
          )}
          {onNavigateToTimeline && (
            <button
              onClick={() => {
                onNavigateToTimeline(entityId);
                if (onClose) onClose();
              }}
              className="edp-action-btn edp-action-btn--secondary"
            >
              ⏱ View Timeline
            </button>
          )}
        </div>

        {/* Component Golden Signals & Catalogue Metrics */}
        <div>
          <div className="edp-section-title edp-section-title--spaced">
            📊 Golden Signals &amp; Metric Catalogue
          </div>

          {loading && (
            <div className="edp-box edp-nodes-box">
              <span className="edp-text-muted">Loading component telemetry…</span>
            </div>
          )}

          {!loading && charts.length > 0 && (
            <div className="edp-signal-grid">
              {charts.map(c => {
                const hasSeries = Array.isArray(c.series) && c.series.length > 0;
                const latestVal = hasSeries ? c.series[c.series.length - 1].value : null;
                const formattedVal = latestVal !== null ? `${latestVal.toFixed(1)} ${c.unit || ''}` : '—';

                return (
                  <div key={c.id} className="edp-signal-card">
                    <div className="edp-signal-label">{c.title}</div>
                    <div className="edp-signal-value">{formattedVal}</div>
                    {!hasSeries && (
                      <div className="edp-cert-meta">
                        {c.reason || 'DATA_UNAVAILABLE'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && charts.length === 0 && (
            <div className="edp-box edp-nodes-box">
              <div className="edp-nodes-empty">
                {error ? `Telemetry query error: ${error}` : 'No active catalogue metrics collected for this component in ' + environment}
              </div>
            </div>
          )}
        </div>

        {/* Component Metadata & Specifications */}
        <div>
          <div className="edp-section-title edp-section-title--spaced">
            ⚙️ Component Specification
          </div>
          <div className="edp-box edp-nodes-box">
            <div className="edp-arch-spec">
              Entity Identifier: <strong className="edp-text-main">{entityId}</strong>
            </div>
            <div className="edp-arch-spec">
              Resolved Component Kind: <strong className="edp-text-main">{kind}</strong>
            </div>
            <div className="edp-arch-spec">
              Environment Context: <strong className="edp-text-main">{environment}</strong>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="edp-footer">
          {onNavigateToTimeline && (
            <button
              onClick={() => {
                onNavigateToTimeline(entityId);
                if (onClose) onClose();
              }}
              className="edp-timeline-btn"
            >
              <span>⏱️ Correlate Entity in Timeline Explorer</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
