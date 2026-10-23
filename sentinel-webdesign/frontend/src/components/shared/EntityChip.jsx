/**
 * Small chip naming an entity (host, app, service); clickable to drill in.
 */
import React from 'react';

/**
 * EntityChip - Compact representation of an infrastructure or application asset.
 */
export default function EntityChip({
  entityId,
  kind = null,
  layer = null,
  onClick = null,
  className = ''
}) {
  const parts = String(entityId || '').split(':');
  const inferredKind = kind || (parts.length > 1 ? parts[0] : 'entity');
  const displayName = parts.length > 1 ? parts.slice(1).join(':') : entityId;

  return (
    <button
      type="button"
      className={`entity-chip entity-chip--${inferredKind} ${onClick ? 'entity-chip--interactive' : ''} ${className}`}
      onClick={onClick ? () => onClick(entityId) : undefined}
      title={`${inferredKind}: ${displayName} ${layer ? `[${layer}]` : ''}`}
    >
      <span className="entity-chip__badge">{inferredKind}</span>
      <span className="entity-chip__name">{displayName}</span>
      {layer && <span className="entity-chip__layer">{layer}</span>}
    </button>
  );
}
