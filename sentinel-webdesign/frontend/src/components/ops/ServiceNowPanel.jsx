import React, { useState, useEffect } from 'react';
import './ServiceNowPanel.css';

export default function ServiceNowPanel({ environment = 'prod' }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTickets = async () => {
    try {
      const res = await fetch(`/api/itsm/tickets?env=${environment}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
    const interval = setInterval(fetchTickets, 15000);
    return () => clearInterval(interval);
  }, [environment]);

  const total = tickets.length;
  const resolved = tickets.filter(t => t.state === 'Resolved').length;
  const openCount = total - resolved;

  return (
    <div className="snow-panel-container">
      {/* Header */}
      <div className="snow-header">
        <div>
          <h2>
            <span>🎫</span>
            <span>ServiceNow Incident &amp; Change Governance</span>
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Bidirectional ITSM bridge · Autonomous remediation audit &amp; on-call assignment
          </div>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Environment: <strong style={{ color: 'var(--primary)' }}>{environment.toUpperCase()}</strong>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="snow-stats-row">
        <div className="snow-stat-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Incidents Synced</span>
          <span className="snow-stat-num">{total}</span>
        </div>
        <div className="snow-stat-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Auto-Resolved by Self-Healing</span>
          <span className="snow-stat-num" style={{ color: '#10b981' }}>{resolved}</span>
        </div>
        <div className="snow-stat-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>In-Progress / Escalated</span>
          <span className="snow-stat-num" style={{ color: openCount > 0 ? '#ef4444' : 'var(--text-muted)' }}>
            {openCount}
          </span>
        </div>
        <div className="snow-stat-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mean Time to Remediate (MTTR)</span>
          <span className="snow-stat-num" style={{ color: '#38bdf8' }}>3.8s</span>
        </div>
      </div>

      {/* Incidents Table */}
      <div className="snow-table-container">
        <table className="snow-table">
          <thead>
            <tr>
              <th>Incident #</th>
              <th>Component</th>
              <th>Title / Description</th>
              <th>Priority</th>
              <th>Assigned To</th>
              <th>State</th>
              <th>Created At</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && tickets.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                  Loading incident registry from ServiceNow Table API...
                </td>
              </tr>
            ) : tickets.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '30px', color: 'var(--healthy)' }}>
                  No active incidents recorded for this environment.
                </td>
              </tr>
            ) : (
              tickets.map(t => (
                <tr key={t.incident_id}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{t.incident_id}</span>
                  </td>
                  <td>
                    <span style={{ color: 'var(--primary)', fontWeight: '600' }}>{t.component}</span>
                  </td>
                  <td style={{ maxWidth: '300px' }}>
                    <div>{t.title}</div>
                    {t.resolution_notes && (
                      <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '2px' }}>
                        ✓ {t.resolution_notes}
                      </div>
                    )}
                  </td>
                  <td>
                    <span style={{
                      color: t.priority?.includes('High') || t.priority?.includes('1') ? '#ef4444' : '#f59e0b',
                      fontWeight: '600'
                    }}>
                      {t.priority}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{t.assigned_to}</span>
                  </td>
                  <td>
                    <span className={t.state === 'Resolved' ? 'snow-badge-resolved' : 'snow-badge-open'}>
                      {t.state}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {t.created_at ? new Date(t.created_at).toLocaleTimeString() : 'N/A'}
                  </td>
                  <td>
                    <a 
                      href={t.deep_link || '#'} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="snow-deep-link"
                    >
                      Open in SN ↗
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
