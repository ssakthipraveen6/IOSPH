/**
 * inventory/sources/k8s_source.js
 *
 * Discovers Kubernetes clusters, nodes, and pods (T1.3).
 */

const resolver = require('../entity_resolver');
const store = require('../store');

// Adds Kubernetes nodes of a cluster to the inventory.
async function syncK8sInventory(clusterId, nodesData = null) {
  if (!clusterId) return { discoveredNodes: 0 };
  const env = global.runtimeEnvironment || 'staging';
  const clusterEntityId = resolver.k8sCluster(clusterId);

  await store.upsertEntity({
    entity_id: clusterEntityId,
    kind: 'k8s_cluster',
    name: clusterId,
    environment: env,
    source: 'k8s_api',
    status: 'Active'
  });

  let nodesCount = 0;
  if (nodesData && Array.isArray(nodesData.items)) {
    for (const node of nodesData.items) {
      const nodeName = node.metadata?.name || node.name;
      if (!nodeName) continue;

      const nodeEntityId = resolver.k8sNode(clusterId, nodeName);
      await store.upsertEntity({
        entity_id: nodeEntityId,
        kind: 'k8s_node',
        name: nodeName,
        parent_id: clusterEntityId,
        environment: env,
        labels: node.metadata?.labels || {},
        source: 'k8s_api',
        status: 'Active'
      });
      nodesCount++;

      await store.upsertEdge({
        from_entity: nodeEntityId,
        to_entity: clusterEntityId,
        edge_type: 'member_of',
        confidence: 1.0,
        source: 'k8s_api'
      });
    }
  }

  return { clusterEntityId, discoveredNodes: nodesCount };
}

/**
 * Resolve the storage entity a PV is backed by, from the PV spec only (nothing guessed).
 *  - Native NFS PV          : spec.nfs.{server,path}        -> share:<server>:<path>
 *  - NetApp Trident (CSI)   : csi.volumeAttributes.internalName (backend volume name)
 *                             -> storage:<internalName>
 *  - Other CSI              : csi.volumeHandle              -> storage:<handle>
 * Returns null when the spec carries no usable identifier.
 */
function storageTargetForPv(pv) {
  const spec = pv?.spec || {};
  if (spec.nfs?.path) {
    return { entityId: resolver.share(`${spec.nfs.server || ''}:${spec.nfs.path}`), kind: 'share', backing: 'nfs' };
  }
  if (spec.csi) {
    const id = spec.csi.volumeAttributes?.internalName || spec.csi.volumeHandle;
    if (id) {
      return {
        entityId: resolver.storage(id),
        kind: 'storage',
        backing: /trident/i.test(spec.csi.driver || '') ? 'trident' : 'csi'
      };
    }
  }
  return null;
}

/**
 * PVC -> PV -> (NFS share | Trident volume) chain, plus pod -> PVC `mounts` edges.
 * `data` holds raw K8s list payloads: { pvcs, pvs, pods } (each `{ items: [...] }`).
 * Edges: k8s_pvc --bound_to--> k8s_pv --backed_by--> share:/storage:   and   k8s_pod --mounts--> k8s_pvc.
 */
