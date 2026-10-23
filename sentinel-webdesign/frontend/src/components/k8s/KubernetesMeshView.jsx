/**
 * Kubernetes view: clusters, nodes (honeycomb), pods and workloads.
 */
import React, { useState } from 'react';
import usePrototypeData from '../shared/usePrototypeData';
import EmptyState from '../shared/EmptyState';
import StatusBadge from '../shared/StatusBadge';
import { LoadingState } from '../shared/PrototypeNotice';
import NodeHoneycombMesh from './NodeHoneycombMesh';
import './KubernetesMeshView.css';

/**
 * Observe › Kubernetes Hierarchy Views (Phase O4.2).
 *
 * Implements full drill-down:
 *   Clusters → Cluster Overview → Namespace → Workload → Pods
 * Zero fabricated telemetry: unobserved metrics render as '—'.
 */
export default function KubernetesMeshView({ environment = 'staging', demoData = null }) {
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [selectedNamespace, setSelectedNamespace] = useState(null);
  const [selectedWorkload, setSelectedWorkload] = useState(null);

  // 1. Clusters Level
  if (!selectedCluster) {
    return (
      <ClustersListView
        environment={environment}
        onSelectCluster={(cl) => setSelectedCluster(cl)}
      />
    );
  }

  // 4. Workload Level
  if (selectedWorkload) {
    return (
      <WorkloadDetailView
        cluster={selectedCluster}
        namespace={selectedNamespace}
        workload={selectedWorkload}
        environment={environment}
        onBack={() => setSelectedWorkload(null)}
      />
    );
  }

  // 3. Namespace Level
  if (selectedNamespace) {
    return (
      <NamespaceDetailView
        cluster={selectedCluster}
        namespace={selectedNamespace}
        environment={environment}
        onBack={() => setSelectedNamespace(null)}
        onSelectWorkload={(wl) => setSelectedWorkload(wl)}
      />
    );
  }

  // 2. Cluster Overview Level
  return (
    <ClusterDetailView
      cluster={selectedCluster}
      environment={environment}
      onBack={() => setSelectedCluster(null)}
      onSelectNamespace={(ns) => setSelectedNamespace(ns)}
      onSelectWorkload={(wl, ns) => {
        setSelectedNamespace(ns);
        setSelectedWorkload(wl);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// 1. Clusters List View
// ---------------------------------------------------------------------------
function ClustersListView({ environment, onSelectCluster }) {
  const { state, data, reason } = usePrototypeData('/api/v2/infra/k8s/clusters', environment);
  const clusters = (data && Array.isArray(data.clusters)) ? data.clusters : [];

  return (
    <div className="k8s-root">
      <div className="k8s-strip">
        <div className="k8s-chip-row">
          <span className="k8s-chip"><strong>Kubernetes Clusters:</strong> {clusters.length} discovered</span>
          <span className="k8s-chip"><strong>Environment:</strong> {environment.toUpperCase()}</span>
        </div>
      </div>

      {state === 'loading' && <LoadingState label="Loading Kubernetes clusters…" />}
      {state === 'unavailable' && (
        <EmptyState
          title="No Kubernetes clusters discovered"
          description="No clusters or nodes have reported k8s metrics for this environment yet."
          reason={reason}
          environment={environment}
        />
      )}

      {state === 'ready' && clusters.length === 0 && (
        <EmptyState
          title="No Kubernetes clusters reporting"
          description="No clusters found in this environment."
          environment={environment}
        />
      )}

      {state === 'ready' && clusters.length > 0 && (
        <div className="k8s-card">
          <div className="k8s-card-head">
            <h3 className="k8s-card-title">Discovered Kubernetes Clusters</h3>
          </div>
          <div className="k8s-table-container">
            <table className="k8s-table">
              <thead>
                <tr>
                  <th>Cluster</th>
                  <th>Status</th>
                  <th>Nodes</th>
                  <th>Pods</th>
                  <th>CPU Allocatable</th>
                  <th>CPU Used</th>
                  <th>Memory Allocatable</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map(c => (
                  <tr
                    key={c.cluster}
                    className="k8s-clickable-row"
                    onClick={() => onSelectCluster(c.cluster)}
                  >
                    <td className="k8s-name-cell">{c.cluster}</td>
                    <td><StatusBadge status={c.status || 'HEALTHY'} /></td>
                    <td>{c.nodes_count ?? '—'}</td>
                    <td>{c.pods_count ?? '—'}</td>
                    <td className="k8s-table-pct">{typeof c.cpu_allocatable === 'number' ? `${c.cpu_allocatable} cores` : '—'}</td>
                    <td className="k8s-table-pct">{typeof c.cpu_used === 'number' ? `${c.cpu_used.toFixed(1)} cores` : '—'}</td>
                    <td className="k8s-table-pct">{typeof c.memory_allocatable === 'number' ? `${(c.memory_allocatable / 1e9).toFixed(1)} GB` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Cluster Detail View
// ---------------------------------------------------------------------------
function ClusterDetailView({ cluster, environment, onBack, onSelectNamespace, onSelectWorkload }) {
  const { state, data, reason } = usePrototypeData(`/api/v2/infra/k8s/${encodeURIComponent(cluster)}`, environment);

  return (
    <div className="k8s-root">
      <div className="k8s-breadcrumbs">
        <button type="button" className="k8s-crumb-btn" onClick={onBack}>Clusters</button>
        <span className="k8s-crumb-sep">/</span>
        <span className="k8s-crumb-current">{cluster}</span>
      </div>

      {state === 'loading' && <LoadingState label={`Loading cluster ${cluster}…`} />}
      {state === 'unavailable' && (
        <EmptyState
          title={`Cluster ${cluster} unavailable`}
          description="Could not load detailed node and pod metrics for this cluster."
          reason={reason}
          environment={environment}
        />
      )}

      {state === 'ready' && data && (
        <>
          {/* Top KPI Summary */}
          <div className="k8s-grid-12">
            <div className="k8s-card k8s-span-3">
              <div className="k8s-kpi-label">PODS BY PHASE</div>
              <div className="k8s-kpi-value">{data.pods_by_phase?.running ?? '—'}</div>
              <div className="k8s-mono-note">
                Running: {data.pods_by_phase?.running ?? 0} · Pending: {data.pods_by_phase?.pending ?? 0} · Failed: {data.pods_by_phase?.failed ?? 0}
              </div>
            </div>
            <div className="k8s-card k8s-span-3">
              <div className="k8s-kpi-label">CRASHLOOP / OOM</div>
              <div className="k8s-kpi-value">{(data.pods_by_phase?.crashloop ?? 0) + (data.pods_by_phase?.oomkilled ?? 0)}</div>
              <div className="k8s-mono-note">
                CrashLoop: {data.pods_by_phase?.crashloop ?? 0} · OOMKilled: {data.pods_by_phase?.oomkilled ?? 0}
              </div>
            </div>
            <div className="k8s-card k8s-span-3">
              <div className="k8s-kpi-label">CPU ALLOCATED</div>
              <div className="k8s-kpi-value">
                {typeof data.resources?.cpu?.used === 'number' ? `${data.resources.cpu.used.toFixed(1)}` : '—'}
              </div>
              <div className="k8s-mono-note">
                Requests: {data.resources?.cpu?.requests ?? '—'} · Allocatable: {data.resources?.cpu?.allocatable ?? '—'}
              </div>
            </div>
            <div className="k8s-card k8s-span-3">
              <div className="k8s-kpi-label">NODES PRESSURE</div>
              <div className="k8s-kpi-value">
                {Array.isArray(data.node_conditions) ? data.node_conditions.filter(n => n.disk_pressure || n.memory_pressure).length : '—'}
              </div>
              <div className="k8s-mono-note">Total Nodes: {Array.isArray(data.node_conditions) ? data.node_conditions.length : '—'}</div>
            </div>
          </div>

          {/* Image Drift Banner */}
          {Array.isArray(data.image_drift) && data.image_drift.length > 0 && (
            <div className="k8s-drift-alert">
              <strong>Image Drift Detected:</strong>
              <span>{data.image_drift.length} workload(s) have replicas running differing image tags.</span>
            </div>
          )}

          {/* Nodes Table & Mesh */}
          <div className="k8s-card">
            <div className="k8s-card-head">
              <h3 className="k8s-card-title">Cluster Nodes &amp; Mesh Conditions</h3>
            </div>
            {Array.isArray(data.node_conditions) && data.node_conditions.length > 0 && (
              <div className="k8s-table-container">
                <NodeHoneycombMesh
                  nodes={data.node_conditions.map(n => ({
                    id: n.node,
                    status: !n.ready ? 'CRITICAL' : (n.disk_pressure || n.memory_pressure ? 'WARNING' : 'HEALTHY'),
                    cpuLoad: (typeof n.cpu_used === 'number' && n.cpu_allocatable) ? Math.round((n.cpu_used / n.cpu_allocatable) * 100) : null,
                    memoryLoad: (typeof n.memory_used === 'number' && n.memory_allocatable) ? Math.round((n.memory_used / n.memory_allocatable) * 100) : null,
                  }))}
                />
              </div>
            )}
            <div className="k8s-table-container">
              <table className="k8s-table">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Ready</th>
                    <th>Disk Pressure</th>
                    <th>Memory Pressure</th>
                    <th>CPU Used / Allocatable</th>
                    <th>Memory Used / Allocatable</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.node_conditions || []).map(n => (
                    <tr key={n.node}>
                      <td className="k8s-name-cell">{n.node}</td>
                      <td>
                        <span className={`k8s-badge ${n.ready ? 'k8s-badge--ready' : 'k8s-badge--not-ready'}`}>
                          {n.ready ? 'Ready' : 'Not Ready'}
                        </span>
                      </td>
                      <td>{n.disk_pressure ? <span className="k8s-badge k8s-badge--warning">Pressure</span> : 'None'}</td>
                      <td>{n.memory_pressure ? <span className="k8s-badge k8s-badge--warning">Pressure</span> : 'None'}</td>
                      <td>{typeof n.cpu_used === 'number' ? `${n.cpu_used.toFixed(1)} / ${n.cpu_allocatable} cores` : '—'}</td>
                      <td>{typeof n.memory_used === 'number' ? `${(n.memory_used / 1e9).toFixed(1)} / ${(n.memory_allocatable / 1e9).toFixed(1)} GB` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quotas & PVCs */}
          <div className="k8s-grid-2">
            <div className="k8s-card">
              <div className="k8s-card-head">
                <h3 className="k8s-card-title">Resource Quotas</h3>
              </div>
              <div className="k8s-table-container">
                <table className="k8s-table">
                  <thead>
                    <tr>
                      <th>Namespace</th>
                      <th>CPU Used / Limit</th>
                      <th>Memory Used / Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.quotas || []).map(q => (
                      <tr key={q.namespace} className="k8s-clickable-row" onClick={() => onSelectNamespace(q.namespace)}>
                        <td className="k8s-name-cell">{q.namespace}</td>
                        <td>{q.cpu_used ?? '—'} / {q.cpu_hard ?? '—'} cores</td>
                        <td>{typeof q.memory_used === 'number' ? `${(q.memory_used / 1e9).toFixed(1)} GB` : '—'} / {typeof q.memory_hard === 'number' ? `${(q.memory_hard / 1e9).toFixed(1)} GB` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="k8s-card">
              <div className="k8s-card-head">
                <h3 className="k8s-card-title">Persistent Volume Claims (PVC Fill)</h3>
              </div>
              <div className="k8s-table-container">
                <table className="k8s-table">
                  <thead>
                    <tr>
                      <th>PVC</th>
                      <th>Namespace</th>
                      <th>Fill %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.pvc_fill || []).map(p => (
                      <tr key={p.pvc}>
                        <td className="k8s-name-cell">{p.pvc}</td>
                        <td>{p.namespace}</td>
                        <td className="k8s-table-pct">{p.fill_pct !== null ? `${p.fill_pct}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Namespace Detail View
// ---------------------------------------------------------------------------
function NamespaceDetailView({ cluster, namespace, environment, onBack, onSelectWorkload }) {
  const { state, data, reason } = usePrototypeData(
    `/api/v2/infra/k8s/${encodeURIComponent(cluster)}/namespaces/${encodeURIComponent(namespace)}`,
    environment
  );

  return (
    <div className="k8s-root">
      <div className="k8s-breadcrumbs">
        <button type="button" className="k8s-crumb-btn" onClick={onBack}>Cluster: {cluster}</button>
        <span className="k8s-crumb-sep">/</span>
        <span className="k8s-crumb-current">Namespace: {namespace}</span>
      </div>

      {state === 'loading' && <LoadingState label={`Loading namespace ${namespace}…`} />}
      {state === 'unavailable' && (
        <EmptyState
          title={`Namespace ${namespace} unavailable`}
          description="Could not load workloads or pods in this namespace."
          reason={reason}
          environment={environment}
        />
      )}

      {state === 'ready' && data && (
        <>
          <div className="k8s-card">
            <div className="k8s-card-head">
              <h3 className="k8s-card-title">Workloads in {namespace}</h3>
            </div>
            <div className="k8s-table-container">
              <table className="k8s-table">
                <thead>
                  <tr>
                    <th>Workload</th>
                    <th>Kind</th>
                    <th>Desired</th>
                    <th>Ready</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.workloads || []).map(w => (
                    <tr
                      key={w.workload}
                      className="k8s-clickable-row"
                      onClick={() => onSelectWorkload(w.workload)}
                    >
                      <td className="k8s-name-cell">{w.workload}</td>
                      <td>{w.kind}</td>
                      <td>{w.replicas_desired ?? '—'}</td>
                      <td>{w.replicas_ready ?? '—'}</td>
                      <td><StatusBadge status={w.status || 'HEALTHY'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="k8s-card">
            <div className="k8s-card-head">
              <h3 className="k8s-card-title">Pods in {namespace}</h3>
            </div>
            <div className="k8s-table-container">
              <table className="k8s-table">
                <thead>
                  <tr>
                    <th>Pod</th>
                    <th>Workload</th>
                    <th>Phase</th>
                    <th>Restarts</th>
                    <th>Node</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.pods || []).map(p => (
                    <tr key={p.pod}>
                      <td className="k8s-name-cell">{p.pod}</td>
                      <td>{p.workload || '—'}</td>
                      <td>{p.phase}</td>
                      <td>{p.restarts}</td>
                      <td>{p.node || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Workload Detail View
// ---------------------------------------------------------------------------
function WorkloadDetailView({ cluster, namespace, workload, environment, onBack }) {
  const { state, data, reason } = usePrototypeData(
    `/api/v2/infra/k8s/${encodeURIComponent(cluster)}/workloads/${encodeURIComponent(workload)}`,
    environment
  );

  return (
    <div className="k8s-root">
      <div className="k8s-breadcrumbs">
        <button type="button" className="k8s-crumb-btn" onClick={onBack}>Namespace: {namespace}</button>
        <span className="k8s-crumb-sep">/</span>
        <span className="k8s-crumb-current">Workload: {workload}</span>
      </div>

      {state === 'loading' && <LoadingState label={`Loading workload ${workload}…`} />}
      {state === 'unavailable' && (
        <EmptyState
          title={`Workload ${workload} unavailable`}
          description="Could not load pod details for this workload."
          reason={reason}
          environment={environment}
        />
      )}

      {state === 'ready' && data && (
        <>
          <div className="k8s-card">
            <div className="k8s-card-head">
              <h3 className="k8s-card-title">Workload Summary</h3>
            </div>
            <div className="k8s-chip-row">
              <span className="k8s-chip"><strong>Kind:</strong> {data.kind}</span>
              <span className="k8s-chip"><strong>Replicas:</strong> {data.replicas?.ready} / {data.replicas?.desired}</span>
              <span className="k8s-chip"><strong>Namespace:</strong> {data.namespace}</span>
            </div>

            {data.image_drift?.has_drift && (
              <div className="k8s-drift-alert" style={{ marginTop: '1rem' }}>
                <strong>Image Drift:</strong> Differing container images in use: {data.image_drift.images.join(', ')}
              </div>
            )}
          </div>

          <div className="k8s-card">
            <div className="k8s-card-head">
              <h3 className="k8s-card-title">Active Pods</h3>
            </div>
            <div className="k8s-table-container">
              <table className="k8s-table">
                <thead>
                  <tr>
                    <th>Pod</th>
                    <th>Node</th>
                    <th>Phase</th>
                    <th>Status Reason</th>
                    <th>Restarts</th>
                    <th>Image</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.pods || []).map(p => (
                    <tr key={p.pod}>
                      <td className="k8s-name-cell">{p.pod}</td>
                      <td>{p.node || '—'}</td>
                      <td>{p.phase}</td>
                      <td>{p.status_reason || 'Running'}</td>
                      <td>{p.restarts}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{p.image || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
