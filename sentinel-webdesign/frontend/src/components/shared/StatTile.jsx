/**
 * Metric tile: label, value and optional trend.
 */
import React from 'react';

/**
 * StatTile - High-density metric display tile for enterprise dashboards.
 * Uses tokens instead of inline styles.
 */
export default function StatTile({
  label,
  value,
  subtext = null,
  trend = null, // { direction: 'up' | 'down' | 'neutral', text: string }
  severity = null, // 'critical' | 'warning' | 'healthy' | 'info'
  sparklineData = null,
  onClick = null,
  className = ''
}) {
  const severityClass = severity ? `stat-tile--${severity.toLowerCase()}` : '';

  return (
    <div
      className={`stat-tile ${severityClass} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="stat-tile__header">
        <span className="stat-tile__label">{label}</span>
        {severity && <span className={`stat-tile__indicator stat-tile__indicator--${severity.toLowerCase()}`} />}
      </div>

      <div className="stat-tile__body">
        <div className="stat-tile__value">{value ?? '—'}</div>
        {trend && (
          <div className={`stat-tile__trend stat-tile__trend--${trend.direction}`}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.text}
          </div>
        )}
      </div>

      {(subtext || sparklineData) && (
        <div className="stat-tile__footer">
          {subtext && <span className="stat-tile__subtext">{subtext}</span>}
        </div>
      )}
    </div>
  );
}
