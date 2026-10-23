/**
 * Table of recent edge log lines; a row can open its trace.
 */
import React from 'react';
import './EdgePerimeterView.css';

// Edge log table component.
export default function LiveLogsStreamTable({ logs = [], onSelectTrace = null }) {
  return (
    <div className="edge-table-wrap">
      <table className="edge-table">
        <thead>
          <tr>
            <th className="edge-th">Timestamp (UTC)</th>
            <th className="edge-th">Host</th>
            <th className="edge-th">URI Path</th>
            <th className="edge-th">Status</th>
            <th className="edge-th">Bytes</th>
            <th className="edge-th">Duration</th>
            <th className="edge-th">Trace ID</th>
            <th className="edge-th">TLS / Edge VIP</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 && (
            <tr>
              <td colSpan={8} className="llog-empty">No edge requests reported</td>
            </tr>
          )}
          {logs.map((log, idx) => {
            let tone = 'healthy';

            if (log.status >= 500) {
              tone = 'critical';
            } else if (log.status >= 400) {
              tone = 'warning';
            }

            return (
              <tr key={idx} className="edge-tr">
                <td className="llog-td edge-c-subtle">{log.timestamp}</td>
                <td className="llog-td edge-c-main">{log.host}</td>
                <td className="llog-td edge-c-main"><code>{log.uri}</code></td>
                <td className="llog-td">
                  <span className={`edge-badge llog-badge edge-badge--${tone}`}>
                    {log.statusLabel || log.status}
                  </span>
                </td>
                <td className="llog-td edge-c-muted">{typeof log.bytes === 'number' ? log.bytes.toLocaleString() : '—'}</td>
                <td className={`llog-td edge-td--bold ${log.durationMs > 1000 ? 'edge-c-critical' : 'edge-c-healthy'}`}>
                  {log.durationMs}ms
                </td>
                <td className={`llog-td llog-trace${onSelectTrace ? ' llog-trace--clickable' : ''}`} onClick={() => onSelectTrace && onSelectTrace(log.traceId)}>
                  {log.traceId}
                </td>
                <td className="llog-td edge-c-muted">{log.tlsVip}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
