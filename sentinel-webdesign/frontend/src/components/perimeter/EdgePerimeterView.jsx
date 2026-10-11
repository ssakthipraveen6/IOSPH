import React, { useState, useEffect } from 'react';
import DonutChart from '../shared/DonutChart';
import LiveLogsStreamTable from './LiveLogsStreamTable';

export default function EdgePerimeterView({ onSelectTrace = null }) {
  const [data, setData] = useState({
    bandwidthGb: 112,
    logVolumeHourlyM: 9.39,
    failuresByHost: [
      { label: 'api.bank.com', percentage: 48.2, color: '#3b82f6' },
      { label: 'auth.bank.com', percentage: 24.1, color: '#14b8a6' },
      { label: 'swift-gw.bank.com', percentage: 18.4, color: '#f59e0b' },
      { label: 'clearing.bank.com', percentage: 9.3, color: '#ef4444' }
    ],
    statusDistribution: [
      { label: '200 OK', percentage: 96.4, color: '#10b981' },
      { label: '304 Not Modified', percentage: 2.1, color: '#14b8a6' },
      { label: '404 / 401 Client Error', percentage: 1.2, color: '#f59e0b' },
      { label: '500 / 502 Origin Error', percentage: 0.3, color: '#ef4444' }
    ],
    liveStream: [
      {
        timestamp: '14:48:01.402',
        host: 'api.bank.com',
        uri: '/v2/payments/settlement/execute',
        status: 200,
        statusLabel: '200 OK',
        bytes: 4180,
        durationMs: 14,
        traceId: '4bf92f3577b34da6',
        tlsVip: 'TLS 1.3 / F5-VIP-01'
      },
      {
        timestamp: '14:48:01.385',
        host: 'auth.bank.com',
        uri: '/oauth2/v1/token/validate',
        status: 200,
        statusLabel: '200 OK',
        bytes: 840,
        durationMs: 6,
        traceId: 'e8b91a24d55b3810',
        tlsVip: 'mTLS / Cloudflare-Edge'
      },
      {
        timestamp: '14:48:01.320',
        host: 'clearing.bank.com',
        uri: '/v1/swift/iso20022/batch-ingest',
        status: 504,
        statusLabel: '504 TIMEOUT',
        bytes: 512,
        durationMs: 5002,
        traceId: 'c92841ab7f004911',
        tlsVip: 'TLS 1.3 / NetScaler-VIP'
      },
      {
        timestamp: '14:48:00.994',
        host: 'api.bank.com',
        uri: '/v1/compliance/sanctions/screen',
        status: 404,
        statusLabel: '404 NOT_FOUND',
        bytes: 310,
        durationMs: 3,
        traceId: '98124bcf01a938de',
        tlsVip: 'TLS 1.3 / Cloudflare-Edge'
      }
    ]
  });

  useEffect(() => {
    fetch('/api/perimeter/telemetry')
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (res) setData(prev => ({ ...prev, ...res }));
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Row: Bandwidth 112 GB, 9.39M Logs, Donut Charts (Reference Images 3 & 5) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.25rem' }}>
        <div className="glass-card" style={{ gridColumn: 'span 2', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Total Data</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Egress</span>
          </div>
          <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--primary)', lineHeight: 1.1 }}>
            {data.bandwidthGb}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>GB Transferred</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--healthy)', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 6 }}>↑ 14% vs baseline</div>
        </div>

        <div className="glass-card" style={{ gridColumn: 'span 2', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Ingested Logs</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Live tail</span>
          </div>
          <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--healthy)', lineHeight: 1.1 }}>
            {data.logVolumeHourlyM} M
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>Structured Logs / hr</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--healthy)', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 6 }}>Zero-drop OTLP</div>
        </div>

        {/* Donut 1: Failures by Host */}
        <div className="glass-card" style={{ gridColumn: 'span 4', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Failures by Ingress Host</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cloudflare / F5 VIPs</span>
          </div>
          <DonutChart segments={data.failuresByHost} size={130} />
        </div>

        {/* Donut 2: Response Status Distribution */}
        <div className="glass-card" style={{ gridColumn: 'span 4', background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>HTTP Response Codes</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Edge distribution</span>
          </div>
          <DonutChart segments={data.statusDistribution} size={130} />
        </div>
      </div>

      {/* Live Log Stream Table (Reference Image 3) */}
      <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Live Edge Request &amp; Security Stream</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Correlated with W3C Trace Context (traceparent / span_id)</div>
          </div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--healthy)' }}>
            🟢 Streaming OTLP Tail Active
          </div>
        </div>
        <LiveLogsStreamTable logs={data.liveStream} onSelectTrace={onSelectTrace} />
      </div>
    </div>
  );
}
