/**
 * inventory/sources/k8s_source.js
 *
 * Discovers Kubernetes clusters, nodes, and pods (T1.3).
 */

const resolver = require('../entity_resolver');
const store = require('../store');

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

module.exports = { syncK8sInventory };
