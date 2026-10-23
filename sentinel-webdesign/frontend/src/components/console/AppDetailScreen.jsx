/**
 * Console: per-application detail screen (metrics, hosts, endpoints, alerts, certificates).
 */
import React, { useEffect, useState } from 'react';
import { ConsoleHeader, Kpis, Panel, StatePill, DataTable, Trend } from './ConsolePrimitives';

/*
 * One screen for every monitored application. Facts come from the manifest
 * (endpoints, declared hosts); everything else is what was received for that
 * application. Sections with nothing behind them say so.
 */
const pct = (v) => (typeof v === 'number' ? `${Math.round(v)}%` : '—');

// Application detail screen; also loads the application's hosts from /api/v2/infra/hosts.
export default function AppDetailScreen({ demoData, environment, onBack }) {
  const d = demoData;
  const [hosts, setHosts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setHosts(null);
    fetch(`/api/v2/infra/hosts?environment=${encodeURIComponent(environment || '')}`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { hosts: [] }))
      .then(b => { if (!cancelled) setHosts(Array.isArray(b.hosts) ? b.hosts : []); })
      .catch(() => { if (!cancelled) setHosts([]); });
    return () => { cancelled = true; };
  }, [d.app.id, environment]);

  const reporting = new Map((hosts || []).filter(h => h.product === d.app.id).map(h => [h.host, h]));
  const names = [...new Set([...(d.declared_hosts || []), ...reporting.keys()])];
  const hostRows = names.map(name => {
    const h = reporting.get(name);
    return { name, declared: (d.declared_hosts || []).includes(name), reporting: !!(h && h.agent_state && h.agent_state.has_agent), cpu: h ? h.cpu_latest : null, memory: h ? h.memory_latest : null, disk: h ? h.worst_filesystem_pct : null };
  });

  return (
    <div className="con">
      <ConsoleHeader title={d.app.name} subtitle={[d.app.category, d.app.tier].filter(Boolean).join(' · ') || undefined}>
        {onBack && <button type="button" className="demo-tab" onClick={onBack}>Back to overview</button>}
      </ConsoleHeader>
      <Kpis items={d.kpis} />
      <Panel title="Metrics received" hint="Latest value and recent trend per metric">
        <DataTable
          columns={[
            { key: 'name', title: 'Metric', mono: true },
            { key: 'latest', title: 'Latest', align: 'right' },
            { key: 'trend', title: 'Trend', render: m => <Trend values={m.series} tone="ok" label={`${m.name} trend`} /> },
            { key: 'points', title: 'Points', align: 'right' },
            { key: 'last_seen', title: 'Last seen', render: m => new Date(m.last_seen).toLocaleString() }
          ]}
          rows={d.metrics}
          empty="Data not available: no numbers have been received for this application."
        />
      </Panel>
      <div className="con-grid-2">
        <Panel title="Hosts" hint="Declared in the manifest, joined with what the agents report">
          <DataTable
            columns={[
              { key: 'name', title: 'Host', mono: true },
              { key: 'reporting', title: 'Agent', render: h => <StatePill state={h.reporting ? 'ok' : null} label={h.reporting ? 'Reporting' : 'Not reporting'} /> },
              { key: 'cpu', title: 'CPU', align: 'right', render: h => pct(h.cpu) },
              { key: 'memory', title: 'Memory', align: 'right', render: h => pct(h.memory) },
              { key: 'disk', title: 'Worst disk', align: 'right', render: h => pct(h.disk) }
            ]}
            rows={hostRows}
            empty={hosts === null ? 'Loading…' : 'No hosts are declared for this application.'}
          />
        </Panel>
        <Panel title="Endpoints" hint={`Declared for ${environment === 'prod' ? 'production' : 'staging'}`}>
          <DataTable
            columns={[{ key: 'name', title: 'Name' }, { key: 'url', title: 'URL', mono: true }]}
            rows={d.endpoints}
            empty="No endpoints are declared for this environment."
          />
        </Panel>
      </div>
      <div className="con-grid-2">
        <Panel title="Open alerts">
          <DataTable
            columns={[{ key: 'sev', title: 'Severity' }, { key: 'state', title: 'State', render: a => <StatePill state={a.state} /> }, { key: 'signal', title: 'Signal' }, { key: 'age', title: 'Age' }]}
            rows={d.alerts}
            empty="No open alerts."
          />
        </Panel>
        <Panel title="Certificates and licences">
          <DataTable
            columns={[{ key: 'name', title: 'Item' }, { key: 'kind', title: 'Type' }, { key: 'days_left', title: 'Days left', align: 'right' }, { key: 'not_after', title: 'Expires', render: c => (c.not_after ? c.not_after.slice(0, 10) : '—') }]}
            rows={d.certificates}
            empty="Nothing has been checked for this application yet."
          />
        </Panel>
      </div>
    </div>
  );
}
