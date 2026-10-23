/**
 * Sortable, dense table used by most views.
 */
import React, { useState, useMemo } from 'react';

/**
 * DataTable - Standardized high-density table for metrics, logs, and inventories.
 */
export default function DataTable({
  columns, // [{ key, header, render?: (val, row) => ReactNode, sortable?: boolean, width?: string }]
  data = [],
  rowKey = 'id',
  emptyMessage = 'No records found',
  onRowClick = null,
  className = ''
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'

  const handleHeaderClick = (col) => {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDirection('asc');
    }
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];
      if (valA === valB) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      const order = valA > valB ? 1 : -1;
      return sortDirection === 'asc' ? order : -order;
    });
  }, [data, sortKey, sortDirection]);

  return (
    <div className={`data-table-container ${className}`}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={`data-table__th ${col.sortable ? 'data-table__th--sortable' : ''}`}
                onClick={() => handleHeaderClick(col)}
              >
                <div className="data-table__th-content">
                  <span>{col.header}</span>
                  {col.sortable && sortKey === col.key && (
                    <span className="data-table__sort-indicator">
                      {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="data-table__empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((row, idx) => {
              const key = typeof rowKey === 'function' ? rowKey(row) : (row[rowKey] || idx);
              return (
                <tr
                  key={key}
                  className={`data-table__tr ${onRowClick ? 'data-table__tr--clickable' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map(col => {
                    const cellVal = row[col.key];
                    return (
                      <td key={col.key} className="data-table__td">
                        {col.render ? col.render(cellVal, row) : (cellVal ?? '—')}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
