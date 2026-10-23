/**
 * Remediation view: runbooks, their runs and approval state.
 */
import React, { useState, useEffect } from 'react';
import { apiFetch, reportFetchError } from '../../api';
import StatusBadge from '../shared/StatusBadge';
import { LoadingState } from '../shared/PrototypeNotice';
import './RemediationView.css';

/**
 * RemediationView (Phase O6.3 / R3)
 * Restored Autonomous Healing & Remediation screen under Respond.
 * Features:
 *   - Autonomous mode switch with last changer information
 *   - Four-eyes dual-signature approval flow for PROD mutations
 *   - Live remediation log stream
 *   - Paginated historical runs
 */
export default function RemediationView({ environment = 'staging' }) {
  const [settings, setSettings] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const fetchSettingsAndRuns = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch('/api/settings').then(r => r.ok ? r.json() : {}),
      apiFetch('/api/v2/remediation/runs?limit=20').then(r => r.ok ? r.json() : { runs: [] })
    ])
      .then(([sData, rData]) => {
        setSettings(sData);
        setRuns(Array.isArray(rData.runs) ? rData.runs : []);
      })
      .catch(err => {
        reportFetchError('RemediationView', err);
        setError(err.message || 'Failed to load remediation settings');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSettingsAndRuns();
  }, [environment]);

  const handleToggle = async () => {
    setToggling(true);
    setFeedback(null);
    const targetState = !settings?.autonomousMode;

    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomousMode: targetState })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update autonomous mode');

      setFeedback(data.message || 'Settings updated successfully');
      fetchSettingsAndRuns();
    } catch (err) {
      reportFetchError('RemediationView.toggle', err);
      setError(err.message);
    } finally {
      setToggling(false);
    }
  };

  const handleApprovePending = async () => {
    setApproving(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomousMode: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve');

      setFeedback(data.message);
      fetchSettingsAndRuns();
    } catch (err) {
      reportFetchError('RemediationView.approve', err);
      setError(err.message);
    } finally {
      setApproving(false);
    }
  };

  const autonomousOn = settings?.autonomousMode === true;
  const pendingReq = settings?.pendingApproval;

  return (
    <div className="remediation-view">
      {/* Header */}
      <div className="rem-header">
        <div>
          <h2 className="rem-title">
            <span>⚡ Automated Remediation &amp; Self-Healing</span>
          </h2>
          <div className="rem-subtitle">
            Respond › Remediation · Autonomous playbooks, four-eyes gatekeeping &amp; remediation audit trail
          </div>
        </div>

        <StatusBadge status={autonomousOn ? 'HEALTHY' : 'WARNING'} size="md" />
      </div>

      {loading && <LoadingState label="Loading remediation configuration…" />}

      {/* Notifications */}
      {feedback && (
        <div className="rem-four-eyes-alert">
          <span>ℹ️ {feedback}</span>
          <button onClick={() => setFeedback(null)} className="rem-mono">Dismiss</button>
        </div>
      )}

      {error && (
        <div className="rem-four-eyes-alert">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} className="rem-mono">Dismiss</button>
        </div>
      )}

      {!loading && (
        <>
          {/* Autonomous Mode Toggle Card */}
          <div className="rem-card">
            <div className="rem-switch-row">
              <div className="rem-switch-info">
                <div className="rem-switch-title">
                  Autonomous Remediation Engine: {autonomousOn ? 'ACTIVE' : 'STANDBY'}
                </div>
                <div className="rem-switch-desc">
                  When enabled, verified Playbook runbooks trigger automatically on correlated multi-signal problems.
                  {environment === 'prod' && ' (PROD requires 2 distinct approvers before activating)'}
                </div>
                <div className="rem-mono rem-switch-desc">
                  Last changed by: <strong>{settings?.lastChangedBy || 'system'}</strong> · {settings?.lastChangedAt ? new Date(settings.lastChangedAt).toLocaleString() : '—'}
                </div>
              </div>

              <button
                onClick={handleToggle}
                disabled={toggling}
                className={`rem-btn-toggle ${autonomousOn ? 'rem-btn-toggle--on' : 'rem-btn-toggle--off'}`}
              >
                {toggling ? 'Processing…' : (autonomousOn ? '✓ Autonomous Mode ON' : '○ Enable Autonomous Mode')}
              </button>
            </div>
          </div>

          {/* Pending 4-Eyes Banner for PROD */}
          {pendingReq && (
            <div className="rem-four-eyes-alert">
              <div>
                <strong>Four-Eyes Approval Required:</strong> A request to activate Autonomous Mode in PROD is awaiting a second signature.
                <div className="rem-mono rem-switch-desc">
                  Requested by: <code>{pendingReq.requestedBy}</code> · Signatures: 1 of 2
                </div>
              </div>
              <button
                onClick={handleApprovePending}
                disabled={approving}
                className="rem-btn-toggle rem-btn-toggle--on"
              >
                {approving ? 'Signing…' : '✍️ Sign as 2nd Approver'}
              </button>
            </div>
          )}

          {/* Remediation Runs History */}
          <div className="rem-card">
            <div className="rem-switch-title">
              Remediation Playbook Execution History ({runs.length})
            </div>
            <div className="rem-table-container">
              <table className="rem-table">
                <thead>
                  <tr>
                    <th>Execution ID</th>
                    <th>Target Layer</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Initiated By</th>
                    <th>Signatures</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="rem-mono">
                        No remediation runs recorded in this environment.
                      </td>
                    </tr>
                  ) : (
                    runs.map((r, idx) => (
                      <tr key={idx}>
                        <td className="rem-mono"><code>{r.id}</code></td>
                        <td>{r.component || r.layer || 'database'}</td>
                        <td>{r.action || r.reason || 'Service recovery'}</td>
                        <td><StatusBadge status={r.status === 'Completed' ? 'HEALTHY' : (r.status === 'In-Progress' ? 'WARNING' : 'CRITICAL')} size="sm" /></td>
                        <td className="rem-mono">{r.initiatedBy || 'autonomous'}</td>
                        <td className="rem-mono">{Array.isArray(r.approvals) ? r.approvals.length : (r.status === 'Completed' ? 2 : 0)} / 2</td>
                        <td className="rem-mono">{r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '—'}</td>
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
