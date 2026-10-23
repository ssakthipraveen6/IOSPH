/**
 * Console: compliance and lifecycle screen (certificate/licence expiry, licence usage).
 */
import React from 'react';
import { ConsoleHeader, Kpis, Panel, StatePill, Meter, DataTable, ConsoleEmpty } from './ConsolePrimitives';

// Formats an hours value, or says 'not measured' when missing.
const measured = (v) => (v === null || v === undefined ? 'not measured' : `${v} h`);

// Compliance screen; shows an empty state when no data is available.
export default function ComplianceScreen({ demoData, environment }) {
  if (!demoData) return <ConsoleEmpty environment={environment} name="Compliance and lifecycle" />;
  const d = demoData;
  return (
    <div className="con">
      <ConsoleHeader title="Compliance and lifecycle" subtitle="Expiries, licences, versions, configuration drift and disaster recovery" />
      {d.note && <div className="con-note">{d.note}</div>}
      <Kpis items={d.kpis} />
      <Panel title="Upcoming expiries" hint="Soonest first">
        <DataTable
          columns={[
            { key: 'item', title: 'Item' },
            { key: 'type', title: 'Type' },
            { key: 'app', title: 'Application' },
            { key: 'date', title: 'Expires' },
            { key: 'days_left', title: 'Days left', align: 'right' },
            { key: 'owner', title: 'Owner' },
            { key: 'ticket', title: 'Ticket' }
          ]}
          rows={d.expiry}
          empty="Nothing has been checked yet."
        />
      </Panel>
      <div className="con-grid-2">
        <Panel title="Licence usage">
          <DataTable
            columns={[
              { key: 'name', title: 'Product' },
              { key: 'unit', title: 'Unit' },
              { key: 'use', title: 'Used / cap', align: 'right', render: l => `${l.used} / ${l.cap}` },
              { key: 'pct', title: 'Usage', render: l => <Meter pct={l.pct} /> }
            ]}
            rows={d.licences}
            empty="No licence with a seat count is tracked."
          />
        </Panel>
        <Panel title="Controller configuration drift">
          <DataTable
            columns={[
              { key: 'controller', title: 'Controller', mono: true },
              { key: 'core', title: 'Core' },
              { key: 'plugin_diffs', title: 'Plugin diffs', align: 'right' },
              { key: 'casc', title: 'Config as code' }
            ]}
            rows={d.controller_drift}
          />
        </Panel>
      </div>
      <Panel title="Versions and support">
        <DataTable
          columns={[
            { key: 'app', title: 'Application' },
            { key: 'running', title: 'Running' },
            { key: 'vendor_support', title: 'Vendor support' },
            { key: 'cves', title: 'Tool CVEs (crit / high)', render: v => `${v.tool_cves.critical} / ${v.tool_cves.high}` },
            { key: 'os_baseline', title: 'OS baseline' },
            { key: 'next_window', title: 'Next window', render: v => v.next_window || 'Not scheduled' }
          ]}
          rows={d.versions}
        />
      </Panel>
      <Panel title="Disaster recovery readiness">
        <DataTable
          columns={[
            { key: 'app', title: 'Application' },
            { key: 'data', title: 'Data' },
            { key: 'backup', title: 'Last backup', render: x => <><StatePill state={x.backup_ok ? 'ok' : 'crit'} label={x.backup_ok ? 'OK' : 'Failed'} /> {x.backup_at}</> },
            { key: 'restore', title: 'Restore test', render: x => `${x.last_restore_test_days_ago} d ago` },
            { key: 'rpo', title: 'RPO (target / measured)', render: x => `${x.rpo_target_h} h / ${measured(x.rpo_measured_h)}` },
            { key: 'rto', title: 'RTO (target / measured)', render: x => `${x.rto_target_h} h / ${measured(x.rto_measured_h)}` },
            { key: 'standby', title: 'Standby' }
          ]}
          rows={d.disaster_recovery}
        />
      </Panel>
    </div>
  );
}
