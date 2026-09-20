/**
 * inventory/sources/yaml_source.js
 *
 * Discovers and builds topology entities and relationship edges
 * from declarative YAML application and infrastructure manifests (T1.3 & T1.4).
 */

const yamlConfig = require('@sentinel/config/yaml_config');
const resolver = require('../entity_resolver');
const store = require('../store');

async function syncYamlTopology() {
  const apps = yamlConfig.loadAllApplications();
  const infra = yamlConfig.loadAllInfrastructureLayers();

  let entityCount = 0;
  let edgeCount = 0;

  // 1. Process Application manifests
  for (const [appId, app] of Object.entries(apps)) {
    // Skip alias references (T1.5): only emit topology for canonical primary app manifest
    if (app.id && app.id !== appId) continue;

    const appEntityId = resolver.app(appId);
    const env = app.environment || global.runtimeEnvironment || 'staging';

    await store.upsertEntity({
      entity_id: appEntityId,
      kind: 'app',
      name: app.display_name || app.name || appId,
      app_id: appId,
      region: (app.regions && app.regions[0]) || 'emea',
      environment: env,
      labels: {
        category: app.category || 'general',
        tier: app.tier || 'standard',
        aliases: app.aliases || []
      },
      source: 'yaml',
      status: 'Active'
    });
    entityCount++;

    // Process topology section if present (extended schema T1.4)
    if (app.topology) {
      const { operations_centers, agent_pools, jump_servers, build_clusters } = app.topology;

      // Operations Centers and Controllers
      if (Array.isArray(operations_centers)) {
        for (const oc of operations_centers) {
          const ocEntityId = `oc:${oc.id}`;
          await store.upsertEntity({
            entity_id: ocEntityId,
            kind: 'oc',
            name: `Operations Center ${oc.id.toUpperCase()}`,
            app_id: appId,
            region: oc.region || 'emea',
            environment: env,
            parent_id: appEntityId,
            labels: { url: oc.url, k8s_cluster: oc.k8s_cluster },
            source: 'yaml',
            status: 'Active'
          });
          entityCount++;

          await store.upsertEdge({
            from_entity: ocEntityId,
            to_entity: appEntityId,
            edge_type: 'member_of',
            confidence: 1.0,
            source: 'yaml'
          });
          edgeCount++;

          // Controllers inside this OC
          if (Array.isArray(oc.controllers)) {
            for (const ctrl of oc.controllers) {
              const ctrlId = resolver.controller(oc.id, ctrl.id);
              await store.upsertEntity({
                entity_id: ctrlId,
                kind: 'controller',
                name: `Controller ${ctrl.id} (${ctrl.flavour || 'General'})`,
                app_id: appId,
                region: oc.region || 'emea',
                environment: env,
                parent_id: ocEntityId,
                labels: { flavour: ctrl.flavour, url: ctrl.url },
                source: 'yaml',
                status: 'Active'
              });
              entityCount++;

              await store.upsertEdge({
                from_entity: ctrlId,
                to_entity: ocEntityId,
                edge_type: 'member_of',
                confidence: 1.0,
                source: 'yaml'
              });
              edgeCount++;
            }
          }
        }
      }

      // Agent Pools (e.g. 200 Windows + 50 Ubuntu agents)
      if (Array.isArray(agent_pools)) {
        for (const pool of agent_pools) {
          const poolEntityId = `agent_pool:${appId}:${pool.id}`;
          await store.upsertEntity({
            entity_id: poolEntityId,
            kind: 'agent_pool',
            name: `Agent Pool: ${pool.id}`,
            app_id: appId,
            region: pool.region || 'emea',
            environment: env,
            parent_id: appEntityId,
            labels: {
              os: pool.os,
              expected_count: pool.expected_count || 0,
              discovery: pool.discovery || 'api'
            },
            source: 'yaml',
            status: 'Active'
          });
          entityCount++;

          await store.upsertEdge({
            from_entity: poolEntityId,
            to_entity: appEntityId,
            edge_type: 'member_of',
            confidence: 1.0,
            source: 'yaml'
          });
          edgeCount++;
        }
      }

      // Jump Servers
      if (Array.isArray(jump_servers)) {
        for (const jump of jump_servers) {
          const hostEntityId = resolver.host(jump.host);
          await store.upsertEntity({
            entity_id: hostEntityId,
            kind: 'host',
            name: jump.host,
            app_id: appId,
            region: 'emea',
            environment: env,
            labels: { role: 'jump_server', os: jump.os || 'linux' },
            source: 'yaml',
            status: 'Active'
          });
          entityCount++;

          await store.upsertEdge({
            from_entity: hostEntityId,
            to_entity: appEntityId,
            edge_type: 'runs_on',
            confidence: 1.0,
            source: 'yaml'
          });
          edgeCount++;
        }
      }

      // Build Clusters
      if (Array.isArray(build_clusters)) {
        for (const cluster of build_clusters) {
          const clusterEntityId = resolver.k8sCluster(cluster.id);
          await store.upsertEntity({
            entity_id: clusterEntityId,
            kind: 'k8s_cluster',
            name: cluster.id,
            app_id: appId,
            region: cluster.region || 'emea',
            environment: env,
            labels: { purpose: cluster.purpose || 'build' },
            source: 'yaml',
            status: 'Active'
          });
          entityCount++;

          await store.upsertEdge({
            from_entity: clusterEntityId,
            to_entity: appEntityId,
            edge_type: 'depends_on',
            confidence: 1.0,
            source: 'yaml'
          });
          edgeCount++;
        }
      }
    }

    // Process legacy servers definition if present
    if (app.servers) {
      const serverNodes = [
        ...(Array.isArray(app.servers.unix) ? app.servers.unix : []),
        ...(Array.isArray(app.servers.windows) ? app.servers.windows : [])
      ];

      for (const s of serverNodes) {
        const nodeName = s.node || s.host;
        if (nodeName) {
          const hostEntityId = resolver.host(nodeName);
          await store.upsertEntity({
            entity_id: hostEntityId,
            kind: 'host',
            name: nodeName,
            app_id: appId,
            environment: env,
            labels: { api: s.api },
            source: 'yaml',
            status: 'Active'
          });
          entityCount++;

          await store.upsertEdge({
            from_entity: hostEntityId,
            to_entity: appEntityId,
            edge_type: 'runs_on',
            confidence: 1.0,
            source: 'yaml'
          });
          edgeCount++;
        }
      }
    }
  }

  // 2. Process Infrastructure layers
  for (const [infraId, layer] of Object.entries(infra)) {
    const infraEntityId = `infra:${infraId}`;
    const env = layer.environment || global.runtimeEnvironment || 'staging';

    await store.upsertEntity({
      entity_id: infraEntityId,
      kind: layer.kind || 'infrastructure',
      name: layer.display_name || layer.name || infraId,
      app_id: null,
      environment: env,
      labels: { type: layer.type || 'shared' },
      source: 'yaml',
      status: 'Active'
    });
    entityCount++;
  }

  return { entityCount, edgeCount };
}

module.exports = { syncYamlTopology };
