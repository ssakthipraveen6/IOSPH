/**
 * inventory/sources/otlp_source.js
 *
 * Auto-registers host, service, and container entities from incoming
 * OpenTelemetry resource attributes on first ingestion (T1.3).
 */

const resolver = require('../entity_resolver');
const store = require('../store');

/**
 * Extracts resource attributes dictionary from an OTLP resource payload.
 */
function extractAttributes(resource) {
  const attrs = {};
  if (!resource || !Array.isArray(resource.attributes)) return attrs;

  for (const attr of resource.attributes) {
    if (!attr || !attr.key) continue;
    const val = attr.value?.stringValue ??
                attr.value?.intValue ??
                attr.value?.doubleValue ??
                attr.value?.boolValue ??
                null;
    attrs[attr.key] = val;
  }
  return attrs;
}

/**
 * Processes an incoming OTLP payload to automatically discover and link entities.
 *
 * @param {object} otlpPayload - Standard OTLP metrics or traces payload
 * @returns {Promise<Array<{ entity_id: string, kind: string }>>}
 */
async function processOtlpPayload(otlpPayload) {
  if (!otlpPayload || !Array.isArray(otlpPayload.resourceMetrics)) {
    return [];
  }

  const registered = [];

  for (const rm of otlpPayload.resourceMetrics) {
    const attrs = extractAttributes(rm.resource);
    const hostName = attrs['host.name'] || attrs['host.id'];
    const serviceName = attrs['service.name'] || attrs['app.name'] || 'unknown_service';
    const env = attrs['environment'] || attrs['deployment.environment'] || global.runtimeEnvironment || 'staging';
    const region = attrs['cloud.region'] || attrs['region'] || 'emea';

    let hostEntity = null;
    let serviceEntity = null;

    // 1. Auto-register Application / Service entity
    if (serviceName) {
      const appEntityId = resolver.app(serviceName);
      serviceEntity = await store.upsertEntity({
        entity_id: appEntityId,
        kind: 'app',
        name: serviceName,
        app_id: serviceName,
        region,
        environment: env,
        labels: {
          runtime: attrs['process.runtime.name'] || 'unknown',
          version: attrs['service.version'] || 'unknown'
        },
        source: 'otlp',
        status: 'Active'
      });
      registered.push(serviceEntity);
    }

    // 2. Auto-register Host entity
    if (hostName) {
      const hostEntityId = resolver.host(hostName);
      hostEntity = await store.upsertEntity({
        entity_id: hostEntityId,
        kind: 'host',
        name: hostName,
        app_id: serviceName,
        region,
        environment: env,
        labels: {
          os: attrs['os.type'] || attrs['os.description'] || 'unknown',
          arch: attrs['host.arch'] || 'unknown'
        },
        source: 'otlp',
        status: 'Active'
      });
      registered.push(hostEntity);

      // 3. Link Host -> App via 'runs_on' edge
      if (serviceEntity) {
        await store.upsertEdge({
          from_entity: hostEntity.entity_id,
          to_entity: serviceEntity.entity_id,
          edge_type: 'runs_on',
          confidence: 1.0,
          source: 'otlp'
        });
      }
    }

    // 4. Auto-register Kubernetes cluster / node if attributes present
    const clusterName = attrs['k8s.cluster.name'];
    const nodeName = attrs['k8s.node.name'];

    if (clusterName && nodeName) {
      const clusterEntityId = resolver.k8sCluster(clusterName);
      const nodeEntityId = resolver.k8sNode(clusterName, nodeName);

      const clusterEntity = await store.upsertEntity({
        entity_id: clusterEntityId,
        kind: 'k8s_cluster',
        name: clusterName,
        environment: env,
        region,
        source: 'otlp',
        status: 'Active'
      });
      registered.push(clusterEntity);

      const nodeEntity = await store.upsertEntity({
        entity_id: nodeEntityId,
        kind: 'k8s_node',
        name: nodeName,
        parent_id: clusterEntityId,
        environment: env,
        region,
        source: 'otlp',
        status: 'Active'
      });
      registered.push(nodeEntity);

      await store.upsertEdge({
        from_entity: nodeEntityId,
        to_entity: clusterEntityId,
        edge_type: 'member_of',
        confidence: 1.0,
        source: 'otlp'
      });

      if (hostEntity) {
        await store.upsertEdge({
          from_entity: hostEntity.entity_id,
          to_entity: nodeEntityId,
          edge_type: 'runs_on',
          confidence: 1.0,
          source: 'otlp'
        });
      }
    }
  }

  return registered;
}

module.exports = {
  extractAttributes,
  processOtlpPayload
};
