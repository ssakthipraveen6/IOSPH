/**
 * Databases view: per-database health, connections and storage from the database receivers.
 */
import React, { useState } from 'react';
import usePrototypeData from '../shared/usePrototypeData';
import DataTable from '../shared/DataTable';
import StatTile from '../shared/StatTile';
import CapacityBar from '../shared/CapacityBar';
import { DataUnavailableState, LoadingState, PrototypeBanner } from '../shared/PrototypeNotice';
import '../shared/TelemetryView.css';
import './DatabaseView.css';

/**
 * Container: fetches /api/v2/databases/overview for the environment.
 * The live payload is one row per database from the PostgreSQL / Oracle /
 * SQL Server OpenTelemetry receivers plus O2.5 sqlquery metrics:
 * cache_hit_pct, space used/allocated/max, replication, idle_in_transaction, backup_age_hours.
 */
export default function DatabaseView({ environment, demoData = null }) {
  if (demoData) return <DatabasePanel data={demoData} environment={environment} />;
  return <LiveDatabaseView environment={environment} />;
}

// Loads live database data and renders the panel, or a loading/unavailable state.
function LiveDatabaseView({ environment }) {
  const { state, data: res, reason } = usePrototypeData('/api/v2/databases/overview', environment);

  if (state === 'loading') return <LoadingState label="Loading database receiver telemetry…" />;
  if (state === 'unavailable') return <DataUnavailableState environment={environment} reason={reason} />;

  return <DatabasePanel data={res} environment={environment} />;
}

const ENGINE_LABELS = { postgresql: 'PostgreSQL', oracle: 'Oracle', sqlserver: 'SQL Server' };

// Number or null.
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Rounds to 2 decimals.
function round(v) {
  return Math.round(v * 100) / 100;
}

