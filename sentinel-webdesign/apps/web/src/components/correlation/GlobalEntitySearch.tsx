import React, { useState, useEffect, useRef } from 'react';
import { MASTER_ENTITY_CATALOG, Entity } from '../../data/correlationData';
import { SEVERITY, normalizeSeverity } from '@sentinel/shared-constants';

export interface GlobalEntitySearchProps {
  onSelectEntity: (entityId: string) => void;
}

export default function GlobalEntitySearch({ onSelectEntity }: GlobalEntitySearchProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const results: Entity[] = (MASTER_ENTITY_CATALOG as Entity[]).filter((e: Entity) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (e.name && e.name.toLowerCase().includes(q)) ||
      (e.hostOrIp && e.hostOrIp.toLowerCase().includes(q)) ||
      (e.id && e.id.toLowerCase().includes(q)) ||
      (e.owner && e.owner.toLowerCase().includes(q)) ||
      (e.type && e.type.toLowerCase().includes(q))
    );
  });

  return (
    <>
      {/* 1. Header Trigger Affordance (Sits alongside Quick Search) */}
      <div
        className="global-entity-search-trigger"
        onClick={() => setIsOpen(true)}
        title="Find Asset: Search by IP, hostname, VIP, app, or ticket ID"
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          background: 'rgba(20, 184, 166, 0.08)',
          border: '1px solid rgba(20, 184, 166, 0.3)',
          padding: '4px 10px',
          borderRadius: '6px',
          fontSize: '11px',
          color: 'var(--sentinel-teal, #14b8a6)',
          fontWeight: 600,
          transition: 'all 0.15s ease'
        }}
      >
        <span>🧭</span>
        <span>Find Asset</span>
        <kbd style={{
          background: 'rgba(20, 184, 166, 0.15)',
          border: '1px solid rgba(20, 184, 166, 0.3)',
          borderRadius: '3px',
          padding: '1px 5px',
          fontSize: '9px',
          fontFamily: 'var(--font-mono, monospace)',
          color: 'var(--sentinel-teal, #14b8a6)'
        }}>Resolver</kbd>
      </div>

      {/* 2. Global Entity Resolver Modal */}
      {isOpen && (
        <div
          className="entity-search-backdrop"
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '12vh',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          <div
            className="entity-search-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '92%',
              maxWidth: '680px',
              background: 'var(--bg-panel-solid, #0f172a)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7), 0 0 32px rgba(20, 184, 166, 0.2)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Input Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--border-light)',
              gap: '12px',
              background: 'var(--bg-panel-subtle)'
            }}>
              <span style={{ fontSize: '1.2rem', color: 'var(--sentinel-teal, #14b8a6)' }}>🧭</span>
              <input
                ref={inputRef}
                type="text"
                placeholder="Resolve asset by IP, Hostname, VIP, App name, or Ticket ID..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setIsOpen(false);
                }}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-main)',
                  fontSize: '0.95rem',
                  fontFamily: 'var(--font-sans)'
                }}
              />
              <kbd 
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '0.7rem',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                ESC
              </kbd>
            </div>

            {/* Entity Results List */}
            <div style={{ maxHeight: '380px', overflowY: 'auto', padding: '0.5rem' }}>
              <div style={{ padding: '6px 12px', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                MATCHED INFRASTRUCTURE &amp; APPLICATION ASSETS ({results.length})
              </div>

              {results.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  No entities matching "{query}". Try searching by IP (e.g. <code>10.240</code>) or asset name (e.g. <code>bitbucket</code>).
                </div>
              ) : (
                results.map((entity: Entity) => {
                  const normStatus = normalizeSeverity(entity.status);
                  const isCritical = normStatus === SEVERITY.CRITICAL;
                  const isWarning = normStatus === SEVERITY.WARNING || normStatus === SEVERITY.PREDICTIVE_WARNING;

                  return (
                    <div
                      key={entity.id}
                      onClick={() => {
                        onSelectEntity(entity.id);
                        setIsOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.03)'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(20, 184, 166, 0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '1.3rem' }}>{entity.icon}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)' }}>
                            {entity.name}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                            {entity.hostOrIp} · {entity.type}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          fontFamily: 'var(--font-mono)',
                          background: isCritical ? 'rgba(239, 68, 68, 0.2)' : isWarning ? 'rgba(245, 158, 11, 0.2)' : 'rgba(20, 184, 166, 0.2)',
                          color: isCritical ? '#ef4444' : isWarning ? '#f59e0b' : '#14b8a6'
                        }}>
                          {entity.status.toUpperCase()}
                        </span>

                        <span style={{ fontSize: '0.72rem', color: 'var(--sentinel-teal, #14b8a6)', fontWeight: 700 }}>
                          Resolve 360° ↗
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '0.65rem 1.25rem',
              background: 'var(--bg-panel-subtle)',
              borderTop: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.72rem',
              color: 'var(--text-muted)'
            }}>
              <span>Global Entity Resolver Layer</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>Press ESC to dismiss</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
