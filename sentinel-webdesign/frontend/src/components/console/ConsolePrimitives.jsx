/**
 * Console building blocks shared by all console screens: header, KPI row, panels, pills, tables,
 * charts, legends, empty state.
 */
import React from 'react';
import EmptyState from '../shared/EmptyState';
import './ConsoleView.css';

/*
 * Shared building blocks for the observability-console screens.
 * Every status is shown as text as well as colour. Nothing here holds sample data:
 * the screens render whatever payload they are given.
 */

export const STATE_TEXT = { ok: 'Healthy', warn: 'Warning', crit: 'Degraded' };
const KNOWN = { ok: true, warn: true, crit: true };
// Returns a known state (ok/warn/crit) or 'none' for anything else.
export const toneOf = (state) => (KNOWN[state] ? state : 'none');

// Coloured state pill.
export function StatePill({ state, label }) {
  const tone = toneOf(state);
  return (
    <span className="con-pill" data-state={tone}>
      <span className="con-pill__dot" aria-hidden="true" />
      {label || STATE_TEXT[tone] || 'Unknown'}
    </span>
  );
}

// Screen title bar with optional controls on the right.
export function ConsoleHeader({ title, subtitle, children }) {
  return (
    <div className="con-header">
      <div>
        <h2 className="con-header__title">{title}</h2>
        {subtitle && <div className="con-header__subtitle">{subtitle}</div>}
      </div>
      {children && <div className="con-header__actions">{children}</div>}
    </div>
  );
}

// Row of KPI tiles.
export function Kpis({ items }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="con-kpis">
      {list.map(k => (
        <div key={k.label} className="con-kpi" data-state={toneOf(k.state)}>
          <div className="con-kpi__label">{k.label}</div>
          <div className="con-kpi__value">{k.value}</div>
          {k.note && <div className="con-kpi__note">{k.note}</div>}
        </div>
      ))}
    </div>
  );
}

