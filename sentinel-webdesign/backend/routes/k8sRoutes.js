/**
 * Kubernetes routes: clusters, nodes and pods from the inventory and ClickHouse.
 */
const express = require('express');
const router = express.Router();
const { requestEnvironment, dataUnavailable } = require('./_prototype');
const inventory = require('../../inventory/store');
const clickhouse = require('../../database/clickhouse');

// Kubernetes mesh: clusters, nodes, workloads.
router.get('/mesh', async (req, res) => {
  const env = requestEnvironment(req);

  try {
    let k8sEntities = null;
    try {
      k8sEntities = await inventory.getEntities({
        environment: env,
        kind: 'k8s_node',
        limit: 200
      });
    } catch (_) {}

    const realNodes = (k8sEntities && k8sEntities.entities) || [];

    // Query ClickHouse for k8s.* metrics
    let metricsMap = {};
    if (clickhouse.isConfigured && clickhouse.isConfigured()) {
      try {
        const rows = await clickhouse.query(
          `SELECT metric_name, argMax(value, ts) AS value
           FROM metrics
           WHERE env = {env:String}
             AND (metric_name LIKE 'k8s.%' OR metric_name LIKE 'k8s_%')
             AND ts >= now64(3) - INTERVAL 15 MINUTE
           GROUP BY metric_name`,
          { env }
        );
        if (Array.isArray(rows) && rows.length > 0) {
          rows.forEach(r => {
            const num = Number(r.value);
            if (!isNaN(num)) {
              metricsMap[r.metric_name] = num;
              metricsMap[r.metric_name.replace(/\./g, '_')] = num;
            }
          });
        }
      } catch (_) {}
    }

    const hasMetrics = Object.keys(metricsMap).length > 0;
    const hasNodes = realNodes.length > 0;

    if (!hasNodes && !hasMetrics) {
      return res.json({
        status: 'DATA_UNAVAILABLE',
        environment: env,
        prototype: false,
        reason: 'Kubernetes view has no active DaemonSet nodes or cluster metrics reporting in this environment.',
        coresAllocated: null,
        coresTotal: null,
        memoryCommittedTb: null,
        memoryTotalTb: null,
        objectCounts: {
          namespaces: null,
          statefulSets: null,
          deployments: null,
          runningPods: null,
          serviceEndpoints: null
        },
        containerRestarts: null,
        namespaceUsage: null,
        nodes: undefined,
        timestamp: new Date().toISOString()
      });
    }

    const nodes = hasNodes ? realNodes.map(n => ({
      id: n.name || n.id,
      status: (n.status || 'healthy').toLowerCase(),
      cpuLoad: typeof n.cpuLoad === 'number' ? n.cpuLoad : null,
      memoryLoad: typeof n.memoryLoad === 'number' ? n.memoryLoad : null
    })) : null;

    const coresAllocated = metricsMap['k8s.cluster.cpu.requests'] ??
      metricsMap['k8s.pod.cpu.request'] ??
      metricsMap['k8s.node.cpu.usage'] ??
      metricsMap['k8s_cores_allocated'] ??
      null;

    const coresTotal = metricsMap['k8s.cluster.cpu.allocatable'] ??
      metricsMap['k8s.node.cpu.allocatable'] ??
      metricsMap['k8s.node.allocatable_cpu'] ??
      metricsMap['k8s_cores_total'] ??
      null;

    const rawMemCommitted = metricsMap['k8s.cluster.memory.requests'] ??
      metricsMap['k8s.pod.memory.request'] ??
      metricsMap['k8s.node.memory.usage'] ??
      metricsMap['k8s_memory_committed_tb'];
    const memoryCommittedTb = rawMemCommitted != null
      ? (rawMemCommitted > 1000000 ? rawMemCommitted / (1024 ** 4) : rawMemCommitted)
      : null;

    const rawMemTotal = metricsMap['k8s.cluster.memory.allocatable'] ??
      metricsMap['k8s.node.memory.allocatable'] ??
      metricsMap['k8s.node.allocatable_memory'] ??
      metricsMap['k8s_memory_total_tb'];
    const memoryTotalTb = rawMemTotal != null
      ? (rawMemTotal > 1000000 ? rawMemTotal / (1024 ** 4) : rawMemTotal)
      : null;

    const objectCounts = {
      namespaces: metricsMap['k8s.namespace.count'] ?? metricsMap['k8s_namespaces'] ?? null,
      statefulSets: metricsMap['k8s.statefulset.count'] ?? metricsMap['k8s_statefulsets'] ?? null,
      deployments: metricsMap['k8s.deployment.count'] ?? metricsMap['k8s_deployments'] ?? null,
      runningPods: metricsMap['k8s.pod.count'] ?? metricsMap['k8s_running_pods'] ?? null,
      serviceEndpoints: metricsMap['k8s.endpoint.count'] ?? metricsMap['k8s_service_endpoints'] ?? null
    };

    res.json({
      status: 'OK',
      prototype: false,
      environment: env,
      coresAllocated,
      coresTotal,
      memoryCommittedTb,
      memoryTotalTb,
      objectCounts,
      containerRestarts: { history: [] },
      namespaceUsage: [],
      nodes: nodes || [],
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return dataUnavailable(res, env, `Kubernetes query error: ${err.message}`);
  }
});

module.exports = router;
