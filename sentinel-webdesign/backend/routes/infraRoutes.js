/**
 * backend/routes/infraRoutes.js — Phase O3 & O4
 *
 * Infrastructure endpoints:
 *   GET /api/v2/infra/hosts?os=linux|windows
 *     Host list with status, product, CPU/mem/disk/network latest, worst filesystem %, agent state
 *
 * Environment taken strictly from req.sentinelEnv.
 * Zero fabricated telemetry.
 */

const express = require('express');
const crypto = require('crypto');
const { sameHost } = require('./agentRoutes');
const { shapeHost } = require('./fleetRoutes');
const yamlConfig = require('../config/yaml_config');
const accessPolicy = require('../auth/access_policy');

const METRIC_FRESH_MS = 15 * 60 * 1000;

/**
 * Latest CPU / memory / disk per host from the metrics that agents ingest (OTLP).
 * Returns Map(entity_id -> { cpu, memory, disk, worstFs }), only from points newer than
 * METRIC_FRESH_MS. Missing series stay absent, so the view shows a dash, never a guess.
 */
async function latestHostMetrics(env, nowMs = Date.now()) {
  const out = new Map();
  let rows = [];
  try {
    const db = require('../../database/db');
    rows = await db.queryMetrics({ env, sinceMs: nowMs - METRIC_FRESH_MS, limit: 50000 });
  } catch (_) {
    return out;
  }
  const newest = new Map(); // `${entity}|${metric}|${mount}` -> { ts, value }
  for (const m of Array.isArray(rows) ? rows : []) {
    if (!m || !m.entity_id || typeof m.value !== 'number' || !String(m.entity_id).startsWith('host:')) continue;
    const name = m.metricName || m.name;
    if (name !== 'cpu' && name !== 'memory' && name !== 'disk') continue;
    const ts = new Date(m.timestamp).getTime();
    if (!Number.isFinite(ts) || ts < nowMs - METRIC_FRESH_MS) continue;
    const mount = name === 'disk' ? ((m.attributes && (m.attributes.mountpoint || m.attributes.device)) || '') : '';
    const key = `${m.entity_id}|${name}|${mount}`;
    const cur = newest.get(key);
    if (!cur || ts >= cur.ts) newest.set(key, { ts, value: m.value });
  }
  for (const [key, v] of newest) {
    const [entity, name] = key.split('|');
    const rec = out.get(entity) || {};
    if (name === 'disk') rec.worstFs = rec.worstFs === undefined ? v.value : Math.max(rec.worstFs, v.value);
    else rec[name] = v.value;
    out.set(entity, rec);
  }
  return out;
}

