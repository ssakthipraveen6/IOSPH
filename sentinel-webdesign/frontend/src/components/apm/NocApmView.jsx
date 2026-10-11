import React, { useState, useEffect } from 'react';
import ReactiveCanvasChart from '../shared/ReactiveCanvasChart';
import RecentDeploymentsTable from './RecentDeploymentsTable';

export default function NocApmView({ environment = 'prod' }) {
  const [data, setData] = useState({
    apdex: 0.984,
    violations: 13,
    syntheticFailures: 13,
    deployments: [
      { rev: 'v1.5', deployer: 'praveen.s', description: 'Update NetScaler TLS session reuse VIP', time: '14:39, 11 Oct' },
      { rev: 'v1.4', deployer: 'release-bot', description: 'Tune RocksDB memory buffer pool for Kafka', time: '12:15, 11 Oct' },
      { rev: 'v1.3', deployer: 'jon.sre', description: 'Add circuit breaker to Oracle settlement pool', time: '09:40, 11 Oct' },
      { rev: 'v1.2', deployer: 'infra-cd', description: 'Patch OpenSSL 3.0.12 CVE-2024 zero-day', time: '06:22, 11 Oct' }
    ],
    webTransactions: {
      history: [0.2, 0.25, 0.8, 0.82, 0.18, 0.2, 0.9, 0.22]
    },
    errorsPerMin: {
      history: [0.05, 0.04, 0.08, 0.05, 0.12, 0.6, 0.2, 0.05]
    },
    datastore: {
      history: [0.15, 0.18, 0.22, 0.19, 0.24, 0.28, 0.35, 0.22]
    },
    multiTierLayer: {
      database: [0.3, 0.35, 0.4, 0.38, 0.42, 0.48, 0.52, 0.41],
      cache: [0.2, 0.22, 0.25, 0.24, 0.26, 0.3, 0.32, 0.28],
      transit: [0.08, 0.1, 0.12, 0.11, 0.14, 0.15, 0.18, 0.12]
    }
  });

  useEffect(() => {
    fetch('/api/apm/overview')
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (res) setData(prev => ({ ...prev, ...res }));
      })
      .catch(() => {
        // Fallback to initial state if server is offline
      });
  }, [environment]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Filter Strip */}
      <div style={{
        background: 'var(--bg-glass-card)',
        backdropFilter: 'blur(var(--glass-blur))',
        border: '1px solid var(--border-light)',
        borderRadius: '12px',
        padding: '0.75rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: 'var(--glass-shadow)',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <strong>Cluster:</strong> equinix-sg3-mesh-01
          </span>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <strong>App:</strong> core-payment-orchestrator
          </span>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <strong>Apdex Target:</strong> T = 100ms
          </span>
        </div>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          Ingesting 1,482,900 req/min • 64 Microservice Pods
        </div>
      </div>

      {/* Top Row: Violations, Synthetic Failures, Deployments, Apdex (Image 1) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.25rem' }}>
        {/* All Violations */}
        <div className="glass-card" style={{ gridColumn: 'span 2', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.9rem', fontWeight: 700 }}>
            <span>All violations</span>
            <span style={{ color: 'var(--text-subtle)' }}>⋮</span>
          </div>
          <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--critical)', lineHeight: 1.1 }}>
            {data.violations}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>All open alert policies</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--critical)', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 6 }}>↑ 2 from last hour</div>
        </div>

        {/* Synthetic Failures */}
        <div className="glass-card" style={{ gridColumn: 'span 2', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.9rem', fontWeight: 700 }}>
            <span>Synthetic Failures</span>
            <span style={{ color: 'var(--text-subtle)' }}>⋮</span>
          </div>
          <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--warning)', lineHeight: 1.1 }}>
            {data.syntheticFailures}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>Browser &amp; API probes</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--healthy)', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 6 }}>99.982% Global SLA</div>
        </div>

        {/* Recent Deployments Table */}
        <div className="glass-card" style={{ gridColumn: 'span 5', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Recent deployments</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last 24 hours</span>
          </div>
          <RecentDeploymentsTable deployments={data.deployments} />
        </div>

        {/* Apdex Score Gauge & Curve */}
        <div className="glass-card" style={{ gridColumn: 'span 3', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Apdex score</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>T = 100ms</span>
          </div>
          <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--healthy)', lineHeight: 1.1, marginBottom: 6 }}>
            {data.apdex}
          </div>
          <ReactiveCanvasChart
            type="line"
            height={90}
            series={[{ data: [0.92, 0.94, 0.91, 0.96, 0.98, 0.95, 0.99, data.apdex], color: '#10b981', width: 2 }]}
          />
        </div>
      </div>

      {/* Middle Row: WebTransactions, Errors per minute, Datastore/all (Images 1 & 4) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>WebTransactions</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>• Avg response time &nbsp;• Std deviation</div>
            </div>
            <span style={{ color: 'var(--text-subtle)' }}>⋮</span>
          </div>
          <ReactiveCanvasChart
            type="line"
            height={160}
            series={[
              { data: data.webTransactions.history, color: '#14b8a6', width: 2 },
              { data: [0.1, 0.15, 0.5, 0.52, 0.12, 0.14, 0.6, 0.15], color: '#f59e0b', width: 1.5 }
            ]}
          />
        </div>

        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Errors per minute</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>HTTP 5xx &amp; Exceptions</div>
            </div>
            <span style={{ color: 'var(--text-subtle)' }}>⋮</span>
          </div>
          <ReactiveCanvasChart
            type="area"
            height={160}
            series={[
              { data: data.errorsPerMin.history, color: '#ef4444', width: 2, fill: true, fillColor: 'rgba(239, 68, 68, 0.2)' }
            ]}
          />
        </div>

        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Datastore/all</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>• Avg latency &nbsp;• Throughput/min</div>
            </div>
            <span style={{ color: 'var(--text-subtle)' }}>⋮</span>
          </div>
          <ReactiveCanvasChart
            type="line"
            height={160}
            series={[
              { data: data.datastore.history, color: '#3b82f6', width: 2 }
            ]}
          />
        </div>
      </div>

      {/* Bottom Row: Layered Multi-Tier Transaction Breakdown & Memory RSS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.25rem' }}>
        <div className="glass-card" style={{ gridColumn: 'span 8', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Transaction Time by Layer (Multi-Tier Breakdown)</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Stacked areas: Database (Blue), Redis Cache (Green), App Engine &amp; Transit (Amber)</div>
            </div>
            <span style={{ color: 'var(--text-subtle)' }}>⋮</span>
          </div>
          <ReactiveCanvasChart
            type="stacked-area"
            height={190}
            series={[
              { data: data.multiTierLayer.database, color: '#3b82f6', fill: true, fillColor: 'rgba(59, 130, 246, 0.28)' },
              { data: data.multiTierLayer.cache, color: '#10b981', fill: true, fillColor: 'rgba(16, 185, 129, 0.28)' },
              { data: data.multiTierLayer.transit, color: '#f59e0b', fill: true, fillColor: 'rgba(245, 158, 11, 0.28)' }
            ]}
          />
        </div>

        <div className="glass-card" style={{ gridColumn: 'span 4', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Physical Memory RSS</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Committed Heap</span>
          </div>
          <ReactiveCanvasChart
            type="area"
            height={190}
            series={[
              { data: [0.55, 0.58, 0.62, 0.64, 0.68, 0.72, 0.74, 0.69], color: '#14b8a6', width: 2, fill: true, fillColor: 'rgba(20, 184, 166, 0.2)' }
            ]}
          />
        </div>
      </div>
    </div>
  );
}
