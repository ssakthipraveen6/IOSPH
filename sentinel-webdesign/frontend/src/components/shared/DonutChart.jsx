import React, { useRef, useEffect } from 'react';

/**
 * DonutChart Component
 * Renders an interactive donut chart with canvas arc rendering and legend track.
 */
export default function DonutChart({
  segments = [], // Array of { label: string, value: number, percentage?: number, color: string }
  size = 140,
  innerRadius = 36,
  showLegend = true,
  style = {}
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.42;
    const hole = innerRadius;

    const total = segments.reduce((sum, s) => sum + (s.percentage || s.value || 0), 0) || 1;
    let startAngle = -Math.PI / 2;

    segments.forEach(seg => {
      const val = seg.percentage || seg.value || 0;
      const slice = (val / total) * (2 * Math.PI);

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
      ctx.arc(cx, cy, hole, startAngle + slice, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = seg.color || '#14b8a6';
      ctx.fill();

      startAngle += slice;
    });
  }, [segments, size, innerRadius]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', ...style }}>
      <div style={{ width: size, height: size, flexShrink: 0, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size, display: 'block' }}
        />
      </div>

      {showLegend && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
          {segments.map((seg, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, marginRight: 6, display: 'inline-block' }} />
                {seg.label || seg.host || seg.status}
              </span>
              <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                {seg.percentage !== undefined ? `${seg.percentage}%` : seg.value}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
