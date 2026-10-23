/**
 * tests/phase_o4_k8s_routes.test.js
 *
 * Phase O4 / O4.1 Kubernetes Endpoints Acceptance:
 * Tests the 4 hierarchy levels in infraRoutes.js:
 *  1. GET /api/v2/infra/k8s/clusters
 *  2. GET /api/v2/infra/k8s/:cluster
 *  3. GET /api/v2/infra/k8s/:cluster/namespaces/:ns
 *  4. GET /api/v2/infra/k8s/:cluster/workloads/:name
 *
 * Checks:
 *  - Real node conditions, pods by phase, crashloop/oomkilled, requests vs allocatable vs used,
 *    quotas, HPA at max, PVC fill, image drift, Warning events.
 *  - Empty data returns DATA_UNAVAILABLE with nulls and reasons (zero fabrication).
 *  - Forbidden environment returns 403.
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createInfraRouter } = require('../backend/routes/infraRoutes');

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    }).on('error', reject);
  });
}

function memoryInventory(entities = []) {
  const store = [...entities];
  return {
    async getEntities({ kind, environment }) {
      return store.filter(e =>
        (!kind || String(e.kind).toLowerCase() === String(kind).toLowerCase()) &&
        (!environment || e.environment === environment)
      );
    }
  };
}

async function main() {
  console.log('=== PHASE O4.1: KUBERNETES HIERARCHY API TESTS ===');
  const closers = [];

  try {
    const mockEntities = [
      // Cluster entity
      {
        entity_id: 'k8s_cluster:prod-k8s-us-east',
        name: 'prod-k8s-us-east',
        kind: 'k8s_cluster',
        environment: 'staging',
        status: 'HEALTHY'
      },
      // Nodes
      {
        entity_id: 'k8s_node:worker-node-01',
        name: 'worker-node-01',
        kind: 'k8s_node',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          condition_ready: true,
          condition_disk_pressure: false,
          condition_memory_pressure: false,
          condition_pid_pressure: false,
          cpu_allocatable: 32.0,
          cpu_usage: 14.5,
          memory_allocatable: 137438953472, // 128 GB
          memory_usage: 68719476736        // 64 GB
        }
      },
      {
        entity_id: 'k8s_node:worker-node-02',
        name: 'worker-node-02',
        kind: 'k8s_node',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          condition_ready: false,
          condition_disk_pressure: true,
          condition_memory_pressure: false,
          condition_pid_pressure: false,
          cpu_allocatable: 32.0,
          cpu_usage: 28.0,
          memory_allocatable: 137438953472,
          memory_usage: 120000000000
        }
      },
      // Pods
      {
        entity_id: 'k8s_pod:artifactory-app-7b6c5d-x1',
        name: 'artifactory-app-7b6c5d-x1',
        kind: 'k8s_pod',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          namespace: 'artifactory',
          workload: 'artifactory-app',
          node_name: 'worker-node-01',
          phase: 'Running',
          restarts: 0,
          image: 'releases.jfrog.io/artifactory-pro:7.77.5',
          cpu_requests: 4.0,
          cpu_usage: 3.2,
          memory_requests: 17179869184,
          memory_usage: 15000000000
        }
      },
      {
        entity_id: 'k8s_pod:artifactory-app-7b6c5d-x2',
        name: 'artifactory-app-7b6c5d-x2',
        kind: 'k8s_pod',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          namespace: 'artifactory',
          workload: 'artifactory-app',
          node_name: 'worker-node-02',
          phase: 'Running',
          restarts: 8,
          status_reason: 'CrashLoopBackOff',
          image: 'releases.jfrog.io/artifactory-pro:7.77.6', // Image drift!
          cpu_requests: 4.0,
          cpu_usage: 3.9,
          memory_requests: 17179869184,
          memory_usage: 16800000000
        }
      },
      {
        entity_id: 'k8s_pod:jenkins-agent-d4-z9',
        name: 'jenkins-agent-d4-z9',
        kind: 'k8s_pod',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          namespace: 'ci-toolchain',
          workload: 'jenkins-agent',
          node_name: 'worker-node-02',
          phase: 'Failed',
          restarts: 1,
          status_reason: 'OOMKilled',
          image: 'jenkins/inbound-agent:3248.v65ec',
          cpu_requests: 2.0,
          cpu_usage: 2.0,
          memory_requests: 8589934592,
          memory_usage: 8589934592
        }
      },
      // Workload
      {
        entity_id: 'k8s_workload:artifactory-app',
        name: 'artifactory-app',
        kind: 'k8s_workload',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          namespace: 'artifactory',
          workload_type: 'Deployment',
          replicas_desired: 2,
          replicas_ready: 2
        }
      },
      // Quota
      {
        entity_id: 'k8s_quota:artifactory-quota',
        name: 'artifactory',
        kind: 'k8s_quota',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          namespace: 'artifactory',
          cpu_used: 8.0,
          cpu_hard: 16.0,
          memory_used: 34359738368,
          memory_hard: 68719476736
        }
      },
      // PVC
      {
        entity_id: 'k8s_pvc:artifactory-filestore',
        name: 'artifactory-filestore',
        kind: 'k8s_pvc',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          namespace: 'artifactory',
          used_bytes: 858993459200, // 800 GB
          capacity_bytes: 1099511627776 // 1 TB (80%)
        }
      },
      // HPA
      {
        entity_id: 'k8s_hpa:artifactory-hpa',
        name: 'artifactory-hpa',
        kind: 'k8s_hpa',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          namespace: 'artifactory',
          current_replicas: 10,
          max_replicas: 10 // At max!
        }
      },
      // Warning Event
      {
        entity_id: 'k8s_event:ev-oom-jenkins',
        name: 'Pod jenkins-agent-d4-z9 exceeded memory limit and was OOMKilled',
        kind: 'k8s_event',
        environment: 'staging',
        labels: {
          cluster: 'prod-k8s-us-east',
          namespace: 'ci-toolchain',
          workload: 'jenkins-agent',
          reason: 'OOMKilled',
          source: 'kubelet'
        }
      }
    ];

    const inv = memoryInventory(mockEntities);

    const app = express();
    app.use((req, res, next) => {
      req.sentinelEnv = 'staging';
      req.user = { role: 'admin' };
      next();
    });
    app.use('/api/v2/infra', createInfraRouter({ inv }));

    const server = http.createServer(app);
    const port = await listen(server);
    closers.push(() => server.close());

    // -------------------------------------------------------------
    // Level 1: GET /api/v2/infra/k8s/clusters
    // -------------------------------------------------------------
    const resClusters = await fetchJson(`http://127.0.0.1:${port}/api/v2/infra/k8s/clusters`);
    assert.strictEqual(resClusters.status, 200);
    assert.strictEqual(resClusters.body.status, 'OK');
    assert.strictEqual(resClusters.body.count, 1);
    const cl = resClusters.body.clusters[0];
    assert.strictEqual(cl.cluster, 'prod-k8s-us-east');
    assert.strictEqual(cl.nodes_count, 2);
    assert.strictEqual(cl.pods_count, 3);
    assert.strictEqual(cl.cpu_allocatable, 64.0);
    assert.strictEqual(cl.cpu_used, 42.5);
    console.log('✔ Level 1 (Clusters): retrieved cluster summary with nodes and pods roll-up');

    // -------------------------------------------------------------
    // Level 2: GET /api/v2/infra/k8s/:cluster
    // -------------------------------------------------------------
    const resDetail = await fetchJson(`http://127.0.0.1:${port}/api/v2/infra/k8s/prod-k8s-us-east`);
    assert.strictEqual(resDetail.status, 200);
    assert.strictEqual(resDetail.body.status, 'OK');
    assert.strictEqual(resDetail.body.cluster, 'prod-k8s-us-east');

    // Assert Node conditions
    assert.strictEqual(resDetail.body.node_conditions.length, 2);
    const worker2 = resDetail.body.node_conditions.find(n => n.node === 'worker-node-02');
    assert.strictEqual(worker2.ready, false);
    assert.strictEqual(worker2.disk_pressure, true);

    // Assert Pods by phase & problem states
    assert.strictEqual(resDetail.body.pods_by_phase.running, 2);
    assert.strictEqual(resDetail.body.pods_by_phase.failed, 1);
    assert.strictEqual(resDetail.body.pods_by_phase.crashloop, 1);
    assert.strictEqual(resDetail.body.pods_by_phase.oomkilled, 1);

    // Assert Requests vs Allocatable vs Used
    assert.strictEqual(resDetail.body.resources.cpu.allocatable, 64.0);
    assert.strictEqual(resDetail.body.resources.cpu.requests, 10.0);
    assert.strictEqual(resDetail.body.resources.cpu.used, 42.5);

    // Assert Quotas, HPA at max, PVC fill, image drift, Warning events
    assert.strictEqual(resDetail.body.quotas.length, 1);
    assert.strictEqual(resDetail.body.hpa_at_max.length, 1);
    assert.strictEqual(resDetail.body.hpa_at_max[0].hpa, 'artifactory-hpa');

    assert.strictEqual(resDetail.body.pvc_fill.length, 1);
    assert.strictEqual(resDetail.body.pvc_fill[0].fill_pct, 78.1); // 858993459200 / 1099511627776 = 78.1%

    assert.strictEqual(resDetail.body.image_drift.length, 1);
    assert.strictEqual(resDetail.body.image_drift[0].workload, 'artifactory-app');
    assert.strictEqual(resDetail.body.image_drift[0].images.length, 2);

    assert.strictEqual(resDetail.body.warning_events.length, 1);
    assert.strictEqual(resDetail.body.warning_events[0].reason, 'OOMKilled');
    console.log('✔ Level 2 (Cluster detail): verified node conditions, pods by phase, quotas, HPA, PVC, image drift, Warning events');

    // -------------------------------------------------------------
    // Level 3: GET /api/v2/infra/k8s/:cluster/namespaces/:ns
    // -------------------------------------------------------------
    const resNs = await fetchJson(`http://127.0.0.1:${port}/api/v2/infra/k8s/prod-k8s-us-east/namespaces/artifactory`);
    assert.strictEqual(resNs.status, 200);
    assert.strictEqual(resNs.body.status, 'OK');
    assert.strictEqual(resNs.body.namespace, 'artifactory');
    assert.strictEqual(resNs.body.workloads.length, 1);
    assert.strictEqual(resNs.body.workloads[0].workload, 'artifactory-app');
    assert.strictEqual(resNs.body.pods.length, 2);
    assert.ok(resNs.body.quota !== null, 'quota must be populated');
    assert.strictEqual(resNs.body.quota.cpu_used, 8.0);
    assert.strictEqual(resNs.body.pvcs.length, 1);
    console.log('✔ Level 3 (Namespace detail): verified workloads, pods, quotas, and PVCs in namespace');

    // -------------------------------------------------------------
    // Level 4: GET /api/v2/infra/k8s/:cluster/workloads/:name
    // -------------------------------------------------------------
    const resWl = await fetchJson(`http://127.0.0.1:${port}/api/v2/infra/k8s/prod-k8s-us-east/workloads/artifactory-app`);
    assert.strictEqual(resWl.status, 200);
    assert.strictEqual(resWl.body.status, 'OK');
    assert.strictEqual(resWl.body.workload, 'artifactory-app');
    assert.strictEqual(resWl.body.replicas.desired, 2);
    assert.strictEqual(resWl.body.replicas.ready, 2);
    assert.strictEqual(resWl.body.pods.length, 2);
    assert.strictEqual(resWl.body.image_drift.has_drift, true);
    assert.strictEqual(resWl.body.image_drift.images.length, 2);
    console.log('✔ Level 4 (Workload detail): verified replicas, pods, and image drift detection');

    // -------------------------------------------------------------
    // Empty data & 403 checks
    // -------------------------------------------------------------
    const resUnknownCluster = await fetchJson(`http://127.0.0.1:${port}/api/v2/infra/k8s/non-existent-cluster`);
    assert.strictEqual(resUnknownCluster.status, 200);
    assert.strictEqual(resUnknownCluster.body.status, 'DATA_UNAVAILABLE');
    assert.strictEqual(resUnknownCluster.body.node_conditions, null);

    const appForbidden = express();
    appForbidden.use((req, res, next) => {
      req.sentinelEnv = 'forbidden';
      next();
    });
    appForbidden.use('/api/v2/infra', createInfraRouter({ inv }));
    const srvForbidden = http.createServer(appForbidden);
    const portForbidden = await listen(srvForbidden);
    closers.push(() => srvForbidden.close());

    const resForbidden = await fetchJson(`http://127.0.0.1:${portForbidden}/api/v2/infra/k8s/clusters`);
    assert.strictEqual(resForbidden.status, 403);
    console.log('✔ Empty data returns DATA_UNAVAILABLE; forbidden env returns 403');

    console.log('=== ALL PHASE O4.1 KUBERNETES TESTS PASSED ===');
  } finally {
    for (const c of closers) {
      try { c(); } catch (_) {}
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
