/**
 * Timeline of correlated events (alerts, changes, deployments) across entities.
 */
import React, { useState } from 'react';
import RcaDashboard from '../analytics/RcaDashboard';
import { SEVERITY, normalizeSeverity } from '@sentinel/shared-constants';
import { READ_ONLY_ACTION_TITLE } from '../shared/ReadOnlyActionButton';
import './UnifiedCorrelationTimeline.css';

// Correlation timeline component.
export default function UnifiedCorrelationTimeline({ 
  onInspectEntity, 
  focusedEventId = null,
  environment = 'staging',
  initialSubTab = 'timeline',
  demoData = null,
  readOnly = false
}) {
  const [activeTimelineTab, setActiveTimelineTab] = useState(initialSubTab);
  const [selectedRange, setSelectedRange] = useState('6h'); // '1h' | '6h' | '24h' | '7d'
  const [selectedTrack, setSelectedTrack] = useState('all');
  const [activeEvent, setActiveEvent] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const tracks = [
    { id: 'all', name: 'All 12 Swim-Lanes', icon: '🌐' },
    { id: 'app_metrics', name: 'App Metric Anomalies', icon: '🚨' },
    { id: 'infra_metrics', name: 'Infra Metric Anomalies', icon: '⚙️' },
    { id: 'avi_lb', name: 'AVI / VIP Pool Flips', icon: '⚖️' },
    { id: 'dns_gslb', name: 'DNS & GSLB Routing', icon: '📡' },
    { id: 'firewall', name: 'Firewall & Security Rules', icon: '🛡️' },
    { id: 'drift', name: 'Config Drift (IaC vs Live)', icon: '⚖️' },
    { id: 'deploy', name: 'Deployments & GitOps', icon: '🚀' },
    { id: 'chg', name: 'ServiceNow CHG Tickets', icon: '🎫' },
    { id: 'certificates', name: 'Certificates & Expiry', icon: '🔒' },
    { id: 'incidents', name: 'Incident Open / Close', icon: '⚠️' }
  ];

  const isProdOrStg = environment === 'prod' || environment === 'staging';

  // Live timeline events are not collected yet; the Demo view supplies a sample set.
  const sourceEvents = demoData && Array.isArray(demoData.events) ? demoData.events : [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredEvents = sourceEvents.filter(evt => {
    if (selectedTrack !== 'all' && evt.trackId !== selectedTrack) return false;
    if (!normalizedQuery) return true;
    return [evt.title, evt.summary, evt.entityName, evt.entityId, evt.badge]
      .some(v => typeof v === 'string' && v.toLowerCase().includes(normalizedQuery));
  });

  const currentActiveEvent = (activeEvent && filteredEvents.some(e => e.id === activeEvent.id))
    ? activeEvent
    : (filteredEvents[0] || null);

  return (
    <div className="unified-correlation-timeline uct-root">

      {/* 0. Streamlined Mode Switcher: Timeline vs RCA Failure Propagation */}
      <div className="uct-mode-bar">
        <div className="uct-mode-title-row">
          <span className="uct-icon">⏱️</span>
          <div>
            <h2 className="uct-mode-title">
              Correlation &amp; Root Cause Analytics Engine
            </h2>
            <div className="uct-mode-subtitle">
              Cross-Layer Chronological Causality, Config Drift &amp; AI Anomaly Failure Propagation
            </div>
          </div>
        </div>

        <div className="uct-mode-tabs">
          {[
            { id: 'timeline', label: 'Multi-Track Correlation Timeline', icon: '⏱️' },
            { id: 'rca', label: 'Root Cause Analytics (RCA) Graph', icon: '🧠' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTimelineTab(tab.id)}
              disabled={readOnly && tab.id === 'rca'}
              title={readOnly && tab.id === 'rca' ? READ_ONLY_ACTION_TITLE : undefined}
              className={`uct-mode-tab${activeTimelineTab === tab.id ? ' uct-mode-tab--active' : ''}`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mode B: Root Cause Analytics Failure Propagation */}
      {activeTimelineTab === 'rca' && !readOnly && (
        <RcaDashboard
          environment={environment}
          onInspectEntity={onInspectEntity}
          onNavigateToTimeline={() => setActiveTimelineTab('timeline')}
        />
      )}

      {/* Mode A: Chronological Multi-Track Timeline */}
      {activeTimelineTab === 'timeline' && (
        <>
      <div className="uct-header">
        <div>
          <div className="uct-title-row">
            <span className="uct-icon">⏱️</span>
            <h2 className="uct-title">
              Unified Cross-Layer Correlation Timeline
            </h2>
            <span className="uct-axis-badge">
              SINGLE SHARED TIME-AXIS
            </span>
          </div>
          <p className="uct-description">
            Chronological multi-track causality engine aligning application anomalies, infra saturation, network path flips, config drift, and deployments on one synchronized time axis.
          </p>
        </div>

        {/* Search & Time Window Range Buttons */}
        <div className="uct-controls">
          <input
            type="text"
            placeholder="Filter events, assets, tickets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="uct-search"
          />

          <div className="uct-ranges">
            {[
              { id: '1h', label: '1 Hour' },
              { id: '6h', label: '6 Hours' },
              { id: '24h', label: '24 Hours' },
              { id: '7d', label: '7 Days' }
            ].map(range => (
              <button
                key={range.id}
                onClick={() => setSelectedRange(range.id)}
                className={`uct-range-btn${selectedRange === range.id ? ' uct-range-btn--active' : ''}`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Swim-Lane Track Filter Pills */}
      <div className="uct-tracks">
        {tracks.map(t => (
          <button
            key={t.id}
            onClick={() => setSelectedTrack(t.id)}
            className={`uct-track-pill${selectedTrack === t.id ? ' uct-track-pill--active' : ''}`}
          >
            <span>{t.icon}</span>
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      {/* 3. Main Split View: Timeline Stream on Left, Event Causality Detail on Right */}
      <div className="uct-split">

        {/* Left Column: Chronological Multi-Track Timeline Stream */}
        <div className="uct-panel">
          <div className="uct-stream-head">
            <div className="uct-stream-title">
              Chronological Event Sequence ({filteredEvents.length} Events Detected)
            </div>
            <span className="uct-stream-range">
              Range: {selectedRange.toUpperCase()} · Live Synced
            </span>
          </div>

          <div className="uct-stream-list">
            {filteredEvents.length === 0 ? (
              <div className="uct-stream-empty">
                <div className="uct-empty-icon">⏱️</div>
                <div className="uct-empty-title">Value Not Available</div>
                <div className="uct-empty-note">
                  {isProdOrStg
                    ? `Correlation & RCA timeline telemetry is not being collected yet for ${environment ? environment.toUpperCase() : 'this environment'}.`
                    : `No timeline events found for ${environment ? environment.toUpperCase() : 'this environment'}.`}
                </div>
              </div>
            ) : (
              filteredEvents.map(evt => {
                const isSelected = currentActiveEvent && currentActiveEvent.id === evt.id;
                const normSev = normalizeSeverity(evt.severity);
                const isCritical = normSev === SEVERITY.CRITICAL;
                const isWarning = normSev === SEVERITY.WARNING || normSev === SEVERITY.PREDICTIVE_WARNING;

                return (
                  <div
                    key={evt.id}
                    onClick={() => setActiveEvent(evt)}
                    className={`uct-event${isSelected ? ' uct-event--selected' : (isCritical ? ' uct-event--critical' : '')}`}
                  >
                    <div className="uct-event-head">
                      <div className="uct-event-tags">
                        <span className="uct-event-icon">{evt.icon}</span>
                        <span className={`uct-sev-badge${isCritical ? ' uct-sev-badge--critical' : (isWarning ? ' uct-sev-badge--warning' : '')}`}>
                          {evt.badge}
                        </span>
                        <span className="uct-track-name">{evt.trackName}</span>
                      </div>

                      <span className="uct-dim-mono">
                        {evt.relativeTime}
                      </span>
                    </div>

                    <div className="uct-event-title">
                      {evt.title}
                    </div>

                    <div className="uct-event-summary">
                      {evt.summary}
                    </div>

                    <div className="uct-event-foot">
                      <span>Asset: <strong className="uct-text-main">{evt.entityName}</strong> ({evt.entityType})</span>
                      <span className="uct-inspect-hint">Click to Inspect Causality →</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Deep Event Causality & Context Detail */}
        {currentActiveEvent ? (
          <div className="uct-panel uct-inspector">
            <div className="uct-inspector-head">
              <div>
                <div className="uct-inspector-label">
                  CORRELATION EVENT INSPECTOR
                </div>
                <div className="uct-inspector-title">
                  {currentActiveEvent.title}
                </div>
              </div>
              <span className="uct-timestamp">
                {currentActiveEvent.timestamp}
              </span>
            </div>

            {/* Target Asset Identity Card */}
            <div className="uct-asset-card">
              <div>
                <div className="uct-asset-label">Target Entity / Resource:</div>
                <div className="uct-asset-name">
                  {currentActiveEvent.entityName}
                </div>
                <div className="uct-dim-mono">
                  Type: {currentActiveEvent.entityType} · ID: {currentActiveEvent.entityId}
                </div>
              </div>

              {onInspectEntity && (
                <button
                  onClick={() => onInspectEntity(currentActiveEvent.entityId)}
                  className="uct-open-entity-btn"
                >
                  🔍 Open in Entity Panel ↗
                </button>
              )}
            </div>

            {/* Technical Payload / Diff Viewer */}
            {currentActiveEvent.details && (
              <div className="uct-payload">
                <div className="uct-payload-title">
                  // Event Technical Payload & Telemetry Context
                </div>
                {Object.entries(currentActiveEvent.details).map(([k, v]) => (
                  <div key={k} className="uct-payload-row">
                    <span className="uct-payload-key">{k}: </span>
                    <span className={k === 'diff' ? 'uct-payload-value uct-payload-value--diff' : 'uct-payload-value'}>
                      {typeof v === 'string' && v.includes('\n') ? <pre className="uct-payload-pre">{v}</pre> : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Causal Chain Links */}
            <div className="uct-chain">
              <div className="uct-chain-title">
                🔗 Correlated Predecessors &amp; Blast Chain
              </div>
              <div className="uct-chain-list">
                <div className="uct-chain-row">
                  <span className="uct-chain-preceding">▲ Preceding:</span>
                  <span>Config Drift event occurred 33 min prior on the same node pool</span>
                </div>
                <div className="uct-chain-row">
                  <span className="uct-chain-consequent">▼ Consequent:</span>
                  <span>Triggered P1 Incident INC0091823 affecting 1,850 developers</span>
                </div>
              </div>
            </div>

          </div>
        ) : (
          <div className="uct-inspector-empty">
            <div className="uct-empty-icon">🔍</div>
            <div className="uct-empty-title">Value Not Available</div>
            <div className="uct-empty-note">
              {isProdOrStg
                ? `Correlation event inspection is not being collected yet for ${environment ? environment.toUpperCase() : 'this environment'}.`
                : 'No event available for inspection in this environment.'}
            </div>
          </div>
        )}

      </div>
      </>
      )}

    </div>
  );
}
