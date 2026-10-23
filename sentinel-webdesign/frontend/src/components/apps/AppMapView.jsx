/**
 * Application map: each application with its layers (VIP, hosts, databases) and their health.
 */
import React, { useState, useEffect } from 'react';
import { apiFetch, reportFetchError } from '../../api';
import StatusBadge from '../shared/StatusBadge';
import { LoadingState, DataUnavailableState } from '../shared/PrototypeNotice';
import './AppMapView.css';

// The application list comes from the manifests (GET /api/yaml/all); nothing is hard-coded here.

export default function AppMapView({
  environment = 'staging',
  initialAppId = 'bitbucket',
  onSelectComponent = null
}) {
  const [selectedAppId, setSelectedAppId] = useState(initialAppId);
  const [appsList, setAppsList] = useState([]);
  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load available apps list from manifests / config
  useEffect(() => {
    apiFetch('/api/yaml/all')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        // The API returns an object keyed by app id (aliases repeat the same manifest).
        const raw = data && data.applications;
        const entries = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
        const byId = new Map();
        entries.forEach(a => {
          const id = a && (a.id || a.key);
          if (id && !byId.has(id)) byId.set(id, { id, name: a.display_name || a.name || id });
        });
        const loaded = [...byId.values()].sort((x, y) => String(x.name).localeCompare(String(y.name)));
        if (loaded.length > 0) {
          setAppsList(loaded);
          // Start on a real application when the requested one is not in the manifests.
          setSelectedAppId(cur => (loaded.some(a => a.id === cur) ? cur : loaded[0].id));
        }
      })
      .catch(() => {
        // Leave the list empty: the screen says so rather than guessing application names.
      });
  }, []);

  // Fetch map for the selected app
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const now = Date.now();
    const from = now - 3600 * 1000;
    const url = `/api/v2/apps/${encodeURIComponent(selectedAppId)}/map?from=${from}&to=${now}`;

    apiFetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        if (active) setMapData(data);
      })
      .catch(err => {
        if (active) {
          reportFetchError('AppMapView', err);
          setError(err.message || 'Failed to fetch application map');
          setMapData(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [selectedAppId, environment]);

  const handleNodeClick = (node) => {
    if (!onSelectComponent) return;
    let targetKind = 'product';
    let targetId = node.id;

    if (node.kind === 'vip') {
      targetKind = 'vip';
      targetId = node.id.replace(/^vip:/, '');
    } else if (node.kind === 'host') {
      targetKind = 'host_linux';
      targetId = node.id.replace(/^host:/, '');
    } else if (node.kind === 'storage') {
      targetKind = 'storage_share';
      targetId = node.id.replace(/^storage:/, '');
    } else if (node.kind === 'database') {
      targetKind = 'db_postgresql';
      targetId = node.id.replace(/^db:/, '');
    } else if (node.kind === 'sso') {
      targetKind = 'sso';
      targetId = node.id.replace(/^sso:/, '');
    } else if (node.kind === 'users') {
      targetKind = 'journey_step';
      targetId = node.id.replace(/^users:/, '');
    }

    onSelectComponent({ kind: targetKind, id: targetId, node });
  };

  const layers = mapData?.layers || [];
  const openProblem = mapData?.open_problem;
  const journey = mapData?.journey_summary;

  return (
    <div className="app-map-view">
      {/* Header with App Picker */}
      <div className="app-map-header">
        <div className="app-map-header__title-group">
          <h2 className="app-map-header__title">
            <span>🗺️ Application Topology &amp; Service Map</span>
          </h2>
          <div className="app-map-header__subtitle">
            Observe › Applications · Real-time pipeline health from Users to Database
          </div>
        </div>

        <div className="app-map-header__picker">
          <label htmlFor="app-map-select" className="app-map-picker-label">
            Application:
          </label>
          <select
            id="app-map-select"
            className="app-map-select"
            value={selectedAppId}
            onChange={(e) => setSelectedAppId(e.target.value)}
          >
            {appsList.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="app-map-kpis">
        <div className="app-map-kpi-card">
          <div className="app-map-kpi-label">Journey Success Rate</div>
          <div className="app-map-kpi-value">
            {typeof journey?.success_rate === 'number' ? `${journey.success_rate}%` : '—'}
          </div>
          <div className="app-map-kpi-note">Golden journey availability</div>
        </div>

        <div className="app-map-kpi-card">
          <div className="app-map-kpi-label">Journey P95 Latency</div>
          <div className="app-map-kpi-value">
            {typeof journey?.p95_ms === 'number' ? `${journey.p95_ms} ms` : '—'}
          </div>
          <div className="app-map-kpi-note">Synthetic probe response</div>
        </div>

        <div className="app-map-kpi-card">
          <div className="app-map-kpi-label">Open Alerts</div>
          <div className="app-map-kpi-value">
            {Array.isArray(mapData?.open_alerts) ? mapData.open_alerts.length : 0}
          </div>
          <div className="app-map-kpi-note">Active alerts in {environment}</div>
        </div>

        <div className="app-map-kpi-card">
          <div className="app-map-kpi-label">Application Status</div>
          <div className="app-map-kpi-value">
            {openProblem ? 'DEGRADED' : (mapData ? 'HEALTHY' : '—')}
          </div>
          <div className="app-map-kpi-note">Correlated system posture</div>
        </div>
      </div>

      {/* Outage / Problem Warning Banner */}
      {openProblem && (
        <div className="app-map-problem-banner">
          <div className="app-map-problem-info">
            <span className="app-map-problem-badge">OUTAGE ACTIVE</span>
            <div>
              <div className="app-map-problem-title">{openProblem.title}</div>
              <div className="app-map-problem-layer">
                First Broken Layer: <strong>{openProblem.top_layer}</strong> · Downstream services affected
              </div>
            </div>
          </div>
          <StatusBadge status="CRITICAL" size="sm" />
        </div>
      )}

      {/* Loading & Error States */}
      {loading && <LoadingState label="Mapping end-to-end application layers…" />}
      {error && !loading && <DataUnavailableState environment={environment} reason={error} />}

      {/* Ordered 8-Layer Pipeline Flow */}
      {!loading && mapData && (
        <div className="app-map-flow">
          {layers.map((layer, idx) => (
            <React.Fragment key={layer.id}>
              <div className="app-map-stage">
                <div className="app-map-stage-header">
                  <span className="app-map-stage-title">{layer.name}</span>
                  <span className="app-map-stage-order">L{idx}</span>
                </div>

                <div className="app-map-stage-nodes">
                  {layer.nodes.map(node => {
                    const statusClass = `app-map-node--${(node.status || 'unavailable').toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
                    const metric = node.headline_metric;

                    return (
                      <div
                        key={node.id}
                        className={`app-map-node ${statusClass}`}
                        onClick={() => handleNodeClick(node)}
                        title={`Click to open ${node.name} metrics`}
                      >
                        <div className="app-map-node__head">
                          <span className="app-map-node__title">{node.name}</span>
                          <span className="app-map-node__kind-chip">{node.kind}</span>
                        </div>

                        {metric && (
                          <div className="app-map-node__metric">
                            <span className="app-map-node__metric-name">{metric.name}</span>
                            <span className="app-map-node__metric-val">
                              {metric.value} {metric.unit || ''}
                            </span>
                          </div>
                        )}

                        {!metric && (
                          <div className="app-map-node__unobserved">
                            {node.reason || 'DATA_UNAVAILABLE'}
                          </div>
                        )}

                        {node.status === 'failing' && (
                          <span className="app-map-status-chip app-map-status-chip--failing">
                            ⚡ FAILING (ROOT CAUSE)
                          </span>
                        )}

                        {node.status === 'affected_downstream' && (
                          <span className="app-map-status-chip app-map-status-chip--affected">
                            ⚠ AFFECTED DOWNSTREAM
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Connector arrow between stages */}
              {idx < layers.length - 1 && (
                <div className="app-map-connector" aria-hidden="true">
                  →
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
