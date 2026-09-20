import React, { useState, useEffect } from 'react';

export default function PipelineOpsView({ environment = 'staging' }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const currentEnv = environment || 'staging';

  async function fetchIngestHealth() {
    try {
      const res = await fetch('/api/v2/ingest/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setLastRefreshed(new Date().toLocaleTimeString());
      }
    } catch (_) {}
    finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchIngestHealth();
    const timer = setInterval(fetchIngestHealth, 5000);
    return () => clearInterval(timer);
  }, []);

  const cardinalityPct = health?.cardinality
    ? Math.round((health.cardinality.activeSeriesCount / (health.cardinality.maxSeries || 200000)) * 100)
    : 0;

  const queuePct = health
    ? Math.round((health.queueDepth / (health.queueCapacity || 50000)) * 100)
    : 0;

  return (
    <div className="pipeline-ops-view" style={{ animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
            Pipeline Operations & Ingestion Health
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Live Write-Ahead Queue, Cardinality Guard, Circuit Breakers & Collector Shard Metrics
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Auto-refresh (5s): {lastRefreshed || 'Connecting...'}
          </span>
          <button
            onClick={fetchIngestHealth}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              background: 'rgba(20, 184, 166, 0.15)',
              border: '1px solid rgba(20, 184, 166, 0.3)',
              color: 'var(--sentinel-teal, #14b8a6)',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {loading && !health ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          🔄 Loading pipeline health metrics...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* 2. Top Metric KPI Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            
            {/* Ingestion Throughput */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '10px',
              padding: '1.2rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Ingest Throughput
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--primary)', marginTop: '4px' }}>
                {(health?.rowsPerSec || 0).toLocaleString()} <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>rows/sec</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Total Ingested: {(health?.totalIngested || 0).toLocaleString()} rows
              </div>
            </div>

            {/* Write-Ahead Queue Depth */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '10px',
              padding: '1.2rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Write-Ahead Queue
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 900, color: queuePct > 80 ? '#ef4444' : '#10b981', marginTop: '4px' }}>
                {(health?.queueDepth || 0).toLocaleString()} <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>/ {(health?.queueCapacity || 50000).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Queue Buffer Saturation: {queuePct}%
              </div>
            </div>

            {/* Cardinality Guard */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '10px',
              padding: '1.2rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Cardinality Guard (T2.3)
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 900, color: cardinalityPct > 85 ? '#f59e0b' : 'var(--sentinel-teal, #14b8a6)', marginTop: '4px' }}>
                {(health?.cardinality?.activeSeriesCount || 0).toLocaleString()} <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>/ {(health?.cardinality?.maxSeries || 200000).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Dropped Series: {health?.cardinality?.droppedTotal || 0}
              </div>
            </div>

            {/* Flush Latency */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '10px',
              padding: '1.2rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Batch Flush Latency
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#10b981', marginTop: '4px' }}>
                {health?.flushLatency?.p95Ms || 0.3} <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>ms (p95)</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                p50: {health?.flushLatency?.p50Ms || 0.08} ms | SLA Target: &lt; 150ms
              </div>
            </div>

          </div>

          {/* 3. Shard & Persistence Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            
            {/* Shard Node Distribution */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '10px',
              padding: '1.25rem'
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '10px' }}>
                Collector Shard Partitioning (T2.5)
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Deterministic modulo hash partition: <code>fnv1a(entity_id) % shardTotal</code>
              </div>
              <div style={{
                padding: '10px',
                borderRadius: '6px',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border-light)',
                display: 'flex',
                justifyContent: 'space-between'
              }}>
                <span>Active Shard Role:</span>
                <strong style={{ color: 'var(--primary)' }}>{health?.shardStatus?.role || 'all'}</strong>
              </div>
              <div style={{
                padding: '10px',
                borderRadius: '6px',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border-light)',
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '8px'
              }}>
                <span>Shard Index / Total:</span>
                <strong>{health?.shardStatus?.shardIndex || 0} / {health?.shardStatus?.shardTotal || 1}</strong>
              </div>
            </div>

            {/* PostgreSQL Persistence Status */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '10px',
              padding: '1.25rem'
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '10px' }}>
                Datastore Persistence State (T2.2)
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                TimescaleDB Hypertable Write-Through + Resilient Ring-Buffer Fallback
              </div>
              <div style={{
                padding: '10px',
                borderRadius: '6px',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border-light)',
                display: 'flex',
                justifyContent: 'space-between'
              }}>
                <span>Persistence Degradation:</span>
                <strong style={{ color: health?.persistence?.degraded ? '#ef4444' : '#10b981' }}>
                  {health?.persistence?.degraded ? 'DEGRADED (Cached Locally)' : 'OPTIMAL'}
                </strong>
              </div>
              <div style={{
                padding: '10px',
                borderRadius: '6px',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border-light)',
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '8px'
              }}>
                <span>Dropped Records Total:</span>
                <strong style={{ color: health?.droppedTotal > 0 ? '#ef4444' : '#10b981' }}>
                  {health?.droppedTotal || 0}
                </strong>
              </div>
            </div>

          </div>

          {/* 4. Circuit Breaker Matrix */}
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-light)',
            borderRadius: '10px',
            padding: '1.25rem'
          }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
              Collector Circuit Breaker Status Matrix (T2.4)
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Protects failed third-party endpoints from storming with exponential backoff (20s - 300s)
            </div>

            {health?.circuitBreakers && Object.keys(health.circuitBreakers).length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {Object.entries(health.circuitBreakers).map(([name, breaker]) => {
                  const stateColor = breaker.state === 'CLOSED' ? '#10b981' : (breaker.state === 'HALF_OPEN' ? '#f59e0b' : '#ef4444');
                  return (
                    <div
                      key={name}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: 'var(--bg-dark)',
                        border: '1px solid var(--border-light)'
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-main)' }}>{name}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <span style={{ fontSize: '0.7rem', color: stateColor, fontWeight: 700 }}>
                          ● {breaker.state}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Fails: {breaker.failureCount || 0}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                All collector circuit breakers operating in standard CLOSED state.
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
}
