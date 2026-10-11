import React, { useState, useEffect } from 'react';
import ReactiveCanvasChart from '../shared/ReactiveCanvasChart';
import NodeHoneycombMesh from './NodeHoneycombMesh';

export default function KubernetesMeshView({ environment = 'prod' }) {
  const [data, setData] = useState({
    coresAllocated: 3842,
    coresTotal: 5120,
    memoryCommittedTb: 73.8,
    objectCounts: {
      namespaces: 24,
      statefulSets: 28,
      deployments: 149,
      runningPods: 3854,
      serviceEndpoints: 765
    },
    containerRestarts: {
      history: [0.1, 0.8, 0.3, 0.95, 0.2, 0.4, 0.7, 0.15, 0.9, 0.3]
    },
    namespaceUsage: [
      { name: 'payment-gateway', cpuPercent: 88.4, cores: 1240, podsDesired: 1420, podsReady: 1420, status: 'critical' },
      { name: 'clearing-settlement-engine', cpuPercent: 72.1, cores: 980, podsDesired: 960, podsReady: 960, status: 'healthy' },
      { name: 'ledger-audit-stream', cpuPercent: 54.0, cores: 420, podsDesired: 480, podsReady: 480, status: 'normal' },
      { name: 'compliance-kyc-worker', cpuPercent: 31.2, cores: 210, podsDesired: 120, podsReady: 120, status: 'normal' }
    ],
    nodes: Array.from({ length: 48 }, (_, i) => ({
      id: `n${String(i + 1).padStart(2, '0')}`,
      status: (i === 3 || i === 21) ? 'warning' : (i === 9 ? 'critical' : 'healthy'),
      cpuLoad: 40 + (i % 30),
      memoryLoad: 60 + (i % 25)
    }))
  });

  useEffect(() => {
    fetch('/api/k8s/mesh')
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (res) setData(prev => ({ ...prev, ...res }));
      })
      .catch(() => {});
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
            <strong>Cluster:</strong> prod-sg3-k8s-mesh-01
          </span>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <strong>Namespace:</strong> all (24 namespaces)
          </span>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <strong>K8s Version:</strong> v1.28.7-eks
          </span>
        </div>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          48 Worker Nodes • 3 Control Plane • 3,854 Running Pods
        </div>
      </div>

      {/* Top Row: Cores, Mem, Objects, Container Restarts (Reference Image 2) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.25rem' }}>
        <div className="glass-card" style={{ gridColumn: 'span 3', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Resources Used</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Compute</span>
          </div>
          <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--primary)', lineHeight: 1.1 }}>
            {data.coresAllocated}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>Cores Allocated (74.2% of {data.coresTotal})</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--healthy)', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 6 }}>↑ 4.1% during trading peak</div>
        </div>

        <div className="glass-card" style={{ gridColumn: 'span 3', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Cluster Memory</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>RAM Committed</span>
          </div>
          <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--healthy)', lineHeight: 1.1 }}>
            {data.memoryCommittedTb} TB
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>Committed Resident RAM</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--healthy)', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 6 }}>68.3% Heap Allocation</div>
        </div>

        <div className="glass-card" style={{ gridColumn: 'span 3', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}># of K8s Objects</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>etcd counts</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-panel-subtle)', padding: '4px 8px', borderRadius: 4 }}>
              <span>Namespaces</span><strong style={{ color: 'var(--primary)' }}>{data.objectCounts.namespaces}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-panel-subtle)', padding: '4px 8px', borderRadius: 4 }}>
              <span>StatefulSets</span><strong style={{ color: 'var(--primary)' }}>{data.objectCounts.statefulSets}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-panel-subtle)', padding: '4px 8px', borderRadius: 4 }}>
              <span>Deployments</span><strong style={{ color: 'var(--primary)' }}>{data.objectCounts.deployments}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-panel-subtle)', padding: '4px 8px', borderRadius: 4 }}>
              <span>Running Pods</span><strong style={{ color: 'var(--healthy)' }}>{data.objectCounts.runningPods}</strong>
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ gridColumn: 'span 3', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Container Restarts</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>OOMKilled &amp; Crashes</span>
          </div>
          <ReactiveCanvasChart
            type="spikes"
            height={130}
            series={[{ data: data.containerRestarts.history }]}
          />
        </div>
      </div>

      {/* Middle Row: Progress Bars (Reference Image 2) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.25rem' }}>
        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>CPU Utilization by Namespace (% Used vs Limit)</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Auto-scaling limits</span>
          </div>
          {data.namespaceUsage.map(ns => (
            <div key={ns.name} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4, color: 'var(--text-muted)' }}>
                <span>{ns.name}</span>
                <strong style={{ color: 'var(--text-main)' }}>{ns.cpuPercent}% ({ns.cores} Cores)</strong>
              </div>
              <div style={{ height: 8, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${ns.cpuPercent}%`,
                  background: ns.status === 'critical' ? 'var(--critical)' : (ns.status === 'healthy' ? 'var(--healthy)' : 'var(--primary)'),
                  borderRadius: 4
                }} />
              </div>
            </div>
          ))}
        </div>

        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Pods by Namespace Distribution</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Replica status</span>
          </div>
          {data.namespaceUsage.map(ns => (
            <div key={ns.name} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4, color: 'var(--text-muted)' }}>
                <span>{ns.name}</span>
                <strong style={{ color: 'var(--text-main)' }}>{ns.podsReady} Pods / {ns.podsDesired} Desired</strong>
              </div>
              <div style={{ height: 8, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '100%', background: 'var(--healthy)', borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: 48-Node Worker Honeycomb Mesh */}
      <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>48-Node Worker Cluster Health Mesh</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--healthy)' }}>
            46 Healthy • 2 Under Pressure
          </span>
        </div>
        <NodeHoneycombMesh nodes={data.nodes} />
      </div>
    </div>
  );
}
