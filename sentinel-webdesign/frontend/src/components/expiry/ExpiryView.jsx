/**
 * Certificates and licences view: expiry dates and days left.
 */
import React, { useState, useEffect } from 'react';
import { apiFetch, reportFetchError } from '../../api';
import StatusBadge from '../shared/StatusBadge';
import { LoadingState } from '../shared/PrototypeNotice';
import CapacityBar from '../shared/CapacityBar';
import { SEVERITY, normalizeSeverity } from '@sentinel/shared-constants';
import './ExpiryView.css';

/**
 * ExpiryView (Phase O7 / O7.6)
 * Observe › Certificates & Licences screen.
 * Displays:
 *   - Days left with status levels (60d info, 30d warning, 14d critical, 7d critical EMERGENCY)
 *   - Locations mapping (multi-location de-duplication)
 *   - Owner product and source (api, file, manifest)
 *   - Seat / Quota meters
 *   - Renewal dates
 *   - Warning flags (e.g. SHA-1, TLS 1.0)
 */
export default function ExpiryView({ environment = 'staging' }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeKind, setActiveKind] = useState('ALL'); // ALL | CERTIFICATES | LICENSES
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const fetchExpiryData = () => {
    setLoading(true);
    setError(null);
    apiFetch('/api/v2/expiry')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        setItems(Array.isArray(data.items) ? data.items : []);
        setSummary(data.summary || null);
      })
      .catch((err) => {
        reportFetchError('ExpiryView', err);
        setError(err.message || 'Failed to fetch certificates and licences');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchExpiryData();
  }, [environment]);

  const filteredItems = items.filter((item) => {
    // Kind filter
    if (activeKind === 'CERTIFICATES') {
      if (item.kind !== 'tls_cert' && item.kind !== 'saml_cert') return false;
    } else if (activeKind === 'LICENSES') {
      if (item.kind !== 'license') return false;
    }

    // Status filter
    if (statusFilter !== 'ALL' && item.status !== statusFilter.toLowerCase()) {
      return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchSubject = (item.subject || item.name || '').toLowerCase().includes(q);
      const matchProduct = (item.product || '').toLowerCase().includes(q);
      const matchLocations = Array.isArray(item.locations) && item.locations.some(l => l.toLowerCase().includes(q));
      if (!matchSubject && !matchProduct && !matchLocations) return false;
    }

    return true;
  });

  return (
    <div className="expiry-view">
      {/* Header */}
      <div className="expiry-view__header">
        <div className="expiry-view__title-group">
          <h1 className="expiry-view__title">Certificates & Licences</h1>
          <span className="expiry-badge expiry-badge--source">{environment.toUpperCase()}</span>
        </div>
        <div className="expiry-view__actions">
          <button
            type="button"
            className="expiry-view__refresh-btn"
            onClick={fetchExpiryData}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="expiry-view__summary-grid">
          <div className="expiry-summary-card">
            <span className="expiry-summary-card__label">Tracked Items</span>
            <span className="expiry-summary-card__value">{summary.total || 0}</span>
          </div>
          <div className="expiry-summary-card expiry-summary-card--critical">
            <span className="expiry-summary-card__label">Critical (&le; 14d)</span>
            <span className="expiry-summary-card__value">{summary.critical || 0}</span>
          </div>
          <div className="expiry-summary-card expiry-summary-card--warning">
            <span className="expiry-summary-card__label">Expiring Soon (&le; 30d)</span>
            <span className="expiry-summary-card__value">{summary.warning || 0}</span>
          </div>
          <div className="expiry-summary-card expiry-summary-card--healthy">
            <span className="expiry-summary-card__label">Healthy</span>
            <span className="expiry-summary-card__value">{summary.healthy || 0}</span>
          </div>
        </div>
      )}

      {/* Filters & Search Controls */}
      <div className="expiry-view__controls">
        <div className="expiry-view__filter-group">
          <button
            type="button"
            className={`expiry-filter-btn ${activeKind === 'ALL' ? 'expiry-filter-btn--active' : ''}`}
            onClick={() => setActiveKind('ALL')}
          >
            All Items
          </button>
          <button
            type="button"
            className={`expiry-filter-btn ${activeKind === 'CERTIFICATES' ? 'expiry-filter-btn--active' : ''}`}
            onClick={() => setActiveKind('CERTIFICATES')}
          >
            Certificates
          </button>
          <button
            type="button"
            className={`expiry-filter-btn ${activeKind === 'LICENSES' ? 'expiry-filter-btn--active' : ''}`}
            onClick={() => setActiveKind('LICENSES')}
          >
            Licences
          </button>
        </div>

        <input
          type="text"
          className="expiry-view__search-input"
          placeholder="Filter by subject, product, or location..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Content Table */}
      {loading ? (
        <LoadingState message="Scanning certificates and licence inventory..." />
      ) : error ? (
        <div className="expiry-empty-state">{error}</div>
      ) : filteredItems.length === 0 ? (
        <div className="expiry-empty-state">No certificates or licences matching your filter criteria.</div>
      ) : (
        <div className="expiry-view__table-container">
          <table className="expiry-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Subject & Product</th>
                <th>Kind / Source</th>
                <th>Locations</th>
                <th>Days Remaining</th>
                <th>Renewal / Expiry</th>
                <th>Capacity / Meter</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const days = item.daysLeft !== undefined ? item.daysLeft : item.days_remaining;
                const normSev = normalizeSeverity(item.status);
                const statusClass = normSev === SEVERITY.CRITICAL
                  ? 'expiry-days--critical'
                  : normSev === SEVERITY.WARNING
                  ? 'expiry-days--warning'
                  : normSev === SEVERITY.INFO
                  ? 'expiry-days--info'
                  : 'expiry-days--healthy';

                return (
                  <tr key={item.fingerprint || item.item_id || item.subject}>
                    <td>
                      <StatusBadge
                        status={
                          normSev === SEVERITY.CRITICAL
                            ? 'CRITICAL'
                            : normSev === SEVERITY.WARNING
                            ? 'WARNING'
                            : normSev === SEVERITY.INFO
                            ? 'INFO'
                            : 'HEALTHY'
                        }
                      />
                    </td>
                    <td>
                      <div className="expiry-item__subject-title">{item.subject || item.name}</div>
                      <div className="expiry-item__subject-sub">Product: {item.product || 'general'}</div>
                    </td>
                    <td>
                      <div className="expiry-locations-list">
                        <span className="expiry-badge expiry-badge--kind">{item.kind}</span>
                        <span className="expiry-badge expiry-badge--source">{item.source || 'manifest'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="expiry-locations-list">
                        {(item.locations || [item.target || 'localhost']).map((loc) => (
                          <span key={loc} className="expiry-location-pill">{loc}</span>
                        ))}
                      </div>
                    </td>
                    <td className="expiry-days-cell">
                      <span className={statusClass}>
                        {days !== null && days !== undefined ? `${days} days` : 'N/A'}
                      </span>
                    </td>
                    <td>
                      {item.not_after
                        ? new Date(item.not_after).toLocaleDateString()
                        : 'No fixed expiry'}
                    </td>
                    <td>
                      {item.kind === 'license' && item.seats_total ? (
                        <CapacityBar
                          label="Seats"
                          used={item.seats_used || 0}
                          total={item.seats_total}
                          unit="seats"
                        />
                      ) : (
                        <span className="expiry-meter__label">—</span>
                      )}
                    </td>
                    <td>
                      {Array.isArray(item.flags) && item.flags.length > 0 ? (
                        item.flags.map((flag) => (
                          <span key={flag} className="expiry-badge expiry-badge--flag">{flag}</span>
                        ))
                      ) : (
                        <span className="expiry-meter__label">—</span>
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
