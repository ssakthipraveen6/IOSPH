/**
 * Fleet view: every host with agent status (reporting, silent, no agent) and agent version.
 */
import React, { useState, useEffect, useMemo } from 'react';
import EmptyState from '../shared/EmptyState';
import './FleetExplorerView.css';

/*
 * Fleet view — Observe › Hosts (mode="hosts") and Govern › Agents (mode="agents").
 *
 * Reads GET /api/v2/fleet/overview: per host the OS, agent version, last heartbeat,
 * silent flag and config-drift state written by the P10 fleet-health job; plus the
 * version distribution and coverage against `fleet.expected_hosts`.
 * No data → EmptyState. Nothing is synthesised here.
 *
 * `demoData` (Demo view) renders a supplied payload instead of calling the API. It
 * accepts the overview shape ({ hosts, summary }) or the older { entities, summary }
 * shape the Demo view adapter produces.
 */

const DRIFT_LABEL = { in_sync: 'In sync', drifted: 'Drifted', unknown: 'Unknown' };

// Age of a timestamp as a short text (e.g. 5m, 2h).
function formatAge(iso, nowMs) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Older Demo view shape ({ entities, summary.agentsDiscoveredVsExpected }) → overview shape. */
function fromLegacyDemo(data) {
  const entities = Array.isArray(data.entities) ? data.entities : [];
  const hosts = entities
    .filter(e => !e.kind || e.kind === 'host')
    .map(e => {
      const labels = e.labels || {};
      const version = labels.agent_version || labels.shipper_version || null;
      return {
        entity_id: e.entity_id,
        host: e.name || e.entity_id,
        os: labels.os || null,
        agent_version: version,
        has_agent: Boolean(version || labels.last_heartbeat),
        last_seen: labels.last_heartbeat || e.last_seen || null,
        silent: null,
        drift: typeof labels.config_drift === 'boolean' ? (labels.config_drift ? 'drifted' : 'in_sync') : 'unknown',
        config_hash: labels.config_hash || null,
        status: e.status || null
      };
    });
  if (hosts.length === 0) return { status: 'DATA_UNAVAILABLE', reason: 'No hosts in this demo payload.', hosts: [], summary: null };
  const agents = hosts.filter(h => h.has_agent);
  const counts = new Map();
  agents.forEach(h => counts.set(h.agent_version, (counts.get(h.agent_version) || 0) + 1));
  const cov = (data.summary && data.summary.agentsDiscoveredVsExpected) || {};
  const expected = Number(cov.expected) > 0 ? Number(cov.expected) : null;
  const reporting = Number.isFinite(Number(cov.discovered)) ? Number(cov.discovered) : agents.length;
  return {
    status: 'OK',
    hosts,
    summary: {
      hosts_total: hosts.length,
      agents_total: agents.length,
      reporting,
      silent: (data.summary && data.summary.staleEntitiesCount) || 0,
      drifted: agents.filter(h => h.drift === 'drifted').length,
      drift_unknown: agents.filter(h => h.drift === 'unknown').length,
      last_seen: null,
      version_distribution: [...counts.entries()].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
      coverage: { reporting, expected, pct: expected ? Math.round((reporting / expected) * 1000) / 10 : null }
    }
  };
}

// Accepts both demo data shapes.
function normaliseDemo(demoData) {
  if (!demoData) return null;
  if (Array.isArray(demoData.hosts)) return demoData;
  return fromLegacyDemo(demoData);
}

// Agent state of a host for the status column.
function hostState(h) {
  if (!h.has_agent) return { key: 'none', label: 'No agent' };
  if (h.silent === true) return { key: 'silent', label: 'Silent' };
  if (h.silent === false) return { key: 'alive', label: 'Reporting' };
  return { key: 'unknown', label: 'Unknown' };
}

