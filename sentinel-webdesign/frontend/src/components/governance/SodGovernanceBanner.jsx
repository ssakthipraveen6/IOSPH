/**
 * Four-eyes approval banner: pending remediation actions and the sign buttons.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { DataUnavailableState, LoadingState, PrototypeBanner } from '../shared/PrototypeNotice';
import { apiFetch } from '../../api';
import './SodGovernanceBanner.css';

// Reads the CSRF token cookie.
function getCsrfToken() {
  const match = document.cookie.match(/(^|;\s*)sentinel_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[2]) : '';
}

// Timestamp as local date/time, or a dash.
function formatTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

// Value as an array.
const asList = (v) => (Array.isArray(v) ? v : []);

// Button label for the next approval step.
function signLabel(action) {
  const approvals = asList(action.approvals).length;
  const required = action.approvalsRequired || 2;
  if (action.status === 'PENDING_FIRST_SIGN' || approvals === 0) return `Sign as first approver (1 of ${required})`;
  return `Co-sign as second approver (${Math.min(approvals + 1, required)} of ${required})`;
}

// Approval banner component.
export default function SodGovernanceBanner({ environment }) {
  const [result, setResult] = useState({ state: 'loading', data: null, reason: null, env: null });
  const [reloadTick, setReloadTick] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [messages, setMessages] = useState({}); // runId -> { ok, text }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/governance/sod-audit?environment=${encodeURIComponent(environment)}`, { credentials: 'include' })
      .then(async r => {
        let body = null;
        try { body = await r.json(); } catch { body = null; }
        if (cancelled) return;
        if (!r.ok) {
          setResult({ state: 'unavailable', data: null, reason: (body && body.error) || `Request failed (HTTP ${r.status}).`, env: environment });
        } else if (!body || body.status === 'DATA_UNAVAILABLE') {
          setResult({ state: 'unavailable', data: null, reason: (body && body.reason) || 'The server returned no data.', env: environment });
        } else {
          setResult({ state: 'ready', data: body, reason: null, env: environment });
        }
      })
      .catch(err => {
        if (!cancelled) setResult({ state: 'unavailable', data: null, reason: `Could not reach the server: ${err.message}`, env: environment });
      });
    return () => { cancelled = true; };
  }, [environment, reloadTick]);

  const handleSign = useCallback(async (action) => {
    setBusyId(action.id);
    setMessages(m => ({ ...m, [action.id]: null }));
    try {
      const res = await apiFetch('/api/recovery/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ runId: action.id })
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (res.ok && body && body.success) {
        setMessages(m => ({ ...m, [action.id]: { ok: true, text: 'Signature recorded' } }));
        setReloadTick(t => t + 1);
      } else if (res.ok) {
        setMessages(m => ({ ...m, [action.id]: { ok: false, text: 'Signature not recorded: the run may no longer be awaiting approval.' } }));
        setReloadTick(t => t + 1);
      } else {
        const text = (body && body.error) || `Approval rejected (HTTP ${res.status}).`;
        setMessages(m => ({ ...m, [action.id]: { ok: false, text } }));
      }
    } catch (err) {
      setMessages(m => ({ ...m, [action.id]: { ok: false, text: `Could not reach the server: ${err.message}` } }));
    } finally {
      setBusyId(null);
    }
  }, []);

  if (result.env !== environment || result.state === 'loading') return <LoadingState label="Loading governance queue…" />;
  if (result.state === 'unavailable') return <DataUnavailableState environment={environment} reason={result.reason} />;

  const data = result.data;
  const isSample = Boolean(data.prototype);
  const pendingActions = asList(data.pendingActions);
  const itsmSync = asList(data.itsmSync);
  const auditTrail = asList(data.auditTrail);

  return (
    <div className="sod-root">
      {data.prototype && <PrototypeBanner environment={environment} note="This approval queue and audit trail are sample records. Signing is disabled." />}

      {/* SoD Approval Queue */}
      {pendingActions.length === 0 && (
        <div className="sod-empty">
          <strong className="sod-empty__title">No actions awaiting approval</strong>
          <div className="sod-sub">
            Remediation runs parked as Awaiting-Approval in {String(environment).toUpperCase()} appear here and need two distinct approvers.
          </div>
        </div>
      )}

      {pendingActions.map(action => {
        const approvals = asList(action.approvals);
        const msg = messages[action.id];
        const busy = busyId === action.id;
        return (
          <div key={action.id} className="sod-pending">
            <div>
              <strong className="sod-pending__title">
                REMEDIATION PENDING DUAL APPROVAL ({approvals.length} of {action.approvalsRequired || 2} signed)
              </strong>
              <div className="sod-sub sod-sub--muted">
                Run: <code>{action.id}</code> • Action: <code>{action.action || '—'}</code> • Target: {action.target || '—'} • Origin: {action.incidentId || 'No incident linked'}
                {action.initiatedBy && <> • Initiated by: {action.initiatedBy}</>}
              </div>
              {msg && (
                <div role="status" className={`sod-msg ${msg.ok ? 'sod-msg--ok' : 'sod-msg--err'}`}>
                  {msg.text}
                </div>
              )}
            </div>
            <div className="sod-actions">
              <span className="sod-signer">
                {action.primarySigner
                  ? <>Primary Signer: <strong>{action.primarySigner}</strong> [Signed{action.primarySignedAt ? ` ${formatTs(action.primarySignedAt)}` : ''}]</>
                  : <>No signatures yet</>}
              </span>
              <button
                onClick={() => handleSign(action)}
                disabled={isSample || busy}
                title={isSample ? 'Sample record: signing is disabled' : undefined}
                className={`sod-sign-btn${isSample ? ' sod-sign-btn--sample' : ''}${busy ? ' sod-sign-btn--busy' : ''}`}
              >
                {isSample ? 'Sample Record' : (busy ? 'Submitting…' : signLabel(action))}
              </button>
            </div>
          </div>
        );
      })}

      <div className="sod-grid">
        {/* ServiceNow Sync Table */}
        <div className="glass-card sod-card">
          <div className="sod-card__head">
            <span className="sod-card__title">ServiceNow CMDB &amp; Incident Sync</span>
            <span className="sod-card__hint">Linked tickets</span>
          </div>
          {itsmSync.length === 0 ? (
            <div className="sod-card__empty">No ServiceNow sync records</div>
          ) : (
            <table className="sod-table">
              <thead>
                <tr>
                  <th className="sod-table__th">Ticket ID</th>
                  <th className="sod-table__th">Priority</th>
                  <th className="sod-table__th">CI Component</th>
                  <th className="sod-table__th">Status</th>
                </tr>
              </thead>
              <tbody>
                {itsmSync.map((t, idx) => {
                  const p1 = String(t.priority || '').includes('P1');
                  return (
                    <tr key={idx} className="sod-table__tr">
                      <td className="sod-table__td sod-table__td--ticket">{t.ticketId || '—'}</td>
                      <td className="sod-table__td">
                        <span className={`sod-priority${p1 ? ' sod-priority--p1' : ''}`}>
                          {t.priority || '—'}
                        </span>
                      </td>
                      <td className="sod-table__td sod-table__td--ci">{t.ciComponent || '—'}</td>
                      <td className={`sod-table__td sod-table__td--status${t.status === 'Remediated' ? ' sod-table__td--remediated' : ''}`}>{t.status || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Governance Audit Trail */}
        <div className="glass-card sod-card">
          <div className="sod-card__head">
            <span className="sod-card__title">Governance Audit Trail</span>
            <span className="sod-card__hint">Recovery, approval &amp; control events</span>
          </div>
          {auditTrail.length === 0 ? (
            <div className="sod-card__empty">No governance events recorded</div>
          ) : (
            <div className="sod-audit">
              {auditTrail.map((a, idx) => (
                <div key={idx} className="sod-audit__item">
                  <div className="sod-audit__line">[{formatTs(a.timestamp)}] <strong>{a.event || '—'}</strong></div>
                  {a.details && (
                    <div className="sod-audit__details">{a.details}</div>
                  )}
                  <div className="sod-audit__meta">
                    {a.hash ? <>Hash: {a.hash} • </> : null}Operator: {a.operator || '—'}{a.ip ? <> • IP: {a.ip}</> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
