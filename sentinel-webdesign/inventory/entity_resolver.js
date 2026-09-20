/**
 * inventory/entity_resolver.js
 *
 * Deterministic, stable entity ID resolver per Section 5 (T1.2).
 */

function sanitizeIdPart(str) {
  if (!str) return 'unknown';
  return String(str).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

const entityResolver = {
  app(appId) {
    return `app:${sanitizeIdPart(appId)}`;
  },

  host(fqdn) {
    return `host:${sanitizeIdPart(fqdn)}`;
  },

  agent(appId, agentName) {
    return `agent:${sanitizeIdPart(appId)}:${sanitizeIdPart(agentName)}`;
  },

  controller(ocId, controllerName) {
    return `controller:${sanitizeIdPart(ocId)}:${sanitizeIdPart(controllerName)}`;
  },

  k8sNode(clusterId, nodeName) {
    return `k8snode:${sanitizeIdPart(clusterId)}:${sanitizeIdPart(nodeName)}`;
  },

  k8sCluster(clusterId) {
    return `k8scluster:${sanitizeIdPart(clusterId)}`;
  },

  avi(vsName) {
    return `avi:${sanitizeIdPart(vsName)}`;
  },

  storage(volumeId) {
    return `storage:${sanitizeIdPart(volumeId)}`;
  },

  url(hostname) {
    return `url:${sanitizeIdPart(hostname)}`;
  },

  service(serviceName) {
    return `service:${sanitizeIdPart(serviceName)}`;
  },

  sensor(appId, sensorName) {
    return `sensor:${sanitizeIdPart(appId)}:${sanitizeIdPart(sensorName)}`;
  },

  /**
   * Resolves an entity ID dynamically given kind and parameters.
   */
  resolve(kind, params = {}) {
    switch (kind) {
      case 'app':
        return this.app(params.appId || params.name || params.id);
      case 'host':
        return this.host(params.fqdn || params.hostName || params.name);
      case 'agent':
        return this.agent(params.appId, params.agentName || params.name);
      case 'controller':
        return this.controller(params.ocId, params.controllerName || params.name);
      case 'k8s_node':
      case 'k8snode':
        return this.k8sNode(params.clusterId, params.nodeName || params.name);
      case 'k8s_cluster':
      case 'k8scluster':
        return this.k8sCluster(params.clusterId || params.name);
      case 'avi':
        return this.avi(params.vsName || params.name);
      case 'storage':
        return this.storage(params.volumeId || params.name);
      case 'url':
        return this.url(params.hostname || params.name);
      case 'service':
        return this.service(params.serviceName || params.name);
      case 'sensor':
        return this.sensor(params.appId, params.sensorName || params.name);
      default:
        return `${sanitizeIdPart(kind)}:${sanitizeIdPart(params.name || params.id || 'unnamed')}`;
    }
  }
};

module.exports = entityResolver;
