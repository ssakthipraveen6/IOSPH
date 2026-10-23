/**
 * Console: CloudBees Jenkins screen (controllers, executors, queue, agents) filtered by operations
 * centre.
 */
import React, { useState } from 'react';
import { ConsoleHeader, Kpis, Panel, StatePill, Meter, DataTable, CellGrid, CellLegend, ConsoleEmpty } from './ConsolePrimitives';

// Percentage of a over b, or null when b is 0.
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
// Seconds as 'Xm YYs'.
const mins = (s) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;

// Jenkins screen.
export default function JenkinsScreen({ demoData, environment }) {
  const [oc, setOc] = useState('All');
  if (!demoData) return <ConsoleEmpty environment={environment} name="CloudBees Jenkins" />;
  const d = demoData;
  const ocs = Array.isArray(d.operations_centers) ? d.operations_centers : [];
  const shown = oc === 'All' ? ocs : ocs.filter(o => o.id === oc);
  const controllers = shown.flatMap(o => o.controllers);
  return (
    <div className="con">
      <ConsoleHeader title="CloudBees Jenkins" subtitle={`${ocs.length} operations centres · ${ocs.reduce((n, o) => n + o.controllers.length, 0)} controllers`}>
        <label className="con-muted">Operations centre{' '}
          <select value={oc} onChange={e => setOc(e.target.value)} aria-label="Operations centre filter">
            <option>All</option>
            {ocs.map(o => <option key={o.id}>{o.id}</option>)}
          </select>
        </label>
      </ConsoleHeader>
      {d.note && <div className="con-note">{d.note}</div>}
      <Kpis items={d.kpis} />
      <Panel title="Controllers" hint="Executors, queue, JVM heap and build success per controller">
        <DataTable
          columns={[
            { key: 'id', title: 'Controller', mono: true },
            { key: 'oc', title: 'OC' },
            { key: 'env', title: 'Env' },
            { key: 'state', title: 'State', render: c => <StatePill state={c.state} /> },
            { key: 'ex', title: 'Executors', render: c => !c.executors.total ? '—' : <Meter pct={pct(c.executors.busy, c.executors.total)} state={c.executors.busy >= c.executors.total ? 'crit' : c.executors.busy / c.executors.total > 0.85 ? 'warn' : 'ok'} label={`${c.executors.busy} / ${c.executors.total}`} /> },
            { key: 'queue', title: 'Queue', align: 'right', render: c => (c.queue === null || c.queue === undefined ? '—' : c.queue) },
            { key: 'heap', title: 'Heap', render: c => <Meter pct={c.heap_pct} state={c.heap_pct >= 90 ? 'crit' : c.heap_pct >= 80 ? 'warn' : 'ok'} /> },
            { key: 'success_pct', title: 'Success %', align: 'right', render: c => (c.success_pct === null || c.success_pct === undefined ? '—' : c.success_pct) }
          ]}
          rows={controllers}
        />
      </Panel>
      <Panel title="Build clusters (Kubernetes)">
        <DataTable
          columns={[
            { key: 'id', title: 'Cluster', mono: true },
            { key: 'purpose', title: 'Purpose' },
            { key: 'region', title: 'Region' },
            { key: 'state', title: 'State', render: c => <StatePill state={c.state} /> },
            { key: 'pods', title: 'Pods', render: c => <Meter pct={pct(c.running, c.capacity)} label={`${c.running} / ${c.capacity}`} state={c.running / c.capacity > 0.9 ? 'crit' : c.running / c.capacity > 0.75 ? 'warn' : 'ok'} /> },
            { key: 'pending', title: 'Pending', align: 'right' },
            { key: 'pod_start_p95_s', title: 'Pod start p95 (s)', align: 'right' },
            { key: 'image_pull_p95_s', title: 'Image pull p95 (s)', align: 'right' },
            { key: 'node_cpu_pct', title: 'Node CPU %', align: 'right' }
          ]}
          rows={d.build_clusters}
          empty="Data not available: no Kubernetes build-cluster source is reporting."
        />
      </Panel>
      {Array.isArray(d.agents) && d.agents.length > 0 && (
        <Panel title="Static agents" hint="One group per operations centre, from each controller's computer list">
          {d.agents.filter(g => oc === 'All' || g.oc === oc).map(g => (
            <div key={g.oc}><strong>{g.oc}</strong> <span className="con-muted">{g.cells.filter(c => c.state !== 'offline').length} / {g.cells.length} online</span><CellGrid cells={g.cells} columns={Math.max(1, Math.min(25, g.cells.length))} /></div>
          ))}
          <CellLegend items={['busy', 'idle', 'offline', 'maintenance']} />
        </Panel>
      )}
      {!d.agents && <div className="con-grid-2">
        <Panel title="Ubuntu static agents" hint="One group per operations centre">
          {(d.ubuntu_agents || []).filter(g => oc === 'All' || g.oc === oc).map(g => (
            <div key={g.oc}><strong>{g.oc}</strong><CellGrid cells={g.cells} columns={Math.max(1, Math.min(12, g.cells.length))} /></div>
          ))}
          <CellLegend items={['busy', 'idle', 'offline', 'maintenance']} />
        </Panel>
        <Panel title="Windows static agents" hint="Pool grouping is assumed; see note above">
          {(d.windows_pools || []).map(p => (
            <div key={p.id}><strong>{p.id}</strong> <span className="con-muted">{p.online} / {p.total} online</span><CellGrid cells={p.cells} columns={25} /></div>
          ))}
          <CellLegend items={['busy', 'idle', 'offline', 'maintenance']} />
        </Panel>
      </div>}
      <div className="con-grid-2">
        <Panel title="Jump servers">
          <DataTable
            columns={[
              { key: 'id', title: 'Host', mono: true },
              { key: 'state', title: 'State', render: j => <StatePill state={j.state} /> },
              { key: 'ssh_sessions', title: 'SSH sessions', align: 'right' },
              { key: 'k8s', title: 'K8s API reachable', render: j => `${j.k8s_api_reachable} / ${j.k8s_api_total}` },
              { key: 'cpu', title: 'CPU', render: j => <Meter pct={j.cpu_pct} /> },
              { key: 'mem', title: 'Memory', render: j => <Meter pct={j.mem_pct} /> }
            ]}
            rows={d.jump_servers}
            empty="Data not available: no jump-server source is reporting."
          />
        </Panel>
        <Panel title="Longest-waiting queue items">
          <DataTable
            columns={[
              { key: 'job', title: 'Job', mono: true },
              { key: 'controller', title: 'Controller', mono: true },
              { key: 'wait', title: 'Waiting', render: q => <span className={q.hot ? 'con-hot' : undefined}>{mins(q.wait_s)}</span> },
              { key: 'label', title: 'Label', mono: true },
              { key: 'reason', title: 'Reason' }
            ]}
            rows={d.queue}
            empty="Queue is empty, or no controller has answered."
          />
        </Panel>
      </div>
    </div>
  );
}
