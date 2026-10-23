/**
 * Console: geo replication screen (replication lag and mirror sync per region).
 */
import React from 'react';
import { ConsoleHeader, Kpis, Panel, StatePill, Meter, DataTable, CellGrid, CellLegend, LineChart, ChartLegend, ConsoleEmpty } from './ConsolePrimitives';

// Value with unit, or a dash when missing.
const orDash = (v, unit = '') => (v === null || v === undefined ? '—' : `${v}${unit}`);

// Geo replication screen.
export default function GeoScreen({ demoData, environment }) {
  if (!demoData) return <ConsoleEmpty environment={environment} name="Geo replication" />;
  const d = demoData;
  const ls = d.lag_series || {};
  return (
    <div className="con">
      <ConsoleHeader title="Artifactory and Bitbucket across regions" subtitle="EMEA is primary; APAC and AMER mirror it" />
      {d.note && <div className="con-note">{d.note}</div>}
      <div className="con-grid-3">
        {(d.regions || []).map(r => (
          <Panel key={r.id} title={`${r.id} · ${r.role}`} right={<StatePill state={r.state} />}>
            <h4 className="con-group__title">Artifactory <span className="con-muted">{r.artifactory.up} up</span></h4>
            <DataTable
              columns={[
                { key: 'id', title: 'Node', mono: true },
                { key: 'state', title: 'State', render: n => <StatePill state={n.state} /> },
                { key: 'cpu', title: 'CPU', render: n => <Meter pct={n.cpu_pct} /> },
                { key: 'heap', title: 'Heap', render: n => <Meter pct={n.heap_pct} /> },
                { key: 'p95', title: 'p95', align: 'right', render: n => orDash(n.p95_ms, ' ms') }
              ]}
              rows={[...r.artifactory.app, ...r.artifactory.xray]}
            />
            <div className="con-tile__kv"><span>Xray queue</span><span>{r.artifactory.xray_queue}</span></div>
            <div className="con-tile__kv"><span>Filestore used</span><span>{r.artifactory.storage_pct}%</span></div>
            <div className="con-tile__kv"><span>Cache hit</span><span>{orDash(r.artifactory.cache_hit_pct, '%')}</span></div>
            <h4 className="con-group__title">{r.bitbucket.title} <span className="con-muted">{r.bitbucket.up} up</span></h4>
            <CellGrid cells={r.bitbucket.nodes.map(n => ({ name: n.id, state: n.state, note: n.note }))} columns={8} />
            <CellLegend items={['ok', 'warn', 'crit']} />
            <div className="con-tile__kv"><span>Clone p95</span><span>{r.bitbucket.clone_p95_s}s</span></div>
            <div className="con-tile__kv"><span>Operations / min</span><span>{r.bitbucket.ops_per_min}</span></div>
            <div className="con-tile__kv"><span>{r.bitbucket.third.label}</span><span>{r.bitbucket.third.value}</span></div>
          </Panel>
        ))}
      </div>
      <Panel title="Replication links">
        <DataTable
          columns={[
            { key: 'route', title: 'Link', render: l => `${l.from} → ${l.to}` },
            { key: 'artifactory_lag', title: 'Artifactory lag' },
            { key: 'bitbucket_lag', title: 'Bitbucket lag' },
            { key: 'wan', title: 'WAN utilisation', render: l => <Meter pct={l.wan_util_pct} state={l.state} /> },
            { key: 'state', title: 'State', render: l => <StatePill state={l.state} /> }
          ]}
          rows={d.links}
        />
      </Panel>
      <Panel title="Artifactory replication lag (minutes)" hint={`Last 24 h · alert threshold ${d.lag_threshold_min} min`}>
        <LineChart series={[{ name: 'EMEA → APAC', values: ls.apac }, { name: 'EMEA → AMER', values: ls.amer }]} threshold={{ value: d.lag_threshold_min, label: `${d.lag_threshold_min} min` }} yUnit="m" xLabels={['-24h', '-12h', 'now']} ariaLabel="Replication lag" />
        <ChartLegend items={['EMEA → APAC', 'EMEA → AMER']} />
      </Panel>
      <Panel title="Repositories">
        <DataTable
          columns={[
            { key: 'name', title: 'Repository', mono: true },
            { key: 'platform', title: 'Platform' },
            { key: 'region', title: 'Region' },
            { key: 'req_per_min', title: 'Req / min', align: 'right' },
            { key: 'p95', title: 'p95', align: 'right' },
            { key: 'replication', title: 'Replication' },
            { key: 'state', title: 'State', render: x => <StatePill state={x.state} /> }
          ]}
          rows={d.repos}
        />
      </Panel>
    </div>
  );
}
