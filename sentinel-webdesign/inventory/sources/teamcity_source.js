/**
 * inventory/sources/teamcity_source.js
 *
 * Discovers build agents from JetBrains TeamCity REST API (T1.3).
 */

const resolver = require('../entity_resolver');
const store = require('../store');

async function syncTeamCityInventory(teamcityData = null) {
  if (!teamcityData || !Array.isArray(teamcityData.agent)) {
    return { discoveredAgents: 0 };
  }

  let agentsCount = 0;
  const appId = 'jetbrains_teamcity';
  const appEntityId = resolver.app(appId);
  const env = global.runtimeEnvironment || 'staging';

  for (const agent of teamcityData.agent) {
    const agentName = agent.name || `agent-${agent.id}`;
    const agentEntityId = resolver.agent(appId, agentName);

    await store.upsertEntity({
      entity_id: agentEntityId,
      kind: 'agent',
      name: agentName,
      app_id: appId,
      environment: env,
      parent_id: appEntityId,
      labels: {
        connected: !!agent.connected,
        enabled: !!agent.enabled,
        pool: agent.pool ? agent.pool.name : 'default'
      },
      source: 'teamcity_api',
      status: agent.connected ? 'Active' : 'Offline'
    });
    agentsCount++;

    await store.upsertEdge({
      from_entity: agentEntityId,
      to_entity: appEntityId,
      edge_type: 'member_of',
      confidence: 1.0,
      source: 'teamcity_api'
    });
  }

  return { discoveredAgents: agentsCount };
}

module.exports = { syncTeamCityInventory };
