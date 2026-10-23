/**
 * Panel wrapping a time-series chart with title and empty state.
 */
import React, { useMemo } from 'react';
import ReactiveCanvasChart from './ReactiveCanvasChart';
import EmptyState from './EmptyState';
import './TimeSeriesPanel.css';

/**
 * TimeSeriesPanel
 * High-density timeseries card with hour-of-week baseline band, change/alert markers,
 * and standard empty state when series is null.
 * Strictly avoids inline styles and uses tokens from tokens.css.
 */
export default function TimeSeriesPanel({
  title = 'Metric Trend',
  unit = '',
  series = null,
  baseline = null,
  markers = [],
  height = 180,
  emptyReason = 'DATA_UNAVAILABLE',
  className = ''
}) {
  const stats = useMemo(() => {
    if (!series || !Array.isArray(series) || series.length === 0) return null;
    const values = series.map(p => Number(p.value)).filter(v => Number.isFinite(v));
    if (values.length === 0) return null;

    const latest = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;

    return {
      latest: Number(latest.toFixed(2)),
      min: Number(min.toFixed(2)),
      max: Number(max.toFixed(2)),
      avg: Number(avg.toFixed(2))
    };
  }, [series]);

  const chartSeries = useMemo(() => {
    if (!series || !Array.isArray(series) || series.length === 0) return [];
    const values = series.map(p => Number(p.value)).filter(v => Number.isFinite(v));
    const list = [
      {
        data: values,
        color: 'var(--brand-primary)',
        fill: true,
        fillColor: 'var(--brand-subtle)',
        width: 2
      }
    ];

    if (baseline && Array.isArray(baseline) && baseline.length > 0) {
      const baseValues = baseline.map(p => Number(p.value)).filter(v => Number.isFinite(v));
      if (baseValues.length > 0) {
        list.push({
          data: baseValues,
          color: 'var(--text-muted)',
          fill: false,
          width: 1
        });
      }
    }
    return list;
  }, [series, baseline]);

  if (!series || !Array.isArray(series) || series.length === 0) {
    return (
      <div className={`timeseries-panel timeseries-panel--empty ${className}`}>
        <div className="timeseries-panel__header">
          <h4 className="timeseries-panel__title">{title}</h4>
          {unit && <span className="timeseries-panel__unit">{unit}</span>}
        </div>
        <EmptyState
          title={title}
          description="No telemetry points recorded in selected time range."
          reason={emptyReason}
        />
      </div>
    );
  }

  return (
    <div className={`timeseries-panel ${className}`}>
      <div className="timeseries-panel__header">
        <div className="timeseries-panel__title-group">
          <h4 className="timeseries-panel__title">{title}</h4>
          {unit && <span className="timeseries-panel__unit">({unit})</span>}
        </div>
        {stats && (
          <div className="timeseries-panel__stats">
            <span className="timeseries-panel__stat timeseries-panel__stat--latest">
              Latest: <strong>{stats.latest}</strong>
            </span>
            <span className="timeseries-panel__stat">Avg: {stats.avg}</span>
            <span className="timeseries-panel__stat">Max: {stats.max}</span>
          </div>
        )}
      </div>

      {markers && markers.length > 0 && (
        <div className="timeseries-panel__markers">
          {markers.map((m, idx) => (
            <span
              key={`marker-${idx}`}
              className={`timeseries-panel__marker timeseries-panel__marker--${m.severity || 'info'}`}
              title={m.label}
            >
              <span className="timeseries-panel__marker-dot" />
              {m.label}
            </span>
          ))}
        </div>
      )}

      <div className="timeseries-panel__chart-container">
        <ReactiveCanvasChart
          type="line"
          series={chartSeries}
          height={height}
        />
      </div>
    </div>
  );
}
