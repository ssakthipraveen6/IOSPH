import React, { useState, useEffect } from 'react';

const classifierRules = [
  { pattern: '/OOMKilled|OutOfMemoryError/i', classification: 'Memory Leak Outage', severity: 'Critical', action: 'Trigger Jenkins job: artifactory-jvm-recycle' },
  { pattern: '/No space left on device/i', classification: 'Disk Space Exhausted', severity: 'Critical', action: 'Trigger Jenkins job: nas-log-purge' },
  { pattern: '/Database connection pool saturated/i', classification: 'TCP Pool Saturation', severity: 'Critical', action: 'Trigger Jenkins job: db-connection-flush' },
  { pattern: '/Ingress network bottleneck/i', classification: 'Traffic Gateway Saturation', severity: 'Warning', action: 'Trigger Jenkins job: avi-ingress-scale' }
];

export default function AiLogPerformance() {
  const [throughputData, setThroughputData] = useState([]);
  const [ingestionData, setIngestionData] = useState([]);
  const [aiStats, setAiStats] = useState({
    scanThroughput: 840,
    accuracy: 99.4,
    latency: 1.2,
    queueSize: 0
  });

  // Fetch simulated AI performance metrics
  useEffect(() => {
    const generateTelemetryPoints = () => {
      const now = Date.now();
      const tData = [];
      const iData = [];
      
      for (let i = 15; i >= 0; i--) {
        const time = now - i * 5000;
        tData.push({
          timestamp: new Date(time).toLocaleTimeString(),
          value: 800 + Math.floor(Math.random() * 80)
        });
        iData.push({
          timestamp: new Date(time).toLocaleTimeString(),
          value: parseFloat((12.4 + Math.random() * 2.5).toFixed(2))
        });
      }
      setThroughputData(tData);
      setIngestionData(iData);
      
      // Update stats
      setAiStats({
        scanThroughput: 800 + Math.floor(Math.random() * 80),
        accuracy: 99.4,
        latency: parseFloat((1.1 + Math.random() * 0.3).toFixed(2)),
        queueSize: Math.floor(Math.random() * 2)
      });
    };

    generateTelemetryPoints();
    const interval = setInterval(generateTelemetryPoints, 5000);
    return () => clearInterval(interval);
  }, []);

  const renderSVGChart = (data, minBase, maxBase, color) => {
    if (data.length === 0) return null;
    
    const width = 500;
    const height = 150;
    const padding = 20;

    const values = data.map(d => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const valRange = maxVal - minVal === 0 ? 1 : maxVal - minVal;

    const points = data.map((d, index) => {
      const x = padding + (index / (data.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((d.value - minVal) / valRange) * (height - 2 * padding);
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg className="custom-chart-svg" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%' }}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
        <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
        <text x={padding + 5} y={padding + 10} className="chart-axis-label" fontWeight="bold">Max: {maxVal.toFixed(1)}</text>
        <text x={padding + 5} y={height - padding - 5} className="chart-axis-label" fontWeight="bold">Min: {minVal.toFixed(1)}</text>
      </svg>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header */}
      <div className="console-panel" style={{ padding: '1.25rem' }}>
        <div className="panel-header">
          <h3>🧠 Local AI & Log Ingestion Telemetry</h3>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '4px' }}>
          This view monitors the processing load of our local AI engine (regular expression keyword dictionary models) and Fluentd forwarder queues. It ensures logs are parsed with low latency and alerts are dispatched correctly.
        </p>
      </div>

      {/* KPI Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
        
        <div className="console-panel" style={{ textAlign: 'center', padding: '12px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>AI Scan Rate</span>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)', marginTop: '4px', display: 'block' }}>
            {aiStats.scanThroughput} <small style={{ fontSize: '0.75rem', fontWeight: 500 }}>eps</small>
          </span>
        </div>

        <div className="console-panel" style={{ textAlign: 'center', padding: '12px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>AI Model Accuracy</span>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981', marginTop: '4px', display: 'block' }}>
            {aiStats.accuracy}%
          </span>
        </div>

        <div className="console-panel" style={{ textAlign: 'center', padding: '12px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Avg Analysis Latency</span>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#3b82f6', marginTop: '4px', display: 'block' }}>
            {aiStats.latency} <small style={{ fontSize: '0.75rem', fontWeight: 500 }}>ms</small>
          </span>
        </div>

        <div className="console-panel" style={{ textAlign: 'center', padding: '12px' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Fluentd Buffer Queue</span>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: aiStats.queueSize > 0 ? 'var(--warning)' : 'inherit', marginTop: '4px', display: 'block' }}>
            {aiStats.queueSize} <small style={{ fontSize: '0.75rem', fontWeight: 500 }}>pkts</small>
          </span>
        </div>

      </div>

      {/* Graphs Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        
        {/* Left: AI throughput */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>📈 Local AI Scanning Rate (eps)</h3>
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            {renderSVGChart(throughputData, 800, 950, 'var(--primary)')}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '6px', textAlign: 'center' }}>
            Logs events scanned per second by the local pattern engine
          </span>
        </div>

        {/* Right: Ingestion rate */}
        <div className="console-panel">
          <div className="panel-header">
            <h3>📈 Fluentd Log Ingestion Volume (KB/s)</h3>
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            {renderSVGChart(ingestionData, 10, 20, '#3b82f6')}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '6px', textAlign: 'center' }}>
            Volume of data received from the fluentd log shipping agent
          </span>
        </div>

      </div>

      {/* Rules dictionary table */}
      <div className="console-panel">
        <div className="panel-header">
          <h3>📋 Local AI Classifier Rules Dictionary</h3>
        </div>
        <div className="table-wrapper" style={{ maxHeight: '200px', marginTop: '0.5rem' }}>
          <table className="telemetry-table">
            <thead>
              <tr>
                <th>Log Regex Match Pattern</th>
                <th>Classification Tag</th>
                <th>Severity</th>
                <th>Runbook Self-Healing Action</th>
              </tr>
            </thead>
            <tbody>
              {classifierRules.map((rule, idx) => (
                <tr key={idx}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--primary)' }}>{rule.pattern}</td>
                  <td style={{ fontWeight: 600 }}>{rule.classification}</td>
                  <td>
                    <span className="status-pill" style={{ backgroundColor: rule.severity === 'Critical' ? '#ef4444' : '#f59e0b', fontSize: '0.6rem', padding: '2px 6px' }}>
                      {rule.severity}
                    </span>
                  </td>
                  <td>{rule.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
