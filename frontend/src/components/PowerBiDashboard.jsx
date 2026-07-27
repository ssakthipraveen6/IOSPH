import React, { useState, useEffect } from 'react';

const metricOptions = {
  avi_load_balancer: ['connections', 'ingressFlow', 'throughput'],
  database: ['cpu', 'memory', 'transactions', 'iops'],
  nas_performance: ['iops', 'throughput', 'spaceUsed'],
  linux_servers: ['cpu', 'memory', 'load'],
  windows_servers: ['cpu', 'memory', 'disk'],
  s3_storage: ['latency', 'space', 'bandwidth']
};

export default function PowerBiDashboard() {
  const [component, setComponent] = useState('database');
  const [metricName, setMetricName] = useState('cpu');
  const [timeRange, setTimeRange] = useState('24'); // hours
  const [historicalData, setHistoricalData] = useState([]);
  const [logAnalytics, setLogAnalytics] = useState([]);
  const [loading, setLoading] = useState(false);

  // Synchronize metricName dropdown if component changes
  useEffect(() => {
    const opts = metricOptions[component] || [];
    if (!opts.includes(metricName)) {
      setMetricName(opts[0] || '');
    }
  }, [component]);

  // Fetch metrics (Postgres) and logs (Snowflake)
  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      // 1. Fetch Postgres historical metrics
      const mRes = await fetch(`/api/pbi/metrics?component=${component}&metricName=${metricName}&hours=${timeRange}`);
      if (mRes.ok) {
        const data = await mRes.json();
        setHistoricalData(data);
      }
      
      // 2. Fetch Snowflake log events statistics
      const lRes = await fetch('/api/pbi/logs');
      if (lRes.ok) {
        const data = await lRes.json();
        setLogAnalytics(data);
      }
    } catch (e) {
      console.error('Failed to load PowerBI analytics:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [component, metricName, timeRange]);

  // Calculate coordinates for SVG timeseries chart
  const renderTrendChart = () => {
    if (historicalData.length === 0) {
      return <div className="empty-chart"><p>No Postgres telemetry dataset found for this filter.</p></div>;
    }

    const width = 500;
    const height = 180;
    const padding = 25;

    const values = historicalData.map(d => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const valRange = maxVal - minVal === 0 ? 1 : maxVal - minVal;

    const points = historicalData.map((d, index) => {
      const x = padding + (index / (historicalData.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((d.value - minVal) / valRange) * (height - 2 * padding);
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg className="custom-chart-svg" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%' }}>
        {/* Gridlines */}
        {[0.25, 0.5, 0.75].map((ratio, idx) => {
          const y = padding + ratio * (height - 2 * padding);
          return (
            <line 
              key={idx}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              className="chart-gridline"
              style={{ strokeDasharray: '4' }}
            />
          );
        })}
        {/* Baseline Axes */}
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1.5" />
        
        {/* Trend Polyline */}
        <polyline 
          fill="none" 
          stroke="var(--primary)" 
          strokeWidth="2.5" 
          points={points} 
          className="chart-line"
        />

        {/* Labels */}
        <text x={padding + 5} y={padding + 10} className="chart-axis-label" fontWeight="bold">Max: {maxVal.toFixed(1)}</text>
        <text x={padding + 5} y={height - padding - 5} className="chart-axis-label" fontWeight="bold">Min: {minVal.toFixed(1)}</text>
        <text x={width - padding - 45} y={height - padding - 5} className="chart-axis-label">Now ({timeRange}h ago)</text>
      </svg>
    );
  };

  // Render log breakdown horizontal bars (Snowflake log counts)
  const renderLogBarChart = () => {
    if (logAnalytics.length === 0) {
      return <div className="empty-chart"><p>No Snowflake data lake summary loaded.</p></div>;
    }

    const maxCount = Math.max(...logAnalytics.map(l => l.info + l.warn + l.error));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 0', flex: 1, justifyContent: 'center' }}>
        {logAnalytics.slice(0, 5).map((l, idx) => {
          const total = l.info + l.warn + l.error;
          const ratio = maxCount > 0 ? (total / maxCount) * 100 : 0;
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem' }}>
              <span style={{ width: '100px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {l.component.replace('_', ' ')}
              </span>
              <div style={{ flex: 1, height: '14px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden', position: 'relative', display: 'flex' }}>
                <div style={{ width: `${ratio}%`, height: '100%', backgroundColor: 'var(--primary)', transition: 'width 0.5s ease' }}></div>
              </div>
              <span style={{ width: '45px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, marginLeft: '8px' }}>{total}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const getKpiValues = () => {
    let kpiMetricVal = 'N/A';
    if (historicalData.length > 0) {
      const values = historicalData.map(d => d.value);
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      kpiMetricVal = avg.toFixed(1);
    }
    
    let totalLogs = 0;
    if (logAnalytics.length > 0) {
      totalLogs = logAnalytics.reduce((sum, l) => sum + l.info + l.warn + l.error, 0);
    }
    
    return {
      avgMetric: kpiMetricVal,
      totalLogs: totalLogs.toLocaleString()
    };
  };

  const kpis = getKpiValues();

  return (
    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
      
      {/* PowerBI Filter Panel (Left) */}
      <div className="console-panel" style={{ flex: '1 1 280px', maxWidth: '320px' }}>
        <div className="panel-header">
          <h3>📊 PowerBI Filter Pane</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Historical Server/Infra</label>
            <select 
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              className="component-dropdown"
              style={{ padding: '6px' }}
            >
              <option value="database">🗄️ Database Clusters</option>
              <option value="linux_servers">🐧 Linux Compute Farm</option>
              <option value="nas_performance">💾 NAS Storage Volumes</option>
              <option value="avi_load_balancer">🌐 Ingress Routing (AVI)</option>
              <option value="windows_servers">💻 Windows Compute Pool</option>
              <option value="s3_storage">☁️ Object Storage (S3)</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target Telemetry Metric</label>
            <select 
              value={metricName}
              onChange={(e) => setMetricName(e.target.value)}
              className="component-dropdown"
              style={{ padding: '6px' }}
            >
              {(metricOptions[component] || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Postgres History Range</label>
            <select 
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="component-dropdown"
              style={{ padding: '6px' }}
            >
              <option value="1">Last 1 Hour</option>
              <option value="6">Last 6 Hours</option>
              <option value="12">Last 12 Hours</option>
              <option value="24">Last 24 Hours (1 Day)</option>
              <option value="168">Last 168 Hours (7 Days)</option>
            </select>
          </div>

          <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            <strong>Databases Configured:</strong>
            <ul style={{ paddingLeft: '15px', marginTop: '4px' }}>
              <li>Postgres (Historical Metrics)</li>
              <li>Snowflake (Log Warehouse)</li>
            </ul>
            <p style={{ marginTop: '6px' }}>API queries execute direct SELECT tasks against relational and dimensional tables.</p>
          </div>

        </div>
      </div>

      {/* Main Analytics View (Right) */}
      <div style={{ flex: '3 1 700px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {/* KPI Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          
          <div className="console-panel" style={{ padding: '12px', textAlign: 'center' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Avg Filtered Metric</span>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--primary)', marginTop: '4px', display: 'block' }}>
              {kpis.avgMetric}
            </span>
          </div>

          <div className="console-panel" style={{ padding: '12px', textAlign: 'center' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Total Snowflake Logs</span>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginTop: '4px', display: 'block' }}>
              {kpis.totalLogs}
            </span>
          </div>

          <div className="console-panel" style={{ padding: '12px', textAlign: 'center' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Postgres Pool status</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981', marginTop: '8px', display: 'block' }}>
              🟢 ACTIVE
            </span>
          </div>

          <div className="console-panel" style={{ padding: '12px', textAlign: 'center' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Snowflake Warehouse</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981', marginTop: '8px', display: 'block' }}>
              🟢 SUSPENDED (AUTO-RESUME)
            </span>
          </div>

        </div>

        {/* Dynamic Charts Row - 2-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', flexWrap: 'wrap' }}>
          
          {/* Trend Chart (Postgres) */}
          <div className="console-panel">
            <div className="panel-header">
              <h3>📈 Postgres Historical metrics trends</h3>
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              {renderTrendChart()}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '6px', textAlign: 'center' }}>
              Source: SQL Query [SELECT timestamp, value FROM metrics WHERE component='{component}' AND metric_name='{metricName}']
            </span>
          </div>

          {/* Log count Chart (Snowflake) */}
          <div className="console-panel" style={{ minHeight: '220px' }}>
            <div className="panel-header">
              <h3>📊 Snowflake Log distribution (Total Rows)</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '5px 0' }}>
              {renderLogBarChart()}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '6px', textAlign: 'center' }}>
              Source: Log Warehouse Table [SELECT component, count(*) FROM logs_events GROUP BY component]
            </span>
          </div>

        </div>

        {/* Detailed Data grids */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          
          {/* Postgres Raw Table */}
          <div className="console-panel">
            <div className="table-panel-header">📁 Postgres Metrics Data Table</div>
            <div className="table-wrapper" style={{ maxHeight: '140px' }}>
              <table className="telemetry-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Metric</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalData.length === 0 ? (
                    <tr>
                      <td colSpan="3">No historical data available.</td>
                    </tr>
                  ) : (
                    [...historicalData].reverse().slice(0, 10).map((d, idx) => (
                      <tr key={idx}>
                        <td>{new Date(d.timestamp).toLocaleTimeString()}</td>
                        <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{metricName}</td>
                        <td className="metric-val-cell">{d.value}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Snowflake Log Aggregates Table */}
          <div className="console-panel">
            <div className="table-panel-header">📁 Snowflake Log Volume Schema</div>
            <div className="table-wrapper" style={{ maxHeight: '140px' }}>
              <table className="telemetry-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>INFO</th>
                    <th>WARN</th>
                    <th>ERROR</th>
                  </tr>
                </thead>
                <tbody>
                  {logAnalytics.length === 0 ? (
                    <tr>
                      <td colSpan="4">No log summary sync.</td>
                    </tr>
                  ) : (
                    logAnalytics.map((l, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{l.component}</td>
                        <td className="metric-val-cell" style={{ color: '#10b981' }}>{l.info}</td>
                        <td className="metric-val-cell" style={{ color: '#f59e0b' }}>{l.warn}</td>
                        <td className="metric-val-cell" style={{ color: '#ef4444' }}>{l.error}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
