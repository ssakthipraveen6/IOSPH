import React, { useState, useEffect } from 'react';

export default function FleetExplorerView({ environment = 'staging', onInspectEntity }) {
  const [entities, setEntities] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [selectedKind, setSelectedKind] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  const currentEnv = environment || 'staging';

  useEffect(() => {
    async function fetchFleetData() {
      setLoading(true);
      setError(null);
      try {
        const [entRes, sumRes] = await Promise.all([
          fetch(`/api/v2/entities?environment=${currentEnv}&limit=500`),
          fetch(`/api/v2/fleet/summary?environment=${currentEnv}`)
        ]);

        if (entRes.ok) {
          const entData = await entRes.json();
          setEntities(entData.entities || []);
        }

        if (sumRes.ok) {
          const sumData = await sumRes.json();
          setSummary(sumData);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchFleetData();
  }, [currentEnv]);

  const toggleExpand = (id) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredEntities = entities.filter(e => {
    const matchesRegion = selectedRegion === 'all' || (e.region && e.region.toUpperCase() === selectedRegion.toUpperCase());
    const matchesKind = selectedKind === 'all' || (e.kind && e.kind.toLowerCase() === selectedKind.toLowerCase());
    const matchesStatus = selectedStatus === 'all' || (e.status && e.status.toUpperCase() === selectedStatus.toUpperCase());
    const matchesSearch = !searchQuery.trim() ||
      (e.name && e.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.entity_id && e.entity_id.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.app_id && e.app_id.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesRegion && matchesKind && matchesStatus && matchesSearch;
  });

  // Group into hierarchical tree: Apps -> Controllers -> Hosts/Agents
  const appEntities = filteredEntities.filter(e => e.kind === 'application' || (!e.parent_id && !e.kind.includes('host')));
  const childEntities = filteredEntities.filter(e => e.kind !== 'application');

  return (
    <div className="fleet-explorer-view" style={{ animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Header & KPI Rollup Cards */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
            Fleet & Topology Inventory Explorer
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Multi-Tier Hierarchical Catalog: Applications → Controllers → Agent Nodes across Enterprise Clusters
          </div>
        </div>

        {summary && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{
              background: 'rgba(20, 184, 166, 0.1)',
              border: '1px solid rgba(20, 184, 166, 0.3)',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              color: 'var(--sentinel-teal, #14b8a6)',
              fontWeight: 700
            }}>
              📡 AGENT COVERAGE: {summary.agentsDiscoveredVsExpected?.discovered} / {summary.agentsDiscoveredVsExpected?.expected} ({summary.agentsDiscoveredVsExpected?.coveragePct}%)
            </div>
            {summary.staleEntitiesCount > 0 && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                color: '#ef4444',
                fontWeight: 700
              }}>
                ⚠️ {summary.staleEntitiesCount} STALE ASSETS (&gt;24h)
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Filter Toolbar */}
      <div style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-light)',
        borderRadius: '10px',
        padding: '1rem',
        marginBottom: '1.5rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center'
      }}>
        {/* Search */}
        <div style={{ flex: '1 1 240px' }}>
          <input
            type="text"
            placeholder="Search assets by hostname, entity ID, or application..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'var(--bg-dark)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-main)',
              fontSize: '0.85rem'
            }}
          />
        </div>

        {/* Region Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Region:</span>
          {['all', 'EMEA', 'AMER', 'APAC'].map(r => (
            <button
              key={r}
              onClick={() => setSelectedRegion(r)}
              className="action-btn-sm"
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                background: selectedRegion === r ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                color: selectedRegion === r ? '#fff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Asset Type Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Kind:</span>
          {['all', 'application', 'controller', 'host', 'storage'].map(k => (
            <button
              key={k}
              onClick={() => setSelectedKind(k)}
              className="action-btn-sm"
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                background: selectedKind === k ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                color: selectedKind === k ? '#fff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Status:</span>
          {['all', 'HEALTHY', 'DEGRADED', 'CRITICAL'].map(s => (
            <button
              key={s}
              onClick={() => setSelectedStatus(s)}
              className="action-btn-sm"
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                background: selectedStatus === s ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                color: selectedStatus === s ? '#fff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Entity Tree Table */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          🔄 Loading enterprise asset inventory...
        </div>
      ) : error ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>
          ⚠️ Failed to load fleet entities: {error}
        </div>
      ) : filteredEntities.length === 0 ? (
        <div style={{
          padding: '3rem',
          textAlign: 'center',
          color: 'var(--text-muted)',
          background: 'var(--bg-panel)',
          borderRadius: '10px',
          border: '1px dashed var(--border-light)'
        }}>
          No entities matched the current filters for <strong>{currentEnv.toUpperCase()}</strong>.
        </div>
      ) : (
        <div style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-light)',
          borderRadius: '10px',
          overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <th style={{ padding: '10px 16px' }}>ENTITY / TOPOLOGY NODE</th>
                <th style={{ padding: '10px 14px' }}>TYPE</th>
                <th style={{ padding: '10px 14px' }}>REGION</th>
                <th style={{ padding: '10px 14px' }}>STATUS</th>
                <th style={{ padding: '10px 14px' }}>LABELS & SHIPPER VERSION</th>
                <th style={{ padding: '10px 14px' }}>LAST OBSERVED</th>
                <th style={{ padding: '10px 16px', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntities.map(entity => {
                const isExpanded = expandedNodes.has(entity.entity_id);
                const statusColor = entity.status === 'CRITICAL' ? '#ef4444' : (entity.status === 'DEGRADED' || entity.status === 'warning' ? '#f59e0b' : '#10b981');
                const labels = entity.labels || {};

                return (
                  <tr
                    key={entity.entity_id}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      transition: 'background 0.15s ease'
                    }}
                    className="table-row-hover"
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-main)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1rem' }}>
                          {entity.kind === 'application' ? '📦' : (entity.kind === 'storage' ? '💾' : (entity.kind === 'controller' ? '☸️' : '🖥️'))}
                        </span>
                        <div>
                          <div>{entity.name}</div>
                          <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                            {entity.entity_id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        background: 'rgba(255,255,255,0.06)',
                        color: 'var(--text-muted)'
                      }}>
                        {entity.kind}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>
                      {entity.region || 'GLOBAL'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        color: statusColor,
                        fontWeight: 700,
                        fontSize: '0.75rem'
                      }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: statusColor }}></span>
                        {entity.status || 'HEALTHY'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {labels.shipper_version ? (
                        <span style={{ color: 'var(--sentinel-teal, #14b8a6)', fontFamily: 'monospace' }}>
                          v{labels.shipper_version}
                        </span>
                      ) : (labels.appKey || 'managed')}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {entity.last_seen ? new Date(entity.last_seen).toLocaleTimeString() : 'Active'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {onInspectEntity && (
                        <button
                          onClick={() => onInspectEntity(entity.entity_id)}
                          style={{
                            background: 'rgba(20, 184, 166, 0.15)',
                            border: '1px solid rgba(20, 184, 166, 0.3)',
                            color: 'var(--sentinel-teal, #14b8a6)',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            fontWeight: 600
                          }}
                        >
                          Inspect ➔
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
