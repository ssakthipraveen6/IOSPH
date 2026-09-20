/**
 * inventory/sources/avi_source.js
 *
 * Discovers AVI Vantage virtual services and pool members to build
 * 'routes_through' relationship edges (T1.3).
 */

const resolver = require('../entity_resolver');
const store = require('../store');

async function syncAviInventory(aviData = null) {
  if (!aviData || !Array.isArray(aviData.results)) {
    return { discoveredServices: 0 };
  }

  let count = 0;
  const env = global.runtimeEnvironment || 'staging';

  for (const vs of aviData.results) {
    const vsName = vs.name;
    if (!vsName) continue;

    const vsEntityId = resolver.avi(vsName);
    await store.upsertEntity({
      entity_id: vsEntityId,
      kind: 'avi',
      name: vsName,
      environment: env,
      labels: {
        vip: vs.ip_address?.addr || null,
        enabled: vs.enabled !== false
      },
      source: 'avi_api',
      status: 'Active'
    });
    count++;

    // Connect pool server members to the virtual service
    if (Array.isArray(vs.pool_members)) {
      for (const member of vs.pool_members) {
        const hostEntityId = resolver.host(member.ip || member.hostname);
        await store.upsertEntity({
          entity_id: hostEntityId,
          kind: 'host',
          name: member.hostname || member.ip,
          environment: env,
          source: 'avi_api',
          status: 'Active'
        });

        await store.upsertEdge({
          from_entity: hostEntityId,
          to_entity: vsEntityId,
          edge_type: 'routes_through',
          confidence: 1.0,
          source: 'avi_api'
        });
      }
    }
  }

  return { discoveredServices: count };
}

module.exports = { syncAviInventory };
