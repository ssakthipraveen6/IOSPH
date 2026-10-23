/**
 * Status badge and dot coloured by severity/state.
 */
import React from 'react';
import { SEVERITY, SEVERITY_COLORS, normalizeSeverity, getStatusColor } from '@sentinel/shared-constants';
import './StatusBadge.css';

/**
 * StatusDot component
 * Standardized status dot indicator supporting healthy, warning, critical, offline, and data_unavailable states.
 */
export function StatusDot({ status = 'healthy', pulse = false, size = 8, style = {} }) {
  const norm = normalizeSeverity(status);
  const color = SEVERITY_COLORS[norm] || '#10b981';
  
  let glow = 'rgba(16, 185, 129, 0.4)';
  if (norm === SEVERITY.CRITICAL) {
    glow = 'rgba(239, 68, 68, 0.5)';
  } else if (norm === SEVERITY.WARNING || norm === SEVERITY.PREDICTIVE_WARNING) {
    glow = 'rgba(245, 158, 11, 0.5)';
  } else if (norm === SEVERITY.DATA_UNAVAILABLE) {
    glow = 'transparent';
  } else if (norm === SEVERITY.AUTH_FAILED) {
    glow = 'rgba(249, 115, 22, 0.5)';
  }

  return (
    <span
      className={`status-dot-indicator shr-status-dot ${pulse ? 'pulse' : ''}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: color,
        boxShadow: pulse ? `0 0 8px ${glow}` : 'none',
        ...style
      }}
    />
  );
}

/**
 * StatusBadge component
 * Consistent pill badge for entity states, alert severities, and compliance flags.
 */
export default function StatusBadge({ status = 'healthy', label = null, size = 'sm', showDot = true, style = {} }) {
  const norm = normalizeSeverity(status);
  
  let tone = 'healthy';
  let defaultLabel = 'HEALTHY';

  if (norm === SEVERITY.CRITICAL) {
    tone = 'critical';
    defaultLabel = 'CRITICAL';
  } else if (norm === SEVERITY.WARNING || norm === SEVERITY.PREDICTIVE_WARNING) {
    tone = 'warning';
    defaultLabel = 'WARNING';
  } else if (norm === SEVERITY.INFO) {
    tone = 'info';
    defaultLabel = 'INFO';
  } else if (norm === SEVERITY.DATA_UNAVAILABLE) {
    tone = 'unavailable';
    defaultLabel = 'NO DATA';
  } else if (norm === SEVERITY.AUTH_FAILED) {
    tone = 'auth-failed';
    defaultLabel = 'AUTH FAILED';
  }

  const isSmall = size === 'sm';
  const displayLabel = label || defaultLabel;

  return (
    <span
      className={`shr-status-badge shr-status-badge--${tone}${isSmall ? ' shr-status-badge--sm' : ''}`}
      style={style}
    >
      {showDot && <StatusDot status={norm} size={isSmall ? 6 : 7} />}
      <span>{displayLabel}</span>
    </span>
  );
}
