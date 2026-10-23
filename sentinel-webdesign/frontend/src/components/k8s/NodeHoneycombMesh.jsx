/**
 * Honeycomb of Kubernetes nodes coloured by severity.
 */
import React from 'react';
import { normalizeSeverity, SEVERITY } from '@sentinel/shared-constants';
import './KubernetesMeshView.css';

// Honeycomb component.
export default function NodeHoneycombMesh({ nodes = [] }) {
  return (
    <div className="k8s-honeycomb">
      {nodes.map(n => {
        const sev = normalizeSeverity(n.status);
        let tone = '';

        if (sev === SEVERITY.WARNING) {
          tone = ' k8s-node--warning';
        } else if (sev === SEVERITY.CRITICAL) {
          tone = ' k8s-node--critical';
        }

        return (
          <div
            key={n.id}
            title={`Node: ${n.id} • Status: ${n.status} • CPU: ${n.cpuLoad ?? '—'}% • RAM: ${n.memoryLoad ?? '—'}%`}
            className={`k8s-node${tone}`}
          >
            {n.id}
          </div>
        );
      })}
    </div>
  );
}
