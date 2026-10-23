/**
 * Global search box (Ctrl+K) to find hosts, applications and services.
 */
import React, { useState, useEffect, useRef } from 'react';
import { SEVERITY, normalizeSeverity } from '@sentinel/shared-constants';
import './GlobalEntitySearch.css';

// Search component; opens a results list and selects an entity.
export default function GlobalEntitySearch({ onSelectEntity, environment = 'staging' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const results = [];

  return (
    <>
      {/* 1. Header Trigger Affordance (Sits alongside ⌘K Quick Search) */}
      <div
        className="global-entity-search-trigger gsearch-trigger"
        onClick={() => setIsOpen(true)}
        title="Find Asset: Search by IP, hostname, VIP, app, or ticket ID"
      >
        <span>🧭</span>
        <span>Find Asset</span>
        <kbd className="gsearch-trigger-kbd">Resolver</kbd>
      </div>

      {/* 2. Global Entity Resolver Modal */}
      {isOpen && (
        <div
          className="entity-search-backdrop gsearch-backdrop"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="entity-search-modal gsearch-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input Bar */}
            <div className="gsearch-input-bar">
              <span className="gsearch-input-icon">🧭</span>
              <input
                ref={inputRef}
                type="text"
                placeholder="Resolve asset by IP, Hostname, VIP, App name, or Ticket ID..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setIsOpen(false);
                }}
                className="gsearch-input"
              />
              <kbd 
                onClick={() => setIsOpen(false)}
                className="gsearch-esc"
              >
                ESC
              </kbd>
            </div>

            {/* Entity Results List */}
            <div className="gsearch-results">
              <div className="gsearch-results-label">
                MATCHED INFRASTRUCTURE &amp; APPLICATION ASSETS ({results.length})
              </div>

              {results.length === 0 ? (
                <div className="gsearch-empty">
                  No entities matching "{query}". Try searching by IP (e.g. <code>10.240</code>) or asset name (e.g. <code>bitbucket</code>).
                </div>
              ) : (
                results.map(entity => {
                  const normStatus = normalizeSeverity(entity.status);
                  const isCritical = normStatus === SEVERITY.CRITICAL;
                  const isWarning = normStatus === SEVERITY.WARNING || normStatus === SEVERITY.PREDICTIVE_WARNING;
                  const statusTone = isCritical ? ' gsearch-status--critical' : isWarning ? ' gsearch-status--warning' : '';

                  return (
                    <div
                      key={entity.id}
                      onClick={() => {
                        onSelectEntity(entity.id);
                        setIsOpen(false);
                      }}
                      className="gsearch-row"
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(20, 184, 166, 0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div className="gsearch-row-main">
                        <span className="gsearch-row-icon">{entity.icon}</span>
                        <div>
                          <div className="gsearch-row-name">
                            {entity.name}
                          </div>
                          <div className="gsearch-row-meta">
                            {entity.hostOrIp} · {entity.type}
                          </div>
                        </div>
                      </div>

                      <div className="gsearch-row-side">
                        <span className={`gsearch-status${statusTone}`}>
                          {entity.status.toUpperCase()}
                        </span>

                        <span className="gsearch-resolve">
                          Resolve 360° ↗
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="gsearch-footer">
              <span>Global Entity Resolver Layer</span>
              <span className="gsearch-mono">Press ESC to dismiss</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
