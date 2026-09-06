import React from 'react';
import { SEVERITY, SEVERITY_COLORS, normalizeSeverity, SeverityType } from '@sentinel/shared-constants';

export interface StatusDotProps {
  status?: SeverityType | string;
  pulse?: boolean;
  size?: number;
  style?: React.CSSProperties;
}

export function StatusDot({
  status = 'healthy',
  pulse = false,
  size = 8,
  style = {}
}: StatusDotProps): React.JSX.Element {
  const norm = normalizeSeverity(status);
  const color = SEVERITY_COLORS[norm] || '#10b981';

  let glow = 'rgba(16, 185, 129, 0.4)';
  if (norm === SEVERITY.CRITICAL) {
    glow = 'rgba(239, 68, 68, 0.5)';
  } else if (norm === SEVERITY.WARNING || norm === SEVERITY.PREDICTIVE_WARNING) {
    glow = 'rgba(245, 158, 11, 0.5)';
  } else if (norm === SEVERITY.DATA_UNAVAILABLE) {
    glow = 'transparent';
  }

  return (
    <span
      className={`status-dot-indicator ${pulse ? 'pulse' : ''}`}
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: pulse ? `0 0 8px ${glow}` : 'none',
        flexShrink: 0,
        ...style
      }}
    />
  );
}

export interface StatusBadgeProps {
  status?: SeverityType | string;
  label?: string | null;
  size?: 'sm' | 'md' | 'lg';
  showDot?: boolean;
  style?: React.CSSProperties;
}

export default function StatusBadge({
  status = 'healthy',
  label = null,
  size = 'sm',
  showDot = true,
  style = {}
}: StatusBadgeProps): React.JSX.Element {
  const norm = normalizeSeverity(status);

  let bg = 'rgba(16, 185, 129, 0.12)';
  let text = '#10b981';
  let border = 'rgba(16, 185, 129, 0.25)';
  let defaultLabel = 'HEALTHY';

  if (norm === SEVERITY.CRITICAL) {
    bg = 'rgba(239, 68, 68, 0.12)';
    text = '#ef4444';
    border = 'rgba(239, 68, 68, 0.3)';
    defaultLabel = 'CRITICAL';
  } else if (norm === SEVERITY.WARNING || norm === SEVERITY.PREDICTIVE_WARNING) {
    bg = 'rgba(245, 158, 11, 0.12)';
    text = '#f59e0b';
    border = 'rgba(245, 158, 11, 0.3)';
    defaultLabel = 'WARNING';
  } else if (norm === SEVERITY.INFO) {
    bg = 'rgba(59, 130, 246, 0.12)';
    text = '#3b82f6';
    border = 'rgba(59, 130, 246, 0.3)';
    defaultLabel = 'INFO';
  } else if (norm === SEVERITY.DATA_UNAVAILABLE) {
    bg = 'rgba(148, 163, 184, 0.12)';
    text = '#94a3b8';
    border = 'rgba(148, 163, 184, 0.25)';
    defaultLabel = 'NO DATA';
  }

  const isSmall = size === 'sm';
  const displayLabel = label || defaultLabel;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: isSmall ? '2px 7px' : '3px 10px',
        fontSize: isSmall ? '0.68rem' : '0.75rem',
        fontWeight: 700,
        fontFamily: 'var(--font-mono, monospace)',
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        borderRadius: '4px',
        background: bg,
        color: text,
        border: `1px solid ${border}`,
        lineHeight: 1.2,
        ...style
      }}
    >
      {showDot && <StatusDot status={norm} size={isSmall ? 6 : 7} />}
      <span>{displayLabel}</span>
    </span>
  );
}
