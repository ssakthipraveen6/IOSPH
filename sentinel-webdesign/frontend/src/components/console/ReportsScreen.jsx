/**
 * Console: SLO and reports screen (availability, root causes, DORA).
 */
import React from 'react';
import { ConsoleHeader, Kpis, Panel, StatePill, Trend, Meter, DataTable, ConsoleEmpty } from './ConsolePrimitives';

const DAY_TEXT = { met: 'met', degraded: 'degraded', outage: 'outage', maintenance: 'maintenance' };

// Reports screen.
export default function ReportsScreen({ demoData, environment }) {
  if (!demoData) return <ConsoleEmpty environment={environment} name="SLO and reports" />;
  const d = demoData;
  const maxCount = Math.max(1, ...(d.root_causes || []).map(r => r.count));
  return (
    <div className="con">
      <ConsoleHeader title="SLOs and monthly report" subtitle="Availability, error budget, delivery performance and capacity outlook" />
      {d.note && <div className="con-note">{d.note}</div>}
      <Panel title="Summary"><p style={{ margin: 0 }}>{d.summary}</p></Panel>
      <Kpis items={d.kpis} />
      <Panel title="Service level objectives">
        <DataTable
          columns={[
            { key: 'app', title: 'Application' },
            { key: 'sli', title: 'Indicator' },
            { key: 'target', title: 'Target', align: 'right' },
            { key: 'actual', title: 'Actual', align: 'right' },
            { key: 'budget', title: 'Budget left', render: s => <Meter pct={s.budget_pct} state={s.state} /> },
            { key: 'burn', title: 'Burn rate', align: 'right', render: s => `${s.burn}×` },
            { key: 'status', title: 'Status', render: s => <StatePill state={s.state} label={s.status} /> }
          ]}
          rows={d.slos}
        />
      </Panel>
      <Panel title="30-day availability" hint="One square per day: met, degraded, outage or maintenance (hover for the day)">
        {(d.calendar || []).map(c => (
          <div key={c.app} className="con-cal">
            <span>{c.app}</span>
            <span className="con-cal__days">
              {c.days.map(x => <span key={x.day} className="con-day" data-day={x.state} title={`Day ${x.day}: ${DAY_TEXT[x.state] || x.state}`} />)}
            </span>
            <span className="con-num">{c.availability}</span>
          </div>
        ))}
      </Panel>
      <div className="con-grid-2">
        <Panel title="Delivery performance (DORA)">
          <DataTable
            columns={[
              { key: 'label', title: 'Measure' },
              { key: 'value', title: 'Value' },
              { key: 'band', title: 'Band' },
              { key: 'trend', title: '6-month trend', render: m => <Trend values={m.trend} label={`${m.label} trend`} /> },
              { key: 'note', title: 'Basis' }
            ]}
            rows={d.dora}
          />
        </Panel>
        <Panel title="Incident root causes">
          {(d.root_causes || []).map(r => (
            <div key={r.name} className="con-bar-row">
              <span>{r.name}</span>
              <span className="con-bar-row__track"><span className="con-bar-row__fill" style={{ width: `${(r.count / maxCount) * 100}%` }} /></span>
              <span className="con-num">{r.count}</span>
            </div>
          ))}
        </Panel>
      </div>
      <Panel title="Capacity outlook">
        <DataTable
          columns={[
            { key: 'name', title: 'Resource' },
            { key: 'now', title: 'Now', render: c => <Meter pct={c.now_pct} state={c.state} /> },
            { key: 'projected', title: 'Projected', render: c => <Meter pct={c.projected_pct} state={c.state} /> },
            { key: 'threshold_pct', title: 'Threshold', align: 'right', render: c => `${c.threshold_pct}%` },
            { key: 'when', title: 'When' },
            { key: 'state', title: 'State', render: c => <StatePill state={c.state} /> }
          ]}
          rows={d.capacity}
        />
      </Panel>
    </div>
  );
}
