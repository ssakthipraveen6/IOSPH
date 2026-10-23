/**
 * Root-cause analysis dashboard: correlated incidents and their probable cause.
 */
import React, { useEffect, useState } from 'react';
import { MAINTENANCE_CONFIG } from '../../maintenanceConfig';
import { MaintenanceBadge, MaintenanceBanner } from '../shared/MaintenanceNotice';
import DriftRcaCorrelationFeed from '../correlation/DriftRcaCorrelationFeed';
import './RcaDashboard.css';
import { SEVERITY, SEVERITY_COLORS, getStatusColor, normalizeSeverity } from '@sentinel/shared-constants';

const appDisplayNames = {
  jenkins: "Jenkins CI/CD Pipeline",
  bitbucket: "Bitbucket Repositories",
  artifactory: "Artifactory Registry",
  argocd: "ArgoCD Deployment Hub",
  teamcity: "TeamCity Build Agents",
  fortify: "Fortify SSC Engine",
  nexusiq: "NexusIQ Policy Scanner",
  mcp: "MCP Gateway",
  argoworkflows: "Argo Workflows Pipeline",
  sonarqube: "SonarQube Quality Gate",
  github: "GitHub Enterprise Pool",
  bitbucket_external: "Bitbucket External Gateway",
  otkr: "OTKR Security Scanner",
  performance_center: "Performance Center"
};

