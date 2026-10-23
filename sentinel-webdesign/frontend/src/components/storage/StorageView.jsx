/**
 * Storage view: NAS/NFS shares with latency and status.
 */
import React, { useState } from 'react';
import usePrototypeData from '../shared/usePrototypeData';
import DataTable from '../shared/DataTable';
import StatTile from '../shared/StatTile';
import EmptyState from '../shared/EmptyState';
import { LoadingState } from '../shared/PrototypeNotice';
import '../shared/TelemetryView.css';
import './StorageView.css';

/**
 * Observe › Storage.
 *
 * Fetches /api/v2/storage/overview for the environment: one record per
 * host + NAS share from the sentinel-probe `nas.*` metrics (up, stat / list /
 * read / write latency, latest and p95 over the window) plus the storage-layer
 * steps of the golden journeys. A missing value is null and renders as a dash;
 * nothing is filled in locally.
 */

const WINDOWS = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 360, label: '6 hours' },
  { minutes: 1440, label: '24 hours' }
];

const OPS = ['stat', 'list', 'read', 'write'];

// Storage page with a time-range selector.
export default function StorageView({ environment }) {
  const [minutes, setMinutes] = useState(60);
  const { state, data, reason } = usePrototypeData(`/api/v2/storage/overview?minutes=${minutes}`, environment);

  return (
    <div className="telemetry-view storage-view">
      <div className="storage-view__header">
        <div>
          <h2 className="storage-view__title">Storage</h2>
          <div className="telemetry-view__subheading">
            NAS share probes from the SENTINEL agent and storage-layer journey steps.
          </div>
        </div>
        <label className="storage-view__window">
          <span className="telemetry-view__muted">Window</span>
          <select
            className="storage-view__select"
            value={minutes}
            onChange={e => setMinutes(Number(e.target.value))}
          >
            {WINDOWS.map(w => <option key={w.minutes} value={w.minutes}>{w.label}</option>)}
          </select>
        </label>
      </div>

      {state === 'loading' && <LoadingState label="Loading storage telemetry…" />}
      {state === 'unavailable' && (
        <EmptyState
          title="No storage telemetry"
          description="No NAS share probes (nas.*) or storage-layer journey steps are stored for this environment and window. Shares appear once a SENTINEL agent with shares configured pushes metrics."
          reason={reason}
          environment={environment}
        />
      )}
      {state === 'ready' && <StoragePanel data={data} />}
    </div>
  );
}

// Number or null.
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Milliseconds as ms or s.
function fmtMs(v) {
  if (v == null) return '—';
  if (v >= 1000) return `${Math.round(v / 10) / 100} s`;
  return `${Math.round(v * 10) / 10} ms`;
}

// Local date/time or a dash.
function fmtTime(v) {
  return v ? new Date(v).toLocaleString() : '—';
}

// Status pill for a share.
function StatusPill({ status }) {
  const s = String(status || 'UNKNOWN').toUpperCase();
  return <span className={`storage-view__pill storage-view__pill--${s.toLowerCase()}`}>{s}</span>;
}

// Table row for one share.
function shareRow(s) {
  const row = {
    id: s.id,
    share: s.share,
    host: s.host,
    products: Array.isArray(s.products) ? s.products : [],
    status: s.status || 'UNKNOWN',
    last_seen: s.last_seen || null
  };
  for (const op of OPS) {
    const l = (s.latency && s.latency[op]) || {};
    row[`${op}_latest`] = num(l.latest_ms);
    row[`${op}_p95`] = num(l.p95_ms);
  }
  return row;
}

// Column definition for an operation's latency.
function latencyColumn(op) {
  return {
    key: `${op}_p95`,
    header: `${op[0].toUpperCase()}${op.slice(1)} (latest / p95)`,
    sortable: true,
    render: (val, row) => (
      <span className="telemetry-view__num">
        {fmtMs(row[`${op}_latest`])}
        <span className="storage-view__p95"> / {fmtMs(val)}</span>
      </span>
    )
  };
}

// Highest value of a column.
function worst(rows, key) {
  const vals = rows.map(r => r[key]).filter(v => v != null);
  return vals.length ? Math.max(...vals) : null;
}

