/**
 * Empty state shown when a view has no data, with the reason.
 */
import React from 'react';
import { DataUnavailableState } from './PrototypeNotice';

/**
 * EmptyState - Clean, enterprise empty state container.
 * Reuses PrototypeNotice when telemetry is unavailable or under migration.
 */
export default function EmptyState({
  title = 'No Data Available',
  description = 'There are no active records or signals reported for the current selection.',
  reason = null,
  environment = 'staging',
  action = null,
  icon = null,
  isPrototype = false,
  className = ''
}) {
  if (isPrototype) {
    return <DataUnavailableState environment={environment} reason={reason || description} title={title} />;
  }

  return (
    <div className={`empty-state ${className}`}>
      <div className="empty-state__icon-wrapper" aria-hidden="true">
        {icon || (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
          </svg>
        )}
      </div>
      <h4 className="empty-state__title">{title}</h4>
      <p className="empty-state__description">{description}</p>
      {reason && (
        <div className="empty-state__reason">
          <code>{reason}</code>
        </div>
      )}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
