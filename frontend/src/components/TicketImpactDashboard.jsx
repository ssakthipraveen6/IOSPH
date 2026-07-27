import React, { useEffect, useState } from 'react';

export default function TicketImpactDashboard() {
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedChange, setSelectedChange] = useState(null);

  useEffect(() => {
    fetch('/api/infra-tickets')
      .then(res => res.json())
      .then(data => {
        setChanges(data);
        setLoading(false);
        if (data && data.length > 0) {
          setSelectedChange(data[0]);
        }
      })
      .catch(e => {
        console.error('Failed loading ticket impact telemetry:', e);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="command-center-loading-card">
        <h3>Loading change & ticket analytics timeline...</h3>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Page Header */}
      <div className="section-header-group">
        <h3 className="section-subtitle">TICKET IMPACT CORRELATION</h3>
        <h2 className="section-title">1-Week Change & Incident Regression Timeline</h2>
        <p className="section-description">
          Cross-references infrastructure change requests (CHGs) with operational incident tickets (INCs) and problems (PRBs) raised 1 week before and 1 week after to analyze deployment safety and stability trends.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.2fr', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Left Side: Changes List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', tracking: '0.5px' }}>
            Infrastructure Changes
          </h4>
          
          {changes.map(chg => (
            <div 
              key={chg.id}
              onClick={() => setSelectedChange(chg)}
              className={`metrics-panel-card`}
              style={{
                cursor: 'pointer',
                borderColor: selectedChange?.id === chg.id ? 'var(--primary)' : 'var(--border-light)',
                background: selectedChange?.id === chg.id ? 'var(--primary-glow)' : 'var(--bg-panel)',
                padding: '1.25rem',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', fontSize: '0.8rem', color: 'var(--primary)' }}>
                  {chg.id}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {chg.date}
                </span>
              </div>
              <h4 style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-main)', marginBottom: '8px', lineHeight: '1.3' }}>
                {chg.title}
              </h4>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span className={`status-badge-inline`} style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                  {chg.component.toUpperCase()}
                </span>
                <span className={`status-badge-inline`} style={{ 
                  background: chg.risk === 'High' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  color: chg.risk === 'High' ? 'var(--critical)' : 'var(--warning)',
                  fontSize: '0.65rem'
                }}>
                  {chg.risk} Risk
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Right Side: Before / After Impact Panels */}
        {selectedChange ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Change Detail Card */}
            <div className="metrics-panel-card">
              <div className="panel-header">
                <h3>Change Record Specifications: {selectedChange.id}</h3>
                <span className="panel-badge-green">{selectedChange.status}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                <div>
                  <h5 style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target System</h5>
                  <p style={{ fontWeight: '700', fontSize: '0.85rem' }}>{selectedChange.component.toUpperCase()}</p>
                </div>
                <div>
                  <h5 style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Assigned Engineer</h5>
                  <p style={{ fontWeight: '700', fontSize: '0.85rem' }}>{selectedChange.engineer}</p>
                </div>
                <div>
                  <h5 style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Rollout Date</h5>
                  <p style={{ fontWeight: '700', fontSize: '0.85rem' }}>{selectedChange.date}</p>
                </div>
              </div>
              <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-light)', paddingTop: '0.75rem' }}>
                <h5 style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Deployment Log</h5>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-main)', lineHeight: '1.4' }}>{selectedChange.description}</p>
              </div>
            </div>

            {/* Before vs After Split Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              
              {/* Left Column: 1 Week Before */}
              <div className="metrics-panel-card" style={{ borderLeft: '4px solid var(--warning)' }}>
                <div className="panel-header">
                  <h3>⏮️ 1 Week BEFORE Change</h3>
                  <span className="pending-badge" style={{ margin: 0, padding: '2px 8px' }}>
                    {selectedChange.beforeTickets.length} Raised
                  </span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: '1rem' }}>
                  Issues or alerts raised leading up to this deployment window.
                </p>
                
                {selectedChange.beforeTickets.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {selectedChange.beforeTickets.map(t => (
                      <div 
                        key={t.id}
                        style={{
                          padding: '0.75rem',
                          background: 'var(--bg-dark)',
                          border: '1px solid var(--border-light)',
                          borderRadius: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', fontSize: '0.7rem', color: 'var(--warning)' }}>
                            {t.id}
                          </span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{t.date}</span>
                        </div>
                        <h5 style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-main)', marginBottom: '4px' }}>{t.title}</h5>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block' }}>Source: {t.source}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                    No alerts or incidents raised in the week before.
                  </p>
                )}
              </div>

              {/* Right Column: 1 Week After */}
              <div className="metrics-panel-card" style={{ borderLeft: '4px solid var(--healthy)' }}>
                <div className="panel-header">
                  <h3>⏭️ 1 Week AFTER Change</h3>
                  <span className="status-badge-inline healthy">
                    {selectedChange.afterTickets.length} Active
                  </span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: '1rem' }}>
                  Incidents or regressions logged following the change rollout.
                </p>

                {selectedChange.afterTickets.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {selectedChange.afterTickets.map(t => (
                      <div 
                        key={t.id}
                        style={{
                          padding: '0.75rem',
                          background: 'var(--bg-dark)',
                          border: '1px solid var(--border-light)',
                          borderRadius: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', fontSize: '0.7rem', color: 'var(--healthy)' }}>
                            {t.id}
                          </span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{t.date}</span>
                        </div>
                        <h5 style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-main)', marginBottom: '4px' }}>{t.title}</h5>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block' }}>Source: {t.source}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                    No incidents or regressions raised in the week following.
                  </p>
                )}
              </div>

            </div>

          </div>
        ) : (
          <div className="metrics-panel-card">
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '4rem 0' }}>
              Select a change record from the sidebar to inspect the before-and-after ticket timeline.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
