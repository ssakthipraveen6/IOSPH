/**
 * Capacity view: used vs available capacity and runway forecast per resource.
 */
import React, { useState, useEffect } from 'react';
import CapacityBar from '../shared/CapacityBar';
import EmptyState from '../shared/EmptyState';
import './CapacityView.css';

// Capacity page; fetches capacity data and renders one CapacityBar per resource.
export default function CapacityView({ activeEnv = 'prod' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterKind, setFilterKind] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`/api/v2/capacity`, {
      headers: {
        'Accept': 'application/json'
      }
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(res => {
        if (mounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(err => {
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { mounted = false; };
  }, [activeEnv]);

  if (loading) {
    return (
      <div className="capacity-view">
        <div className="capacity-view__loading">Loading capacity and runway projections...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="capacity-view">
        <EmptyState
          title="Capacity Data Unavailable"
          message={`Failed to load capacity telemetry: ${error}`}
        />
      </div>
    );
  }

  const items = (data && data.items) || [];
  const criticalItems = items.filter(it => it.min_days_to_full !== null && it.min_days_to_full < 7);
  const warningItems = items.filter(it => it.min_days_to_full !== null && it.min_days_to_full >= 7 && it.min_days_to_full < 30);

  const filteredItems = items.filter(item => {
    if (filterKind !== 'all' && item.kind !== filterKind) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchName = (item.name || '').toLowerCase().includes(q);
      const matchComp = (item.component || '').toLowerCase().includes(q);
      const matchId = (item.id || '').toLowerCase().includes(q);
      if (!matchName && !matchComp && !matchId) return false;
    }
    return true;
  });

  return (
    <div className="capacity-view">
      <div className="capacity-view__header">
        <div>
          <h1 className="capacity-view__title">Observe › Capacity & Runway</h1>
          <p className="capacity-view__subtitle">
            Linear runway projections across infrastructure hosts, Kubernetes, storage shares, databases, and licenses
          </p>
        </div>
        <div className="capacity-view__stats">
          <div className="capacity-stat-pill capacity-stat-pill--total">
            <span className="capacity-stat-pill__label">Monitored</span>
            <span className="capacity-stat-pill__value">{items.length}</span>
          </div>
          <div className="capacity-stat-pill capacity-stat-pill--critical">
            <span className="capacity-stat-pill__label">&lt; 7 Days</span>
            <span className="capacity-stat-pill__value">{criticalItems.length}</span>
          </div>
          <div className="capacity-stat-pill capacity-stat-pill--warning">
            <span className="capacity-stat-pill__label">&lt; 30 Days</span>
            <span className="capacity-stat-pill__value">{warningItems.length}</span>
          </div>
        </div>
      </div>

      <div className="capacity-view__toolbar">
        <input
          type="text"
          className="capacity-search-input"
          placeholder="Filter by name, component or ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="capacity-kind-filter">
          {['all', 'host', 'k8s', 'share', 'db', 'license', 'executor', 'avi'].map(k => (
            <button
              key={k}
              className={`capacity-filter-btn ${filterKind === k ? 'capacity-filter-btn--active' : ''}`}
              onClick={() => setFilterKind(k)}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyState
          title="No Capacity Records Found"
          message={items.length === 0 ? 'No capacity metrics currently collected for this environment.' : 'No records match the current filter criteria.'}
        />
      ) : (
        <div className="capacity-view__grid">
          {filteredItems.map(item => {
            const isAvi = item.kind === 'avi' || item.kind === 'vip';
            const isDataUnavailable = item.status === 'DATA_UNAVAILABLE' || isAvi;
            return (
              <div key={item.id} className="capacity-card">
                <div className="capacity-card__top">
                  <div className="capacity-card__identity">
                    <span className="capacity-card__kind-badge">{item.kind}</span>
                    <span className="capacity-card__name">{item.name || item.id}</span>
                  </div>
                  <div className="capacity-card__status">
                    {isDataUnavailable ? (
                      <span className="capacity-pill capacity-pill--unavail">NOT COLLECTED</span>
                    ) : item.min_days_to_full !== null ? (
                      item.min_days_to_full < 7 ? (
                        <span className="capacity-pill capacity-pill--critical">CRITICAL (&lt;7d)</span>
                      ) : item.min_days_to_full < 30 ? (
                        <span className="capacity-pill capacity-pill--warning">WARNING (&lt;30d)</span>
                      ) : (
                        <span className="capacity-pill capacity-pill--healthy">HEALTHY</span>
                      )
                    ) : (
                      <span className="capacity-pill capacity-pill--stable">STABLE</span>
                    )}
                  </div>
                </div>

                {isDataUnavailable ? (
                  <div className="capacity-card__empty-notice">
                    {item.reason || 'Telemetry not collected for this component kind.'}
                  </div>
                ) : (
                  <>
                    <CapacityBar
                      label={item.resource_label || 'Utilization'}
                      used={item.used ?? 0}
                      total={item.total ?? 100}
                      available={item.available}
                      unit={item.unit || ''}
                      daysToFull={item.min_days_to_full}
                    />

                    <div className="capacity-card__forecast-row">
                      <div className="capacity-card__forecast-cell">
                        <span className="capacity-card__forecast-label">7-Day Runway</span>
                        <span className="capacity-card__forecast-val">
                          {item.days_to_full_7d !== null && item.days_to_full_7d !== undefined
                            ? `${item.days_to_full_7d}d`
                            : 'Stable'}
                        </span>
                      </div>
                      <div className="capacity-card__forecast-cell">
                        <span className="capacity-card__forecast-label">30-Day Runway</span>
                        <span className="capacity-card__forecast-val">
                          {item.days_to_full_30d !== null && item.days_to_full_30d !== undefined
                            ? `${item.days_to_full_30d}d`
                            : 'Stable'}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