// RCA dashboard component; loads correlations for the environment and lets the user drill into an
// entity.
export default function RcaDashboard({ environment = 'staging', onInspectEntity, onNavigateToTimeline }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCorrelation, setSelectedCorrelation] = useState(null);
  const [selectedFlowApp, setSelectedFlowApp] = useState('jenkins');
  const [changes, setChanges] = useState([]);
  const [selectedChange, setSelectedChange] = useState(null);

  // 1. Fetch ServiceNow Change & Incident telemetry for current environment
  useEffect(() => {
    fetch(`/api/infra-tickets?environment=${encodeURIComponent(environment)}`)
      .then(res => res.json())
      .then(t => {
        const list = Array.isArray(t) ? t : (t && Array.isArray(t.tickets) ? t.tickets : []);
        setChanges(list);
        if (list.length > 0) {
          setSelectedChange(list[0]);
        } else {
          setSelectedChange(null);
        }
      })
      .catch(e => console.error('Failed loading ServiceNow changes:', e));
  }, [environment]);

  // 2. Fetch RCA & Correlation data dynamically for selected app and environment
  useEffect(() => {
    const fetchData = () => {
      fetch(`/api/rca-correlation?app=${selectedFlowApp}&environment=${encodeURIComponent(environment)}`)
        .then(res => res.json())
        .then(d => {
          setData(d);
          setLoading(false);
          if (d.correlations && d.correlations.length > 0) {
            setSelectedCorrelation(d.correlations[0]);
          } else {
            setSelectedCorrelation(null);
          }
        })
        .catch(e => {
          console.error('Failed loading RCA data:', e);
          setLoading(false);
        });
    };

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [selectedFlowApp, environment]);

  if (loading || !data || !data.flows) {
    return (
      <div className="command-center-loading-card">
        <h3>Loading RCA Analytics & Ticket timelines...</h3>
      </div>
    );
  }

  const activeFlow = (data.flows && data.flows[selectedFlowApp]) || [];
  const timelineData = data.timeline || [];

  // Generate SVG coordinates for Expected vs Actual Chart
  const padding = 40;
  const width = 800;
  const height = 240;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxVal = Math.max(
    ...timelineData.map(t => Math.max(t.nasIops || 0, (t.expected || 0) * (t.nasIops > 1000 ? 5 : 1))),
    100
  );
  
  const getX = (index, total) => padding + (index / (Math.max(total - 1, 1))) * chartWidth;
  const getY = (value) => padding + chartHeight - ((value || 0) / maxVal) * chartHeight;

  const pointsActual = timelineData.map((t, i) => `${getX(i, timelineData.length)},${getY(t.nasIops)}`).join(' ');
  const pointsExpected = timelineData.map((t, i) => `${getX(i, timelineData.length)},${getY(t.expected * (t.nasIops > 1000 ? 5 : 1))}`).join(' ');

  const getStatusClass = (status) => {
    if (!status) return 'healthy';
    return status.toLowerCase();
  };

  return (
    <div className="rca-root">

      {/* Overview Block */}
      <div className="section-header-group">
        <h3 className="section-subtitle">ROOT CAUSE & TICKET CORRELATION ENGINE</h3>
        <h2 className="section-title">
          RCA Analytics & ServiceNow Ticket Regression
          {MAINTENANCE_CONFIG.pages.rcaDashboard && <MaintenanceBadge />}
        </h2>
        <p className="section-description">
          Cross-references end-to-end telemetry flows with active deviations and ServiceNow Incident (INC), Change (CHG), and Problem (PRB) tickets raised 2 weeks before and after deployment gates.
        </p>
      </div>

      {/* Interactive E2E Flow Dependency Mapper */}
      <div className="metrics-panel-card rca-pad-lg">
        <div className="panel-header rca-header-lg">
          <div>
            <h3>Application End-to-End Dependency Flow Mapper</h3>
            <p className="rca-hint">
              Select an application below to visualize status propagation and performance deviations from identity proxies down to NAS/S3 storage mounts.
            </p>
          </div>
          <span className="panel-badge-green">Live Active</span>
        </div>

        {/* Application Selector Tabs */}
        <div className="rca-app-tabs">
          {Object.keys(data.flows).map(appKey => (
            <button
              key={appKey}
              onClick={() => setSelectedFlowApp(appKey)}
              className={`nav-tab-btn rca-app-tab${selectedFlowApp === appKey ? ' rca-app-tab--active' : ''}`}
            >
              {appDisplayNames[appKey] || appKey.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Horizontal Node Flow Visualizer */}
        <div className="rca-flow-scroll">
          <div className="rca-flow-row">
            {activeFlow.map((node, index) => {
              const normStatus = normalizeSeverity(node.status);
              const isAnomaly = normStatus === SEVERITY.CRITICAL || normStatus === SEVERITY.WARNING;
              return (
                <React.Fragment key={index}>
                  <div
                    className={`rca-flow-node${isAnomaly ? ' rca-flow-node--anomaly' : ''}${normStatus === SEVERITY.CRITICAL ? ' rca-flow-node--critical' : ''}`}
                    style={{ borderTopColor: getStatusColor(node.status) }}
                  >
                    <span className="rca-flow-layer">
                      Layer {index + 1}
                    </span>
                    <h4 className="rca-flow-name">
                      {node.name}
                    </h4>
                    <span className="rca-flow-value" style={isAnomaly ? { color: getStatusColor(node.status) } : undefined}>
                      {node.value}
                    </span>
                    {isAnomaly && (
                      <div className="rca-flow-deviation">
                        ⚠️ Deviation Detected
                      </div>
                    )}
                  </div>
                  {index < activeFlow.length - 1 && (
                    <div className="rca-flow-arrow">
                      ➜
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* AI Root Cause & Correlation Intelligence Panel */}
      {selectedCorrelation && (
        <div className="metrics-panel-card rca-ai-card">
          <div className="panel-header rca-header-sm">
            <div className="rca-ai-title-row">
              <span className="rca-ai-icon">🧠</span>
              <div>
                <h3 className="rca-ai-title">AI Root Cause Correlation: {selectedCorrelation.title}</h3>
                <span className="rca-ai-meta">Target: <strong>{appDisplayNames[selectedFlowApp] || selectedFlowApp.toUpperCase()}</strong> | Correlation Confidence: <strong className="rca-confidence">{selectedCorrelation.confidence}%</strong></span>
              </div>
            </div>
            <span className="panel-badge-green">AI Verified</span>
          </div>
          <div className="rca-ai-grid">
            <div className="rca-ai-box">
              <span className="rca-ai-label rca-ai-label--diagnosis">🔍 Root Cause Diagnosis</span>
              <p className="rca-ai-text">{selectedCorrelation.rootCause}</p>
            </div>
            <div className="rca-ai-box">
              <span className="rca-ai-label rca-ai-label--action">⚡ Recommended Remediation Action</span>
              <p className="rca-ai-text">{selectedCorrelation.recommendation}</p>
            </div>
          </div>
        </div>
      )}

      {/* Row 2: Performance Telemetry & Anomaly Deviations */}
      <div className="metrics-panel-card rca-pad-lg">
        <div className="panel-header rca-header-lg">
          <div>
            <h3>Telemetry Deviation Timeline: {appDisplayNames[selectedFlowApp] || selectedFlowApp.toUpperCase()} vs Baseline</h3>
            <p className="rca-hint">
              Comparison of live observed metrics (Red) against historical predictive baseline models (Teal).
            </p>
          </div>
          <div className="rca-legend">
            <span className="rca-legend-item">
              <span className="rca-legend-dot rca-legend-dot--expected"></span> Expected Baseline
            </span>
            <span className="rca-legend-item">
              <span className="rca-legend-dot rca-legend-dot--actual"></span> Live Observed Telemetry
            </span>
          </div>
        </div>

        <div className="rca-chart-frame">
          {timelineData.length === 0 ? (
            <div className="rca-chart-empty">
              <div className="rca-chart-empty-icon">⏱️</div>
              <strong className="rca-text-main">Value Not Available</strong>
              <span className="rca-chart-empty-note">Telemetry deviation timeline is not collected yet for {environment ? environment.toUpperCase() : 'this environment'}.</span>
            </div>
          ) : (
            <svg width={width} height={height} className="rca-chart-svg">
              {[0, 1, 2, 3].map((g, idx) => (
                <line key={idx} x1={padding} y1={padding + (chartHeight / 3) * idx} x2={width - padding} y2={padding + (chartHeight / 3) * idx} stroke="var(--border-light)" strokeDasharray="4,4" />
              ))}
              <polyline fill="none" stroke="var(--primary)" strokeWidth="2.5" points={pointsExpected} />
              <polyline fill="none" stroke="#ef4444" strokeWidth="3" points={pointsActual} />
              {data.timeline.map((t, idx) => {
                const x = getX(idx, data.timeline.length);
                const y = getY(t.nasIops);
                const isAlert = t.note;
                return (
                  <g key={idx}>
                    <circle cx={x} cy={y} r={isAlert ? 6 : 4} fill={isAlert ? '#ef4444' : 'var(--text-main)'} stroke={isAlert ? '#ffffff' : '#ef4444'} strokeWidth="2" />
                    {isAlert && (
                      <g>
                        <rect x={x - 60} y={y - 30} width={120} height={20} rx="4" fill="#ef4444" />
                        <text x={x} y={y - 17} fill="#ffffff" fontSize="8" fontWeight="700" textAnchor="middle">{t.note}</text>
                      </g>
                    )}
                    <text x={x} y={height - 15} fill="var(--text-muted)" fontSize="9" textAnchor="middle" fontFamily="var(--font-mono)">{t.time}</text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Row 3: ServiceNow 2-Week Change & Incident timelines */}
      <div className="rca-changes-grid">

        {/* ServiceNow Changes List */}
        <div className="rca-col-sm">
          <h4 className="rca-changes-title">
            ServiceNow Change Records & Incident Correlation
            {MAINTENANCE_CONFIG.tiles.serviceNowTile && <MaintenanceBadge />}
          </h4>
          {MAINTENANCE_CONFIG.tiles.serviceNowTile && (
            <div className="rca-maint-note">
              🛠️ Under Maintenance — ServiceNow ITSM change ticket sync in progress.
            </div>
          )}

          {changes.length === 0 ? (
            <div className="rca-empty-box">
              Value Not Available
            </div>
          ) : (
            changes.map(chg => (
              <div
                key={chg.id}
                onClick={() => setSelectedChange(chg)}
                className={`metrics-panel-card rca-chg-card${selectedChange?.id === chg.id ? ' rca-chg-card--selected' : ''}`}
              >
                <div className="rca-chg-head">
                  <span className="rca-chg-id">{chg.id}</span>
                  <span className="rca-chg-date">{chg.date}</span>
                </div>
                <h4 className="rca-chg-title">{chg.title}</h4>
                <div className="rca-chg-tags">
                  <span className="badge-gray rca-tag-xs">{chg.component.toUpperCase()}</span>
                  <span className={`status-badge-inline rca-risk${chg.risk === 'High' ? ' rca-risk--high' : ''}`}>{chg.risk} Risk</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 2-Week Timeline before & after ticket mapping */}
        {selectedChange ? (
          <div className="rca-col-lg">
            <div className="metrics-panel-card rca-pad-md">
              <div className="panel-header rca-header-md">
                <h3>ServiceNow Specification Details: {selectedChange.id}</h3>
                <span className="panel-badge-green">{selectedChange.status}</span>
              </div>
              <div className="rca-spec">
                <p><strong>Title:</strong> {selectedChange.title}</p>
                <p className="rca-mt-1"><strong>Engineer:</strong> {selectedChange.engineer} | <strong>Risk Level:</strong> {selectedChange.risk}</p>
                <p className="rca-spec-desc">{selectedChange.description}</p>
              </div>
            </div>

            {/* Split panel: 2 weeks before vs 2 weeks after */}
            <div className="rca-split">

              {/* 2 Weeks Before */}
              <div className="metrics-panel-card rca-pad-md">
                <div className="panel-header rca-window-header">
                  <h4 className="rca-window-title rca-window-title--before">📉 2 Weeks BEFORE Change</h4>
                </div>
                {selectedChange.beforeTickets.length === 0 ? (
                  <p className="rca-window-empty">Value Not Available</p>
                ) : (
                  <div className="rca-ticket-list">
                    {selectedChange.beforeTickets.map(t => (
                      <div key={t.id} className="rca-ticket">
                        <div className="rca-ticket-head">
                          <span className="rca-ticket-id">{t.id} ({t.type})</span>
                          <span className="rca-text-muted">{t.date}</span>
                        </div>
                        <div className="rca-ticket-title">{t.title}</div>
                        <span className="rca-ticket-source">Source: {t.source}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2 Weeks After */}
              <div className="metrics-panel-card rca-pad-md">
                <div className="panel-header rca-window-header">
                  <h4 className="rca-window-title rca-window-title--after">📈 2 Weeks AFTER Change</h4>
                </div>
                {selectedChange.afterTickets.length === 0 ? (
                  <p className="rca-window-empty">Value Not Available</p>
                ) : (
                  <div className="rca-ticket-list">
                    {selectedChange.afterTickets.map(t => (
                      <div key={t.id} className="rca-ticket rca-ticket--after">
                        <div className="rca-ticket-head">
                          <span className="rca-ticket-id rca-ticket-id--after">{t.id} ({t.type})</span>
                          <span className="rca-text-muted">{t.date}</span>
                        </div>
                        <div className="rca-ticket-title">{t.title}</div>
                        <span className="rca-ticket-source">Source: {t.source}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        ) : (
          <p className="rca-text-muted">Select a change record to view ServiceNow impact timelines.</p>
        )}
      </div>

      {/*
        Colleague Integration Placeholder: RcaDashboard
        -------------------------------------------------
        To integrate your colleague's custom module or root cause analytics here:
        1. Import the component (e.g., import ColleagueRcaModule from './ColleagueRcaModule';)
        2. Render it inside this container with the appropriate RCA / Change telemetry data props.

        Example (add matching rules to RcaDashboard.css):
        <div className="colleague-module-container rca-colleague-module">
          <h4 className="rca-colleague-module-title">Colleague RCA Analytics Module</h4>
          Example: ColleagueRcaModule selectedFlowApp={selectedFlowApp} data={data} changes={changes}
        </div>
      {/* Connective Architecture Layer: Drift-Linked Incidents Feed */}
      <DriftRcaCorrelationFeed
        onSelectEntity={onInspectEntity}
        onNavigateToTimeline={onNavigateToTimeline}
        environment={environment}
      />
    </div>
  );
}