async function syncK8sStorage(clusterId, data = {}) {
  if (!clusterId) return { pvcs: 0, pvs: 0, pods: 0, storageLinks: 0 };
  const env = global.runtimeEnvironment || 'staging';
  const out = { pvcs: 0, pvs: 0, pods: 0, storageLinks: 0 };
  const pvByName = new Map();

  for (const pv of data.pvs?.items || []) {
    const name = pv.metadata?.name;
    if (!name) continue;
    const pvId = resolver.k8sPv(clusterId, name);
    pvByName.set(name, pvId);
    await store.upsertEntity({
      entity_id: pvId, kind: 'k8s_pv', name, environment: env, source: 'k8s_api', status: 'Active',
      labels: {
        cluster: clusterId,
        storage_class: pv.spec?.storageClassName || null,
        phase: pv.status?.phase || null,
        capacity: pv.spec?.capacity?.storage || null,
        driver: pv.spec?.csi?.driver || (pv.spec?.nfs ? 'nfs' : null)
      }
    });
    out.pvs++;
    const target = storageTargetForPv(pv);
    if (target) {
      await store.upsertEntity({
        entity_id: target.entityId, kind: target.kind, name: target.entityId.split(':').slice(1).join(':'),
        environment: env, source: 'k8s_api', status: 'Active'
      });
      await store.upsertEdge({
        from_entity: pvId, to_entity: target.entityId, edge_type: 'backed_by', confidence: 1.0, source: 'k8s_api'
      });
      out.storageLinks++;
    }
  }

  const pvcIdByKey = new Map();
  for (const pvc of data.pvcs?.items || []) {
    const name = pvc.metadata?.name;
    const ns = pvc.metadata?.namespace;
    if (!name || !ns) continue;
    const pvcId = resolver.k8sPvc(clusterId, ns, name);
    pvcIdByKey.set(`${ns}/${name}`, pvcId);
    await store.upsertEntity({
      entity_id: pvcId, kind: 'k8s_pvc', name, environment: env, source: 'k8s_api', status: 'Active',
      labels: {
        cluster: clusterId, namespace: ns,
        storage_class: pvc.spec?.storageClassName || null,
        phase: pvc.status?.phase || null,
        requested: pvc.spec?.resources?.requests?.storage || null
      }
    });
    out.pvcs++;
    const pvName = pvc.spec?.volumeName;
    if (pvName && pvByName.has(pvName)) {
      await store.upsertEdge({
        from_entity: pvcId, to_entity: pvByName.get(pvName), edge_type: 'bound_to', confidence: 1.0, source: 'k8s_api'
      });
    }
  }

  for (const pod of data.pods?.items || []) {
    const name = pod.metadata?.name;
    const ns = pod.metadata?.namespace;
    if (!name || !ns) continue;
    const claims = (pod.spec?.volumes || []).map(v => v.persistentVolumeClaim?.claimName).filter(Boolean);
    if (!claims.length) continue;
    const podId = `k8spod:${clusterId}:${ns}:${name}`.replace(/[^a-zA-Z0-9:_.-]/g, '_').toLowerCase();
    await store.upsertEntity({
      entity_id: podId, kind: 'k8s_pod', name, environment: env, source: 'k8s_api', status: 'Active',
      labels: { cluster: clusterId, namespace: ns, node: pod.spec?.nodeName || null, phase: pod.status?.phase || null }
    });
    out.pods++;
    for (const c of claims) {
      const pvcId = pvcIdByKey.get(`${ns}/${c}`);
      if (pvcId) {
        await store.upsertEdge({
          from_entity: podId, to_entity: pvcId, edge_type: 'mounts', confidence: 1.0, source: 'k8s_api'
        });
      }
    }
  }
  return out;
}

/**
 * Live discovery against the K8s API using the service-account token.
 * Returns { status } and never throws: unreachable / unconfigured / AUTH_FAILED are distinct.
 */
async function discover() {
  const config = require('@sentinel/config');
  const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
  const active = config.ACTIVE_URLS || {};
  const endpoint = active.k8s_api || active.infrastructure?.k8s?.api;
  if (!endpoint) return { status: 'NOT_CONFIGURED' };
  const clusterId = active.k8s_cluster || active.infrastructure?.k8s?.cluster || 'default-cluster';

  let token = null;
  try { token = await credentialProvider.getCredential('k8s', 'service_account'); } catch (_) {}
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const list = async (path) => {
    const res = await fetch(`${endpoint}${path}`, { headers, signal: AbortSignal.timeout(5000) });
    if (res.status === 401 || res.status === 403) { const e = new Error('AUTH_FAILED'); e.authFailed = true; throw e; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  try {
    const [nodes, pvcs, pvs, pods] = await Promise.all([
      list('/api/v1/nodes'), list('/api/v1/persistentvolumeclaims'),
      list('/api/v1/persistentvolumes'), list('/api/v1/pods')
    ]);
    const n = await syncK8sInventory(clusterId, nodes);
    const st = await syncK8sStorage(clusterId, { pvcs, pvs, pods });
    return { status: 'OK', clusterId, nodes: n.discoveredNodes, ...st };
  } catch (e) {
    return { status: e.authFailed ? 'AUTH_FAILED' : 'UNREACHABLE', error: e.message };
  }
}

module.exports = { syncK8sInventory, syncK8sStorage, storageTargetForPv, discover };
