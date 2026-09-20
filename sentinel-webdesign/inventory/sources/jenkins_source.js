/**
 * inventory/sources/jenkins_source.js
 *
 * Discovers live build agent fleet and controllers from CloudBees Jenkins / OC (T1.3).
 */

const resolver = require('../entity_resolver');
const store = require('../store');

async function syncJenkinsInventory(jenkinsData = null) {
  // If data is provided (from collector or test fixture), process it.
  // Otherwise degrade gracefully without throwing.
  if (!jenkinsData) return { discoveredAgents: 0, discoveredControllers: 0 };

  let agentsCount = 0;
  let controllersCount = 0;
  const appId = 'cloudbees_jenkins';
  const appEntityId = resolver.app(appId);
  const env = global.runtimeEnvironment || 'staging';

  // Process live agents (computers)
  if (Array.isArray(jenkinsData.computers)) {
    for (const comp of jenkinsData.computers) {
      const agentName = comp.displayName || comp.name;
      if (!agentName) continue;

      const agentEntityId = resolver.agent(appId, agentName);
      await store.upsertEntity({
        entity_id: agentEntityId,
        kind: 'agent',
        name: agentName,
        app_id: appId,
        region: comp.region || 'emea',
        environment: env,
        parent_id: appEntityId,
        labels: {
          os: comp.os || (agentName.includes('win') ? 'windows' : 'linux'),
          executors: comp.numExecutors || 1,
          offline: !!comp.offline
        },
        source: 'jenkins_api',
        status: comp.offline ? 'Offline' : 'Active'
      });
      agentsCount++;

      await store.upsertEdge({
        from_entity: agentEntityId,
        to_entity: appEntityId,
        edge_type: 'member_of',
        confidence: 1.0,
        source: 'jenkins_api'
      });

      // If host is identified, link host -> agent
      if (comp.hostName || comp.ip) {
        const hostEntityId = resolver.host(comp.hostName || comp.ip);
        await store.upsertEntity({
          entity_id: hostEntityId,
          kind: 'host',
          name: comp.hostName || comp.ip,
          app_id: appId,
          environment: env,
          source: 'jenkins_api',
          status: 'Active'
        });

        await store.upsertEdge({
          from_entity: agentEntityId,
          to_entity: hostEntityId,
          edge_type: 'runs_on',
          confidence: 1.0,
          source: 'jenkins_api'
        });
      }
    }
  }

  return { discoveredAgents: agentsCount, discoveredControllers: controllersCount };
}

module.exports = { syncJenkinsInventory };