// Bytes as B/KB/MB/GB/TB.
function formatBytes(v) {
  if (v == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let n = v;
  let i = 0;
  while (Math.abs(n) >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${round(n)} ${units[i]}`;
}

/** Format a receiver value using its OTel unit string. */
function formatUnit(v, unit) {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  if (unit === 'By') return formatBytes(v);
  if (unit === 's' || unit === 'ms') return `${round(v)} ${unit}`;
  if (unit && unit.endsWith('/s')) return `${round(v)}/s`;
  if (unit === '%') return `${round(v)}%`;
  if (unit === 'h') return `${round(v)}h`;
  return String(round(v));
}

/** Accept the live row shape and the older demo fixture shape. */
function normalizeRow(d, idx) {
  const sessions = num(d.sessions) ?? num(d.active_sessions);
  return {
    id: d.id || d.name || `db-${idx}`,
    name: d.database || d.name || d.host || d.id || '—',
    host: d.host || null,
    engine: ENGINE_LABELS[d.engine] || d.engine || '—',
    rawEngine: d.engine,
    sessions,
    max_sessions: num(d.max_sessions),
    locks: num(d.locks),
    waits: num(d.waits) ?? (d.top_wait_event || null),
    replication_lag: num(d.replication_lag) ?? num(d.replication_lag_ms),
    size_bytes: num(d.size_bytes),
    cache_hit_pct: num(d.cache_hit_pct),
    space_used_bytes: num(d.space_used_bytes),
    space_allocated_bytes: num(d.space_allocated_bytes),
    space_max_bytes: num(d.space_max_bytes),
    idle_in_transaction: num(d.idle_in_transaction),
    backup_age_hours: num(d.backup_age_hours),
    units: d.units || (d.replication_lag_ms != null ? { replication_lag: 'ms' } : {}),
    last_seen: d.last_seen || null
  };
}

// Sum of a numeric column, or null when no row has a value.
function sumOrNull(rows, key) {
  const vals = rows.map(r => r[key]).filter(v => typeof v === 'number');
  return vals.length ? round(vals.reduce((a, b) => a + b, 0)) : null;
}

/** Presentational: renders a database overview payload from props. */
export function DatabasePanel({ data: payload, environment }) {
  const [selectedDb, setSelectedDb] = useState(null);
  const data = payload || {};
  const rows = (Array.isArray(data.databases) ? data.databases : []).map(normalizeRow);

  if (rows.length === 0) {
    return (
      <DataUnavailableState
        environment={environment}
        reason={data.reason || 'No PostgreSQL, Oracle or SQL Server receiver metrics are stored for this environment.'}
      />
    );
  }

  if (selectedDb) {
    return (
      <DatabaseDetailView
        db={selectedDb}
        environment={environment}
        onBack={() => setSelectedDb(null)}
      />
    );
  }

  const columns = [
    {
      key: 'name',
      header: 'Database',
      sortable: true,
      render: (val, row) => (
        <button
          type="button"
          onClick={() => setSelectedDb(row)}
          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
        >
          <code className="telemetry-view__mono" style={{ textDecoration: 'underline' }}>{val}</code>
          {row.host && row.host !== val && <div className="telemetry-view__subheading">{row.host}</div>}
        </button>
      )
    },
    { key: 'engine', header: 'Engine', sortable: true },
    {
      key: 'sessions',
      header: 'Sessions',
      sortable: true,
      render: (val, row) => (
        <span className="telemetry-view__num">
          {val == null ? '—' : round(val)}{row.max_sessions != null ? ` / ${row.max_sessions}` : ''}
        </span>
      )
    },
    {
      key: 'cache_hit_pct',
      header: 'Cache Hit %',
      sortable: true,
      render: (val) => <span className="telemetry-view__num">{val != null ? `${val}%` : '—'}</span>
    },
    {
      key: 'locks',
      header: 'Locks',
      sortable: true,
      render: (val, row) => <span className="telemetry-view__num">{formatUnit(val, row.units.locks)}</span>
    },
    {
      key: 'idle_in_transaction',
      header: 'Idle Locks',
      sortable: true,
      render: (val) => <span className="telemetry-view__num">{val != null ? val : '—'}</span>
    },
    {
      key: 'replication_lag',
      header: 'Replication Lag',
      sortable: true,
      render: (val, row) => <span className="telemetry-view__num">{formatUnit(val, row.units.replication_lag)}</span>
    },
    {
      key: 'size_bytes',
      header: 'Size',
      sortable: true,
      render: (val, row) => <span className="telemetry-view__num">{formatBytes(val ?? row.space_used_bytes)}</span>
    },
    {
      key: 'backup_age_hours',
      header: 'Backup Age',
      sortable: true,
      render: (val) => <span className="telemetry-view__muted">{val != null ? `${val}h` : '—'}</span>
    },
    {
      key: 'last_seen',
      header: 'Last Seen',
      sortable: true,
      render: (val) => <span className="telemetry-view__muted">{val ? new Date(val).toLocaleTimeString() : '—'}</span>
    }
  ];

  const sessions = sumOrNull(rows, 'sessions');
  const sizeBytes = sumOrNull(rows, 'size_bytes');
  const engines = [...new Set(rows.map(r => r.engine))].join(', ');

  return (
    <div className="telemetry-view">
      {data.prototype && <PrototypeBanner environment={environment} />}

      <div className="telemetry-view__tiles">
        <StatTile label="Databases" value={rows.length} subtext={engines} />
        <StatTile label="Sessions" value={sessions} subtext="Latest receiver value, summed" />
        <StatTile label="Stored Size" value={sizeBytes == null ? null : formatBytes(sizeBytes)} subtext="Databases reporting size" />
      </div>

      <section className="telemetry-view__section">
        <div>
          <h3 className="telemetry-view__heading">Database Instances</h3>
          <div className="telemetry-view__subheading">
            Telemetry from OpenTelemetry receivers &amp; Phase O2.5 read-only sqlquery scrapers
            {data.window_minutes ? ` (last ${data.window_minutes} min)` : ''}. A dash means no value reported.
          </div>
        </div>
        <DataTable columns={columns} data={rows} rowKey="id" emptyMessage="No databases reported" />
      </section>
    </div>
  );
}

/** Detail view for an individual database instance. */
function DatabaseDetailView({ db, environment, onBack }) {
  return (
    <div className="telemetry-view" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-sm)' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Databases
        </button>
        <span style={{ color: 'var(--text-muted)' }}>/</span>
        <span style={{ color: 'var(--text-color)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{db.name}</span>
      </div>

      <div style={{ padding: 'var(--space-4)', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-xl)', color: 'var(--text-color)', fontFamily: 'var(--font-mono)' }}>{db.name}</h2>
        <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>
          <span>Engine: {db.engine}</span>
          <span>•</span>
          <span>Host: {db.host || '—'}</span>
          <span>•</span>
          <span>Environment: {environment}</span>
        </div>
      </div>

      <div className="telemetry-view__tiles">
        <StatTile label="Buffer Cache Hit" value={db.cache_hit_pct != null ? `${db.cache_hit_pct}%` : '—'} subtext="Cache hit ratio" />
        <StatTile label="Active Sessions" value={db.sessions ?? '—'} subtext={db.max_sessions ? `Max ${db.max_sessions}` : 'Current sessions'} />
        <StatTile label="Idle in Transaction" value={db.idle_in_transaction ?? '—'} subtext="Holding locks > 30m" />
        <StatTile label="Backup Age" value={db.backup_age_hours != null ? `${db.backup_age_hours}h` : '—'} subtext="Since last backup" />
      </div>

      <section className="telemetry-view__section">
        <h3 className="telemetry-view__heading">Storage &amp; Tablespace Capacity</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>Space Used</div>
            <div style={{ fontSize: 'var(--font-xl)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-color)' }}>
              {formatBytes(db.space_used_bytes ?? db.size_bytes)}
            </div>
            {db.space_allocated_bytes && (
              <CapacityBar
                used={db.space_used_bytes || 0}
                total={db.space_allocated_bytes}
                unit="bytes"
                label="Allocated Fill"
              />
            )}
          </div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>Allocated vs Max Autoextend</div>
            <div style={{ fontSize: 'var(--font-xl)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-color)' }}>
              {formatBytes(db.space_allocated_bytes)} / {formatBytes(db.space_max_bytes)}
            </div>
            {db.space_max_bytes && (
              <CapacityBar
                used={db.space_allocated_bytes || 0}
                total={db.space_max_bytes}
                unit="bytes"
                label="Autoextend Fill"
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
