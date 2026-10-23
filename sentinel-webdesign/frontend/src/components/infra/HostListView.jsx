/**
 * Host list (Linux or Windows) with filters and status.
 */
import React, { useState, useMemo } from 'react';
import usePrototypeData from '../shared/usePrototypeData';
import EmptyState from '../shared/EmptyState';
import StatusBadge from '../shared/StatusBadge';
import { LoadingState } from '../shared/PrototypeNotice';
import './HostListView.css';

/**
 * Observe › Infrastructure › Linux | Windows.
 *
 * Lists all discovered hosts running the specified OS with real telemetry
 * from /api/v2/infra/hosts?os=<os>. Zero fabricated metrics.
 */
export default function HostListView({
  os = 'linux',
  environment = 'staging',
  onSelectHost = null
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const endpoint = `/api/v2/infra/hosts?os=${encodeURIComponent(os)}`;
  const { state, data, reason } = usePrototypeData(endpoint, environment);

  const rawHosts = (data && Array.isArray(data.hosts)) ? data.hosts : [];

  const filteredHosts = useMemo(() => {
    if (!searchTerm.trim()) return rawHosts;
    const term = searchTerm.toLowerCase();
    return rawHosts.filter(h =>
      (h.host && h.host.toLowerCase().includes(term)) ||
      (h.product && h.product.toLowerCase().includes(term)) ||
      (h.status && h.status.toLowerCase().includes(term))
    );
  }, [rawHosts, searchTerm]);

  const kpis = useMemo(() => {
    const total = rawHosts.length;
    const healthy = rawHosts.filter(h => h.status === 'HEALTHY').length;
    const withAgent = rawHosts.filter(h => h.agent_state && h.agent_state.has_agent).length;
    const cpuVals = rawHosts.map(h => h.cpu_latest).filter(v => typeof v === 'number');
    const avgCpu = cpuVals.length > 0 ? (cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length).toFixed(1) : '—';
    return { total, healthy, withAgent, avgCpu };
  }, [rawHosts]);

  const title = os === 'windows' ? 'Windows Infrastructure' : 'Linux Infrastructure';
  const description = os === 'windows'
    ? 'Windows Server enterprise compute fleet, perf counters & IIS hosts.'
    : 'Linux Server compute fleet, kernel metrics & container host performance.';

  return (
    <div className="host-list-view">
      <div className="host-list-header">
        <div className="host-list-title-group">
          <h2 className="host-list-title">{title}</h2>
          <div className="host-list-subtitle">{description}</div>
        </div>
        <div className="host-list-controls">
          <input
            type="text"
            className="host-search-input"
            placeholder="Filter by host or product…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="host-list-kpis">
        <div className="host-kpi">
          <div className="host-kpi-label">Total Hosts</div>
          <div className="host-kpi-value">{kpis.total}</div>
        </div>
        <div className="host-kpi">
          <div className="host-kpi-label">Healthy</div>
          <div className="host-kpi-value">{kpis.healthy}</div>
        </div>
        <div className="host-kpi">
          <div className="host-kpi-label">Active Agents</div>
          <div className="host-kpi-value">{kpis.withAgent}</div>
        </div>
        <div className="host-kpi">
          <div className="host-kpi-label">Avg CPU %</div>
          <div className="host-kpi-value">{kpis.avgCpu}{kpis.avgCpu !== '—' ? '%' : ''}</div>
        </div>
      </div>

      {state === 'loading' && <LoadingState label={`Loading ${os} infrastructure…`} />}

      {state === 'unavailable' && (
        <EmptyState
          title={`No ${os} hosts reporting`}
          description={`No ${os} telemetry recorded for this environment. Telemetry populates as agents report metrics.`}
          reason={reason}
          environment={environment}
        />
      )}

      {state === 'ready' && filteredHosts.length === 0 && (
        <EmptyState
          title="No matching hosts"
          description={`No ${os} hosts match the search filter "${searchTerm}".`}
          environment={environment}
        />
      )}

      {state === 'ready' && filteredHosts.length > 0 && (
        <div className="host-table-card">
          <div className="host-table-container">
            <table className="host-table">
              <thead>
                <tr>
                  <th>Host</th>
                  <th>OS</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>CPU %</th>
                  <th>Memory %</th>
                  <th>Disk %</th>
                  <th>Worst FS %</th>
                  <th>Agent Version</th>
                  <th>Agent State</th>
                </tr>
              </thead>
              <tbody>
                {filteredHosts.map(h => {
                  const agent = h.agent_state || {};
                  const drift = agent.drift || 'unknown';
                  return (
                    <tr
                      key={h.entity_id || h.host}
                      className="host-row"
                      onClick={() => onSelectHost && onSelectHost(h.host, h)}
                    >
                      <td className="host-name-cell">{h.host}</td>
                      <td><span className="host-os-chip">{h.os || os}</span></td>
                      <td>
                        {h.product ? (
                          <span className="host-product-badge">{h.product}</span>
                        ) : (
                          <span className="host-metric-val">—</span>
                        )}
                      </td>
                      <td><StatusBadge status={h.status || 'UNKNOWN'} /></td>
                      <td className="host-metric-val">{typeof h.cpu_latest === 'number' ? `${h.cpu_latest.toFixed(1)}%` : '—'}</td>
                      <td className="host-metric-val">{typeof h.memory_latest === 'number' ? `${h.memory_latest.toFixed(1)}%` : '—'}</td>
                      <td className="host-metric-val">{typeof h.disk_latest === 'number' ? `${h.disk_latest.toFixed(1)}%` : '—'}</td>
                      <td className="host-metric-val">{typeof h.worst_filesystem_pct === 'number' ? `${h.worst_filesystem_pct.toFixed(1)}%` : '—'}</td>
                      <td className="host-metric-val">{agent.agent_version || '—'}</td>
                      <td>
                        {agent.has_agent ? (
                          <span className={`host-agent-badge host-agent-badge--${agent.silent ? 'silent' : drift}`}>
                            {agent.silent ? 'Silent' : (drift === 'in_sync' ? 'In Sync' : drift)}
                          </span>
                        ) : (
                          <span className="host-metric-val">No Agent</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
