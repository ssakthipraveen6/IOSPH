import React from 'react';

export default function LiveLogsStreamTable({ logs = [], onSelectTrace = null }) {
  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Timestamp (UTC)</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Host</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: '0.68rem', textTransform: 'uppercase' }}>URI Path</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Status</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Bytes</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Duration</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Trace ID</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: '0.68rem', textTransform: 'uppercase' }}>TLS / Edge VIP</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, idx) => {
            let badgeBg = 'var(--healthy-glass)';
            let badgeColor = 'var(--healthy)';
            let badgeBorder = 'var(--healthy)';

            if (log.status >= 500) {
              badgeBg = 'var(--critical-glass)';
              badgeColor = 'var(--critical)';
              badgeBorder = 'var(--critical)';
            } else if (log.status >= 400) {
              badgeBg = 'var(--warning-glass)';
              badgeColor = 'var(--warning)';
              badgeBorder = 'var(--warning)';
            }

            return (
              <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                <td style={{ padding: '7px 10px', color: 'var(--text-subtle)' }}>{log.timestamp}</td>
                <td style={{ padding: '7px 10px', color: 'var(--text-main)' }}>{log.host}</td>
                <td style={{ padding: '7px 10px', color: 'var(--text-main)' }}><code>{log.uri}</code></td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 7px',
                    borderRadius: 4,
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    background: badgeBg,
                    color: badgeColor,
                    border: `1px solid ${badgeBorder}`
                  }}>
                    {log.statusLabel || log.status}
                  </span>
                </td>
                <td style={{ padding: '7px 10px', color: 'var(--text-muted)' }}>{log.bytes.toLocaleString()}</td>
                <td style={{
                  padding: '7px 10px',
                  fontWeight: 700,
                  color: log.durationMs > 1000 ? 'var(--critical)' : 'var(--healthy)'
                }}>
                  {log.durationMs}ms
                </td>
                <td style={{ padding: '7px 10px', color: 'var(--primary)', cursor: onSelectTrace ? 'pointer' : 'default' }} onClick={() => onSelectTrace && onSelectTrace(log.traceId)}>
                  {log.traceId}
                </td>
                <td style={{ padding: '7px 10px', color: 'var(--text-muted)' }}>{log.tlsVip}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
