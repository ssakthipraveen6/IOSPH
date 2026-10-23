/**
 * Traces view: recent traces and their spans.
 */
import React, { useState, useEffect } from 'react';
import { apiFetch, reportFetchError } from '../../api';
import StatusBadge from '../shared/StatusBadge';
import { LoadingState } from '../shared/PrototypeNotice';
import EmptyState from '../shared/EmptyState';
import './TracesView.css';

/**
 * TracesView (Phase O6.4 / R4)
 * Distributed Trace Explorer & Waterfall View under Explore.
 * Connects to ClickHouse spans table (or memory fallback),
 * displaying distributed traces and span waterfall breakdowns.
 */
export default function TracesView({ environment = 'staging' }) {
  const [traces, setTraces] = useState([]);
  const [selectedTraceId, setSelectedTraceId] = useState(null);
  const [traceDetail, setTraceDetail] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [error, setError] = useState(null);

  const fetchTraces = () => {
    setLoadingList(true);
    setError(null);
    const params = new URLSearchParams();
    if (productFilter) params.set('product', productFilter);
    if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
    params.set('limit', '50');

    apiFetch(`/api/v2/traces?${params.toString()}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        const list = Array.isArray(data.traces) ? data.traces : [];
        setTraces(list);
        if (list.length > 0 && !selectedTraceId) {
          setSelectedTraceId(list[0].trace_id);
        } else if (list.length === 0) {
          setSelectedTraceId(null);
          setTraceDetail(null);
        }
      })
      .catch(err => {
        reportFetchError('TracesView.list', err);
        setError(err.message || 'Failed to query traces');
      })
      .finally(() => {
        setLoadingList(false);
      });
  };

  useEffect(() => {
    fetchTraces();
  }, [environment, productFilter, statusFilter]);

  useEffect(() => {
    if (!selectedTraceId) {
      setTraceDetail(null);
      return;
    }
    setLoadingDetail(true);
    apiFetch(`/api/v2/traces/${encodeURIComponent(selectedTraceId)}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        setTraceDetail(data);
      })
      .catch(err => {
        reportFetchError('TracesView.detail', err);
      })
      .finally(() => {
        setLoadingDetail(false);
      });
  }, [selectedTraceId]);

  const spans = Array.isArray(traceDetail?.spans) ? traceDetail.spans : [];
  const rootDuration = spans.length > 0 ? Math.max(...spans.map(s => Number(s.duration_ms || 0)), 1) : 1;

  return (
    <div className="traces-view">
      {/* Header & Filters */}
      <div className="tr-header">
        <div>
          <h2 className="tr-title">
            <span>🔬 Distributed Trace Explorer</span>
          </h2>
          <div className="tr-subtitle">
            Explore › Traces · End-to-end W3C distributed trace spans and latency waterfall analysis
          </div>
        </div>

        <div className="tr-controls">
          <input
            type="text"
            className="tr-input"
            placeholder="Filter by product..."
            value={productFilter}
            onChange={e => setProductFilter(e.target.value)}
          />

          <select
            className="tr-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All Statuses</option>
            <option value="OK">OK</option>
            <option value="ERROR">ERROR</option>
          </select>

          <button onClick={fetchTraces} className="tr-btn-refresh">
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="tr-card">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="tr-layout">
        {/* Left: Trace List */}
        <div className="tr-card">
          <div className="tr-card-title">
            <span>Traces ({traces.length})</span>
            {loadingList && <span className="tr-mono">Loading…</span>}
          </div>

          {loadingList && traces.length === 0 && <LoadingState label="Searching spans in ClickHouse…" />}

          {!loadingList && traces.length === 0 && (
            <EmptyState
              title="No traces found"
              message={`No matching distributed traces in ${environment} environment.`}
            />
          )}

          <div className="tr-trace-list">
            {traces.map(t => {
              const isSelected = t.trace_id === selectedTraceId;
              return (
                <button
                  key={t.trace_id}
                  onClick={() => setSelectedTraceId(t.trace_id)}
                  className={`tr-trace-item ${isSelected ? 'tr-trace-item--selected' : ''}`}
                >
                  <div className="tr-trace-item-row">
                    <span className="tr-service-badge">{t.service}</span>
                    <StatusBadge status={t.status === 'ERROR' ? 'CRITICAL' : 'HEALTHY'} size="sm" />
                  </div>
                  <div className="tr-span-name">{t.name}</div>
                  <div className="tr-trace-item-row tr-mono tr-span-meta">
                    <span>{t.duration_ms} ms · {t.span_count} spans</span>
                    <span>{new Date(t.start_ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="tr-mono tr-span-meta">{t.trace_id.slice(0, 16)}…</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Trace Detail & Waterfall */}
        <div className="tr-card">
          <div className="tr-card-title">
            <span>Trace Waterfall Breakdown</span>
            {selectedTraceId && <span className="tr-mono">{selectedTraceId}</span>}
          </div>

          {loadingDetail && <LoadingState label="Loading span hierarchy…" />}

          {!selectedTraceId && !loadingDetail && (
            <EmptyState
              title="No trace selected"
              message="Select a trace from the list on the left to inspect its waterfall hierarchy."
            />
          )}

          {traceDetail && !loadingDetail && (
            <div className="tr-waterfall">
              <div className="tr-waterfall-header">
                <div>
                  <strong>Total Spans:</strong> {traceDetail.span_count}
                </div>
                <div>
                  <strong>Max Span Duration:</strong> {rootDuration} ms
                </div>
                <div>
                  <strong>Environment:</strong> <code>{traceDetail.environment}</code>
                </div>
              </div>

              <div className="tr-waterfall-spans">
                {spans.map((span, idx) => {
                  const dur = Number(span.duration_ms || 0);
                  const isError = span.status === 'ERROR';
                  return (
                    <div
                      key={span.span_id || idx}
                      className={`tr-span-row ${isError ? 'tr-span-row--error' : ''}`}
                    >
                      <div>
                        <span className="tr-service-badge">{span.service}</span>
                        <div className="tr-span-name" title={span.name}>{span.name}</div>
                      </div>

                      <div className="tr-span-bar-container">
                        <div className="tr-span-track">
                          <div
                            className={`tr-span-bar ${isError ? 'tr-span-bar--error' : ''}`}
                          />
                        </div>
                        <div className="tr-span-meta tr-mono">
                          Span ID: {span.span_id ? span.span_id.slice(0, 8) : 'root'}
                          {span.parent_span_id ? ` · Parent: ${span.parent_span_id.slice(0, 8)}` : ' (root)'}
                        </div>
                      </div>

                      <div className="tr-mono">{dur} ms</div>

                      <StatusBadge status={isError ? 'CRITICAL' : 'HEALTHY'} size="sm" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
