/**
 * Edge / perimeter view: AVI virtual services, VIP timings and edge logs.
 */
import React from 'react';
import DonutChart from '../shared/DonutChart';
import LiveLogsStreamTable from './LiveLogsStreamTable';
import usePrototypeData from '../shared/usePrototypeData';
import { DataUnavailableState, LoadingState, PrototypeBanner } from '../shared/PrototypeNotice';
import { SEVERITY, normalizeSeverity } from '@sentinel/shared-constants';
import './EdgePerimeterView.css';

// Captions that only dress the demo sample; shown only for prototype payloads.
const DEMO_SAMPLE_DECOR = {
  bandwidthDelta: '↑ 14% vs baseline',
  ingestCaption: 'Zero-drop OTLP',
  streamCaption: 'Sample stream (not live)'
};

// Value or a dash.
const fmt = (v) => (v === null || v === undefined ? '—' : v);

/**
 * Container: fetches /api/perimeter/telemetry for the environment.
 * When `demoData` is supplied (Demo view) it renders that payload instead
 * and never calls the live API.
 */
export default function EdgePerimeterView({ environment, onSelectTrace = null, demoData = null }) {
  if (demoData) {
    return <EdgePerimeterPanel data={demoData} environment={environment} onSelectTrace={onSelectTrace} />;
  }
  return <LiveEdgePerimeterView environment={environment} onSelectTrace={onSelectTrace} />;
}

// Loads live AVI telemetry and renders the panel.
function LiveEdgePerimeterView({ environment, onSelectTrace }) {
  const { state, data: res, reason } = usePrototypeData('/api/perimeter/telemetry', environment);

  if (state === 'loading') return <LoadingState label="Loading AVI & VIP telemetry…" />;
  if (state === 'unavailable') return <DataUnavailableState environment={environment} reason={reason} />;

  return <EdgePerimeterPanel data={res} environment={environment} onSelectTrace={onSelectTrace} />;
}

