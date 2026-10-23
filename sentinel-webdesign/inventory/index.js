/**
 * inventory/index.js
 *
 * Public API for @sentinel/inventory package.
 * Coordinates entity lifecycle, source discovery cycles, and graph queries.
 */

const resolver = require('./entity_resolver');
const store = require('./store');
const yamlSource = require('./sources/yaml_source');
const otlpSource = require('./sources/otlp_source');
const jenkinsSource = require('./sources/jenkins_source');
const teamcitySource = require('./sources/teamcity_source');
const k8sSource = require('./sources/k8s_source');
const aviSource = require('./sources/avi_source');

// Runs every inventory source (YAML, OTLP, Jenkins, TeamCity, Kubernetes, AVI).
async function syncAllSources() {
  console.log('[INVENTORY] Triggering full inventory sync cycle...');
  try {
    const yamlResult = await yamlSource.syncYamlTopology();
    console.log(`[INVENTORY] YAML topology sync completed: ${yamlResult.entityCount} entities, ${yamlResult.edgeCount} edges.`);
  } catch (err) {
    console.warn('[INVENTORY] YAML topology sync warning:', err.message);
  }
  try {
    const k8s = await k8sSource.discover();
    if (k8s.status !== 'NOT_CONFIGURED') console.log(`[INVENTORY] K8s discovery: ${JSON.stringify(k8s)}`);
  } catch (err) {
    console.warn('[INVENTORY] K8s discovery warning:', err.message);
  }
}

module.exports = {
  resolver,
  store,
  sources: {
    yaml: yamlSource,
    otlp: otlpSource,
    jenkins: jenkinsSource,
    teamcity: teamcitySource,
    k8s: k8sSource,
    avi: aviSource
  },
  syncAllSources,
  getEntities: (opts) => store.getEntities(opts),
  queryEntities: (opts) => store.getEntities(opts),
  getEntityById: (id) => store.getEntityById(id),
  getEntityGraph: (id, depth) => store.getEntityGraph(id, depth),
  upsertEntity: (e) => store.upsertEntity(e),
  upsertEdge: (edge) => store.upsertEdge(edge),
  markStaleEntities: (ttl) => store.markStaleEntities(ttl)
};
