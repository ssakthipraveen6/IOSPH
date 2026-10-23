/**
 * Bar showing used / available capacity, utilisation and runway.
 */
import React from 'react';
import './CapacityBar.css';

/**
 * CapacityBar
 * Renders total / used / available capacity with utilization % and runway forecast badge.
 * Uses tokens from tokens.css; zero inline styles.
 */
export default function CapacityBar({
  label = 'Capacity',
  used = 0,
  total = 100,
  available = null,
  unit = '',
  daysToFull = null,
  className = ''
}) {
  const numTotal = Number(total);
  const numUsed = Number(used);
  const numAvail = available !== null && available !== undefined ? Number(available) : Math.max(0, numTotal - numUsed);
  const pct = numTotal > 0 ? Math.min(100, Math.max(0, (numUsed / numTotal) * 100)) : 0;
  const roundedPct = Number(pct.toFixed(1));

  let statusLevel = 'healthy';
  if (roundedPct >= 90) statusLevel = 'critical';
  else if (roundedPct >= 80) statusLevel = 'warning';

  let runwayBadgeClass = 'capacity-bar__runway--ok';
  if (daysToFull !== null && daysToFull !== undefined) {
    if (daysToFull < 7) runwayBadgeClass = 'capacity-bar__runway--critical';
    else if (daysToFull < 30) runwayBadgeClass = 'capacity-bar__runway--warning';
  }

  return (
    <div className={`capacity-bar ${className}`}>
      <div className="capacity-bar__header">
        <div className="capacity-bar__label-group">
          <span className="capacity-bar__label">{label}</span>
          {daysToFull !== null && daysToFull !== undefined && (
            <span className={`capacity-bar__runway ${runwayBadgeClass}`}>
              {daysToFull === 0 ? 'Full' : `Full in ${daysToFull}d`}
            </span>
          )}
        </div>
        <div className="capacity-bar__value-group">
          <span className="capacity-bar__pct">{roundedPct}%</span>
          <span className="capacity-bar__details">
            {numUsed} / {numTotal} {unit}
            {numAvail !== null && <span className="capacity-bar__avail"> ({numAvail} free)</span>}
          </span>
        </div>
      </div>

      <div className="capacity-bar__track">
        <div
          className={`capacity-bar__fill capacity-bar__fill--${statusLevel}`}
          data-pct={Math.round(roundedPct)}
        />
      </div>
    </div>
  );
}
