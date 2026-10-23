/**
 * Table of the top N items by a metric.
 */
import React, { useMemo } from 'react';
import DataTable from './DataTable';
import './TopNTable.css';

/**
 * TopNTable
 * Standardized table ranking top-N entities/processes/queries by metric value.
 * Built on DataTable; zero inline styles.
 */
export default function TopNTable({
  title = 'Top Resource Consumers',
  items = [],
  nameKey = 'name',
  valueKey = 'value',
  secondaryKey = 'details',
  unit = '',
  maxItems = 5,
  onItemClick = null,
  className = ''
}) {
  const topItems = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return [...items]
      .sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0))
      .slice(0, maxItems)
      .map((item, idx) => ({
        ...item,
        _rank: idx + 1,
        _id: item.id || `rank-${idx + 1}`
      }));
  }, [items, valueKey, maxItems]);

  const maxValue = useMemo(() => {
    if (topItems.length === 0) return 1;
    return Math.max(...topItems.map(i => Number(i[valueKey] || 0)), 1);
  }, [topItems, valueKey]);

  const columns = useMemo(() => [
    {
      key: '_rank',
      header: '#',
      width: '40px',
      render: (val) => <span className="top-n-table__rank">{val}</span>
    },
    {
      key: nameKey,
      header: 'Name',
      render: (val, row) => (
        <div className="top-n-table__name-cell">
          <span className="top-n-table__name">{val || '—'}</span>
          {row[secondaryKey] && (
            <span className="top-n-table__secondary">{row[secondaryKey]}</span>
          )}
        </div>
      )
    },
    {
      key: valueKey,
      header: `Value ${unit ? `(${unit})` : ''}`,
      width: '180px',
      render: (val) => {
        const num = Number(val || 0);
        const barPct = Math.min(100, Math.round((num / maxValue) * 100));
        return (
          <div className="top-n-table__value-cell">
            <span className="top-n-table__num">{num}</span>
            <div className="top-n-table__bar-track">
              <div
                className="top-n-table__bar-fill"
                data-pct={barPct}
              />
            </div>
          </div>
        );
      }
    }
  ], [nameKey, valueKey, secondaryKey, unit, maxValue]);

  return (
    <div className={`top-n-table ${className}`}>
      <div className="top-n-table__header">
        <h4 className="top-n-table__title">{title}</h4>
        <span className="top-n-table__count">Showing Top {topItems.length}</span>
      </div>

      <DataTable
        columns={columns}
        data={topItems}
        rowKey="_id"
        emptyMessage="No telemetry reported for this rank."
        onRowClick={onItemClick}
        className="top-n-table__grid"
      />
    </div>
  );
}