// Titled panel container.
export function Panel({ title, hint, right, children, className = '' }) {
  return (
    <section className={`con-panel ${className}`}>
      {(title || right) && (
        <div className="con-panel__head">
          <div>
            <h3 className="con-panel__title">{title}</h3>
            {hint && <div className="con-panel__hint">{hint}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

// Segmented button group (single choice).
export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="con-seg" role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o}
          type="button"
          className={`con-seg__btn${value === o ? ' con-seg__btn--on' : ''}`}
          aria-pressed={value === o}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** Horizontal meter with its value printed next to it. */
export function Meter({ pct, state, label }) {
  const v = pct !== null && pct !== undefined && pct !== '' && Number.isFinite(Number(pct)) ? Math.max(0, Math.min(100, Number(pct))) : null;
  if (v === null) return <span className="con-muted">—</span>;
  return (
    <span className="con-meter" data-state={toneOf(state)} title={label || `${v}%`}>
      <span className="con-meter__track"><span className="con-meter__bar" style={{ width: `${v}%` }} /></span>
      <span className="con-meter__text">{label || `${v}%`}</span>
    </span>
  );
}

// Simple table with column definitions and an empty message.
export function DataTable({ columns, rows, empty = 'No rows.' }) {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div className="con-table-wrap">
      <table className="con-table">
        <thead>
          <tr>{columns.map(c => <th key={c.key} className={c.align === 'right' ? 'con-num' : undefined}>{c.title}</th>)}</tr>
        </thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={columns.length} className="con-muted">{empty}</td></tr>}
          {list.map((r, i) => (
            <tr key={r.key || r.id || i}>
              {columns.map(c => (
                <td key={c.key} className={c.align === 'right' ? 'con-num' : (c.mono ? 'con-mono' : undefined)}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- charts (plain SVG, scale to their container) ---------- */

function scale(values, min, max) {
  const lo = min !== undefined ? min : Math.min(...values);
  const hi = max !== undefined ? max : Math.max(...values);
  const span = hi - lo || 1;
  return { lo, hi, y: (v, h, pad) => pad + (1 - (v - lo) / span) * (h - pad * 2) };
}

/** Small trend line with no axes. */
export function Trend({ values, tone = 'ok', label }) {
  const v = (Array.isArray(values) ? values : []).filter(n => Number.isFinite(n));
  if (v.length < 2) return null;
  const w = 120; const h = 32;
  const s = scale(v);
  const pts = v.map((n, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${s.y(n, h, 3).toFixed(1)}`).join(' ');
  return (
    <svg className="con-trend" data-state={toneOf(tone)} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label || 'trend'}>
      <polyline points={pts} fill="none" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Line chart. series: [{ name, values, tone? }]. threshold: { value, label }.
 * xLabels: optional array of tick labels, markers: [{ index, label }].
 */
export function LineChart({ series, height = 200, threshold, markers = [], xLabels = [], yUnit = '', min, max, ariaLabel }) {
  const list = (Array.isArray(series) ? series : []).filter(s => Array.isArray(s.values) && s.values.length > 1);
  if (list.length === 0) return <div className="con-muted">No data.</div>;
  const w = 720; const h = height; const padL = 40; const padR = 10; const padT = 10; const padB = 24;
  const all = list.flatMap(s => s.values).concat(threshold ? [threshold.value] : []);
  const lo = min !== undefined ? min : Math.min(0, ...all);
  const hi = max !== undefined ? max : Math.max(...all) * 1.1;
  const span = hi - lo || 1;
  const y = (v) => padT + (1 - (v - lo) / span) * (h - padT - padB);
  const n = list[0].values.length;
  const x = (i) => padL + (i / (n - 1)) * (w - padL - padR);
  const ticks = [lo, lo + span / 2, hi];
  return (
    <svg className="con-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel || 'chart'}>
      {ticks.map(t => (
        <g key={t}>
          <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="con-chart__grid" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="con-chart__tick">{Math.round(t * 10) / 10}{yUnit}</text>
        </g>
      ))}
      {threshold && (
        <g>
          <line x1={padL} x2={w - padR} y1={y(threshold.value)} y2={y(threshold.value)} className="con-chart__threshold" />
          <text x={w - padR} y={y(threshold.value) - 4} textAnchor="end" className="con-chart__tick">{threshold.label}</text>
        </g>
      )}
      {markers.map(m => (
        <g key={m.label}>
          <line x1={x(m.index)} x2={x(m.index)} y1={padT} y2={h - padB} className="con-chart__marker" />
          <text x={x(m.index) + 4} y={padT + 10} className="con-chart__tick">{m.label}</text>
        </g>
      ))}
      {list.map((s, si) => (
        <polyline
          key={s.name}
          className={`con-chart__line con-chart__line--${si}`}
          data-state={s.tone ? toneOf(s.tone) : undefined}
          fill="none"
          points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
        />
      ))}
      {xLabels.map((l, i) => (
        <text key={i} x={x(Math.round((i / Math.max(1, xLabels.length - 1)) * (n - 1)))} y={h - 6} textAnchor="middle" className="con-chart__tick">{l}</text>
      ))}
    </svg>
  );
}

// Legend for line charts.
export function ChartLegend({ items }) {
  return (
    <div className="con-legend">
      {items.map((it, i) => (
        <span key={it} className="con-legend__item"><span className={`con-legend__swatch con-legend__swatch--${i}`} aria-hidden="true" />{it}</span>
      ))}
    </div>
  );
}

/** Column chart. */
export function Columns({ values, labels = [], height = 160, markers = [], ariaLabel }) {
  const v = (Array.isArray(values) ? values : []).filter(n => Number.isFinite(n));
  if (!v.length) return <div className="con-muted">No data.</div>;
  const w = 720; const padL = 8; const padB = 22; const padT = 8;
  const hi = Math.max(...v) * 1.1 || 1;
  const bw = (w - padL * 2) / v.length;
  return (
    <svg className="con-chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={ariaLabel || 'columns'}>
      {v.map((n, i) => {
        const bh = (n / hi) * (height - padT - padB);
        return <rect key={i} x={padL + i * bw + 2} y={height - padB - bh} width={Math.max(1, bw - 4)} height={bh} className="con-chart__col"><title>{`${labels[i] ?? i}: ${n}`}</title></rect>;
      })}
      {markers.map(m => (
        <g key={m.label}>
          <line x1={padL + m.index * bw + bw / 2} x2={padL + m.index * bw + bw / 2} y1={padT} y2={height - padB} className="con-chart__marker" />
          <text x={padL + m.index * bw + bw / 2 + 4} y={padT + 10} className="con-chart__tick">{m.label}</text>
        </g>
      ))}
      {labels.map((l, i) => (i % 4 === 0 ? <text key={i} x={padL + i * bw + bw / 2} y={height - 6} textAnchor="middle" className="con-chart__tick">{l}</text> : null))}
    </svg>
  );
}

/** Grid of small cells (agents, mirror nodes). Meaning is also given by the legend and each cell's title. */
export function CellGrid({ cells, columns = 10 }) {
  const list = Array.isArray(cells) ? cells : [];
  return (
    <div className="con-cells" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {list.map(c => (
        <span key={c.name || c.id} className="con-cell" data-cell={c.state} title={`${c.name || c.id} · ${c.note || c.state}`} />
      ))}
    </div>
  );
}

// Legend for cell grids.
export function CellLegend({ items }) {
  return (
    <div className="con-legend">
      {items.map(i => <span key={i} className="con-legend__item"><span className="con-cell con-cell--legend" data-cell={i} aria-hidden="true" />{i}</span>)}
    </div>
  );
}

/** Rendered when a screen has no payload (live collectors for it are not wired yet). */
export function ConsoleEmpty({ environment, name, reason }) {
  return (
    <EmptyState
      title="Data not available"
      description={`${name} has no live data source in ${environment || 'this environment'} yet.`}
      reason={reason || `${name} has no live data source in ${environment || 'this environment'} yet.`}
      environment={environment}
      isPrototype
    />
  );
}
