/**
 * Grid of status badges for a set of items.
 */
import React from 'react';
import StatusBadge from './StatusBadge';
import './StatusGrid.css';

/**
 * StatusGrid
 * Responsive multi-column grid of status cards for components, nodes, or checks.
 * Uses StatusBadge from @sentinel/shared-constants; zero inline styles.
 */
export default function StatusGrid({
  items = [],
  onItemClick = null,
  emptyMessage = 'No items available',
  className = ''
}) {
  if (!items || items.length === 0) {
    return (
      <div className={`status-grid status-grid--empty ${className}`}>
        <p className="status-grid__empty-text">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`status-grid ${className}`}>
      {items.map((item, idx) => {
        const itemId = item.id || `item-${idx}`;
        const isClickable = typeof onItemClick === 'function';

        return (
          <div
            key={itemId}
            className={`status-grid__card ${isClickable ? 'status-grid__card--clickable' : ''}`}
            onClick={() => isClickable && onItemClick(item)}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={(e) => {
              if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onItemClick(item);
              }
            }}
          >
            <div className="status-grid__card-header">
              <span className="status-grid__name" title={item.name || itemId}>
                {item.name || itemId}
              </span>
              <StatusBadge status={item.status || 'UNKNOWN'} size="sm" />
            </div>

            <div className="status-grid__card-body">
              {item.metricValue !== undefined && item.metricValue !== null && (
                <div className="status-grid__metric">
                  <span className="status-grid__metric-val">{item.metricValue}</span>
                  {item.metricUnit && (
                    <span className="status-grid__metric-unit">{item.metricUnit}</span>
                  )}
                </div>
              )}
              {item.secondaryText && (
                <div className="status-grid__secondary">{item.secondaryText}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