/** Presentational: renders a perimeter telemetry payload from props. */
export function EdgePerimeterPanel({ data, environment, onSelectTrace = null }) {
  const decor = data.prototype ? DEMO_SAMPLE_DECOR : null;
  const asList = (v) => (Array.isArray(v) ? v : []);

  // Demo / Prototype View
  if (data.prototype) {
    return (
      <div className="edge-root">
        <PrototypeBanner environment={environment} />
        {/* Top Row: Bandwidth 112 GB, 9.39M Logs, Donut Charts */}
        <div className="edge-grid-12">
          <div className="glass-card edge-card edge-span-2">
            <div className="edge-card-head">
              <span className="edge-card-title">Total Data</span>
              <span className="edge-card-sub">Egress</span>
            </div>
            <div className="edge-kpi-value">
              {fmt(data.bandwidthGb)}
            </div>
            <div className="edge-kpi-label">GB Transferred</div>
            <div className="edge-kpi-foot">{decor.bandwidthDelta}</div>
          </div>

          <div className="glass-card edge-card edge-span-2">
            <div className="edge-card-head">
              <span className="edge-card-title">Ingested Logs</span>
              <span className="edge-card-sub">Live tail</span>
            </div>
            <div className="edge-kpi-value edge-kpi-value--healthy">
              {fmt(data.logVolumeHourlyM)} M
            </div>
            <div className="edge-kpi-label">Structured Logs / hr</div>
            <div className="edge-kpi-foot">{decor.ingestCaption}</div>
          </div>

          <div className="glass-card edge-card edge-span-4">
            <div className="edge-card-head">
              <span className="edge-card-title">Failures by Ingress Host</span>
              <span className="edge-card-sub">Cloudflare / F5 VIPs</span>
            </div>
            <DonutChart segments={asList(data.failuresByHost)} size={130} />
          </div>

          <div className="glass-card edge-card edge-span-4">
            <div className="edge-card-head">
              <span className="edge-card-title">HTTP Response Codes</span>
              <span className="edge-card-sub">Edge distribution</span>
            </div>
            <DonutChart segments={asList(data.statusDistribution)} size={130} />
          </div>
        </div>

        <div className="glass-card edge-card">
          <div className="edge-card-head edge-card-head--lg">
            <div>
              <div className="edge-card-title">Live Edge Request &amp; Security Stream</div>
              <div className="edge-card-sub">Correlated with W3C Trace Context (traceparent / span_id)</div>
            </div>
            <div className="edge-stream-caption">
              {decor.streamCaption}
            </div>
          </div>
          <LiveLogsStreamTable logs={asList(data.liveStream)} onSelectTrace={onSelectTrace} />
        </div>
      </div>
    );
  }

  // Real VIP Probe Telemetry View (Prod / Staging)
  const vips = asList(data.vips);
  const timingBreakdown = asList(data.timingBreakdown);
  const worstVips = asList(data.worstVips);
  const certExpiries = asList(data.certExpiries);

  const healthyCount = vips.filter(v => v.status === 'HEALTHY' || (v.httpStatus && v.httpStatus < 400)).length;
  const validTimings = vips.filter(v => typeof v.total_ms === 'number' && v.total_ms > 0);
  const avgLatency = validTimings.length > 0
    ? (validTimings.reduce((sum, v) => sum + v.total_ms, 0) / validTimings.length).toFixed(1)
    : '—';
  const expiringCertsCount = certExpiries.filter(c => c.days_left !== null && c.days_left <= 30).length;
  const certTone = expiringCertsCount > 0 ? 'warning' : 'healthy';

  const donutSegments = asList(data.statusDistribution).map(s => {
    let color = '#10b981';
    if (String(s.status).startsWith('3')) color = '#14b8a6';
    else if (String(s.status).startsWith('4')) color = '#f59e0b';
    else if (String(s.status).startsWith('5') || s.status === 'DATA_UNAVAILABLE') color = '#ef4444';
    return {
      label: String(s.status),
      percentage: s.percentage,
      value: s.count,
      color
    };
  });

  return (
    <div className="edge-root">
      {/* KPI Cards */}
      <div className="edge-grid-12">
        <div className="glass-card edge-card edge-span-3">
          <div className="edge-card-head">
            <span className="edge-card-title">Monitored VIPs</span>
            <span className="edge-card-sub">Layer 1 Probes</span>
          </div>
          <div className="edge-kpi-value">
            {vips.length}
          </div>
          <div className="edge-kpi-label">Active Endpoints</div>
          <div className="edge-kpi-foot">
            {healthyCount} / {vips.length} Passing
          </div>
        </div>

        <div className="glass-card edge-card edge-span-3">
          <div className="edge-card-head">
            <span className="edge-card-title">Mean VIP Latency</span>
            <span className="edge-card-sub">End-to-End</span>
          </div>
          <div className="edge-kpi-value">
            {avgLatency} <span className="edge-kpi-unit">ms</span>
          </div>
          <div className="edge-kpi-label">Across All Endpoints</div>
          <div className="edge-kpi-foot edge-kpi-foot--subtle">
            DNS + TCP + TLS + TTFB
          </div>
        </div>

        <div className="glass-card edge-card edge-span-3">
          <div className="edge-card-head">
            <span className="edge-card-title">SSL/TLS Expirations</span>
            <span className="edge-card-sub">&le; 30 Days</span>
          </div>
          <div className={`edge-kpi-value edge-kpi-value--${certTone}`}>
            {expiringCertsCount}
          </div>
          <div className="edge-kpi-label">Certs Requiring Renewal</div>
          <div className={`edge-kpi-foot edge-kpi-foot--${certTone}`}>
            {expiringCertsCount > 0 ? 'Action Required' : 'All Certificates Valid'}
          </div>
        </div>

        <div className="glass-card edge-card edge-span-3">
          <div className="edge-card-head">
            <span className="edge-card-title">HTTP Response Codes</span>
            <span className="edge-card-sub">Edge distribution</span>
          </div>
          {donutSegments.length > 0 ? (
            <DonutChart segments={donutSegments} size={110} />
          ) : (
            <div className="edge-empty-note">No responses recorded</div>
          )}
        </div>
      </div>

      {/* Worst Latency VIPs (Bottlenecks) */}
      {worstVips.length > 0 && (
        <div className="glass-card edge-card">
          <div className="edge-card-head edge-card-head--lg">
            <div>
              <div className="edge-card-title edge-card-title--lg">Worst Latency VIPs (Top 5 Slowest Endpoints)</div>
              <div className="edge-card-sub">Stage-by-stage delay attribution to isolate network vs edge vs backend</div>
            </div>
          </div>
          <div className="edge-worst-grid">
            {worstVips.map((vip, idx) => (
              <div key={idx} className="edge-worst-card">
                <div className="edge-worst-head">
                  <span className="edge-worst-name">{vip.component || vip.productId}</span>
                  <span className={`edge-worst-total${(vip.total_ms || 0) > 1000 ? ' edge-worst-total--critical' : ''}`}>
                    {vip.total_ms !== null ? `${vip.total_ms} ms` : 'N/A'}
                  </span>
                </div>
                <div className="edge-worst-url">
                  {vip.url}
                </div>
                <div className="edge-stage-list">
                  <div className="edge-stage-row">
                    <span className="edge-stage--dns">DNS:</span>
                    <span>{vip.dns_ms !== null ? `${vip.dns_ms} ms` : '—'}</span>
                  </div>
                  <div className="edge-stage-row">
                    <span className="edge-stage--tcp">TCP:</span>
                    <span>{vip.tcp_ms !== null ? `${vip.tcp_ms} ms` : '—'}</span>
                  </div>
                  <div className="edge-stage-row">
                    <span className="edge-stage--tls">TLS:</span>
                    <span>{vip.tls_ms !== null ? `${vip.tls_ms} ms` : '—'}</span>
                  </div>
                  <div className="edge-stage-row">
                    <span className="edge-stage--ttfb">TTFB:</span>
                    <span>{vip.ttfb_ms !== null ? `${vip.ttfb_ms} ms` : '—'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-VIP Timing Breakdown Table */}
      <div className="glass-card edge-card">
        <div className="edge-card-head edge-card-head--lg">
          <div>
            <div className="edge-card-title edge-card-title--lg">VIP Probe Telemetry &amp; Latency Decomposition</div>
            <div className="edge-card-sub">Periodic Layer 1 DNS / TCP / TLS / TTFB probes from Sentinel nodes</div>
          </div>
        </div>
        <div className="edge-table-wrap">
          <table className="edge-table">
            <thead>
              <tr>
                <th className="edge-th">Target VIP</th>
                <th className="edge-th">Component</th>
                <th className="edge-th edge-right">DNS</th>
                <th className="edge-th edge-right">TCP</th>
                <th className="edge-th edge-right">TLS</th>
                <th className="edge-th edge-right">TTFB</th>
                <th className="edge-th edge-right">Total</th>
                <th className="edge-th edge-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {timingBreakdown.length === 0 && (
                <tr>
                  <td colSpan={8} className="edge-td--empty">No VIP probes recorded</td>
                </tr>
              )}
              {timingBreakdown.map((row, idx) => {
                const isHealthy = row.status === 'HEALTHY' || (typeof row.status === 'number' && row.status < 400);
                return (
                  <tr key={idx} className="edge-tr">
                    <td className="edge-td edge-c-main">
                      <code>{row.url}</code>
                    </td>
                    <td className="edge-td edge-c-muted">{row.component || row.productId}</td>
                    <td className="edge-td edge-right edge-stage--dns">{row.dns_ms !== null ? `${row.dns_ms} ms` : '—'}</td>
                    <td className="edge-td edge-right edge-stage--tcp">{row.tcp_ms !== null ? `${row.tcp_ms} ms` : '—'}</td>
                    <td className="edge-td edge-right edge-stage--tls">{row.tls_ms !== null ? `${row.tls_ms} ms` : '—'}</td>
                    <td className="edge-td edge-right edge-stage--ttfb">{row.ttfb_ms !== null ? `${row.ttfb_ms} ms` : '—'}</td>
                    <td className="edge-td edge-right edge-td--bold edge-c-main">
                      {row.total_ms !== null ? `${row.total_ms} ms` : '—'}
                    </td>
                    <td className="edge-td edge-center">
                      <span className={`edge-badge${isHealthy ? '' : ' edge-badge--critical'}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SSL/TLS Certificate Expiry Radar */}
      <div className="glass-card edge-card">
        <div className="edge-card-head edge-card-head--lg">
          <div>
            <div className="edge-card-title edge-card-title--lg">TLS Certificate Health &amp; Expiry Radar</div>
            <div className="edge-card-sub">Probed certificate parameters and days until expiration</div>
          </div>
        </div>
        <div className="edge-table-wrap">
          <table className="edge-table">
            <thead>
              <tr>
                <th className="edge-th">Target VIP</th>
                <th className="edge-th">Product</th>
                <th className="edge-th">Subject / Common Name</th>
                <th className="edge-th">Issuer</th>
                <th className="edge-th">Protocol &amp; Cipher</th>
                <th className="edge-th edge-right">Days Left</th>
                <th className="edge-th edge-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {certExpiries.length === 0 && (
                <tr>
                  <td colSpan={7} className="edge-td--empty">No TLS certificates discovered</td>
                </tr>
              )}
              {certExpiries.map((cert, idx) => {
                let tone = 'healthy';

                const normSev = normalizeSeverity(cert.status);
                if (normSev === SEVERITY.CRITICAL) {
                  tone = 'critical';
                } else if (normSev === SEVERITY.WARNING || cert.status === 'EXPIRING_SOON') {
                  tone = 'warning';
                }

                return (
                  <tr key={idx} className="edge-tr">
                    <td className="edge-td edge-c-main"><code>{cert.url}</code></td>
                    <td className="edge-td edge-c-muted">{cert.productId}</td>
                    <td className="edge-td edge-c-main">{cert.subject || '—'}</td>
                    <td className="edge-td edge-c-muted">{cert.issuer || '—'}</td>
                    <td className="edge-td edge-c-subtle">
                      {cert.protocol ? `${cert.protocol} / ${cert.cipher || 'Default'}` : '—'}
                    </td>
                    <td className={`edge-td edge-right edge-td--bold edge-c-${tone}`}>
                      {cert.days_left !== null ? `${cert.days_left}d` : '—'}
                    </td>
                    <td className="edge-td edge-center">
                      <span className={`edge-badge edge-badge--${tone}`}>
                        {cert.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
