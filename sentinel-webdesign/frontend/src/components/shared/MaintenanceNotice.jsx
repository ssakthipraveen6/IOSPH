/**
 * Banner and badge shown on views under maintenance.
 */
import React from 'react';
import './MaintenanceNotice.css';

// Maintenance banner.
export function MaintenanceBanner({ message = "Under Maintenance — Production live telemetry data pipeline integration in progress." }) {
  return (
    <div className="maintenance-notice-banner shr-maint-banner">
      <span className="shr-maint-banner__icon">🛠️</span>
      <span className="shr-maint-banner__message">{message}</span>
      <span className="shr-maint-banner__tag">
        Under Maintenance
      </span>
    </div>
  );
}

// Maintenance badge.
export function MaintenanceBadge({ text = "Under Maintenance" }) {
  return (
    <span className="maintenance-notice-badge shr-maint-badge" title="Under Maintenance — PROD data integration pending validation">
      🛠️ {text}
    </span>
  );
}
