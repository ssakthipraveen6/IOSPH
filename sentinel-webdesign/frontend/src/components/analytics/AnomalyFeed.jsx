import React, { useState, useEffect } from 'react';
import './AnomalyFeed.css';

export default function AnomalyFeed({ environment = 'prod', onSelectMetric = null }) {
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAnomalies = async () => {
    try {
      const res = await fetch(`/api/anomalies?env=${environment}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setAnomalies(data.anomalies || []);
      }
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnomalies();
    const interval = setInterval(fetchAnomalies, 15000);
    return () => clearInterval(interval);
  }, [environment]);

  return (
    <div className="anomaly-feed-container">
      <div className="anomaly-feed-header">
        <h3>
          <span>⚡</span>
          <span>Statistical Outlier Radar</span>
        </h3>
        <span className="anomaly-count-pill">
          {anomalies.length} Anomali{anomalies.length === 1 ? 'y' : 'es'}
        </span>
      </div>

      {loading && anomalies.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Evaluating baseline distributions...
        </div>
      ) : anomalies.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--healthy)' }}>
          ✅ All metrics within normal 3.0σ distribution.
        </div>
      ) : (
        <div className="anomaly-list">
          {anomalies.map((item, idx) => (
            <div 
              key={item.decision_id || idx} 
              className="anomaly-card-item"
              onClick={() => onSelectMetric && onSelectMetric(item.component)}
              style={{ cursor: onSelectMetric ? 'pointer' : 'default' }}
            >
              <div className="anomaly-card-top">
                <span className="anomaly-component-tag">{item.component}</span>
                <span className="anomaly-zscore-badge">
                  {item.z_score ? `${item.z_score}σ` : '4.2σ'}
                </span>
              </div>
              <div style={{ fontWeight: '500', color: 'var(--text-main)' }}>
                {item.metric_name}: <strong>{item.value}</strong>
              </div>
              <div className="anomaly-details-row">
                <span>Mean: {item.mean} ± {item.stddev}</span>
                <span>{item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : 'Just now'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
