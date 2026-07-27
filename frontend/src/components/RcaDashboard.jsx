import React, { useEffect, useState } from 'react';

export default function RcaDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCorrelation, setSelectedCorrelation] = useState(null);
  const [selectedFlowApp, setSelectedFlowApp] = useState('jenkins');

  useEffect(() => {
    // Poll data immediately and every 10 seconds to keep live metrics sync
    const fetchData = () => {
      fetch('/api/rca-correlation')
        .then(res => res.json())
        .then(d => {
          setData(d);
          setLoading(false);
          if (!selectedCorrelation && d.correlations && d.correlations.length > 0) {
            setSelectedCorrelation(d.correlations[0]);
          }
        })
        .catch(e => {
          console.error('Failed loading RCA data:', e);
          setLoading(false);
        });
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [selectedCorrelation]);

  if (loading) {
    return (
      <div className="command-center-loading-card">
        <h3>Loading Root Cause Analysis data...</h3>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="command-center-loading-card">
        <h3>Error: RCA Telemetry Data Unavailable</h3>
      </div>
    );
  }

  const activeFlow = data.flows[selectedFlowApp] || [];

  // Generate SVG coordinates for the expected vs actual chart
  const padding = 40;
  const width = 800;
  const height = 280;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxVal = 2500;
  
  const getX = (index, total) => padding + (index / (total - 1)) * chartWidth;
  const getY = (value) => padding + chartHeight - (value / maxVal) * chartHeight;

  const pointsActual = data.timeline.map((t, i) => `${getX(i, data.timeline.length)},${getY(t.nasIops)}`).join(' ');
  const pointsExpected = data.timeline.map((t, i) => `${getX(i, data.timeline.length)},${getY(t.expected * 5)}`).join(' ');

  const getStatusClass = (status) => {
    if (!status) return 'healthy';
    return status.toLowerCase();
  };

  const getStatusColor = (status) => {
    if (status === 'Critical') return 'var(--critical)';
    if (status === 'Warning') return 'var(--warning)';
    return 'var(--healthy)';
  };

  const appDisplayNames = {
    jenkins: "Jenkins CI/CD",
    bitbucket: "Bitbucket Repositories",
    artifactory: "Artifactory Binaries",
    argocd: "ArgoCD GitOps",
    teamcity: "TeamCity Builds",
    fortify: "Fortify SSC scans",
    nexusiq: "NexusIQ security",
    mcp: "MCP Gateway"
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Overview Block */}
      <div className="section-header-group">
        <h3 className="section-subtitle">ROOT CAUSE CORRELATION ENGINE</h3>
        <h2 className="section-title">E2E Flow Dependencies & RCA Analytics</h2>
        <p className="section-description">
          Tracks low-level infrastructure dependencies (SSO, AVI, databases, disks) through application deployment gates to automatically identify bottlenecks and isolate incident roots.
        </p>
      </div>

      {/* Interactive E2E Flow Dependencies Card */}
      <div className="metrics-panel-card" style={{ padding: '2rem 1.5rem' }}>
        <div className="panel-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h3>Application End-to-End Dependency Flow Mapper</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Select an application below to visualize status propagation from identity and networking buffers down to storage pools.
            </p>
          </div>
          <span className="panel-badge-green">Dynamic Real-time</span>
        </div>

        {/* Application Selector Tabs */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '2.5rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '1rem' }}>
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
                boxShadow: selectedFlowApp === appKey ? '0 2px 8px var(--primary-glow)' : 'none'
              }}
            >
              {appDisplayNames[appKey] || appKey.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Node Chain Diagram Flow */}
        <div style={{ overflowX: 'auto', padding: '1rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: '950px' }}>
            {activeFlow.map((node, index) => (
              <React.Fragment key={index}>
                {/* Node Box */}
                <div 
                  style={{
                    flex: '1',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border-light)',
                    borderTop: `4px solid ${getStatusColor(node.status)}`,
                    borderRadius: '8px',
                    padding: '1rem',
                    textAlign: 'center',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
                    position: 'relative',
                    animation: node.status === 'Critical' ? 'pulse-ring 2.5s infinite' : 'none',
                    minWidth: '150px'
                  }}
                >
                  <span style={{ 
                    display: 'block', 
                    fontSize: '0.6rem', 
                    color: 'var(--text-muted)', 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.5px',
                    marginBottom: '4px'
                  }}>
                    Layer {index + 1}
                  </span>
                  <h4 style={{ fontSize: '0.8rem', fontWeight: '800', color: 'var(--text-main)', marginBottom: '8px' }}>
                    {node.name}
                  </h4>
                  <span style={{ 
                    fontFamily: 'var(--font-mono)', 
                    fontSize: '0.75rem', 
                    color: node.status === 'Critical' ? 'var(--critical)' : node.status === 'Warning' ? 'var(--warning)' : 'var(--primary)',
                    fontWeight: '700'
                  }}>
                    {node.value}
                  </span>
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px' }}>
                    <span className={`status-badge-inline ${getStatusClass(node.status)}`} style={{ fontSize: '0.6rem' }}>
                      {node.status}
                    </span>
                  </div>
                </div>

                {/* Arrow Connector (Omitted for final element) */}
                {index < activeFlow.length - 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: '1.25rem', fontWeight: '700' }}>
                    ➜
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Correlation Matrix */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem' }}>
        
        {/* Correlation Table Card */}
        <div className="metrics-panel-card">
          <div className="panel-header">
            <h3>Infrastructure-Application Correlation Coefficients</h3>
            <span className="panel-badge-green">AI Evaluated</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table className="glassmorphic-table">
              <thead>
                <tr>
                  <th>Infrastructure Layer</th>
                  <th>Application Layer</th>
                  <th>Correlation</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {data.correlations.map((c, i) => (
                  <tr 
                    key={i} 
                    onClick={() => setSelectedCorrelation(c)}
                    style={{ 
                      cursor: 'pointer',
                      background: selectedCorrelation?.source === c.source ? 'var(--primary-glow)' : 'transparent'
                    }}
                  >
                    <td style={{ fontWeight: '700', fontSize: '0.8rem' }}>{c.source}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{c.target}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', fontSize: '0.75rem' }}>
                          {(c.coefficient * 100).toFixed(0)}%
                        </span>
                        <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden', minWidth: '60px' }}>
                          <div style={{ 
                            width: `${c.coefficient * 100}%`, 
                            height: '100%', 
                            background: c.coefficient > 0.9 ? 'var(--critical)' : c.coefficient > 0.75 ? 'var(--warning)' : 'var(--primary)' 
                          }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge-inline ${c.status.toLowerCase()}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RCA Diagnostics Details Card */}
        <div className="metrics-panel-card">
          <div className="panel-header">
            <h3>Selected Component Correlation Diagnostics</h3>
          </div>
          
          {selectedCorrelation ? (
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: 'var(--bg-dark)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                  <h4 style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Source Metric</h4>
                  <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-main)' }}>{selectedCorrelation.source}</span>
                </div>
                <div style={{ padding: '1rem', background: 'var(--bg-dark)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                  <h4 style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Target Application Impact</h4>
                  <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-main)' }}>{selectedCorrelation.target}</span>
                </div>
              </div>

              <div style={{ padding: '1.25rem', background: 'var(--primary-glow)', borderRadius: '8px', border: '1px solid var(--primary)' }}>
                <h4 style={{ fontWeight: '700', fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '6px' }}>Correlation Assessment:</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-main)', lineHeight: '1.4' }}>
                  There is a <strong>{(selectedCorrelation.coefficient * 100).toFixed(0)}% regression lock</strong> identified between the two layers. 
                  During spike intervals, resource constraints at the infrastructure layer ({selectedCorrelation.source}) immediately propagate bottleneck delays to the application stack ({selectedCorrelation.target}).
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h4 style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)' }}>Automated Remediation Trigger</h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="remediate-trigger-btn" style={{ width: 'auto', padding: '0.5rem 1rem' }}>
                    ⚡ Run Remediation Diagnostics
                  </button>
                  <button className="ignore-trigger-btn" style={{ width: 'auto', padding: '0.5rem 1rem' }}>
                    Mute Correlation Warnings
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Select a correlation row to view diagnostics details.</p>
          )}
        </div>
      </div>

      {/* Row 3: Expected vs Issue Correlation Chart */}
      <div className="metrics-panel-card">
        <div className="panel-header">
          <div>
            <h3>Expected vs. Issue Correlation Chart (24-Hour Timeline)</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Plots anticipated telemetry benchmarks against actual traffic load spikes to visualize anomaly deviations.
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '15px', fontSize: '0.75rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '4px', background: 'var(--primary)' }}></span>
              Expected Baseline
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '4px', background: 'var(--critical)' }}></span>
              Actual Saturation (Spikes)
            </span>
          </div>
        </div>

        {/* SVG Correlation Line Chart */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', background: 'var(--bg-dark)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-light)', overflowX: 'auto' }}>
          <svg width={width} height={height} style={{ minWidth: '800px' }}>
            {/* Grid Lines */}
            {[0, 1, 2, 3].map((g, idx) => (
              <line 
                key={idx}
                x1={padding}
                y1={padding + (chartHeight / 3) * idx}
                x2={width - padding}
                y2={padding + (chartHeight / 3) * idx}
                stroke="var(--border-light)"
                strokeDasharray="4,4"
              />
            ))}
            
            {/* Line Plots */}
            <polyline
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2.5"
              points={pointsExpected}
            />

            <polyline
              fill="none"
              stroke="var(--critical)"
              strokeWidth="3"
              points={pointsActual}
            />

            {/* Plot Points */}
            {data.timeline.map((t, idx) => {
              const x = getX(idx, data.timeline.length);
              const y = getY(t.nasIops);
              const isAlert = t.note;
              return (
                <g key={idx}>
                  <circle 
                    cx={x} 
                    cy={y} 
                    r={isAlert ? 6 : 4} 
                    fill={isAlert ? 'var(--critical)' : 'var(--text-main)'}
                    stroke={isAlert ? '#ffffff' : 'var(--critical)'}
                    strokeWidth="2"
                  />
                  {isAlert && (
                    <g>
                      <rect 
                        x={x - 60} 
                        y={y - 30} 
                        width="120" 
                        height="20" 
                        rx="4" 
                        fill="var(--critical)" 
                      />
                      <text 
                        x={x} 
                        y={y - 17} 
                        fill="#ffffff" 
                        fontSize="8" 
                        fontWeight="700" 
                        textAnchor="middle"
                      >
                        {t.note}
                      </text>
                      <line x1={x} y1={y - 10} x2={x} y2={y} stroke="var(--critical)" strokeWidth="1.5" />
                    </g>
                  )}
                  <text 
                    x={x} 
                    y={height - 15} 
                    fill="var(--text-muted)" 
                    fontSize="9" 
                    textAnchor="middle"
                    fontFamily="var(--font-mono)"
                  >
                    {t.time}
                  </text>
                </g>
              );
            })}
            
            {/* Y Axis Labels */}
            <text x={padding - 8} y={padding + 5} fill="var(--text-muted)" fontSize="9" textAnchor="end">Max</text>
            <text x={padding - 8} y={padding + chartHeight / 2 + 3} fill="var(--text-muted)" fontSize="9" textAnchor="end">Med</text>
            <text x={padding - 8} y={padding + chartHeight + 3} fill="var(--text-muted)" fontSize="9" textAnchor="end">Min</text>
          </svg>
        </div>
      </div>
    </div>
  );
}
