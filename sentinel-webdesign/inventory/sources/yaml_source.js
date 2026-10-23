/**
 * inventory/sources/yaml_source.js
 *
 * Discovers and builds topology entities and relationship edges
 * from declarative YAML application and infrastructure manifests (T1.3 & T1.4).
 */

const yamlConfig = require('@sentinel/config/yaml_config');
const resolver = require('../entity_resolver');
const store = require('../store');

// Builds the inventory (applications, layers, hosts, VIPs, relations) from the YAML manifests.
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

    // Process layers: vip, hosts[], shares[], databases[], clusters[] (M3 Task 3.2)
    if (app.layers || (app.endpoints && (app.endpoints[env]?.vip || app.endpoints.prod?.vip))) {
      const layers = app.layers || {};
      const vipUrl = (typeof layers.vip === 'string' ? layers.vip : null)
        || app.endpoints?.[env]?.vip
        || app.endpoints?.prod?.vip;

      if (vipUrl) {
        try {
          const parsedVip = new URL(vipUrl);
          const vipEntityId = `vip:${parsedVip.hostname}`;
          await store.upsertEntity({
            entity_id: vipEntityId,
            kind: 'vip',
            name: `VIP: ${parsedVip.hostname}`,
            app_id: appId,
            environment: env,
            labels: { url: vipUrl, layer: 'network' },
            source: 'yaml',
            status: 'Active'
          });
          entityCount++;

          await store.upsertEdge({
            from_entity: vipEntityId,
            to_entity: appEntityId,
            edge_type: 'routes_traffic_to',
            confidence: 1.0,
            source: 'yaml'
          });
          edgeCount++;
        } catch (_) {}
      }

      // Hosts layer: VIP -> Product -> Hosts
      const hostList = Array.isArray(layers.hosts) ? layers.hosts : [];
      const createdHostIds = [];
      for (const hostName of hostList) {
        if (!hostName) continue;
        const hostEntityId = resolver.host(hostName);
        createdHostIds.push(hostEntityId);
        await store.upsertEntity({
          entity_id: hostEntityId,
          kind: 'host',
          name: hostName,
          app_id: appId,
          environment: env,
          labels: { layer: 'host' },
          source: 'yaml',
          status: 'Active'
        });
        entityCount++;

        await store.upsertEdge({
          from_entity: appEntityId,
          to_entity: hostEntityId,
          edge_type: 'runs_on',
          confidence: 1.0,
          source: 'yaml'
        });
        edgeCount++;
      }

      // Shares layer: Hosts -> Shares (and Product -> Shares)
      const rawShares = Array.isArray(layers.shares) ? layers.shares : (layers.nfs?.mount ? [layers.nfs.mount] : []);
      const createdShareIds = [];
      for (const sharePath of rawShares) {
        if (!sharePath) continue;
        const cleanShare = String(sharePath).replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
        const shareEntityId = `share:${cleanShare}`;
        createdShareIds.push(shareEntityId);
        await store.upsertEntity({
          entity_id: shareEntityId,
          kind: 'storage',
          name: `Share: ${sharePath}`,
          app_id: appId,
          environment: env,
          labels: { path: sharePath, layer: 'storage' },
          source: 'yaml',
          status: 'Active'
        });
        entityCount++;

        // Edge from each host to share (hosts mount shares)
        for (const hid of createdHostIds) {
          await store.upsertEdge({
            from_entity: hid,
            to_entity: shareEntityId,
            edge_type: 'mounts',
            confidence: 1.0,
            source: 'yaml'
          });
          edgeCount++;
        }

        // Edge from product to share
        await store.upsertEdge({
          from_entity: appEntityId,
          to_entity: shareEntityId,
          edge_type: 'mounts',
          confidence: 1.0,
          source: 'yaml'
        });
        edgeCount++;
      }

      // Databases layer: Shares/Hosts/Product -> Databases
      const rawDbs = Array.isArray(layers.databases) ? layers.databases : (layers.db?.jdbc ? [layers.db.jdbc] : []);
      for (const dbConn of rawDbs) {
        if (!dbConn) continue;
        const cleanDb = String(dbConn).replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
        const dbEntityId = `database:${cleanDb}`;
        await store.upsertEntity({
          entity_id: dbEntityId,
          kind: 'database',
          name: `Database: ${dbConn}`,
          app_id: appId,
          environment: env,
          labels: { connection: dbConn, layer: 'database' },
          source: 'yaml',
          status: 'Active'
        });
        entityCount++;

        // Edge from product to DB
        await store.upsertEdge({
          from_entity: appEntityId,
          to_entity: dbEntityId,
          edge_type: 'reads_writes',
          confidence: 1.0,
          source: 'yaml'
        });
        edgeCount++;

        // Edge from each share/host to DB if applicable
        for (const sid of createdShareIds) {
          await store.upsertEdge({
            from_entity: sid,
            to_entity: dbEntityId,
            edge_type: 'persists_to',
            confidence: 0.9,
            source: 'yaml'
          });
          edgeCount++;
        }
      }

      // Clusters layer: Product -> Clusters
      const rawClusters = Array.isArray(layers.clusters) ? layers.clusters : [];
      for (const clusterName of rawClusters) {
        if (!clusterName) continue;
        const clusterEntityId = resolver.k8sCluster(clusterName);
        await store.upsertEntity({
          entity_id: clusterEntityId,
          kind: 'k8s_cluster',
          name: clusterName,
          app_id: appId,
          environment: env,
          labels: { cluster: clusterName, layer: 'compute' },
          source: 'yaml',
          status: 'Active'
        });
        entityCount++;

        await store.upsertEdge({
          from_entity: appEntityId,
          to_entity: clusterEntityId,
          edge_type: 'depends_on',
          confidence: 1.0,
          source: 'yaml'
        });
        edgeCount++;
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
