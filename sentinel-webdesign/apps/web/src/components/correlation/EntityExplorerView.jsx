import React, { useState } from 'react';
import { MASTER_ENTITY_CATALOG } from '../../data/correlationData';
import { SEVERITY, normalizeSeverity, getStatusColor } from '@sentinel/shared-constants';

export default function EntityExplorerView({ 
  onSelectEntity, 
  onNavigateToTimeline,
  environment = 'staging',
  historicalMetrics = null
}) {
  const [filterType, setFilterType] = useState('all');
  const [selectedAppFilter, setSelectedAppFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const types = [
    { id: 'all', label: 'All Asset Types' },
    { id: 'Application', label: 'Applications' },
    { id: 'Load Balancer VIP', label: 'Load Balancer VIPs' },
    { id: 'Host Compute Node', label: 'Host Compute Nodes' },
    { id: 'Database', label: 'Databases' },
    { id: 'Certificate Authority', label: 'Certificate Authorities' }
  ];

  const appFilters = [
    { id: 'all', label: 'All Applications' },
    { id: 'bitbucket', label: 'Bitbucket' },
    { id: 'artifactory', label: 'Artifactory' },
    { id: 'jenkins', label: 'Jenkins' },
    { id: 'fortify', label: 'Fortify' },
    { id: 'sonarqube', label: 'SonarQube' },
    { id: 'nexusiq', label: 'NexusIQ' },
    { id: 'argocd', label: 'ArgoCD' },
    { id: 'teamcity', label: 'TeamCity' },
    { id: 'github', label: 'GitHub' },
    { id: 'argoworkflows', label: 'Argo Workflows' },
    { id: 'bitbucket_external', label: 'Bitbucket DMZ' },
    { id: 'otkr', label: 'OTKR Security' },
    { id: 'performance_center', label: 'Performance Center' }
  ];

  const filteredEntities = MASTER_ENTITY_CATALOG.filter(e => {
    const matchesType = filterType === 'all' || e.type === filterType;
    const matchesApp = selectedAppFilter === 'all' || e.appKey === selectedAppFilter || e.appKey === 'all';
    const matchesQuery = searchQuery === '' ||
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.hostOrIp && e.hostOrIp.toLowerCase().includes(searchQuery.toLowerCase())) ||
      e.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.owner && e.owner.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.tier && e.tier.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesType && matchesApp && matchesQuery;
  });

  const isProdOrStg = environment === 'prod' || environment === 'staging' || environment === 'stg';

  const getTypeCount = (typeId) => {
    if (typeId === 'all') return MASTER_ENTITY_CATALOG.length;
    return MASTER_ENTITY_CATALOG.filter(e => e.type === typeId).length;
  };

  return (
    <div className="entity-explorer-view" style={{ animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* Header Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '1.25rem',
        background: 'var(--bg-panel)',
        borderRadius: '12px',
        border: '1px solid var(--border-light)',
        marginBottom: '1.25rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>🧭</span>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--text-main)' }}>
              Universal Entity Explorer &amp; Topology Resolver
            </h2>
            <span style={{
              background: isProdOrStg ? 'rgba(148, 163, 184, 0.15)' : 'rgba(20, 184, 166, 0.15)',
              color: isProdOrStg ? '#94a3b8' : 'var(--sentinel-teal, #14b8a6)',
              border: `1px solid ${isProdOrStg ? 'rgba(148, 163, 184, 0.3)' : 'rgba(20, 184, 166, 0.3)'}`,
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.5px'
            }}>
              {isProdOrStg ? 'NOT COLLECTED (VALUE NOT AVAILABLE)' : `${MASTER_ENTITY_CATALOG.length} ASSETS INDEXED`}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Searchable registry indexing all 13 enterprise applications, dedicated AVI ingress VIPs, clustered host nodes, databases, and PKI certificates.
          </p>
        </div>

        {/* Search Box */}
        <input
          type="text"
          placeholder="Search by IP, hostname, VIP, app, or owner..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '8px 14px',
            background: 'var(--bg-panel-subtle)',
            border: '1px solid var(--border-light)',
            borderRadius: '8px',
            color: 'var(--text-main)',
            fontSize: '0.82rem',
            width: '320px',
            outline: 'none'
          }}
        />
      </div>

      {/* Infrastructure Tier Filters (All tabs) */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '0.75rem', overflowX: 'auto', paddingBottom: '4px' }}>
        {types.map(t => {
          const count = getTypeCount(t.id);
          const isActive = filterType === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setFilterType(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: isActive ? 'var(--sentinel-teal, #14b8a6)' : 'var(--border-light)',
                background: isActive ? 'rgba(20, 184, 166, 0.15)' : 'var(--bg-panel)',
                color: isActive ? 'var(--sentinel-teal, #14b8a6)' : 'var(--text-muted)',
                fontSize: '0.78rem',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{t.label}</span>
              <span style={{
                background: isActive ? 'var(--primary)' : 'rgba(255,255,255,0.08)',
                color: isActive ? '#041212' : 'var(--text-muted)',
                padding: '1px 6px',
                borderRadius: '10px',
                fontSize: '0.68rem',
                fontWeight: 800
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Application Scoping Chips */}
      <div style={{
        display: 'flex',
        gap: '6px',
        marginBottom: '1.25rem',
        overflowX: 'auto',
        paddingBottom: '6px',
        scrollbarWidth: 'none'
      }}>
        {appFilters.map(app => (
          <button
            key={app.id}
            onClick={() => setSelectedAppFilter(app.id)}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid',
              borderColor: selectedAppFilter === app.id ? 'rgba(56, 189, 248, 0.6)' : 'var(--border-light)',
              background: selectedAppFilter === app.id ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-panel-subtle)',
              color: selectedAppFilter === app.id ? '#38bdf8' : 'var(--text-muted)',
              fontSize: '0.72rem',
              fontWeight: selectedAppFilter === app.id ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
          >
            {app.label}
          </button>
        ))}
      </div>

      {/* Notice banner for prod/stg */}
      {isProdOrStg && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(148, 163, 184, 0.08)',
          border: '1px solid rgba(148, 163, 184, 0.25)',
          borderRadius: '8px',
          marginBottom: '1.25rem',
          fontSize: '0.78rem',
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>ℹ️</span>
          <span>
            <strong>Notice:</strong> Universal entity explorer telemetry and signals are not being collected yet for {environment ? environment.toUpperCase() : 'this environment'}. Asset values are shown as <em>Value Not Available</em>.
          </span>
        </div>
      )}

      {/* Entity Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.25rem' }}>
        {filteredEntities.map(entity => {
          const status = isProdOrStg ? 'DATA_UNAVAILABLE' : entity.status;
          const normStatus = normalizeSeverity(status);
          const isCritical = normStatus === SEVERITY.CRITICAL;
          const isWarning = normStatus === SEVERITY.WARNING || normStatus === SEVERITY.PREDICTIVE_WARNING;
          const isUnavailStatus = status === 'DATA_UNAVAILABLE';

          const p95 = isProdOrStg ? 'Value Not Available' : ((entity.metrics && entity.metrics.p95Latency) || 'N/A');
          const errRate = isProdOrStg ? 'Value Not Available' : ((entity.metrics && entity.metrics.errorRate) || '0.00%');
          const tput = isProdOrStg ? 'Value Not Available' : ((entity.metrics && entity.metrics.throughput) || 'N/A');
          const isDrifted = isProdOrStg ? false : (entity.driftStatus && entity.driftStatus.drifted);

          return (
            <div
              key={entity.id}
              onClick={() => onSelectEntity(entity.id)}
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-light)',
                borderRadius: '10px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                boxShadow: '0 4px 14px rgba(0,0,0,0.06)'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--sentinel-teal, #14b8a6)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.5rem' }}>{entity.icon}</span>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      {entity.name}
                    </h4>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {entity.hostOrIp}
                    </span>
                  </div>
                </div>

                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  background: isUnavailStatus ? 'rgba(148, 163, 184, 0.15)' : (isCritical ? 'rgba(239, 68, 68, 0.2)' : isWarning ? 'rgba(245, 158, 11, 0.2)' : 'rgba(20, 184, 166, 0.2)'),
                  color: isUnavailStatus ? '#94a3b8' : (isCritical ? '#ef4444' : isWarning ? '#f59e0b' : '#14b8a6')
                }}>
                  {isUnavailStatus ? 'Value Not Available' : status.toUpperCase()}
                </span>
              </div>

              {/* Metrics row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', textAlign: 'center', background: 'var(--bg-panel-subtle)', padding: '8px', borderRadius: '6px' }}>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Latency</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>{p95}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Errors</div>
                  <div style={{
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    color: (errRate === 'Value Not Available') ? 'var(--text-muted)' : (errRate.startsWith('0') ? '#14b8a6' : '#ef4444')
                  }}>
                    {errRate}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Throughput</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>{tput}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Drift</div>
                  <div style={{
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    color: isProdOrStg ? 'var(--text-muted)' : (isDrifted ? '#f59e0b' : '#14b8a6')
                  }}>
                    {isProdOrStg ? 'Value Not Available' : (isDrifted ? 'DRIFT' : 'SYNC')}
                  </div>
                </div>
              </div>

              {/* Footer row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-dim)', borderTop: '1px solid var(--border-light)', paddingTop: '8px' }}>
                <span>Type: <strong style={{ color: 'var(--primary)' }}>{entity.type}</strong></span>
                <span style={{ color: 'var(--sentinel-teal, #14b8a6)', fontWeight: 700 }}>Inspect Drill-Down ↗</span>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