/** Presentational: renders a storage overview payload. */
export function StoragePanel({ data: payload }) {
  const data = payload || {};
  const shares = (Array.isArray(data.shares) ? data.shares : []).map(shareRow);
  const steps = Array.isArray(data.journey_steps) ? data.journey_steps : [];

  const up = shares.filter(s => s.status === 'UP').length;
  const down = shares.filter(s => s.status === 'DOWN').length;
  const failedSteps = steps.filter(s => s.status === 'FAILED').length;
  const worstWrite = worst(shares, 'write_p95');
  const worstRead = worst(shares, 'read_p95');

  const shareColumns = [
    {
      key: 'share',
      header: 'Share',
      sortable: true,
      render: (val, row) => (
        <div>
          <code className="telemetry-view__mono">{val}</code>
          <div className="telemetry-view__subheading">{row.host}</div>
        </div>
      )
    },
    {
      key: 'products',
      header: 'Product',
      render: (val) => (val.length
        ? <div className="storage-view__tags">{val.map(p => <span key={p} className="storage-view__tag">{p}</span>)}</div>
        : <span className="telemetry-view__muted">—</span>)
    },
    { key: 'status', header: 'Status', sortable: true, render: (val) => <StatusPill status={val} /> },
    ...OPS.map(latencyColumn),
    { key: 'last_seen', header: 'Last Seen', sortable: true, render: (val) => <span className="telemetry-view__muted">{fmtTime(val)}</span> }
  ];

  const stepColumns = [
    {
      key: 'step',
      header: 'Step',
      sortable: true,
      render: (val, row) => (
        <div>
          <span>{row.step_name || val}</span>
          <div className="telemetry-view__subheading">{row.journey_name || row.journey}</div>
        </div>
      )
    },
    { key: 'product', header: 'Product', sortable: true, render: (val) => <code className="telemetry-view__mono">{val || '—'}</code> },
    { key: 'status', header: 'Last Run', sortable: true, render: (val) => <StatusPill status={val} /> },
    {
      key: 'success_rate',
      header: 'Success',
      sortable: true,
      render: (val, row) => (
        <span className="telemetry-view__num">
          {val == null ? '—' : `${val}%`}
          {row.runs ? <span className="storage-view__p95"> ({row.runs} runs)</span> : null}
        </span>
      )
    },
    {
      key: 'duration_p95_ms',
      header: 'Duration (latest / p95)',
      sortable: true,
      render: (val, row) => (
        <span className="telemetry-view__num">
          {fmtMs(num(row.duration_ms))}
          <span className="storage-view__p95"> / {fmtMs(num(val))}</span>
        </span>
      )
    },
    { key: 'last_seen', header: 'Last Seen', sortable: true, render: (val) => <span className="telemetry-view__muted">{fmtTime(val)}</span> }
  ];

  return (
    <>
      <div className="telemetry-view__tiles">
        <StatTile
          label="Shares"
          value={shares.length}
          subtext={shares.length ? `${up} up · ${down} down` : 'No NAS probes reported'}
          severity={down > 0 ? 'critical' : (shares.length ? 'healthy' : null)}
        />
        <StatTile label="Worst Read p95" value={worstRead == null ? null : fmtMs(worstRead)} subtext="Across shares" />
        <StatTile label="Worst Write p95" value={worstWrite == null ? null : fmtMs(worstWrite)} subtext="Across shares" />
        <StatTile
          label="Storage Journey Steps"
          value={steps.length}
          subtext={steps.length ? `${failedSteps} failing on last run` : 'None reported'}
          severity={failedSteps > 0 ? 'critical' : (steps.length ? 'healthy' : null)}
        />
      </div>

      <section className="telemetry-view__section">
        <div>
          <h3 className="telemetry-view__heading">NAS Shares</h3>
          <div className="telemetry-view__subheading">
            Agent probe latency per share{data.window_minutes ? ` over the last ${data.window_minutes} min` : ''}.
            A dash means no point was stored for that operation.
          </div>
        </div>
        {shares.length
          ? <DataTable columns={shareColumns} data={shares} rowKey="id" emptyMessage="No shares reported" />
          : <EmptyState title="No NAS share probes" description="No nas.* metrics are stored for this window. Configure shares for an agent host to start probing." />}
      </section>

      <section className="telemetry-view__section">
        <div>
          <h3 className="telemetry-view__heading">Storage-Layer Journey Steps</h3>
          <div className="telemetry-view__subheading">
            Golden-journey steps tagged <code className="telemetry-view__mono">layer: storage</code> in the product manifests.
          </div>
        </div>
        {steps.length
          ? <DataTable columns={stepColumns} data={steps} rowKey="id" emptyMessage="No storage steps reported" />
          : <EmptyState title="No storage journey steps" description="No journey step with layer: storage ran in this window." />}
      </section>
    </>
  );
}
