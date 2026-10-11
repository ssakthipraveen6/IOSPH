import React from 'react';

export default function NodeHoneycombMesh({ nodes = [] }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(16, 1fr)',
      gap: '6px',
      marginTop: '10px'
    }}>
      {nodes.map(n => {
        let bg = 'var(--healthy-glass)';
        let border = 'var(--healthy)';
        let color = 'var(--healthy)';

        if (n.status === 'warning') {
          bg = 'var(--warning-glass)';
          border = 'var(--warning)';
          color = 'var(--warning)';
        } else if (n.status === 'critical') {
          bg = 'var(--critical-glass)';
          border = 'var(--critical)';
          color = 'var(--critical)';
        }

        return (
          <div
            key={n.id}
            title={`Node: ${n.id} • Status: ${n.status} • CPU: ${n.cpuLoad}% • RAM: ${n.memoryLoad}%`}
            style={{
              height: 32,
              borderRadius: 6,
              background: bg,
              border: `1px solid ${border}`,
              color: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'transform 0.15s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.12)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {n.id}
          </div>
        );
      })}
    </div>
  );
}
