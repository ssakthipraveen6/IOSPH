/**
 * Security view: vulnerability and scan findings per host and product.
 */
import React from 'react';
import usePrototypeData from '../shared/usePrototypeData';
import DataTable from '../shared/DataTable';
import StatTile from '../shared/StatTile';
import { DataUnavailableState, LoadingState } from '../shared/PrototypeNotice';
import '../shared/TelemetryView.css';

/**
 * Security view: CVE findings stored in ClickHouse `cve_findings` by the CVE
 * scan job, via GET /api/v2/security/summary. Shows per-host and per-product
 * counts (latest scan per host) and the newest critical/high findings.
 * Nothing is synthesised: no stored rows -> "Data not available".
 */
export default function SecurityView({ environment }) {
  const { state, data, reason } = usePrototypeData('/api/v2/security/summary', environment);

  if (state === 'loading') return <LoadingState label="Loading CVE scan findings…" />;
  if (state === 'unavailable') return <DataUnavailableState environment={environment} reason={reason} />;

  return <SecurityPanel data={data} environment={environment} />;
}

// CVSS-style severities from the scanner, mapped to badge classes.
const SEVERITY_BADGE = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'moderate', LOW: 'healthy' };

// Number, highlighted when above zero.
function Count({ value, tone }) {
  const cls = value > 0 && tone ? ` telemetry-view__num--${tone}` : '';
  return <span className={`telemetry-view__num${cls}`}>{value ?? '—'}</span>;
}

// Sum of a column.
function sum(rows, key) {
  return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
}

// Security panel (used by the live view and the demo).
export function SecurityPanel({ data: payload, environment }) {
  const data = payload || {};
  const hosts = Array.isArray(data.hosts) ? data.hosts : [];
  const products = Array.isArray(data.products) ? data.products : [];
  const findings = Array.isArray(data.findings) ? data.findings : [];

  if (hosts.length === 0 && products.length === 0) {
    return <DataUnavailableState environment={environment} reason={data.reason || 'No CVE scan findings are stored for this environment.'} />;
  }

  const hostColumns = [
    { key: 'host', header: 'Host', sortable: true, render: (v) => <code className="telemetry-view__mono">{v}</code> },
    { key: 'product_id', header: 'Product', sortable: true },
    { key: 'critical', header: 'Critical', sortable: true, render: (v) => <Count value={v} tone="critical" /> },
    { key: 'high', header: 'High', sortable: true, render: (v) => <Count value={v} tone="warning" /> },
    { key: 'medium', header: 'Medium', sortable: true, render: (v) => <Count value={v} /> },
    { key: 'low', header: 'Low', sortable: true, render: (v) => <Count value={v} /> },
    { key: 'eol_components', header: 'EOL Components', sortable: true, render: (v) => <Count value={v} tone="warning" /> },
    {
      key: 'last_scan',
      header: 'Last Scan',
      sortable: true,
      render: (v) => <span className="telemetry-view__muted">{v ? new Date(v).toLocaleString() : '—'}</span>
    }
  ];

  const productColumns = [
    { key: 'product_id', header: 'Product', sortable: true },
    { key: 'hosts', header: 'Hosts', sortable: true, render: (v) => <Count value={v} /> },
    { key: 'critical', header: 'Critical', sortable: true, render: (v) => <Count value={v} tone="critical" /> },
    { key: 'high', header: 'High', sortable: true, render: (v) => <Count value={v} tone="warning" /> },
    { key: 'eol_components', header: 'EOL Components', sortable: true, render: (v) => <Count value={v} tone="warning" /> }
  ];

  const findingColumns = [
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (v) => <span className={`status-badge-inline ${SEVERITY_BADGE[v] || 'status-unknown'}`}>{v}</span>
    },
    { key: 'cve_id', header: 'CVE', sortable: true, render: (v) => <code className="telemetry-view__mono">{v}</code> },
    { key: 'cvss_score', header: 'CVSS', sortable: true, render: (v) => <span className="telemetry-view__num">{v ?? '—'}</span> },
    { key: 'host', header: 'Host', sortable: true },
    {
      key: 'package_name',
      header: 'Package',
      sortable: true,
      render: (v, row) => <span className="telemetry-view__mono">{v}@{row.version}{row.is_eol ? ' (EOL)' : ''}</span>
    },
    { key: 'remediation', header: 'Remediation', render: (v) => <span className="telemetry-view__muted">{v || '—'}</span> }
  ];

  return (
    <div className="telemetry-view">
      <div className="telemetry-view__tiles">
        <StatTile label="Hosts Scanned" value={new Set(hosts.map(h => h.host)).size} subtext={`Latest scan per host, last ${data.days || 7} days`} />
        <StatTile label="Critical" value={sum(hosts, 'critical')} severity={sum(hosts, 'critical') > 0 ? 'critical' : null} />
        <StatTile label="High" value={sum(hosts, 'high')} severity={sum(hosts, 'high') > 0 ? 'warning' : null} />
        <StatTile label="EOL Components" value={sum(hosts, 'eol_components')} />
      </div>

      <section className="telemetry-view__section">
        <h3 className="telemetry-view__heading">By Product</h3>
        <DataTable columns={productColumns} data={products} rowKey="product_id" emptyMessage="No products reported" />
      </section>

      <section className="telemetry-view__section">
        <h3 className="telemetry-view__heading">By Host</h3>
        <DataTable columns={hostColumns} data={hosts} rowKey={(r) => `${r.host}|${r.product_id}`} emptyMessage="No hosts reported" />
      </section>

      <section className="telemetry-view__section">
        <div>
          <h3 className="telemetry-view__heading">Latest Critical &amp; High Findings</h3>
          {data.truncated && <div className="telemetry-view__subheading">Result set truncated; counts cover the first rows returned.</div>}
        </div>
        <DataTable
          columns={findingColumns}
          data={findings}
          rowKey={(r) => `${r.host}|${r.package_name}|${r.version}|${r.cve_id}`}
          emptyMessage="No critical or high findings in the latest scans"
        />
      </section>
    </div>
  );
}