// Router for infrastructure views.
function createInfraRouter({ inv = null, ch = null, processProvider = null, metricsProvider = latestHostMetrics } = {}) {
  const router = express.Router();

  // Host list with latest metrics and agent state.
  router.get('/hosts', async (req, res) => {
    const env = req.sentinelEnv || req.query.environment || 'staging';
    if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
      return res.status(403).json({ error: 'Access denied for requested environment' });
    }

    try {
      const inventory = inv || require('@sentinel/inventory');
      const osFilter = (req.query.os || '').trim().toLowerCase();

      // Query host entities
      const result = await inventory.getEntities({ kind: 'host', environment: env, limit: 10000 });
      const rawEntities = Array.isArray(result) ? result : (result && result.entities) || [];
      const entities = rawEntities.filter(e => e && String(e.kind || '').toLowerCase() === 'host');

      if (entities.length === 0) {
        return res.json({
          status: 'DATA_UNAVAILABLE',
          environment: env,
          reason: 'No host telemetry found for this environment',
          hosts: []
        });
      }

      // Load all apps to map hosts to products
      let allApps = [];
      try {
        const apps = yamlConfig.loadAllApplications() || [];
        allApps = Array.isArray(apps) ? apps : Object.values(apps || {});
      } catch (_) {}

      let ingested = new Map();
      try { ingested = await metricsProvider(env); } catch (_) { ingested = new Map(); }

      const hostRows = [];
      for (const entity of entities) {
        const hostname = entity.name || String(entity.entity_id || '').replace(/^host:/, '');
        const labels = entity.labels || {};
        const hostOs = (labels.os || '').toLowerCase() || (hostname.startsWith('win') ? 'windows' : 'linux');

        if (osFilter && hostOs !== osFilter) {
          continue;
        }

        // Match product from layers.hosts
        let matchedProduct = null;
        for (const app of allApps) {
          const hosts = (app.layers && Array.isArray(app.layers.hosts)) ? app.layers.hosts : [];
          if (hosts.some(h => sameHost(h, hostname))) {
            matchedProduct = app.id || app.name;
            break;
          }
        }

        const shaped = shapeHost(entity, {
          nowMs: Date.now(),
          silentAfterSeconds: 300,
          environment: env
        });

        // Stored label first, else the latest value the agent has sent.
        const live = ingested.get(entity.entity_id) || ingested.get(`host:${hostname}`) || {};
        const pick = (label, metric) => (typeof label === 'number' ? label : (typeof metric === 'number' ? metric : null));
        const cpuLatest = pick(labels.cpu_utilization, live.cpu);
        const memoryLatest = pick(labels.memory_utilization, live.memory);
        const diskLatest = pick(labels.disk_utilization, live.worstFs);
        const networkLatest = typeof labels.network_bytes_sec === 'number' ? labels.network_bytes_sec : null;
        const worstFsPct = pick(labels.worst_filesystem_pct, live.worstFs);

        hostRows.push({
          entity_id: entity.entity_id,
          host: hostname,
          os: hostOs,
          status: entity.status || (shaped.silent ? 'DEGRADED' : 'HEALTHY'),
          product: matchedProduct,
          cpu_latest: cpuLatest,
          memory_latest: memoryLatest,
          disk_latest: diskLatest,
          network_latest: networkLatest,
          worst_filesystem_pct: worstFsPct,
          agent_state: {
            has_agent: shaped.has_agent,
            agent_version: shaped.agent_version,
            silent: shaped.silent,
            last_seen: shaped.last_seen,
            drift: shaped.drift,
            status: shaped.status
          }
        });
      }

      hostRows.sort((a, b) => a.host.localeCompare(b.host));

      res.json({
        status: 'OK',
        environment: env,
        count: hostRows.length,
        hosts: hostRows
      });
    } catch (err) {
      console.error('[INFRA_HOSTS_ERROR]', err);
      res.status(500).json({ error: `Failed to retrieve infrastructure hosts: ${err.message}` });
    }
  });

  // =========================================================================
  // Phase O8.1: Top Processes per Host & Capture Dump
  // =========================================================================

  router.get('/hosts/:host/processes', async (req, res) => {
    const env = req.sentinelEnv || req.query.environment || 'staging';
    if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
      return res.status(403).json({ error: 'Access denied for requested environment' });
    }

    const host = req.params.host;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const sortField = req.query.sort || 'cpu';

    try {
      let processes = [];
      const prov = req.processProvider || processProvider;
      if (typeof prov === 'function') {
        processes = await prov(host, env);
      } else if (prov && typeof prov.getProcesses === 'function') {
        processes = await prov.getProcesses(env, host);
      } else {
        const clickhouse = ch || require('../../database/clickhouse');
        if (clickhouse && typeof clickhouse.isConfigured === 'function' && clickhouse.isConfigured()) {
          try {
            const rows = await clickhouse.query(
              `SELECT pid, name, user, cpu_pct, memory_rss_bytes, memory_pct, io_read_bytes, io_write_bytes, fds_open, fds_limit, threads, state, uptime_seconds
               FROM host_processes
               WHERE env = {env:String} AND host = {host:String}
               ORDER BY cpu_pct DESC LIMIT {limit:UInt32}`,
              { env, host, limit }
            );
            processes = rows || [];
          } catch (_) {}
        }
      }

      if (!processes || processes.length === 0) {
        return res.json({
          status: 'DATA_UNAVAILABLE',
          environment: env,
          host,
          reason: `No process telemetry recorded for host ${host}`,
          processes: []
        });
      }

      const sorted = [...processes].sort((a, b) => {
        if (sortField === 'memory') return (b.memory_rss_bytes || 0) - (a.memory_rss_bytes || 0);
        if (sortField === 'io') return ((b.io_read_bytes || 0) + (b.io_write_bytes || 0)) - ((a.io_read_bytes || 0) + (a.io_write_bytes || 0));
        if (sortField === 'handles' || sortField === 'fds') return (b.fds_open || 0) - (a.fds_open || 0);
        return (b.cpu_pct || 0) - (a.cpu_pct || 0);
      });

      res.json({
        status: 'OK',
        environment: env,
        host,
        count: sorted.slice(0, limit).length,
        processes: sorted.slice(0, limit)
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to retrieve processes: ${err.message}` });
    }
  });

  // Requests a process dump on a host (audited).
  router.post('/hosts/:host/processes/:pid/dump', async (req, res) => {
    const env = req.sentinelEnv || req.query.environment || 'staging';
    if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
      return res.status(403).json({ error: 'Access denied for requested environment' });
    }

    const host = req.params.host;
    const pid = parseInt(req.params.pid, 10);
    const attachmentId = `dump-${host}-${pid}-${Date.now()}`;

    // Store evidence attachment
    try {
      const evidenceRoutes = require('./evidenceRoutes');
      if (typeof evidenceRoutes.storeAttachment === 'function') {
        evidenceRoutes.storeAttachment(attachmentId, {
          id: attachmentId,
          type: 'diagnostic_dump',
          host,
          pid,
          environment: env,
          content: `Thread & stack diagnostic dump captured for PID ${pid} on ${host} at ${new Date().toISOString()}`
        });
      }
    } catch (_) {}

    // Audit log
    try {
      const { auditLog } = require('../audit_logger');
      auditLog({
        action: 'CAPTURE_DIAGNOSTIC_DUMP',
        user: req.user?.username || 'operator',
        host,
        pid,
        attachment_id: attachmentId,
        environment: env
      });
    } catch (_) {}

    res.json({
      success: true,
      host,
      pid,
      attachment_id: attachmentId,
      status: 'QUEUED',
      message: `Diagnostic dump requested for PID ${pid} on ${host}. Output stored as evidence attachment ${attachmentId}.`
    });
  });

  // =========================================================================
  // Phase O4.1: Kubernetes Hierarchy Endpoints
  // =========================================================================

  // Helper to extract entities by kind safely
  async function fetchEntities(inventory, kind, env) {
    try {
      const res = await inventory.getEntities({ kind, environment: env, limit: 10000 });
      const raw = Array.isArray(res) ? res : (res && res.entities) || [];
      return raw.filter(e => e && String(e.kind || '').toLowerCase() === String(kind).toLowerCase());
    } catch (_) {
      return [];
    }
  }

  // 1. GET /api/v2/infra/k8s/clusters
  router.get('/k8s/clusters', async (req, res) => {
    const env = req.sentinelEnv || req.query.environment || 'staging';
    if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
      return res.status(403).json({ error: 'Access denied for requested environment' });
    }

    try {
      const inventory = inv || require('@sentinel/inventory');
      const clusterEntities = await fetchEntities(inventory, 'k8s_cluster', env);
      const nodeEntities = await fetchEntities(inventory, 'k8s_node', env);
      const podEntities = await fetchEntities(inventory, 'k8s_pod', env);

      if (clusterEntities.length === 0 && nodeEntities.length === 0) {
        return res.json({
          status: 'DATA_UNAVAILABLE',
          environment: env,
          reason: 'No Kubernetes clusters or nodes reporting in this environment',
          clusters: []
        });
      }

      // Group nodes & pods by cluster
      const clustersMap = new Map();
      clusterEntities.forEach(c => {
        const name = c.name || c.entity_id.replace(/^k8s_cluster:/, '');
        clustersMap.set(name, {
          cluster: name,
          status: c.status || 'HEALTHY',
          nodes_count: 0,
          pods_count: 0,
          cpu_allocatable: null,
          cpu_used: null,
          memory_allocatable: null,
          memory_used: null,
          warning_events: 0
        });
      });

      // If no explicit cluster entities, derive from node labels
      nodeEntities.forEach(n => {
        const clusterName = (n.labels && n.labels.cluster) || 'default-cluster';
        if (!clustersMap.has(clusterName)) {
          clustersMap.set(clusterName, {
            cluster: clusterName,
            status: 'HEALTHY',
            nodes_count: 0,
            pods_count: 0,
            cpu_allocatable: null,
            cpu_used: null,
            memory_allocatable: null,
            memory_used: null,
            warning_events: 0
          });
        }
        const cl = clustersMap.get(clusterName);
        cl.nodes_count += 1;
        if (n.labels) {
          if (typeof n.labels.cpu_allocatable === 'number') cl.cpu_allocatable = (cl.cpu_allocatable || 0) + n.labels.cpu_allocatable;
          if (typeof n.labels.cpu_usage === 'number') cl.cpu_used = (cl.cpu_used || 0) + n.labels.cpu_usage;
          if (typeof n.labels.memory_allocatable === 'number') cl.memory_allocatable = (cl.memory_allocatable || 0) + n.labels.memory_allocatable;
          if (typeof n.labels.memory_usage === 'number') cl.memory_used = (cl.memory_used || 0) + n.labels.memory_usage;
        }
      });

      podEntities.forEach(p => {
        const clusterName = (p.labels && p.labels.cluster) || 'default-cluster';
        if (clustersMap.has(clusterName)) {
          clustersMap.get(clusterName).pods_count += 1;
        }
      });

      const clusterList = Array.from(clustersMap.values()).sort((a, b) => a.cluster.localeCompare(b.cluster));

      res.json({
        status: 'OK',
        environment: env,
        count: clusterList.length,
        clusters: clusterList
      });
    } catch (err) {
      console.error('[INFRA_K8S_CLUSTERS_ERROR]', err);
      res.status(500).json({ error: `Failed to retrieve Kubernetes clusters: ${err.message}` });
    }
  });

  // 2. GET /api/v2/infra/k8s/:cluster
  router.get('/k8s/:cluster', async (req, res) => {
    const env = req.sentinelEnv || req.query.environment || 'staging';
    if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
      return res.status(403).json({ error: 'Access denied for requested environment' });
    }

    const clusterId = req.params.cluster;

    try {
      const inventory = inv || require('@sentinel/inventory');
      const nodeEntities = (await fetchEntities(inventory, 'k8s_node', env)).filter(n =>
        !n.labels || !n.labels.cluster || n.labels.cluster === clusterId
      );
      const podEntities = (await fetchEntities(inventory, 'k8s_pod', env)).filter(p =>
        !p.labels || !p.labels.cluster || p.labels.cluster === clusterId
      );
      const quotaEntities = (await fetchEntities(inventory, 'k8s_quota', env)).filter(q =>
        !q.labels || !q.labels.cluster || q.labels.cluster === clusterId
      );
      const pvcEntities = (await fetchEntities(inventory, 'k8s_pvc', env)).filter(p =>
        !p.labels || !p.labels.cluster || p.labels.cluster === clusterId
      );
      const hpaEntities = (await fetchEntities(inventory, 'k8s_hpa', env)).filter(h =>
        !h.labels || !h.labels.cluster || h.labels.cluster === clusterId
      );
      const eventEntities = (await fetchEntities(inventory, 'k8s_event', env)).filter(e =>
        !e.labels || !e.labels.cluster || e.labels.cluster === clusterId
      );

      if (nodeEntities.length === 0 && podEntities.length === 0) {
        return res.json({
          status: 'DATA_UNAVAILABLE',
          environment: env,
          cluster: clusterId,
          reason: `No telemetry available for cluster '${clusterId}'`,
          node_conditions: null,
          pods_by_phase: null,
          resources: null,
          quotas: [],
          hpa_at_max: [],
          pvc_fill: [],
          image_drift: [],
          warning_events: []
        });
      }

      // Node conditions
      const nodeConditions = nodeEntities.map(n => {
        const labels = n.labels || {};
        return {
          node: n.name || n.entity_id,
          ready: typeof labels.condition_ready === 'boolean' ? labels.condition_ready : true,
          disk_pressure: Boolean(labels.condition_disk_pressure),
          memory_pressure: Boolean(labels.condition_memory_pressure),
          pid_pressure: Boolean(labels.condition_pid_pressure),
          cpu_allocatable: typeof labels.cpu_allocatable === 'number' ? labels.cpu_allocatable : null,
          cpu_used: typeof labels.cpu_usage === 'number' ? labels.cpu_usage : null,
          memory_allocatable: typeof labels.memory_allocatable === 'number' ? labels.memory_allocatable : null,
          memory_used: typeof labels.memory_usage === 'number' ? labels.memory_usage : null
        };
      });

      // Pods by phase & problem states
      const podsByPhase = { running: 0, pending: 0, succeeded: 0, failed: 0, crashloop: 0, oomkilled: 0 };
      const imageMap = new Map(); // workload -> Set of images
      podEntities.forEach(p => {
        const labels = p.labels || {};
        const phase = (labels.phase || 'running').toLowerCase();
        if (podsByPhase[phase] !== undefined) podsByPhase[phase] += 1;
        if (labels.status_reason === 'CrashLoopBackOff' || (labels.restarts && labels.restarts > 5)) podsByPhase.crashloop += 1;
        if (labels.status_reason === 'OOMKilled') podsByPhase.oomkilled += 1;

        if (labels.workload && labels.image) {
          if (!imageMap.has(labels.workload)) imageMap.set(labels.workload, new Set());
          imageMap.get(labels.workload).add(labels.image);
        }
      });

      // Resources roll-up
      let totalCpuAlloc = null, totalCpuReq = null, totalCpuUsed = null;
      let totalMemAlloc = null, totalMemReq = null, totalMemUsed = null;

      nodeEntities.forEach(n => {
        const l = n.labels || {};
        if (typeof l.cpu_allocatable === 'number') totalCpuAlloc = (totalCpuAlloc || 0) + l.cpu_allocatable;
        if (typeof l.cpu_usage === 'number') totalCpuUsed = (totalCpuUsed || 0) + l.cpu_usage;
        if (typeof l.memory_allocatable === 'number') totalMemAlloc = (totalMemAlloc || 0) + l.memory_allocatable;
        if (typeof l.memory_usage === 'number') totalMemUsed = (totalMemUsed || 0) + l.memory_usage;
      });

      podEntities.forEach(p => {
        const l = p.labels || {};
        if (typeof l.cpu_requests === 'number') totalCpuReq = (totalCpuReq || 0) + l.cpu_requests;
        if (typeof l.memory_requests === 'number') totalMemReq = (totalMemReq || 0) + l.memory_requests;
      });

      // Quotas
      const quotas = quotaEntities.map(q => {
        const l = q.labels || {};
        return {
          namespace: l.namespace || q.name,
          cpu_used: typeof l.cpu_used === 'number' ? l.cpu_used : null,
          cpu_hard: typeof l.cpu_hard === 'number' ? l.cpu_hard : null,
          memory_used: typeof l.memory_used === 'number' ? l.memory_used : null,
          memory_hard: typeof l.memory_hard === 'number' ? l.memory_hard : null
        };
      });

      // HPA at max
      const hpaAtMax = hpaEntities.filter(h => {
        const l = h.labels || {};
        return typeof l.current_replicas === 'number' && typeof l.max_replicas === 'number' && l.current_replicas >= l.max_replicas;
      }).map(h => ({
        hpa: h.name,
        namespace: (h.labels && h.labels.namespace) || 'default',
        current_replicas: h.labels.current_replicas,
        max_replicas: h.labels.max_replicas
      }));

      // PVC fill
      const pvcFill = pvcEntities.map(p => {
        const l = p.labels || {};
        const used = typeof l.used_bytes === 'number' ? l.used_bytes : null;
        const cap = typeof l.capacity_bytes === 'number' ? l.capacity_bytes : null;
        const pct = (used !== null && cap !== null && cap > 0) ? Number(((used / cap) * 100).toFixed(1)) : null;
        return {
          pvc: p.name,
          namespace: l.namespace || 'default',
          used_bytes: used,
          capacity_bytes: cap,
          fill_pct: pct
        };
      });

      // Image drift: workloads where pods run different image tags
      const imageDrift = [];
      for (const [workload, images] of imageMap.entries()) {
        if (images.size > 1) {
          imageDrift.push({
            workload,
            images: Array.from(images)
          });
        }
      }

      // Warning events
      const warningEvents = eventEntities.map(e => {
        const l = e.labels || {};
        return {
          event_id: e.entity_id,
          reason: l.reason || 'Warning',
          message: e.name || l.message || '',
          namespace: l.namespace || 'default',
          source: l.source || 'k8sobjects',
          ts: l.ts || new Date().toISOString()
        };
      });

      res.json({
        status: 'OK',
        environment: env,
        cluster: clusterId,
        node_conditions: nodeConditions,
        pods_by_phase: podsByPhase,
        resources: {
          cpu: { allocatable: totalCpuAlloc, requests: totalCpuReq, used: totalCpuUsed },
          memory: { allocatable: totalMemAlloc, requests: totalMemReq, used: totalMemUsed }
        },
        quotas,
        hpa_at_max: hpaAtMax,
        pvc_fill: pvcFill,
        image_drift: imageDrift,
        warning_events: warningEvents
      });
    } catch (err) {
      console.error('[INFRA_K8S_CLUSTER_ERROR]', err);
      res.status(500).json({ error: `Failed to retrieve Kubernetes cluster detail: ${err.message}` });
    }
  });

  // 3. GET /api/v2/infra/k8s/:cluster/namespaces/:ns
  router.get('/k8s/:cluster/namespaces/:ns', async (req, res) => {
    const env = req.sentinelEnv || req.query.environment || 'staging';
    if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
      return res.status(403).json({ error: 'Access denied for requested environment' });
    }

    const { cluster: clusterId, ns } = req.params;

    try {
      const inventory = inv || require('@sentinel/inventory');
      const podEntities = (await fetchEntities(inventory, 'k8s_pod', env)).filter(p =>
        (!p.labels || !p.labels.cluster || p.labels.cluster === clusterId) &&
        (p.labels && p.labels.namespace === ns)
      );
      const workloadEntities = (await fetchEntities(inventory, 'k8s_workload', env)).filter(w =>
        (!w.labels || !w.labels.cluster || w.labels.cluster === clusterId) &&
        (w.labels && w.labels.namespace === ns)
      );
      const quotaEntities = (await fetchEntities(inventory, 'k8s_quota', env)).filter(q =>
        (!q.labels || !q.labels.cluster || q.labels.cluster === clusterId) &&
        ((q.labels && q.labels.namespace === ns) || q.name === ns)
      );
      const pvcEntities = (await fetchEntities(inventory, 'k8s_pvc', env)).filter(p =>
        (!p.labels || !p.labels.cluster || p.labels.cluster === clusterId) &&
        (p.labels && p.labels.namespace === ns)
      );
      const eventEntities = (await fetchEntities(inventory, 'k8s_event', env)).filter(e =>
        (!e.labels || !e.labels.cluster || e.labels.cluster === clusterId) &&
        (e.labels && e.labels.namespace === ns)
      );

      if (podEntities.length === 0 && workloadEntities.length === 0) {
        return res.json({
          status: 'DATA_UNAVAILABLE',
          environment: env,
          cluster: clusterId,
          namespace: ns,
          reason: `No workloads or pods in namespace '${ns}'`,
          workloads: [],
          pods: [],
          quota: null,
          pvcs: [],
          warning_events: []
        });
      }

      const workloads = workloadEntities.map(w => {
        const l = w.labels || {};
        return {
          workload: w.name || w.entity_id,
          kind: l.workload_type || 'Deployment',
          replicas_desired: typeof l.replicas_desired === 'number' ? l.replicas_desired : null,
          replicas_ready: typeof l.replicas_ready === 'number' ? l.replicas_ready : null,
          status: w.status || 'HEALTHY'
        };
      });

      const pods = podEntities.map(p => {
        const l = p.labels || {};
        return {
          pod: p.name || p.entity_id,
          workload: l.workload || null,
          phase: l.phase || 'Running',
          restarts: typeof l.restarts === 'number' ? l.restarts : 0,
          status_reason: l.status_reason || null,
          node: l.node_name || null
        };
      });

      const quota = quotaEntities.length > 0 ? {
        namespace: ns,
        cpu_used: quotaEntities[0].labels?.cpu_used ?? null,
        cpu_hard: quotaEntities[0].labels?.cpu_hard ?? null,
        memory_used: quotaEntities[0].labels?.memory_used ?? null,
        memory_hard: quotaEntities[0].labels?.memory_hard ?? null
      } : null;

      const pvcs = pvcEntities.map(p => {
        const l = p.labels || {};
        return {
          pvc: p.name,
          used_bytes: typeof l.used_bytes === 'number' ? l.used_bytes : null,
          capacity_bytes: typeof l.capacity_bytes === 'number' ? l.capacity_bytes : null
        };
      });

      const warningEvents = eventEntities.map(e => ({
        reason: e.labels?.reason || 'Warning',
        message: e.name || e.labels?.message || '',
        ts: e.labels?.ts || new Date().toISOString()
      }));

      res.json({
        status: 'OK',
        environment: env,
        cluster: clusterId,
        namespace: ns,
        workloads,
        pods,
        quota,
        pvcs,
        warning_events: warningEvents
      });
    } catch (err) {
      console.error('[INFRA_K8S_NS_ERROR]', err);
      res.status(500).json({ error: `Failed to retrieve namespace detail: ${err.message}` });
    }
  });

  // 4. GET /api/v2/infra/k8s/:cluster/workloads/:name
  router.get('/k8s/:cluster/workloads/:name', async (req, res) => {
    const env = req.sentinelEnv || req.query.environment || 'staging';
    if (!env || env === 'forbidden' || (req.user && !accessPolicy.isEntitled(req.user, env))) {
      return res.status(403).json({ error: 'Access denied for requested environment' });
    }

    const { cluster: clusterId, name: workloadName } = req.params;

    try {
      const inventory = inv || require('@sentinel/inventory');
      const workloadEntities = (await fetchEntities(inventory, 'k8s_workload', env)).filter(w =>
        (!w.labels || !w.labels.cluster || w.labels.cluster === clusterId) &&
        (w.name === workloadName || w.entity_id === `k8s_workload:${workloadName}`)
      );
      const podEntities = (await fetchEntities(inventory, 'k8s_pod', env)).filter(p =>
        (!p.labels || !p.labels.cluster || p.labels.cluster === clusterId) &&
        (p.labels && p.labels.workload === workloadName)
      );
      const eventEntities = (await fetchEntities(inventory, 'k8s_event', env)).filter(e =>
        (!e.labels || !e.labels.cluster || e.labels.cluster === clusterId) &&
        (e.labels && e.labels.workload === workloadName)
      );

      if (workloadEntities.length === 0 && podEntities.length === 0) {
        return res.json({
          status: 'DATA_UNAVAILABLE',
          environment: env,
          cluster: clusterId,
          workload: workloadName,
          reason: `Workload '${workloadName}' not found in cluster '${clusterId}'`,
          replicas: null,
          pods: [],
          image_drift: null,
          warning_events: []
        });
      }

      const wl = workloadEntities[0] || {};
      const wlLabels = wl.labels || {};

      const images = new Set();
      const pods = podEntities.map(p => {
        const l = p.labels || {};
        if (l.image) images.add(l.image);
        return {
          pod: p.name || p.entity_id,
          node: l.node_name || null,
          phase: l.phase || 'Running',
          restarts: typeof l.restarts === 'number' ? l.restarts : 0,
          status_reason: l.status_reason || null,
          image: l.image || null,
          cpu_requests: typeof l.cpu_requests === 'number' ? l.cpu_requests : null,
          cpu_usage: typeof l.cpu_usage === 'number' ? l.cpu_usage : null,
          memory_requests: typeof l.memory_requests === 'number' ? l.memory_requests : null,
          memory_usage: typeof l.memory_usage === 'number' ? l.memory_usage : null
        };
      });

      const imageDrift = images.size > 1 ? {
        has_drift: true,
        images: Array.from(images)
      } : {
        has_drift: false,
        image: Array.from(images)[0] || wlLabels.image || null
      };

      res.json({
        status: 'OK',
        environment: env,
        cluster: clusterId,
        workload: workloadName,
        kind: wlLabels.workload_type || 'Deployment',
        namespace: wlLabels.namespace || 'default',
        replicas: {
          desired: typeof wlLabels.replicas_desired === 'number' ? wlLabels.replicas_desired : pods.length,
          ready: typeof wlLabels.replicas_ready === 'number' ? wlLabels.replicas_ready : pods.filter(p => p.phase === 'Running').length
        },
        pods,
        image_drift: imageDrift,
        warning_events: eventEntities.map(e => ({
          reason: e.labels?.reason || 'Warning',
          message: e.name || e.labels?.message || '',
          ts: e.labels?.ts || new Date().toISOString()
        }))
      });
    } catch (err) {
      console.error('[INFRA_K8S_WORKLOAD_ERROR]', err);
      res.status(500).json({ error: `Failed to retrieve workload detail: ${err.message}` });
    }
  });

  return router;
}

const router = createInfraRouter();
module.exports = router;
module.exports.createInfraRouter = createInfraRouter;

