import React, { useState, useRef } from 'react';

export default function CustomChart({ datasets = [], title = '', unit = '' }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);

  // Validate datasets
  const validDatasets = datasets.filter(d => d && d.points && d.points.length > 0);
  if (validDatasets.length === 0) {
    return (
      <div className="empty-chart">
        <p>No telemetry metrics available yet. Polling infrastructure...</p>
      </div>
    );
  }

  // Find max length of datasets points to index timestamps
  const referenceDataset = validDatasets[0];
  const totalTicks = referenceDataset.points.length;

  // Extract all values to calculate dynamic Y limits
  const allValues = [];
  validDatasets.forEach(d => {
    d.points.forEach(p => allValues.push(p.value));
  });

  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100;
  
  const minVal = Math.max(0, rawMin - 0.05 * (rawMax - rawMin));
  const maxVal = rawMax + 0.05 * (rawMax - rawMin) || 10;
  const valRange = maxVal - minVal || 1;

  // SVG dimensions
  const width = 800;
  const height = 300;
  const paddingLeft = 50;
  const paddingRight = 160; // Extra padding on right to render legends!
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Map each dataset to SVG path strings
  const renderedLines = validDatasets.map(d => {
    const coords = d.points.map((p, index) => {
      const x = paddingLeft + (index / (d.points.length - 1 || 1)) * chartWidth;
      const y = paddingTop + chartHeight - ((p.value - minVal) / valRange) * chartHeight;
      return { x, y, value: p.value, timestamp: p.timestamp };
    });

    let pathStr = '';
    if (coords.length > 0) {
      pathStr = `M ${coords[0].x} ${coords[0].y} ` + coords.slice(1).map(pt => `L ${pt.x} ${pt.y}`).join(' ');
    }

    return {
      label: d.label,
      color: d.color,
      coords,
      pathStr
    };
  });

  // Mouse interactivity
  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    // Scale to SVG viewport coordinates
    const svgX = (mouseX / rect.width) * width;
    
    if (svgX >= paddingLeft && svgX <= paddingLeft + chartWidth) {
      const fraction = (svgX - paddingLeft) / chartWidth;
      const closestIndex = Math.max(0, Math.min(totalTicks - 1, Math.round(fraction * (totalTicks - 1))));
      setHoverIndex(closestIndex);
    } else {
      setHoverIndex(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  // 4 Horizontal Gridlines
  const gridCount = 4;
  const yGridLines = Array.from({ length: gridCount }).map((_, i) => {
    const val = minVal + (i / (gridCount - 1)) * valRange;
    const y = paddingTop + chartHeight - (i / (gridCount - 1)) * chartHeight;
    return { val, y };
  });

  // Extract date labels
  const getTickTime = (index) => {
    if (index >= 0 && index < totalTicks) {
      const iso = referenceDataset.points[index].timestamp;
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return '';
  };

  // Get active values at hover index
  const hoverDetails = [];
  let hoverTime = '';
  let hoverXCoord = 0;

  if (hoverIndex !== null) {
    renderedLines.forEach(line => {
      const pt = line.coords[hoverIndex];
      if (pt) {
        hoverDetails.push({
          label: line.label,
          value: pt.value,
          color: line.color
        });
        hoverTime = new Date(pt.timestamp).toLocaleTimeString();
        hoverXCoord = pt.x;
      }
    });
  }

  return (
    <div className="custom-chart-wrapper">
      <div className="chart-header">
        <span className="chart-title">{title}</span>
      </div>
      
      <svg 
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`} 
        className="custom-chart-svg"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Draw Gridlines */}
        {yGridLines.map((line, idx) => (
          <g key={idx}>
            <line 
              x1={paddingLeft} 
              y1={line.y} 
              x2={paddingLeft + chartWidth} 
              y2={line.y} 
              className="chart-gridline"
            />
            <text 
              x={paddingLeft - 8} 
              y={line.y + 4} 
              textAnchor="end" 
              className="chart-axis-label"
            >
              {line.val.toFixed(0)}
            </text>
          </g>
        ))}

        {/* X Axis boundaries */}
        {totalTicks > 0 && (
          <>
            <text 
              x={paddingLeft} 
              y={height - 12} 
              textAnchor="start" 
              className="chart-axis-label"
            >
              {getTickTime(0)}
            </text>
            <text 
              x={paddingLeft + chartWidth} 
              y={height - 12} 
              textAnchor="end" 
              className="chart-axis-label"
            >
              {getTickTime(totalTicks - 1)}
            </text>
          </>
        )}

        {/* Draw Line paths */}
        {renderedLines.map((line, idx) => (
          line.pathStr && (
            <path 
              key={idx}
              d={line.pathStr} 
              fill="none" 
              stroke={line.color} 
              strokeWidth={2} 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className="chart-line"
            />
          )
        ))}

        {/* Render Legends on the right-hand panel */}
        <g transform={`translate(${paddingLeft + chartWidth + 20}, ${paddingTop})`}>
          {renderedLines.map((line, idx) => (
            <g key={idx} transform={`translate(0, ${idx * 20})`}>
              <rect x="0" y="2" width="12" height="12" fill={line.color} rx="2" />
              <text x="18" y="12" fill="#0f172a" fontSize="11" fontWeight="600" fontFamily="var(--font-sans)">
                {line.label}
              </text>
            </g>
          ))}
        </g>

        {/* Hover Highlight elements */}
        {hoverIndex !== null && hoverDetails.length > 0 && (
          <g>
            <line 
              x1={hoverXCoord} 
              y1={paddingTop} 
              x2={hoverXCoord} 
              y2={paddingTop + chartHeight} 
              stroke="#64748b" 
              strokeDasharray="3,3" 
              strokeWidth={1}
            />
            {renderedLines.map((line, idx) => {
              const pt = line.coords[hoverIndex];
              return pt ? (
                <circle 
                  key={idx}
                  cx={pt.x} 
                  cy={pt.y} 
                  r={4} 
                  fill={line.color} 
                  stroke="#ffffff" 
                  strokeWidth={1.5}
                />
              ) : null;
            })}

            {/* Hover Tooltip listing all app values */}
            <foreignObject 
              x={hoverXCoord > (paddingLeft + chartWidth / 2) ? hoverXCoord - 210 : hoverXCoord + 15} 
              y={paddingTop} 
              width={190} 
              height={180}
              style={{ overflow: 'visible', pointerEvents: 'none' }}
            >
              <div 
                className="chart-tooltip" 
                style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                  border: '1px solid #cbd5e1', 
                  borderRadius: '6px', 
                  padding: '10px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  color: '#0f172a',
                  fontFamily: 'var(--font-sans)'
                }}
              >
                <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0', paddingBottom: '3px', marginBottom: '6px' }}>
                  🕒 {hoverTime}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {hoverDetails.map((det, dIdx) => (
                    <div key={dIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: det.color, display: 'inline-block' }}></span>
                        {det.label}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {det.value.toFixed(1)} <span style={{ fontSize: '9px', fontWeight: 400, color: '#64748b' }}>{unit}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </foreignObject>
          </g>
        )}
      </svg>
    </div>
  );
}