// Fleet page; loads hosts or agents for the environment.
export default function FleetExplorerView({ environment = 'staging', mode = 'hosts', onInspectEntity, demoData = null }) {
  const [fetched, setFetched] = useState(null);
  const [loadingLive, setLoadingLive] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());

  const currentEnv = environment || 'staging';
  const isAgents = mode === 'agents';

  // Demo view: the supplied payload, never the live API.
  const demoView = useMemo(() => normaliseDemo(demoData), [demoData]);

  useEffect(() => {
    if (demoData) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v2/fleet/overview?environment=${encodeURIComponent(currentEnv)}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
        if (!cancelled) { setFetched(body); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setFetchedAt(Date.now());
          setLoadingLive(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [currentEnv, demoData]);

  const data = demoData ? demoView : fetched;
  const loading = demoData ? false : loadingLive;
  const nowMs = fetchedAt;

  const hosts = useMemo(() => {
    const all = (data && Array.isArray(data.hosts)) ? data.hosts : [];
    return isAgents ? all.filter(h => h.has_agent) : all;
  }, [data, isAgents]);

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return hosts.filter(h => {
      if (q && !(`${h.host} ${h.entity_id || ''} ${h.os || ''} ${h.agent_version || ''}`.toLowerCase().includes(q))) return false;
      if (filter === 'silent') return h.silent === true;
      if (filter === 'drifted') return h.drift === 'drifted';
      if (filter === 'no_agent') return !h.has_agent;
      return true;
    });
  }, [hosts, searchQuery, filter]);

  const title = isAgents ? 'Agent Fleet' : 'Hosts';
  const subtitle = isAgents
    ? 'SENTINEL agent versions, heartbeats and config drift (fleet-health job, P10)'
    : 'Discovered hosts with their agent heartbeat, OS and version';

  const header = (
    <div className="fleet-view__header">
      <div>
        <h2 className="fleet-view__title">{title}</h2>
        <div className="fleet-view__subtitle">{subtitle} · {currentEnv.toUpperCase()}</div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="fleet-view">
        {header}
        <div className="fleet-view__message">Loading fleet inventory…</div>
      </div>
    );
  }

  if (error && !demoData) {
    return (
      <div className="fleet-view">
        {header}
        <div className="fleet-view__message fleet-view__message--error">Failed to load fleet overview: {error}</div>
      </div>
    );
  }

  if (!data || data.status === 'DATA_UNAVAILABLE' || hosts.length === 0) {
    return (
      <div className="fleet-view">
        {header}
        <EmptyState
          environment={currentEnv}
          title={isAgents ? 'No agents reporting' : 'No hosts discovered'}
          description={isAgents
            ? 'No SENTINEL agent has sent a heartbeat in this environment yet.'
            : 'No host has been discovered or has sent an agent heartbeat in this environment yet.'}
          reason={(data && data.reason) || null}
        />
      </div>
    );
  }

  const s = data.summary || {};
  const coverage = s.coverage || {};
  const versions = Array.isArray(s.version_distribution) ? s.version_distribution : [];
  const maxVersionCount = versions.reduce((m, v) => Math.max(m, v.count), 0) || 1;
  const filters = isAgents
    ? [['all', 'All'], ['silent', 'Silent'], ['drifted', 'Drifted']]
    : [['all', 'All'], ['silent', 'Silent'], ['drifted', 'Drifted'], ['no_agent', 'No agent']];

  return (
    <div className="fleet-view">
      {header}

      <div className="fleet-view__kpis">
        <div className="fleet-kpi">
          <div className="fleet-kpi__label">Coverage</div>
          <div className="fleet-kpi__value">{coverage.pct === null || coverage.pct === undefined ? '—' : `${coverage.pct}%`}</div>
          <div className="fleet-kpi__hint">
            {coverage.expected
              ? `${coverage.reporting} reporting of ${coverage.expected} expected`
              : `${coverage.reporting ?? 0} reporting · fleet.expected_hosts not set`}
          </div>
        </div>
        <div className="fleet-kpi">
          <div className="fleet-kpi__label">{isAgents ? 'Agents' : 'Hosts'}</div>
          <div className="fleet-kpi__value">{isAgents ? s.agents_total : s.hosts_total}</div>
          <div className="fleet-kpi__hint">
            {isAgents ? `${s.hosts_total ?? '—'} hosts discovered` : `${s.agents_total ?? 0} with an agent`}
          </div>
        </div>
        <div className={`fleet-kpi${s.silent > 0 ? ' fleet-kpi--critical' : ''}`}>
          <div className="fleet-kpi__label">Silent</div>
          <div className="fleet-kpi__value">{s.silent ?? 0}</div>
          <div className="fleet-kpi__hint">No heartbeat within {data.silent_after_seconds ? `${Math.round(data.silent_after_seconds / 60)} min` : 'the threshold'}</div>
        </div>
        <div className={`fleet-kpi${s.drifted > 0 ? ' fleet-kpi--warning' : ''}`}>
          <div className="fleet-kpi__label">Config drift</div>
          <div className="fleet-kpi__value">{s.drifted ?? 0}</div>
          <div className="fleet-kpi__hint">{s.drift_unknown ? `${s.drift_unknown} not yet evaluated` : 'All evaluated'}</div>
        </div>
        <div className="fleet-kpi">
          <div className="fleet-kpi__label">Last heartbeat</div>
          <div className="fleet-kpi__value fleet-kpi__value--sm">{formatAge(s.last_seen, nowMs)}</div>
          <div className="fleet-kpi__hint">{s.last_seen ? new Date(s.last_seen).toLocaleString() : 'No heartbeat recorded'}</div>
        </div>
      </div>

      <section className="fleet-view__panel">
        <h3 className="fleet-view__panel-title">Agent version distribution</h3>
        {versions.length === 0 ? (
          <div className="fleet-view__muted">No agent has reported a version.</div>
        ) : (
          <ul className="fleet-versions">
            {versions.map(v => (
              <li key={v.version ?? '__none'} className="fleet-versions__row">
                <span className="fleet-versions__name">{v.version ? `v${v.version}` : 'not reported'}</span>
                <span className="fleet-versions__track">
                  <span className="fleet-versions__bar" style={{ width: `${(v.count / maxVersionCount) * 100}%` }} />
                </span>
                <span className="fleet-versions__count">{v.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="fleet-view__toolbar">
        <input
          type="text"
          className="fleet-view__search"
          placeholder="Search by host, OS or version…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="fleet-view__filters" role="group" aria-label="Filter hosts">
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`fleet-chip${filter === key ? ' fleet-chip--active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="fleet-view__message fleet-view__message--boxed">
          No {isAgents ? 'agents' : 'hosts'} match the current filters.
        </div>
      ) : (
        <div className="fleet-view__table-wrap">
          <table className="fleet-table">
            <thead>
              <tr>
                <th>Host</th>
                <th>OS</th>
                <th>Agent version</th>
                <th>Heartbeat</th>
                <th>Last seen</th>
                <th>Config</th>
                <th className="fleet-table__right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(h => {
                const state = hostState(h);
                return (
                  <tr key={h.entity_id || h.host}>
                    <td>
                      <div className="fleet-table__host">{h.host}</div>
                      {h.entity_id && <div className="fleet-table__id">{h.entity_id}</div>}
                    </td>
                    <td className="fleet-table__muted">{h.os || '—'}</td>
                    <td className="fleet-table__mono">{h.agent_version ? `v${h.agent_version}` : '—'}</td>
                    <td>
                      <span className={`fleet-badge fleet-badge--${state.key}`}>
                        <span className="fleet-badge__dot" />
                        {state.label}
                      </span>
                    </td>
                    <td className="fleet-table__muted" title={h.last_seen || ''}>{formatAge(h.last_seen, nowMs)}</td>
                    <td>
                      {h.has_agent ? (
                        <span className={`fleet-badge fleet-badge--drift-${h.drift || 'unknown'}`} title={h.config_hash ? `reported ${h.config_hash}` : 'no config hash reported'}>
                          {DRIFT_LABEL[h.drift] || DRIFT_LABEL.unknown}
                        </span>
                      ) : <span className="fleet-table__muted">—</span>}
                    </td>
                    <td className="fleet-table__right">
                      {onInspectEntity && h.entity_id && (
                        <button type="button" className="fleet-inspect" onClick={() => onInspectEntity(h.entity_id)}>
                          Inspect
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
