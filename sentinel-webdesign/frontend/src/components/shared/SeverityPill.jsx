/**
 * Coloured pill for a severity (critical, high, medium, low).
 */
import React from 'react';

/**
 * Normalizes input string to canonical severity token class
 */
function normalizeSeverityClass(sev) {
  if (!sev) return 'info';
  const s = String(sev).toLowerCase();
  if (s.includes('crit') || s === 'p1') return 'critical';
  if (s.includes('warn') || s === 'p2' || s === 'degraded') return 'warning';
  if (s.includes('health') || s === 'ok' || s === 'optimal') return 'healthy';
  if (s.includes('unavail') || s.includes('no_data')) return 'unavailable';
  if (s.includes('auth')) return 'auth-failed';
  return 'info';
}

/**
 * SeverityPill - Standardized status pill for alerts, incidents, and health.
 */
export default function SeverityPill({
  severity,
  label = null,
  size = 'md', // 'sm' | 'md' | 'lg'
  dotOnly = false,
  className = ''
}) {
  const normClass = normalizeSeverityClass(severity);
  const displayText = label || severity || 'Unknown';

  if (dotOnly) {
    return <span className={`severity-dot severity-dot--${normClass} ${className}`} title={displayText} />;
  }

  return (
    <span className={`severity-pill severity-pill--${normClass} severity-pill--${size} ${className}`}>
      <span className="severity-pill__dot" />
      <span className="severity-pill__text">{displayText}</span>
    </span>
  );
}
