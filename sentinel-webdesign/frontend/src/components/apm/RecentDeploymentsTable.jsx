import React from 'react';

export default function RecentDeploymentsTable({ deployments = [] }) {
  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid var(--border-light)' }}>Rev</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid var(--border-light)' }}>Deployer</th>
            <th style={{ textAlign: 'left', color: 'var(--text-subtle)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid var(--border-light)' }}>Description</th>
            <th style={{ textAlign: 'right', color: 'var(--text-subtle)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid var(--border-light)' }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((d, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <td style={{ padding: '8px 4px', fontFamily: 'var(--font-mono)', color: 'var(--primary)', fontWeight: 700 }}>{d.rev}</td>
              <td style={{ padding: '8px 4px', color: 'var(--text-main)' }}>{d.deployer}</td>
              <td style={{ padding: '8px 4px', color: 'var(--text-main)' }}>{d.description}</td>
              <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>{d.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
