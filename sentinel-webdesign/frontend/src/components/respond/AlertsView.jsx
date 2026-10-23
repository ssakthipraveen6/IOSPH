/**
 * Alerts view: open alerts with acknowledge and resolve actions.
 */
import React, { useState, useEffect } from 'react';
import SeverityPill from '../shared/SeverityPill';
import DataTable from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import ReadOnlyActionButton from '../shared/ReadOnlyActionButton';
import { apiFetch } from '../../api';
import './Respond.css';

// Alerts page.
export default function AlertsView({ environment = 'staging', demoData = null, readOnly = false }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState(null);

  const fetchAlerts = () => {
    setLoading(true);
    // Demo view: render the supplied sample payload, never call the live API.
    if (demoData) {
      setAlerts(demoData.alerts || []);
      setLoading(false);
      return;
    }
    fetch(`/api/v2/alerts?environment=${encodeURIComponent(environment)}`)
      .then(r => r.json())
      .then(data => {
        setAlerts(data.alerts || []);
        setLoading(false);
      })
      .catch(() => {
        setAlerts([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAlerts();
  }, [environment, demoData]);

  const handleAction = async (id, action, body = {}) => {
    if (readOnly || demoData) return;
    try {
      // In web portal, session cookie authenticates, or authorization header if stored
      const res = await apiFetch(`/api/v2/alerts/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActionMsg(`Action failed (${res.status}): ${err.error || 'Permission denied or error'}`);
      } else {
        setActionMsg(`Alert ${id} successfully ${action}d.`);
        fetchAlerts();
      }
    } catch (err) {
      setActionMsg(`Network error: ${err.message}`);
    }
    setTimeout(() => setActionMsg(null), 5000);
  };

  const columns = [
    {
      key: 'id',
      header: 'Alert ID',
      sortable: true,
      render: (val) => <code className="alr-id">{val}</code>
    },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (val) => <SeverityPill severity={val} />
    },
    {
      key: 'component',
      header: 'Component',
      sortable: true,
      render: (val) => <strong>{val}</strong>
    },
    {
      key: 'message',
      header: 'Summary / Reason',
      render: (val, row) => (
        <div>
          <div>{val}</div>
          {row.rule_id && (
            <div className="alr-subtle">
              Rule: <code>{row.rule_id}</code>
            </div>
          )}
        </div>
      )
    },
    {
      key: 'status',
      header: 'Lifecycle Status',
      sortable: true,
      render: (val, row) => {
        const sev = val === 'Resolved' ? 'healthy' : val === 'Acknowledged' ? 'info' : val === 'Snoozed' ? 'warning' : 'critical';
        return (
          <div>
            <SeverityPill severity={sev} label={val} size="sm" />
            {row.acked_by && (
              <div className="alr-subtle">
                by: {row.acked_by}
              </div>
            )}
            {row.snoozed_until && (
              <div className="alr-subtle">
                until: {new Date(row.snoozed_until).toLocaleTimeString()}
              </div>
            )}
          </div>
        );
      }
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (_, row) => readOnly ? (
        <div className="alr-actions">
          {row.status === 'Active' && (
            <>
              <ReadOnlyActionButton className="time-picker__btn time-picker__btn--active">Ack</ReadOnlyActionButton>
              <ReadOnlyActionButton>Snooze</ReadOnlyActionButton>
            </>
          )}
          {row.status !== 'Resolved' && <ReadOnlyActionButton>Resolve</ReadOnlyActionButton>}
        </div>
      ) : (
        <div className="alr-actions">
          {row.status === 'Active' && (
            <>
              <button
                type="button"
                className="time-picker__btn time-picker__btn--active"
                onClick={() => handleAction(row.id, 'ack')}
                title="Acknowledge alert"
              >
                Ack
              </button>
              <button
                type="button"
                className="time-picker__btn"
                onClick={() => handleAction(row.id, 'snooze', { minutes: 60 })}
                title="Snooze for 60m"
              >
                Snooze
              </button>
            </>
          )}
          {row.status !== 'Resolved' && (
            <button
              type="button"
              className="time-picker__btn"
              onClick={() => handleAction(row.id, 'resolve')}
              title="Resolve alert"
            >
              Resolve
            </button>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="alr-root">
      <div className="alr-card">
        <div className="alr-card-header">
          <div>
            <h3 className="alr-title">
              Alert Lifecycle Management (Task 5.3)
            </h3>
            <span className="alr-subtle">
              Active rules, threshold breaches, and audited operator acknowledgements
            </span>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="time-picker__btn time-picker__btn--active"
              onClick={fetchAlerts}
            >
              ↻ Refresh
            </button>
          )}
        </div>

        {actionMsg && (
          <div className="alr-action-msg">
            {actionMsg}
          </div>
        )}

        {loading ? (
          <div className="alr-loading">
            Loading active alerts...
          </div>
        ) : alerts.length === 0 ? (
          <EmptyState
            title="Zero Alerts"
            description={`No active alert rule triggers detected in ${environment}.`}
            environment={environment}
          />
        ) : (
          <DataTable
            columns={columns}
            data={alerts}
            rowKey="id"
          />
        )}
      </div>
    </div>
  );
}
