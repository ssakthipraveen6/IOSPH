/**
 * Change windows: list, create and close maintenance windows that suppress alerts.
 */
import React, { useCallback, useEffect, useState } from 'react';
import DataTable from '../shared/DataTable';
import { DataUnavailableState, LoadingState } from '../shared/PrototypeNotice';
import { apiFetch, reportFetchError } from '../../api';
import './ChangeWindowsView.css';

/**
 * Govern > Change windows (Phase S1).
 * Lists the session environment's SENTINEL change windows, and lets SRE Lead+
 * create and close them. The server takes the environment and creator from the
 * session and refuses (503) when PostgreSQL cannot store the window.
 */
const LEAD_ROLES = ['SRE Lead', 'Platform Admin', 'SecOps Admin', 'Super Admin'];
const EMPTY_FORM = { title: '', productId: '', host: '', startTime: '', endTime: '', description: '' };

// State of a change window at a given time (upcoming, active, ended, closed).
function windowState(w, now) {
  if (w.status === 'CLOSED') return 'closed';
  const start = new Date(w.start_time).getTime();
  const end = new Date(w.end_time).getTime();
  if (now < start) return 'scheduled';
  if (now > end) return 'ended';
  return 'active';
}

// Change windows page.
export default function ChangeWindowsView({ environment, user }) {
  const [state, setState] = useState({ loading: true, windows: [], reason: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const canEdit = !!user && LEAD_ROLES.includes(user.role);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/v2/changes/windows?environment=${encodeURIComponent(environment)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status === 'DATA_UNAVAILABLE') {
        setState({ loading: false, windows: [], reason: body.reason || body.error || `Request failed (HTTP ${res.status}).` });
      } else {
        setState({ loading: false, windows: body.windows || [], reason: null });
      }
    } catch (err) {
      reportFetchError('[CHANGE WINDOWS] load failed', err);
      setState({ loading: false, windows: [], reason: `Could not reach the server: ${err.message}` });
    }
  }, [environment]);

  useEffect(() => { load(); }, [load]);

  const update = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/v2/changes/windows?environment=${encodeURIComponent(environment)}`, {
        method: 'POST',
        body: {
          title: form.title,
          productId: form.productId || undefined,
          host: form.host || undefined,
          description: form.description || undefined,
          startTime: form.startTime ? new Date(form.startTime).toISOString() : '',
          endTime: form.endTime ? new Date(form.endTime).toISOString() : ''
        }
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ error: true, text: body.error || `Not saved (HTTP ${res.status}).` });
      } else {
        setMessage({ error: false, text: `Change window ${body.window.id} created.` });
        setForm(EMPTY_FORM);
        load();
      }
    } catch (err) {
      setMessage({ error: true, text: `Not saved: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const closeWindow = async (id) => {
    setMessage(null);
    try {
      const res = await apiFetch(`/api/v2/changes/windows/${encodeURIComponent(id)}/close?environment=${encodeURIComponent(environment)}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      setMessage(res.ok ? { error: false, text: `Change window ${id} closed.` } : { error: true, text: body.error || `Not closed (HTTP ${res.status}).` });
      if (res.ok) load();
    } catch (err) {
      setMessage({ error: true, text: `Not closed: ${err.message}` });
    }
  };

  const now = Date.now();
  const columns = [
    { key: 'id', header: 'ID', sortable: true, render: (v) => <code>{v}</code> },
    { key: 'title', header: 'Title', sortable: true },
    { key: 'product_id', header: 'Product', sortable: true, render: (v) => v || 'All' },
    { key: 'host', header: 'Host', sortable: true, render: (v) => v || 'All' },
    { key: 'start_time', header: 'Start', sortable: true, render: (v) => new Date(v).toLocaleString() },
    { key: 'end_time', header: 'End', sortable: true, render: (v) => new Date(v).toLocaleString() },
    { key: 'created_by', header: 'Created by', sortable: true },
    {
      key: 'status', header: 'State', sortable: true,
      render: (_v, row) => {
        const s = windowState(row, now);
        return <span className={`cw-view__status--${s === 'active' ? 'active' : 'closed'}`}>{s}</span>;
      }
    },
    ...(canEdit ? [{
      key: 'actions', header: '',
      render: (_v, row) => row.status !== 'CLOSED' && new Date(row.end_time).getTime() > now
        ? <button type="button" className="cw-view__button cw-view__button--ghost" onClick={() => closeWindow(row.id)}>Close</button>
        : null
    }] : [])
  ];

  return (
    <div className="cw-view">
      {canEdit ? (
        <form className="cw-view__form" onSubmit={submit}>
          <label className="cw-view__field">Title
            <input required value={form.title} onChange={update('title')} maxLength={255} />
          </label>
          <label className="cw-view__field">Product id (blank = all)
            <input value={form.productId} onChange={update('productId')} />
          </label>
          <label className="cw-view__field">Host (blank = all)
            <input value={form.host} onChange={update('host')} />
          </label>
          <label className="cw-view__field">Start
            <input required type="datetime-local" value={form.startTime} onChange={update('startTime')} />
          </label>
          <label className="cw-view__field">End
            <input required type="datetime-local" value={form.endTime} onChange={update('endTime')} />
          </label>
          <label className="cw-view__field cw-view__field--wide">Description
            <textarea rows={2} value={form.description} onChange={update('description')} />
          </label>
          <div className="cw-view__actions">
            <button type="submit" className="cw-view__button" disabled={busy}>Create change window</button>
            {message && <span className={`cw-view__message${message.error ? ' cw-view__message--error' : ''}`}>{message.text}</span>}
          </div>
        </form>
      ) : (
        <p className="cw-view__message">Creating and closing change windows needs the SRE Lead role.</p>
      )}

      {state.loading && <LoadingState label="Loading change windows…" />}
      {!state.loading && state.reason && <DataUnavailableState environment={environment} reason={state.reason} />}
      {!state.loading && !state.reason && (
        state.windows.length === 0
          ? <DataUnavailableState environment={environment} title="No change windows" reason="No SENTINEL change windows are recorded for this environment." />
          : <DataTable columns={columns} data={state.windows} rowKey="id" />
      )}
    </div>
  );
}
