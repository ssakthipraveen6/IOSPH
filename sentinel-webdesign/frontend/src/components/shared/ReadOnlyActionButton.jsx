/**
 * Button that is disabled in read-only (demo) mode with an explanation.
 */
import React from 'react';
import './ReadOnlyActionButton.css';

export const READ_ONLY_ACTION_TITLE = 'Not available in demo';

/**
 * Stand-in for an action button (ack, snooze, resolve, export, AI summary...)
 * when a real screen is rendered read-only from sample data in the Demo view.
 * Always disabled; it never fires a request.
 */
export default function ReadOnlyActionButton({ children, className = 'time-picker__btn', style }) {
  return (
    <button
      type="button"
      className={`${className} shr-readonly-btn`}
      disabled
      title={READ_ONLY_ACTION_TITLE}
      style={style}
    >
      {children}
    </button>
  );
}
