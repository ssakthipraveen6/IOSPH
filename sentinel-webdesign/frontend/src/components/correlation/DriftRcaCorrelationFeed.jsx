/**
 * Feed of configuration-drift events correlated with RCA (currently shows an empty state).
 */
import React from 'react';
import './DriftRcaCorrelationFeed.css';

// Drift correlation feed component.
export default function DriftRcaCorrelationFeed({ onSelectEntity, onNavigateToTimeline, environment = 'staging' }) {
  return (
    <div className="drift-rca-correlation-feed drf-root">
      <div className="drf-empty">
        <div className="drf-empty-icon">⚖️</div>
        <div className="drf-empty-title">Value Not Available</div>
        <div className="drf-empty-note">
          Config-Drift-to-RCA Causality telemetry is not collected yet for {environment ? environment.toUpperCase() : 'this environment'}.
        </div>
      </div>
    </div>
  );
}
