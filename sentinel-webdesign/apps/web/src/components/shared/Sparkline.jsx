import React, { useMemo } from 'react';

/**
 * Sparkline Component
 * High-performance, lightweight SVG sparkline for dense NOC telemetry dashboards.
 */
export default function Sparkline({
  data = [],
  width = 90,
  height = 24,
  color = 'var(--primary, #14b8a6)',
  strokeWidth = 1.6,
  showArea = true,
  min: customMin = null,
  max: customMax = null,
  style = {}
}) {
  const pointsData = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const numericValues = data.map(d => {
      if (typeof d === 'number') return d;
      if (d && typeof d.value === 'number') return d.value;
      if (d && typeof d.v === 'number') return d.v;
      return parseFloat(d) || 0;
    });

    if (numericValues.length === 0) return null;

    const min = customMin !== null ? customMin : Math.min(...numericValues);
    const max = customMax !== null ? customMax : Math.max(...numericValues);
    const range = (max - min) === 0 ? 1 : (max - min);

    const padTop = 2;
    const padBottom = 2;
    const usableHeight = height - padTop - padBottom;

    const coords = numericValues.map((val, idx) => {
      const x = numericValues.length === 1 ? width / 2 : (idx / (numericValues.length - 1)) * width;
      const normalizedY = (val - min) / range;
      const y = height - padBottom - (normalizedY * usableHeight);
      return { x: parseFloat(x.toFixed(1)), y: parseFloat(y.toFixed(1)) };
    });

    const polylinePoints = coords.map(c => `${c.x},${c.y}`).join(' ');
    const areaPoints = `${coords[0].x},${height} ${polylinePoints} ${coords[coords.length - 1].x},${height}`;
    const lastPoint = coords[coords.length - 1];

    return {
      polylinePoints,
      areaPoints,
      lastPoint,
      min,
      max
    };
  }, [data, width, height, customMin, customMax]);

  if (!pointsData) {
    return (
      <svg width={width} height={height} style={{ opacity: 0.3, ...style }}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeDasharray="2,2" strokeWidth="1" />
      </svg>
    );
  }

  const gradientId = `spark-grad-${Math.random().toString(36).substring(2, 9)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible', verticalAlign: 'middle', ...style }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {showArea && (
        <polygon
          points={pointsData.areaPoints}
          fill={`url(#${gradientId})`}
        />
      )}

      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pointsData.polylinePoints}
      />

      {pointsData.lastPoint && (
        <circle
          cx={pointsData.lastPoint.x}
          cy={pointsData.lastPoint.y}
          r={2}
          fill={color}
        />
      )}
    </svg>
  );
}
