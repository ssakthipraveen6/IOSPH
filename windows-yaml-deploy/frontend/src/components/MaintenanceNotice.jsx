import React from 'react';

export function MaintenanceBanner({ message = "Under Maintenance — Production live telemetry data pipeline integration in progress." }) {
  return (
    <div className="maintenance-notice-banner" style={{
      background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.18), rgba(217, 119, 6, 0.25))',
      border: '1px solid rgba(245, 158, 11, 0.45)',
      color: '#fbbf24',
      padding: '0.6rem 1rem',
      borderRadius: '8px',
      fontSize: '0.82rem',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      marginBottom: '1rem',
      boxShadow: '0 2px 8px rgba(245, 158, 11, 0.15)'
    }}>
      <span style={{ fontSize: '1rem' }}>🛠️</span>
      <span style={{ flex: 1 }}>{message}</span>
      <span style={{
        fontSize: '0.7rem',
        background: 'rgba(245, 158, 11, 0.25)',
        border: '1px solid rgba(245, 158, 11, 0.5)',
        padding: '2px 8px',
        borderRadius: '12px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        Under Maintenance
      </span>
    </div>
  );
}

export function MaintenanceBadge({ text = "Under Maintenance" }) {
  return (
    <span className="maintenance-notice-badge" style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      background: 'rgba(245, 158, 11, 0.18)',
      color: '#fbbf24',
      border: '1px solid rgba(245, 158, 11, 0.4)',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '0.72rem',
      fontWeight: 700,
      marginLeft: '8px',
      letterSpacing: '0.3px'
    }} title="Under Maintenance — PROD data integration pending validation">
      🛠️ {text}
    </span>
  );
}
