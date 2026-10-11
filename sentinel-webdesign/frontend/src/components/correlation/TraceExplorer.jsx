import React, { useState, useEffect } from 'react';
import './TraceExplorer.css';

export default function TraceExplorer({ initialTraceId = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' }) {
  const [traceId, setTraceId] = useState(initialTraceId);
  const [traceData, setTraceData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchTrace = async (idToFetch) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/traces/${encodeURIComponent(idToFetch || traceId)}`);
      if (res.ok) {
        const data = await res.json();
        setTraceData(data);
      }
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrace(initialTraceId);
  }, [initialTraceId]);

  const handleCopyHeader = () => {
    navigator.clipboard.writeText(traceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalDuration = (traceData?.spans || []).reduce((acc, s) => acc + (s.duration_ms || 0), 0) || 1;

  return (
    <div className="trace-explorer-container">
      {/* Search Input */}
      <div className="trace-search-bar">
        <span style={{ fontSize: '1.2rem' }}>🧬</span>
        <input 
          type="text" 
          value={traceId} 
          onChange={(e) => setTraceId(e.target.value)}
          placeholder="Enter W3C traceparent (00-...)"
          className="trace-input"
        />
        <button onClick={() => fetchTrace(traceId)} className="trace-btn">
          {loading ? 'Searching...' : 'Explore Trace'}
        </button>
        <button onClick={handleCopyHeader} className="trace-btn" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
          {copied ? '✓ Copied' : 'Copy Header'}
        </button>
      </div>

      {/* Waterfall Visualization */}
      {traceData && (
        <div className="trace-waterfall-card">
          <div className="trace-header-row">
            <div>
              <h3 style={{ margin: 0 }}>Distributed Trace Waterfall</h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                W3C Trace ID: <span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{traceData.trace_id}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#10b981' }}>
                {totalDuration}ms
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Total Pipeline Latency
              </div>
            </div>
          </div>

          <div>
            {(traceData.spans || []).map((span, idx) => {
              const widthPct = Math.max(8, (span.duration_ms / totalDuration) * 100);
              const leftOffset = idx * 12; // staggered visualization

              return (
                <div key={span.span_id} className="span-row">
                  <div className="span-label">
                    <span>{span.name}</span>
                  </div>
                  <div className="span-track-container">
                    <div 
                      className="span-bar" 
                      style={{ 
                        width: `${widthPct}%`, 
                        marginLeft: `${Math.min(60, leftOffset)}%` 
                      }}
                    >
                      {span.duration_ms}ms
                    </div>
                  </div>
                  <div style={{ width: '60px', textAlign: 'right', fontSize: '0.75rem', color: '#10b981', fontWeight: 'bold' }}>
                    {span.status}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
