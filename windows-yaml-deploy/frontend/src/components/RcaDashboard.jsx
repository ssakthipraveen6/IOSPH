import React, { useEffect, useState } from 'react';
import { MAINTENANCE_CONFIG } from '../maintenanceConfig';
import { MaintenanceBadge, MaintenanceBanner } from './MaintenanceNotice';

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

export default function RcaDashboard({ environment = 'staging' }) {
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
        setChanges(t);
        if (t && t.length > 0) {
          setSelectedChange(t[0]);
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

  const getStatusColor = (status) => {
    if (status === 'Critical') return '#ef4444';
    if (status === 'Warning') return '#f59e0b';
    return '#10b981';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
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
      <div className="metrics-panel-card" style={{ padding: '1.5rem' }}>
        <div className="panel-header" style={{ marginBottom: '1.25rem' }}>
          <div>
            <h3>Application End-to-End Dependency Flow Mapper</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Select an application below to visualize status propagation and performance deviations from identity proxies down to NAS/S3 storage mounts.
            </p>
          </div>
          <span className="panel-badge-green">Live Active</span>
        </div>

        {/* Application Selector Tabs */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '2rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '1rem' }}>
          {Object.keys(data.flows).map(appKey => (
            <button
              key={appKey}
              onClick={() => setSelectedFlowApp(appKey)}
              className="nav-tab-btn"
              style={{
                width: 'auto',
                padding: '0.4rem 1rem',
                fontSize: '0.75rem',
                background: selectedFlowApp === appKey ? 'var(--primary)' : 'rgba(255,255,255,0.02)',
                color: selectedFlowApp === appKey ? '#ffffff' : 'var(--text-muted)',
                borderColor: selectedFlowApp === appKey ? 'var(--primary)' : 'var(--border-light)',
              }}
            >
              {appDisplayNames[appKey] || appKey.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Horizontal Node Flow Visualizer */}
        <div style={{ overflowX: 'auto', padding: '1rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: '950px' }}>
            {activeFlow.map((node, index) => {
              const isAnomaly = node.status === 'Critical' || node.status === 'Warning';
              return (
                <React.Fragment key={index}>
                  <div 
                    style={{
                      flex: '1',
                      background: 'var(--bg-panel)',
                      border: isAnomaly ? '1.5px solid #ef4444' : '1px solid var(--border-light)',
                      borderTop: `4px solid ${getStatusColor(node.status)}`,
                      borderRadius: '8px',
                      padding: '1rem',
                      textAlign: 'center',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
                      animation: node.status === 'Critical' ? 'pulse-ring 2.5s infinite' : 'none',
                      minWidth: '160px'
                    }}
                  >
                    <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                      Layer {index + 1}
                    </span>
                    <h4 style={{ fontSize: '0.8rem', fontWeight: '800', color: 'var(--text-main)', marginBottom: '8px' }}>
                      {node.name}
                    </h4>
                    <span style={{ 
                      fontFamily: 'var(--font-mono)', 
                      fontSize: '0.75rem', 
                      color: node.status === 'Critical' ? '#ef4444' : node.status === 'Warning' ? '#f59e0b' : 'var(--primary)',
                      fontWeight: '700'
                    }}>
                      {node.value}
                    </span>
                    {isAnomaly && (
                      <div style={{ fontSize: '0.6rem', color: '#ef4444', marginTop: '6px', fontWeight: 'bold' }}>
                        ⚠️ Deviation Detected
                      </div>
                    )}
                  </div>
                  {index < activeFlow.length - 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: '1.25rem' }}>
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
        <div className="metrics-panel-card" style={{ padding: '1.25rem', background: 'linear-gradient(135deg, rgba(13,148,136,0.06) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(13,148,136,0.3)' }}>
          <div className="panel-header" style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.25rem' }}>🧠</span>
              <div>
                <h3 style={{ fontSize: '0.95rem' }}>AI Root Cause Correlation: {selectedCorrelation.title}</h3>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Target: <strong>{appDisplayNames[selectedFlowApp] || selectedFlowApp.toUpperCase()}</strong> | Correlation Confidence: <strong style={{ color: '#10b981' }}>{selectedCorrelation.confidence}%</strong></span>
              </div>
            </div>
            <span className="panel-badge-green">AI Verified</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '8px' }}>
            <div style={{ background: 'var(--bg-dark)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🔍 Root Cause Diagnosis</span>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-main)', marginTop: '4px', lineHeight: 1.4 }}>{selectedCorrelation.rootCause}</p>
            </div>
            <div style={{ background: 'var(--bg-dark)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>⚡ Recommended Remediation Action</span>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-main)', marginTop: '4px', lineHeight: 1.4 }}>{selectedCorrelation.recommendation}</p>
            </div>
          </div>
        </div>
      )}

      {/* Row 2: Performance Telemetry & Anomaly Deviations */}
      <div className="metrics-panel-card" style={{ padding: '1.5rem' }}>
        <div className="panel-header" style={{ marginBottom: '1.25rem' }}>
          <div>
            <h3>Telemetry Deviation Timeline: {appDisplayNames[selectedFlowApp] || selectedFlowApp.toUpperCase()} vs Baseline</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Comparison of live observed metrics (Red) against historical predictive baseline models (Teal).
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
              <span style={{ width: '10px', height: '10px', background: 'var(--primary)', display: 'inline-block', borderRadius: '50%' }}></span> Expected Baseline
            </span>
            <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
              <span style={{ width: '10px', height: '10px', background: '#ef4444', display: 'inline-block', borderRadius: '50%' }}></span> Live Observed Telemetry
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', background: 'var(--bg-dark)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-light)', overflowX: 'auto' }}>
          {timelineData.length === 0 ? (
            <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Data Not Available
            </div>
          ) : (
            <svg width={width} height={height} style={{ minWidth: '800px' }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* ServiceNow Changes List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            ServiceNow Change Records & Incident Correlation
            {MAINTENANCE_CONFIG.tiles.serviceNowTile && <MaintenanceBadge />}
          </h4>
          {MAINTENANCE_CONFIG.tiles.serviceNowTile && (
            <div style={{ fontSize: '0.7rem', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '6px 10px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)', marginBottom: '8px', fontWeight: 600 }}>
              🛠️ Under Maintenance — ServiceNow ITSM change ticket sync in progress.
            </div>
          )}
          
          {changes.length === 0 ? (
            <div style={{ padding: '15px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', background: 'var(--bg-panel)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
              Data Not Available
            </div>
          ) : (
            changes.map(chg => (
              <div 
                key={chg.id}
                onClick={() => setSelectedChange(chg)}
                className="metrics-panel-card"
                style={{
                  cursor: 'pointer',
                  borderColor: selectedChange?.id === chg.id ? 'var(--primary)' : 'var(--border-light)',
                  background: selectedChange?.id === chg.id ? 'var(--primary-glow)' : 'var(--bg-panel)',
                  padding: '1rem',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', fontSize: '0.8rem', color: 'var(--primary)' }}>{chg.id}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{chg.date}</span>
                </div>
                <h4 style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-main)', marginBottom: '8px', lineHeight: '1.3' }}>{chg.title}</h4>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <span className="badge-gray" style={{ fontSize: '0.6rem' }}>{chg.component.toUpperCase()}</span>
                  <span className="status-badge-inline" style={{ 
                    background: chg.risk === 'High' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    color: chg.risk === 'High' ? '#ef4444' : '#f59e0b',
                    fontSize: '0.6rem'
                  }}>{chg.risk} Risk</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 2-Week Timeline before & after ticket mapping */}
        {selectedChange ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="metrics-panel-card" style={{ padding: '1.25rem' }}>
              <div className="panel-header" style={{ marginBottom: '1rem' }}>
                <h3>ServiceNow Specification Details: {selectedChange.id}</h3>
                <span className="panel-badge-green">{selectedChange.status}</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                <p><strong>Title:</strong> {selectedChange.title}</p>
                <p style={{ marginTop: '4px' }}><strong>Engineer:</strong> {selectedChange.engineer} | <strong>Risk Level:</strong> {selectedChange.risk}</p>
                <p style={{ marginTop: '6px', color: 'var(--text-main)', background: 'var(--bg-dark)', padding: '8px', borderRadius: '4px' }}>{selectedChange.description}</p>
              </div>
            </div>

            {/* Split panel: 2 weeks before vs 2 weeks after */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              
              {/* 2 Weeks Before */}
              <div className="metrics-panel-card" style={{ padding: '1.25rem' }}>
                <div className="panel-header" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '8px' }}>
                  <h4 style={{ color: '#f59e0b', fontSize: '0.8rem', fontWeight: 800 }}>📉 2 Weeks BEFORE Change</h4>
                </div>
                {selectedChange.beforeTickets.length === 0 ? (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>Data Not Available</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedChange.beforeTickets.map(t => (
                      <div key={t.id} style={{ padding: '8px', background: 'var(--bg-dark)', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 'bold' }}>
                          <span style={{ color: 'var(--primary)' }}>{t.id} ({t.type})</span>
                          <span style={{ color: 'var(--text-muted)' }}>{t.date}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', marginTop: '4px', color: 'var(--text-main)' }}>{t.title}</div>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>Source: {t.source}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2 Weeks After */}
              <div className="metrics-panel-card" style={{ padding: '1.25rem' }}>
                <div className="panel-header" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '8px' }}>
                  <h4 style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 800 }}>📈 2 Weeks AFTER Change</h4>
                </div>
                {selectedChange.afterTickets.length === 0 ? (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>Data Not Available</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedChange.afterTickets.map(t => (
                      <div key={t.id} style={{ padding: '8px', background: 'rgba(239, 68, 68, 0.03)', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 'bold' }}>
                          <span style={{ color: '#ef4444' }}>{t.id} ({t.type})</span>
                          <span style={{ color: 'var(--text-muted)' }}>{t.date}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', marginTop: '4px', color: 'var(--text-main)' }}>{t.title}</div>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>Source: {t.source}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Select a change record to view ServiceNow impact timelines.</p>
        )}
      </div>

      {/* 
        Colleague Integration Placeholder: RcaDashboard
        -------------------------------------------------
        To integrate your colleague's custom module or root cause analytics here:
        1. Import the component (e.g., import ColleagueRcaModule from './ColleagueRcaModule';)
        2. Render it inside this container with the appropriate RCA / Change telemetry data props.
        
        Example:
        <div className="colleague-module-container" style={{ marginTop: '2rem', border: '1px dashed var(--border-light)', padding: '15px', borderRadius: '6px' }}>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '8px' }}>Colleague RCA Analytics Module</h4>
          Example: ColleagueRcaModule selectedFlowApp={selectedFlowApp} data={data} changes={changes}
        </div>
      */}

    </div>
  );
}
