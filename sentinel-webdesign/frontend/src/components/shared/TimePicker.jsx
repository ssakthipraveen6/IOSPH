/**
 * Time range picker (15m, 1h, 6h, 24h ...).
 */
import React from 'react';

const PRESET_RANGES = [
  { id: '15m', label: '15m', durationMs: 15 * 60 * 1000 },
  { id: '1h', label: '1h', durationMs: 60 * 60 * 1000 },
  { id: '6h', label: '6h', durationMs: 6 * 60 * 60 * 1000 },
  { id: '24h', label: '24h', durationMs: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30d', durationMs: 30 * 24 * 60 * 60 * 1000 }
];

/**
 * TimePicker - Enterprise time scrubbing selector for observability queries.
 */
export default function TimePicker({
  selectedRange = '24h',
  onRangeChange,
  className = ''
}) {
  const handleSelect = (rangeId) => {
    const preset = PRESET_RANGES.find(r => r.id === rangeId);
    if (!preset) return;

    const to = new Date().toISOString();
    const from = new Date(Date.now() - preset.durationMs).toISOString();

    if (onRangeChange) {
      onRangeChange({ rangeId, from, to });
    }
  };

  return (
    <div className={`time-picker ${className}`} role="group" aria-label="Time range selector">
      <span className="time-picker__icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      </span>
      <div className="time-picker__presets">
        {PRESET_RANGES.map(preset => (
          <button
            key={preset.id}
            type="button"
            className={`time-picker__btn ${selectedRange === preset.id ? 'time-picker__btn--active' : ''}`}
            onClick={() => handleSelect(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
