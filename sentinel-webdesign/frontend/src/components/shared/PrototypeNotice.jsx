/**
 * Shared loading, data-unavailable and prototype states.
 */
import React from 'react';
import './PrototypeNotice.css';

/**
 * Shared states for prototype views and any view that can lack real data.
 *
 * Project rule: never fabricate in prod or staging. Only the `demo`
 * environment may show sample data; everywhere else a view shows real
 * values or this explicit "Data not available" state.
 */

export function envLabel(environment) {
  return String(environment || 'unknown').toUpperCase();
}

// Data-unavailable message with the reason and environment.
export function DataUnavailableState({ environment, reason, title, compact = false }) {
  return (
    <div
      role="status"
      className={`shr-unavailable${compact ? ' shr-unavailable--compact' : ''}`}
    >
      <div className="shr-unavailable__title">
        {title || `Data not available in ${envLabel(environment)}`}
      </div>
      {reason && (
        <div className="shr-unavailable__reason">
          {reason}
        </div>
      )}
    </div>
  );
}

// Loading message.
export function LoadingState({ label = 'Loading…' }) {
  return (
    <div role="status" className="shr-loading">
      {label}
    </div>
  );
}

// Banner marking a prototype view.
export function PrototypeBanner({ environment, note }) {
  return (
    <div
      role="note"
      className="shr-proto-banner"
    >
      <span>Prototype · sample data</span>
      <span className="shr-proto-banner__note">
        {note || `Values on this screen are illustrative samples for ${envLabel(environment)}, not live telemetry.`}
      </span>
    </div>
  );
}
