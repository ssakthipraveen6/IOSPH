/**
 * backend/routes/topologyRoutes.js
 *
 * M3 Task 3.2: Multi-layer topology extraction API:
 * GET /api/v2/topology/:productId?environment=
 *
 * Traverses topology graph VIP -> Product -> Hosts -> Shares -> Databases.
 */

const express = require('express');
const router = express.Router();
const inventory = require('@sentinel/inventory');
const yamlConfig = require('../config/yaml_config');

const DISCOVERY_LEAF_KINDS = new Set(['ip_address', 'dns_name']);

/**
 * Re-walks the traversal from the root over the collected edges, entering
 * discovery-leaf entities but never expanding through them. Drops entities (and
 * edges) only reachable through such a leaf.
 */
function pruneThroughDiscoveryLeaves(rootId, entities, edges, maxDepth) {
  const byId = new Map(entities.map(e => [e.entity_id, e]));
  if (![...byId.values()].some(e => DISCOVERY_LEAF_KINDS.has(e.kind))) return { entities, edges };
  const keep = new Set([rootId]);
  let frontier = [rootId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    for (const id of frontier) {
      const node = byId.get(id);
      if (node && DISCOVERY_LEAF_KINDS.has(node.kind)) continue;
      for (const e of edges) {
        const other = e.from_entity === id ? e.to_entity : (e.to_entity === id ? e.from_entity : null);
        if (other && byId.has(other) && !keep.has(other)) { keep.add(other); next.push(other); }
      }
    }
    frontier = next;
  }
  return {
    entities: entities.filter(e => keep.has(e.entity_id)),
    // drop only edges touching a pruned entity (dangling edges keep their old behaviour)
    edges: edges.filter(e => [e.from_entity, e.to_entity].every(id => keep.has(id) || !byId.has(id)))
  };
}

// Topology graph for one product.
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    // [Phase S2] Environment only from the request context (entitlement-checked).
    const env = req.sentinelEnv || 'staging';

    const canonicalAppId = productId.startsWith('app:') ? productId.replace(/^app:/, '') : productId;
    const rootEntityId = `app:${canonicalAppId}`;

    // Lookup root entity from inventory store
    let rootEntity = null;
    try {
      rootEntity = await inventory.getEntityById(rootEntityId);
      if (!rootEntity) {
        rootEntity = await inventory.getEntityById(canonicalAppId);
      }
    } catch (_) {}

    // Verify product exists in manifests if not yet loaded in cache
    const apps = yamlConfig.loadAllApplications ? yamlConfig.loadAllApplications() : {};
    const appManifest = apps[canonicalAppId];

    if (!rootEntity && !appManifest) {
      return res.status(404).json({ error: `Product '${productId}' not found in topology.`, productId });
    }

    // Traverse the topology graph (depth 3 covers VIP -> Product -> Hosts -> Shares -> DB)
    const targetRootId = rootEntity?.entity_id || rootEntityId;
    const graph = await inventory.getEntityGraph(targetRootId, 3);

    let entities = graph?.entities || (rootEntity ? [rootEntity] : []);
    let edges = graph?.edges || [];

    // [Q4] Probe-discovered nodes (VIP -> resolves_to -> ip_address, VIP -> cert_san
    // -> dns_name) are leaves of this product's graph: a shared AVI address or a
    // wildcard SAN must not pull other products' VIPs into this product's topology.
    ({ entities, edges } = pruneThroughDiscoveryLeaves(targetRootId, entities, edges, 3));

    // Filter by environment if specified and present
    const norm = (s) => {
      if (!s) return '';
      const l = s.toLowerCase();
      if (l === 'prod' || l === 'production') return 'prod';
      if (l === 'stg' || l === 'staging') return 'staging';
      return l;
    };

    const requestedNorm = norm(env);
    const envFilteredEntities = entities.filter(e => {
      const entityNorm = norm(e.environment);
      return !entityNorm || entityNorm === requestedNorm || entityNorm === 'global';
    });

    // Group into distinct layers per M3 Task 3.2 specification
    const layers = {
      vip: envFilteredEntities.filter(e => e.kind === 'vip' || e.kind === 'avi'),
      product: envFilteredEntities.filter(e => e.kind === 'app' || e.kind === 'application'),
      hosts: envFilteredEntities.filter(e => e.kind === 'host'),
      shares: envFilteredEntities.filter(e => e.kind === 'storage' || e.kind === 'share'),
      databases: envFilteredEntities.filter(e => e.kind === 'database'),
      clusters: envFilteredEntities.filter(e => e.kind === 'k8s_cluster' || e.kind === 'k8snode'),
      // [Q4] discovered by the P1 VIP probe, hanging under the VIP
      addresses: envFilteredEntities.filter(e => e.kind === 'ip_address'),
      cert_names: envFilteredEntities.filter(e => e.kind === 'dns_name')
    };

    res.json({
      productId: canonicalAppId,
      environment: env,
      rootEntity: rootEntity || { entity_id: rootEntityId, kind: 'app', name: appManifest?.name || canonicalAppId },
      entities: envFilteredEntities,
      edges,
      layers
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to load topology for ${req.params.productId}: ${err.message}` });
  }
});

module.exports = router;
module.exports.pruneThroughDiscoveryLeaves = pruneThroughDiscoveryLeaves;
