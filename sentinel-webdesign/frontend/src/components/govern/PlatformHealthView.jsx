/**
 * Platform health: Sentinel's own health (database, jobs, ingest queue, leader).
 */
import React, { useState, useEffect } from 'react';
import { apiFetch, reportFetchError } from '../../api';
import StatusBadge from '../shared/StatusBadge';
import { LoadingState, DataUnavailableState } from '../shared/PrototypeNotice';
import './PlatformHealthView.css';

/**
 * PlatformHealthView (Phase O6.2 / R2)
 * Pipeline Operations & Health screen under Govern.
 * Combines ingest rates, buffer drops, background jobs, ClickHouse lag,
 * circuit-breaker states, and leader node info.
 */
export default function PlatformHealthView({ environment = 'staging' }) {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHealth = () => {
    setLoading(true);
    setError(null);
    apiFetch('/api/v2/platform/health')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        setHealthData(data);
      })
      .catch(err => {
        reportFetchError('PlatformHealthView', err);
        setError(err.message || 'Failed to load platform health');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchHealth();
  }, [environment]);

  const ingest = healthData?.ingest || {};
  const ch = healthData?.clickhouse || {};
  const jobs = Array.isArray(healthData?.jobs) ? healthData.jobs : [];
  const leader = healthData?.leader || {};

  return (
    <div className="platform-health-view">
      {/* Header */}
      <div className="ph-header">
        <div>
          <h2 className="ph-title">
            <span>⚙️ Platform Operations &amp; Engine Health</span>
          </h2>
          <div className="ph-subtitle">
            Govern › Platform Health · Ingest pipeline telemetry, leader coordination &amp; background daemons
          </div>
        </div>

        <div className="ph-actions">
          <StatusBadge status={healthData?.status || 'HEALTHY'} size="md" />
        </div>
      </div>

      {loading && <LoadingState label="Inspecting platform infrastructure daemons…" />}
      {error && !loading && <DataUnavailableState environment={environment} reason={error} />}

      {!loading && healthData && (
        <>
          {/* Key Metric Tiles */}
          <div className="ph-grid">
            <div className="ph-tile">
              <span className="ph-tile-label">Leader Node</span>
              <span className="ph-tile-val">{leader.role || 'LEADER'}</span>
              <span className="ph-tile-sub ph-mono">{leader.leaderId || 'node-01'}</span>
            </div>

            <div className="ph-tile">
              <span className="ph-tile-label">Ingest Rate</span>
              <span className="ph-tile-val">
                {typeof ingest.rowsPerSec === 'number' ? `${ingest.rowsPerSec} rps` : '0 rps'}
              </span>
              <span className="ph-tile-sub">Queue depth: {ingest.queueDepth || 0} / {ingest.queueCapacity || 50000}</span>
            </div>

            <div className="ph-tile">
              <span className="ph-tile-label">Buffer Drops</span>
              <span className="ph-tile-val">{ingest.droppedTotal || 0}</span>
              <span className="ph-tile-sub">Rejected batches: {ch.rejectedBatches || 0}</span>
            </div>

            <div className="ph-tile">
              <span className="ph-tile-label">ClickHouse Write Lag</span>
              <span className="ph-tile-val">
                {typeof ch.writeLagMs === 'number' ? `${ch.writeLagMs} ms` : '—'}
              </span>
              <span className="ph-tile-sub">Status: {ch.connected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>

          {/* Background Jobs Status Table */}
          <div className="ph-card">
            <div className="ph-card-head">
              <h3 className="ph-card-title">Background SRE Daemons &amp; Periodic Jobs</h3>
            </div>
            <div className="ph-table-container">
              <table className="ph-table">
                <thead>
                  <tr>
                    <th>Job Name</th>
                    <th>Schedule</th>
                    <th>Last Run</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Error Details</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="ph-mono">
                        No background jobs registered or running in this process.
                      </td>
                    </tr>
                  ) : (
                    jobs.map((j, idx) => (
                      <tr key={idx}>
                        <td>
                          <strong>{j.name || j.id}</strong>
                        </td>
                        <td className="ph-mono">{j.schedule || 'Periodic'}</td>
                        <td className="ph-mono">{j.lastRun ? new Date(j.lastRun).toLocaleTimeString() : 'Pending'}</td>
                        <td className="ph-mono">{typeof j.durationMs === 'number' ? `${j.durationMs} ms` : '—'}</td>
                        <td>
                          <StatusBadge status={j.status === 'ERROR' ? 'CRITICAL' : 'HEALTHY'} size="sm" />
                        </td>
                        <td className="ph-mono">{j.error || 'Clean execution'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
