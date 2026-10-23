/**
 * Console: platform overview (KPIs, application groups and their state, open alerts).
 */
import React from 'react';
import { ConsoleHeader, Kpis, Panel, StatePill, Trend, LineChart, Columns, ChartLegend, DataTable, ConsoleEmpty, toneOf } from './ConsolePrimitives';

// Hour number as HH:00.
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

// Overview screen; clicking an application drills into its detail.
export default function OverviewScreen({ demoData, environment, onDrill, live }) {
  if (!demoData) return <ConsoleEmpty environment={environment} name="Platform overview" />;
  const d = demoData;
  const ch = d.chart || {};
  const hours = Array.isArray(ch.hours) ? ch.hours : [];
  const marker = ch.change_event ? [{ index: hours.indexOf(ch.change_event.hour), label: ch.change_event.label }].filter(m => m.index >= 0) : [];
  return (
    <div className="con">
      <ConsoleHeader title="Platform overview" subtitle={(d.regions || []).length > 1 ? `${d.app_count} applications across ${d.regions.length - 1} regions` : `${d.app_count} applications`} />
      {!live && <div className="con-note">Sample data. Region filter chips are display-only in this demo.</div>}
      <Kpis items={d.kpis} />
      {(d.chain || []).length > 0 && <Panel title="Delivery path" hint="Commit to production: latest p95 per hop">
        <div className="con-chain">
          {(d.chain || []).map(s => (
            <div key={s.name} className="con-chain__step" data-state={toneOf(s.state)}>
              <div className="con-chain__name">{s.name}</div>
              <div className="con-chain__sub">{s.sub}</div>
              <div className="con-chain__p95">p95 {s.p95} · <StatePill state={s.state} /></div>
            </div>
          ))}
        </div>
      </Panel>}
      {(d.groups || []).map(g => (
        <Panel key={g.title} title={g.title} right={<StatePill state={g.state} />}>
          <div className="con-tiles">
            {(g.apps || []).map(a => {
              const inner = (
                <>
                  <div className="con-tile__top"><span className="con-tile__name">{a.name}</span><StatePill state={a.state} /></div>
                  <div className="con-tile__scope">{a.scope}</div>
                  <div className="con-tile__metric">{a.metric.value} <span className="con-tile__scope">{a.metric.label}</span></div>
                  <div className="con-tile__kv"><span>{a.k1.label}</span><span>{a.k1.value}</span></div>
                  <div className="con-tile__kv"><span>{a.k2.label}</span><span>{a.k2.value}</span></div>
                  <Trend values={a.trend} tone={a.state} label={`${a.name} trend`} />
                  {a.drill && onDrill && <span className="con-link">View detail</span>}
                </>
              );
              return a.drill && onDrill
                ? <button type="button" key={a.id} className="con-tile" data-state={toneOf(a.state)} onClick={() => onDrill(a.drill)}>{inner}</button>
                : <div key={a.id} className="con-tile" data-state={toneOf(a.state)}>{inner}</div>;
            })}
          </div>
        </Panel>
      ))}
      {d.chart && <div className="con-grid-2">
        <Panel title="Builds per hour" hint="Last 24 h">
          <Columns values={ch.builds} labels={hours.map(hh)} markers={marker} ariaLabel="Builds per hour" />
        </Panel>
        <Panel title="Queue wait p95 (minutes)" hint="Last 24 h">
          <LineChart series={[{ name: 'Queue wait p95', values: ch.queue_wait_min }]} xLabels={[hh(hours[0] ?? 0), hh(hours[12] ?? 12), hh(hours[hours.length - 1] ?? 23)]} threshold={{ value: 5, label: 'target 5m' }} markers={marker} yUnit="m" ariaLabel="Queue wait p95" />
        </Panel>
      </div>}
      {(d.region_health || []).length > 0 && <Panel title="Region health">
        <div className="con-grid-3">
          {(d.region_health || []).map(r => (
            <div key={r.name}>
              <div className="con-group__title"><strong>{r.name}</strong><span className="con-muted">{r.role}</span><StatePill state={r.state} /></div>
              <DataTable columns={[{ key: 'k', title: 'Component' }, { key: 'v', title: 'Status' }, { key: 's', title: 'State', render: x => <StatePill state={x.state} /> }]} rows={r.rows} />
            </div>
          ))}
        </div>
      </Panel>}
      <Panel title="Open alerts" hint={live ? 'Open alerts, most recent first' : 'Sample alerts, routed as the real routing would be'}>
        <DataTable
          columns={[
            { key: 'sev', title: 'Severity' },
            { key: 'state', title: 'State', render: a => <StatePill state={a.state} /> },
            { key: 'service', title: 'Service' },
            { key: 'signal', title: 'Signal' },
            { key: 'region', title: 'Region' },
            { key: 'age', title: 'Age' },
            { key: 'owner', title: 'Owner' },
            { key: 'route', title: 'Route' }
          ]}
          rows={d.alerts}
        />
      </Panel>
    </div>
  );
}
