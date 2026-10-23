/**
 * Console: dependencies and probes screen (probe results by region, WAN chart).
 */
import React from 'react';
import { ConsoleHeader, Kpis, Panel, StatePill, DataTable, LineChart, ChartLegend, ConsoleEmpty } from './ConsolePrimitives';

const LABEL = { p: 'pass', s: 'slow', f: 'fail' };

// Shows the last runs of a probe as coloured characters.
function History({ text }) {
  if (!text) return <span className="con-muted">not run</span>;
  return (
    <span className="con-prob" aria-label={`last ${text.length} runs: ${[...text].map(c => LABEL[c] || c).join(', ')}`}>
      {[...text].map((c, i) => <span key={i} className={`con-prob__${c}`}>{c === 'p' ? '●' : c === 's' ? '◐' : '✕'}</span>)}
    </span>
  );
}

// Dependencies screen.
export default function DependenciesScreen({ demoData, environment }) {
  if (!demoData) return <ConsoleEmpty environment={environment} name="Dependencies and probes" />;
  const d = demoData;
  const w = d.wan_chart || {};
  const regions = d.regions || [];
  return (
    <div className="con">
      <ConsoleHeader title="Dependencies and synthetic probes" subtitle="What each tool needs to work, and whether a user could actually do the job" />
      {d.note && <div className="con-note">{d.note}</div>}
      <Kpis items={d.kpis} />
      <Panel title="Synthetic probes" hint="●  pass   ◐  slow (over budget)   ✕  fail · last 12 runs per region">
        <DataTable
          columns={[
            { key: 'name', title: 'Probe' },
            { key: 'how', title: 'Method' },
            { key: 'budget', title: 'Budget', align: 'right' },
            ...regions.map(r => ({
              key: r,
              title: r,
              render: p => {
                const x = (p.results || []).find(z => z.region === r);
                return x ? <span>{x.value} <History text={x.history} /></span> : <span className="con-muted">—</span>;
              }
            }))
          ]}
          rows={d.probes}
        />
      </Panel>
      <Panel title="Dependencies by application">
        <div className="con-grid-3">
          {(d.dependencies || []).map(a => (
            <div key={a.app}>
              <div className="con-group__title"><strong>{a.app}</strong><StatePill state={a.state} /></div>
              <DataTable columns={[{ key: 'name', title: 'Dependency' }, { key: 'value', title: 'Value' }, { key: 's', title: 'State', render: x => <StatePill state={x.state} /> }]} rows={a.items} />
            </div>
          ))}
        </div>
      </Panel>
      <div className="con-grid-2">
        <Panel title="Network paths">
          <DataTable
            columns={[
              { key: 'path', title: 'Path' },
              { key: 'rtt', title: 'RTT', align: 'right', render: n => <span className={n.rtt_hot ? 'con-hot' : undefined}>{n.rtt_ms} ms</span> },
              { key: 'loss', title: 'Loss', align: 'right', render: n => <span className={n.loss_hot ? 'con-hot' : undefined}>{n.loss_pct}%</span> },
              { key: 'throughput', title: 'Throughput' }
            ]}
            rows={d.network_paths}
          />
        </Panel>
        <Panel title="EMEA ↔ APAC WAN">
          <LineChart series={[{ name: 'Utilisation %', values: w.util_pct }]} yUnit="%" max={100} min={0} xLabels={['-24h', '-12h', 'now']} ariaLabel="WAN utilisation" />
          <LineChart series={[{ name: 'RTT ms', values: w.rtt_ms }]} yUnit="ms" threshold={{ value: w.baseline_rtt_ms, label: 'baseline' }} xLabels={['-24h', '-12h', 'now']} height={140} ariaLabel="WAN round-trip time" />
          <ChartLegend items={['Utilisation %', 'RTT ms']} />
        </Panel>
      </div>
    </div>
  );
}
