import React from 'react';

export default function FlamegraphProfiler({ traceId = 'c92841ab7f004911', onProceedToSoD = null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Trace Sub-Header */}
      <div style={{
        background: 'var(--bg-glass-card)',
        backdropFilter: 'blur(var(--glass-blur))',
        border: '1px solid var(--border-light)',
        borderRadius: '12px',
        padding: '0.75rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: 'var(--glass-shadow)',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <strong>Trace ID:</strong> {traceId}
          </span>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <strong>Service:</strong> clearing-settlement-engine
          </span>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <strong>Operation:</strong> /v1/swift/iso20022/batch-ingest
          </span>
        </div>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--critical)', fontWeight: 800 }}>
          Total Span Duration: 5,002ms (SLA Violated by 4,920ms)
        </div>
      </div>

      {/* Flamegraph Spans Waterfall */}
      <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Distributed Trace Flamegraph &amp; Method Call Stack</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Click any span bar to inspect SQL query, locks, or pre-termination thread dump</div>
          </div>
          <span style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            Zoom: 100% | 14 Spans
          </span>
        </div>

        <div style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-light)', borderRadius: 8, padding: 14 }}>
          {/* Level 1: Ingress */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
            <div style={{ width: '100%', background: '#3b82f6', padding: '5px 10px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
              <span><strong>F5_VIP_Ingress:</strong> POST /v1/swift/iso20022/batch-ingest</span>
              <span>5,002ms (100%)</span>
            </div>
          </div>

          {/* Level 2: SpringBoot Engine */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
            <div style={{ width: '98%', marginLeft: '2%', background: '#14b8a6', padding: '5px 10px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
              <span><strong>clearing-settlement-engine:</strong> SpringBoot BatchIngestController.processBatch()</span>
              <span>4,910ms (98.1%)</span>
            </div>
          </div>

          {/* Level 3: XML Validation & DB Lock */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
            <div style={{ width: '15%', marginLeft: '2%', background: '#10b981', padding: '5px 10px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#fff' }}>
              <span>SchemaValidator.validateXml() [14ms]</span>
            </div>
            <div style={{ width: '80%', marginLeft: '2%', background: '#ef4444', padding: '5px 10px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#fff' }}>
              <span><strong>Oracle HikariCP:</strong> SELECT FOR UPDATE on LEDGER_TX_LOCK (BLOCKED) [4,880ms]</span>
            </div>
          </div>

          {/* Level 4: Underlying Lock Contention */}
          <div style={{ display: 'flex', gap: 3 }}>
            <div style={{ width: '78%', marginLeft: '19%', background: '#991b1b', padding: '5px 10px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#fff' }}>
              <span><strong>Oracle RAC Node 02:</strong> enq: TX - row lock contention on PK_LEDGER_TX [4,876ms]</span>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostic Metadata & AI RCA */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.25rem' }}>
        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 8 }}>Selected Span Diagnostic Metadata</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <tbody>
              <tr><td style={{ color: 'var(--text-subtle)', width: 140, padding: '6px 0' }}>Database:</td><td>Oracle 19c Enterprise RAC</td></tr>
              <tr><td style={{ color: 'var(--text-subtle)', padding: '6px 0' }}>SQL Statement:</td><td><code>SELECT * FROM CORE_LEDGER WHERE ACCT_ID = ? FOR UPDATE WAIT 5</code></td></tr>
              <tr><td style={{ color: 'var(--text-subtle)', padding: '6px 0' }}>Contention Event:</td><td style={{ color: 'var(--critical)', fontWeight: 700 }}>enq: TX - row lock contention (Blocking SID: 412)</td></tr>
              <tr><td style={{ color: 'var(--text-subtle)', padding: '6px 0' }}>Connection Pool:</td><td>HikariCP-Settlement-Pool (Active: 50/50 - SATURATED)</td></tr>
            </tbody>
          </table>
        </div>

        <div className="glass-card" style={{ background: 'var(--bg-glass-card)', padding: '1.25rem', borderRadius: 14, border: '1px solid var(--border-light)', backdropFilter: 'blur(var(--glass-blur))' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 8 }}>Automated AI Root Cause Analysis (RCA)</div>
          <div style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-main)' }}>
            <p><strong>Causality:</strong> Deadlock chain detected between concurrent batch settlement thread <code>Thread-84</code> and real-time reconciliation daemon <code>recon-svc-pod-2</code>.</p>
            <p style="margin-top: 8px; color: var(--text-muted);">
              <strong>Mitigation:</strong> Invoke circuit breaker runbook <code>RUNBOOK-ORACLE-TX-KILL-SID-412</code>. Segregation of Duties approval required prior to execution.
            </p>
            {onProceedToSoD && (
              <div style={{ marginTop: 14 }}>
                <button
                  onClick={onProceedToSoD}
                  style={{
                    background: 'linear-gradient(135deg, var(--healthy) 0%, #059669 100%)',
                    color: '#fff',
                    fontWeight: 800,
                    border: 'none',
                    padding: '8px 18px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    boxShadow: '0 2px 10px var(--healthy-glow)'
                  }}
                >
                  Proceed to SoD Approval Terminal &rarr;
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
