import React, { useState, useEffect } from 'react';

export default function SodGovernanceBanner() {
  const [data, setData] = useState({
    pendingActions: [
      {
        id: 'ACT-0849201',
        action: 'ORACLE_KILL_BLOCKING_SESSION(SID: 412)',
        target: 'oracle-rac-cluster-02 (Node 02)',
        incidentId: 'INC0849201',
        primarySigner: 'praveen.s (SRE Lead)',
        primarySignedAt: '14:40:12 UTC',
        status: 'PENDING_CO_SIGN'
      }
    ],
    itsmSync: [
      { ticketId: 'INC0849201', priority: 'P1-CRITICAL', ciComponent: 'clearing-settlement-engine', status: 'Investigating' },
      { ticketId: 'INC0849188', priority: 'P2-HIGH', ciComponent: 'oracle-rac-cluster-02', status: 'Remediated' }
    ],
    auditTrail: [
      { timestamp: '14:48:12 UTC', event: 'SESSION_TOKEN_MINTED', details: 'Minted via CyberArk Vault CCP', hash: '8f4a2c1b9e01...', operator: 'praveen.s' },
      { timestamp: '14:42:45 UTC', event: 'CIRCUIT_BREAKER_TRIPPED', details: 'Oracle HikariCP max errors exceeded', hash: 'd32b918f02ac...', operator: 'sentinel-daemon' }
    ]
  });

  const [signed, setSigned] = useState(false);

  useEffect(() => {
    fetch('/api/governance/sod-audit')
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (res) setData(prev => ({ ...prev, ...res }));
      })
      .catch(() => {});
  }, []);

  const handleCoSign = () => {
    setSigned(true);
    alert('Secondary signature confirmed! Dual-approval requirement fulfilled. Runbook executed with immutable SHA-256 audit hash.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* SoD Approval Strip */}
      <div style={{
        background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.15) 0%, rgba(245, 158, 11, 0.08) 100%)',
        border: '1px solid rgba(239, 68, 68, 0.4)',
        borderRadius: 12,
        padding: '1rem 1.4rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem',
        boxShadow: '0 4px 20px rgba(239, 68, 68, 0.1)'
      }}>
        <div>
          <strong style={{ color: 'var(--critical)', fontSize: '0.95rem' }}>CRITICAL REMEDIATION PENDING DUAL APPROVAL</strong>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3 }}>
            Action: <code>ORACLE_KILL_BLOCKING_SESSION(SID: 412)</code> • Target: Oracle RAC Node 02 • Origin: INC0849201
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Primary Signer: <strong>praveen.s (SRE Lead)</strong> [Signed]
          </span>
          <button
            onClick={handleCoSign}
            disabled={signed}
            style={{
              background: signed ? 'var(--healthy)' : 'linear-gradient(135deg, var(--healthy) 0%, #059669 100%)',
              color: '#fff',
              fontWeight: 800,
              border: 'none',
              padding: '8px 18px',
              borderRadius: 6,
              cursor: signed ? 'default' : 'pointer',
              boxShadow: '0 2px 10px var(--healthy-glow)'
            }}
          >
            {signed ? 'Co-Signed & Executed ✔' : 'Co-Sign & Execute Action'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.25rem' }}>
        {/* ServiceNow Sync Table */}
        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>ServiceNow CMDB &amp; Incident Sync</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Bidirectional sync</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: 'var(--text-subtle)', paddingBottom: 8, borderBottom: '1px solid var(--border-light)', fontSize: '0.7rem' }}>Ticket ID</th>
                <th style={{ textAlign: 'left', color: 'var(--text-subtle)', paddingBottom: 8, borderBottom: '1px solid var(--border-light)', fontSize: '0.7rem' }}>Priority</th>
                <th style={{ textAlign: 'left', color: 'var(--text-subtle)', paddingBottom: 8, borderBottom: '1px solid var(--border-light)', fontSize: '0.7rem' }}>CI Component</th>
                <th style={{ textAlign: 'left', color: 'var(--text-subtle)', paddingBottom: 8, borderBottom: '1px solid var(--border-light)', fontSize: '0.7rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.itsmSync.map((t, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <td style={{ padding: '8px 4px', color: 'var(--primary)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{t.ticketId}</td>
                  <td style={{ padding: '8px 4px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      background: t.priority.includes('P1') ? 'var(--critical-glass)' : 'var(--warning-glass)',
                      color: t.priority.includes('P1') ? 'var(--critical)' : 'var(--warning)',
                      border: `1px solid ${t.priority.includes('P1') ? 'var(--critical)' : 'var(--warning)'}`
                    }}>
                      {t.priority}
                    </span>
                  </td>
                  <td style={{ padding: '8px 4px', color: 'var(--text-main)' }}>{t.ciComponent}</td>
                  <td style={{ padding: '8px 4px', color: t.status === 'Remediated' ? 'var(--healthy)' : 'var(--warning)', fontWeight: 600 }}>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Immutable Audit Trail */}
        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Immutable Audit Trail (Append-Only WAL)</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SHA-256 cryptographic logging</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {data.auditTrail.map((a, idx) => (
              <div key={idx} style={{ background: 'var(--bg-panel-subtle)', padding: 8, borderRadius: 6, borderLeft: '3px solid var(--healthy)' }}>
                <div style={{ color: 'var(--text-main)' }}>[{a.timestamp}] <strong>{a.event}</strong></div>
                <div style={{ color: 'var(--text-subtle)', fontSize: 10, marginTop: 2 }}>
                  Hash: {a.hash} • Operator: {a.operator}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
