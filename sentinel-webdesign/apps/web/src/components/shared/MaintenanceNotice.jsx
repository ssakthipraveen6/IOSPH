import React from 'react';

export function MaintenanceBanner({ message = "Under Maintenance — Production live telemetry data pipeline integration in progress." }) {
  return (
    <div className="maintenance-notice-banner" style={{
      background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.18), rgba(217, 119, 6, 0.25))',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(245, 158, 11, 0.45)',
      color: '#fbbf24',
      padding: '0.65rem 1.25rem',
      borderRadius: '10px',
      fontSize: '0.82rem',
      fontWeight: 700,
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      marginBottom: '1.25rem',
      boxShadow: '0 4px 16px rgba(245, 158, 11, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
    }}>
      <span style={{ fontSize: '1.1rem' }}>🛠️</span>
      <span style={{ flex: 1 }}>{message}</span>
      <span style={{
        fontSize: '0.7rem',
        background: 'rgba(245, 158, 11, 0.3)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(245, 158, 11, 0.6)',
        padding: '2px 10px',
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
      background: 'rgba(245, 158, 11, 0.2)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      color: '#fbbf24',
      border: '1px solid rgba(245, 158, 11, 0.45)',
      padding: '2px 10px',
      borderRadius: '12px',
      fontSize: '0.72rem',
      fontWeight: 800,
      marginLeft: '8px',
      letterSpacing: '0.3px',
      boxShadow: '0 2px 8px rgba(245, 158, 11, 0.15)'
    }} title="Under Maintenance — PROD data integration pending validation">
      🛠️ {text}
    </span>
  );
}
