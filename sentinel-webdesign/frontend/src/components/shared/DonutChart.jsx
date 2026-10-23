/**
 * Canvas donut chart.
 */
import React, { useRef, useEffect } from 'react';
import './DonutChart.css';

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
    <div className="shr-donut" style={style}>
      <div className="shr-donut__plot" style={{ width: size, height: size }}>
        <canvas
          ref={canvasRef}
          className="shr-donut__canvas"
        />
      </div>

      {showLegend && (
        <div className="shr-donut__legend">
          {segments.map((seg, idx) => (
            <div key={idx} className="shr-donut__row">
              <span className="shr-donut__label">
                <span className="shr-donut__swatch" style={{ background: seg.color }} />
                {seg.label || seg.host || seg.status}
              </span>
              <strong className="shr-donut__value">
                {seg.percentage !== undefined ? `${seg.percentage}%` : seg.value}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
