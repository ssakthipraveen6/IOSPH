/**
 * Correlation engine: finds shared infrastructure behind symptoms, diagnoses which layer failed,
 * and groups alerts into problems.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');
const inventory = require('@sentinel/inventory');
const eventStore = require('../database/event_store');

// Default config
const DEFAULT_CONFIG = {
  correlation: {
    weights: {
      fanout: 0.40,
      temporal_precedence: 0.25,
      graph_proximity: 0.20,
      change_proximity: 0.15
    },
    window_minutes: {
      before: 30,
      after: 5
    },
    thresholds: {
      min_hypothesis_confidence: 0.50,
      high_confidence: 0.75
    }
  }
};

// Loads config/correlation.yaml.
function loadConfig() {
  const cfgPath = path.resolve(__dirname, '../config/correlation.yaml');
  try {
    if (fs.existsSync(cfgPath)) {
      const fileContent = fs.readFileSync(cfgPath, 'utf8');
      const parsed = yaml.load(fileContent);
      if (parsed && parsed.correlation) {
        return parsed.correlation;
      }
    }
  } catch (_) {}
  return DEFAULT_CONFIG.correlation;
}

/**
 * Traverses the topology graph downward to find infrastructure entities connected to the given entity.
 * Returns array of { entityId, distance, edgeType }.
 */
async function findDownstreamInfra(entityId, maxDepth = 5) {
  const visited = new Set();
  const queue = [{ id: entityId, distance: 0 }];
  const infraCandidates = [];

  while (queue.length > 0) {
    const { id, distance } = queue.shift();
    if (visited.has(id) || distance >= maxDepth) continue;
    visited.add(id);

    try {
      const graph = await inventory.getEntityGraph(id, 1);
      if (graph && Array.isArray(graph.edges)) {
        for (const edge of graph.edges) {
          // Check downstream edge (id -> to_entity or runs_on / depends_on)
          const nextId = edge.from_entity === id ? edge.to_entity : edge.from_entity;
          if (!visited.has(nextId)) {
            const nextDistance = distance + 1;
            infraCandidates.push({ entityId: nextId, distance: nextDistance, edgeType: edge.edge_type });
            queue.push({ id: nextId, distance: nextDistance });
          }
        }
      }
    } catch (_) {}
  }

  return infraCandidates;
}

/**
 * Finds all application entities that depend on a given infrastructure entity (fan-out query).
 */
async function findDependentApps(infraEntityId, maxDepth = 5) {
  const visited = new Set();
  const queue = [{ id: infraEntityId, distance: 0 }];
  const dependentApps = new Set();

  while (queue.length > 0) {
    const { id, distance } = queue.shift();
    if (visited.has(id) || distance >= maxDepth) continue;
    visited.add(id);

    try {
      const graph = await inventory.getEntityGraph(id, 1);
      if (graph && Array.isArray(graph.edges)) {
        for (const edge of graph.edges) {
          const nextId = edge.to_entity === id ? edge.from_entity : edge.to_entity;
          if (nextId.startsWith('app:')) {
            dependentApps.add(nextId);
          }
          if (!visited.has(nextId)) {
            queue.push({ id: nextId, distance: distance + 1 });
          }
        }
      }
    } catch (_) {}
  }

  return Array.from(dependentApps);
}

/**
 * Evaluates fan-out correlation for a trigger symptom event.
 * Replaces the 40-hour investigation by computing shared-infrastructure fan-out.
 *
 * @param {object} triggerEvent
 * @param {object} options
 * @returns {Promise<object|null>} Computed RCA hypothesis
 */
async function correlateSymptom(triggerEvent, options = {}) {
  if (!triggerEvent || !triggerEvent.entity_id) return null;

  const cfg = loadConfig();
  const weights = cfg.weights || DEFAULT_CONFIG.correlation.weights;
  const thresholds = cfg.thresholds || DEFAULT_CONFIG.correlation.thresholds;
  const windowMins = cfg.window_minutes || DEFAULT_CONFIG.correlation.window_minutes;

  const triggerTs = new Date(triggerEvent.ts).getTime();
  const fromTs = new Date(triggerTs - (windowMins.before * 60 * 1000)).toISOString();
  const toTs = new Date(triggerTs + (windowMins.after * 60 * 1000)).toISOString();
  const env = (triggerEvent.environment || 'staging').toLowerCase();

  // 1. Walk topology downward from symptom entity to find candidate infrastructure
  const downstreamInfra = await findDownstreamInfra(triggerEvent.entity_id);
  if (downstreamInfra.length === 0) {
    return null;
  }

  // 2. Query events in the correlation window
  const windowEvents = await eventStore.getEvents({
    from: fromTs,
    to: toTs,
    environment: env,
    limit: 500
  });

  const candidatesScored = [];

  for (const infra of downstreamInfra) {
    const infraId = infra.entityId;
    const relatedInfraEvents = windowEvents.filter(e => e.entity_id === infraId);

    // If infra entity had events or is a known shared resource
    const dependentApps = await findDependentApps(infraId);
    
    // Compute Fan-out: count symptomatic apps depending on this infra entity
    const symptomaticApps = new Set();
    if (triggerEvent.entity_id.startsWith('app:')) {
      symptomaticApps.add(triggerEvent.entity_id);
    }

    windowEvents.forEach(evt => {
      if (evt.severity === 'critical' || evt.severity === 'warning') {
        if (evt.entity_id && dependentApps.includes(evt.entity_id)) {
          symptomaticApps.add(evt.entity_id);
        }
      }
    });

    const totalApps = Math.max(dependentApps.length, symptomaticApps.size, 1);
    const fanoutNormalized = Math.min(symptomaticApps.size / totalApps, 1.0);

    // Temporal precedence: did an infra event occur before the symptom?
    const earliestInfraEvent = relatedInfraEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())[0];
    const temporalPrecedence = earliestInfraEvent && new Date(earliestInfraEvent.ts).getTime() <= triggerTs ? 1.0 : 0.4;

    // Graph proximity: 1 / hop distance
    const graphProximity = 1 / Math.max(infra.distance, 1);

    // Change proximity: deploy, drift, or change ticket on this entity
    const hasChange = relatedInfraEvents.some(e => ['deploy', 'argocd_sync', 'config_drift', 'change_ticket'].includes(e.kind));
    const changeProximity = hasChange ? 1.0 : 0.0;

    // Composite correlation score
    const score = (
      weights.fanout * (fanoutNormalized > 0.3 ? 1.0 : fanoutNormalized) +
      weights.temporal_precedence * temporalPrecedence +
      weights.graph_proximity * graphProximity +
      weights.change_proximity * changeProximity
    );

    candidatesScored.push({
      infraEntityId: infraId,
      score,
      blastRadius: symptomaticApps.size,
      symptomaticApps: Array.from(symptomaticApps),
      earliestEvent: earliestInfraEvent,
      relatedEvents: relatedInfraEvents,
      distance: infra.distance
    });
  }

  candidatesScored.sort((a, b) => b.score - a.score);
  const bestCandidate = candidatesScored[0];

  if (!bestCandidate || bestCandidate.score < thresholds.min_hypothesis_confidence) {
    return null;
  }

  // Construct evidence chain citing real event IDs
  const rationale = [];
  if (bestCandidate.earliestEvent) {
    rationale.push({
      step: 1,
      event_id: bestCandidate.earliestEvent.event_id,
      entity_id: bestCandidate.infraEntityId,
      timestamp: bestCandidate.earliestEvent.ts,
      observation: `${bestCandidate.earliestEvent.title}: ${bestCandidate.earliestEvent.summary || 'telemetry breach'}`
    });
  }

  rationale.push({
    step: 2,
    event_id: triggerEvent.event_id,
    entity_id: triggerEvent.entity_id,
    timestamp: triggerEvent.ts,
    observation: `Concurrent symptom detected on ${triggerEvent.entity_id}: ${triggerEvent.title}`
  });

  rationale.push({
    step: 3,
    fan_out_count: bestCandidate.blastRadius,
    affected_entities: bestCandidate.symptomaticApps,
    observation: `Shared infrastructure fan-out: ${bestCandidate.blastRadius} downstream applications degraded concurrently`
  });

  const hypothesis = {
    hypothesis_id: 'hypo-' + crypto.randomUUID(),
    created_at: new Date().toISOString(),
    trigger_event_id: triggerEvent.event_id,
    suspect_entity_id: bestCandidate.infraEntityId,
    layer: bestCandidate.infraEntityId.startsWith('storage:') ? 'storage' : (bestCandidate.infraEntityId.startsWith('vip:') ? 'network/AVI' : (/^k8s(node|cluster|pod|pvc|pv):/.test(bestCandidate.infraEntityId) ? 'k8s' : 'product')),
    rule_id: 'rule_shared_infra_fanout',
    confidence: parseFloat(bestCandidate.score.toFixed(2)),
    blast_radius: bestCandidate.blastRadius,
    rationale,
    evidence_series: bestCandidate.relatedEvents || [],
    environment: env,
    status: 'open',
    title: `Shared Infrastructure Root Cause: ${bestCandidate.infraEntityId}`,
    summary: `${bestCandidate.blastRadius} downstream applications degraded simultaneously due to anomaly on ${bestCandidate.infraEntityId}.`
  };

  await eventStore.saveHypothesis(hypothesis);
  return hypothesis;
}

/**
 * M3 Task 3.3: Diagnoses the specific layer responsible for an anomaly
 * based on declarative rules configured in config/correlation.yaml:
 *  (a) many products slow in DNS/TCP/TLS at same time -> network/AVI
 *  (b) VIP total slow but localhost agent timing normal -> AVI/path (disabled until M4.5)
 *  (c) storage-heavy steps slow on products sharing a share -> storage
 *  (d) only one product slow across all its steps -> product
 *  (e) version_change or file-change event within window -> change
 *
 * @param {object} evidenceData { events, metrics, journeys, environment }
 * @param {object} options
 * @returns {Array<object>} Hypotheses sorted by confidence descending
 */
const K8S_WORKLOAD_REASONS = ['OOMKilled', 'CrashLoopBackOff', 'BackOff', 'Evicted', 'FailedScheduling', 'ImagePullBackOff', 'ErrImagePull', 'NodeNotReady', 'FailedCreate'];
const STORAGE_MOUNT_REASONS = ['FailedMount', 'FailedAttachVolume', 'VolumeFailedMount', 'ProvisioningFailed', 'FailedBinding', 'VolumeFailedDelete'];

// Reason text of a Kubernetes event.
function k8sEventReason(e) {
  const r = e.reason || e.attributes?.reason || e.labels?.reason || e.attributes?.['k8s.event.reason'];
  return r ? String(r) : String(e.title || '');
}

// True for Kubernetes events.
function isK8sEvent(e) {
  return e.kind === 'k8s_event' || e.kind === 'k8s_warning' ||
    (typeof e.entity_id === 'string' && /^k8s(pod|pvc|pv|node|cluster):/.test(e.entity_id));
}

// Decides which layer (network, VIP, host, app, ...) explains the evidence.
function diagnoseLayer(evidenceData = {}, options = {}) {
  const cfg = loadConfig();
  const rules = cfg.rules || {};
  const hypotheses = [];

  const events = Array.isArray(evidenceData.events) ? evidenceData.events : [];
  const metrics = Array.isArray(evidenceData.metrics) ? evidenceData.metrics : [];
  const journeys = Array.isArray(evidenceData.journeys) ? evidenceData.journeys : [];

  // --- Rule (e): Change event within window ---
  const changeRule = rules.change || {};
  if (changeRule.enabled !== false) {
    const changeEvents = events.filter(e =>
      ['version_change', 'file_change', 'deploy', 'argocd_sync'].includes(e.kind)
    );

    if (changeEvents.length > 0) {
      const topChange = changeEvents[0];
      hypotheses.push({
        hypothesis_id: 'hypo-rule-change-' + crypto.randomBytes(4).toString('hex'),
        rule_id: changeRule.id || 'rule_recent_change',
        layer: changeRule.target_layer || 'change',
        confidence: Number(changeRule.confidence || 0.92),
        evidence_series: changeEvents,
        title: `Change Event Correlation: ${topChange.title || topChange.kind}`,
        summary: `Recent ${topChange.kind} on ${topChange.entity_id || 'system'} detected within correlation window.`,
        status: 'open'
      });
    }
  }

  // --- Rule (a): Multiple products slow in DNS/TCP/TLS at the same time ---
  const netRule = rules.network_avi || {};
  if (netRule.enabled !== false) {
    const minAffected = Number(netRule.min_affected_products || 2);
    const netEvidence = [];
    const affectedProducts = new Set();

    // Check metric data
    metrics.forEach(m => {
      const name = m.metricName || m.metric_name || '';
      if (['vip.dns_ms', 'vip.tcp_ms', 'vip.tls_ms', 'dns_latency_ms', 'tcp_connect_ms'].includes(name)) {
        if (Number(m.value) > 50) {
          netEvidence.push(m);
          const prod = m.component || m.productId || (m.attributes && m.attributes.product);
          if (prod) affectedProducts.add(prod);
        }
      }
    });

    // Check event anomalies
    events.forEach(e => {
      const isNetAnomaly = (e.kind === 'metric_anomaly' || e.kind === 'network_event') &&
        (e.title?.toLowerCase().includes('dns') || e.title?.toLowerCase().includes('tcp') || e.title?.toLowerCase().includes('tls'));
      if (isNetAnomaly) {
        netEvidence.push(e);
        if (e.entity_id) affectedProducts.add(e.entity_id.replace(/^app:/, ''));
      }
    });

    if (affectedProducts.size >= minAffected) {
      hypotheses.push({
        hypothesis_id: 'hypo-rule-net-' + crypto.randomBytes(4).toString('hex'),
        rule_id: netRule.id || 'rule_network_avi',
        layer: netRule.target_layer || 'network/AVI',
        confidence: Number(netRule.confidence || 0.88),
        evidence_series: netEvidence,
        title: 'Perimeter & Edge Latency Degradation (AVI / Network)',
        summary: `${affectedProducts.size} products experiencing concurrent DNS/TCP/TLS handshake slowdown: ${Array.from(affectedProducts).join(', ')}.`,
        status: 'open'
      });
    }
  }

  // --- Rule (b): VIP total slow but agent localhost timing normal ---
  const aviPathRule = rules.avi_path || {};
  if (aviPathRule.enabled === true) {
    // Only active when M4.5 agent localhost telemetry is enabled
    const vipTotalMetrics = metrics.filter(m => (m.metricName || m.metric_name) === 'vip.total_ms');
    const localMetrics = metrics.filter(m => (m.metricName || m.metric_name) === 'agent.localhost_ms');

    // Both series must exist: without agent localhost timing the rule cannot tell AVI from the product.
    if (localMetrics.length > 0 && vipTotalMetrics.some(v => Number(v.value) > 500) && localMetrics.every(l => Number(l.value) < 100)) {
      hypotheses.push({
        hypothesis_id: 'hypo-rule-vip-path-' + crypto.randomBytes(4).toString('hex'),
        rule_id: aviPathRule.id || 'rule_avi_path',
        layer: aviPathRule.target_layer || 'AVI/path',
        confidence: Number(aviPathRule.confidence || 0.85),
        evidence_series: [...vipTotalMetrics, ...localMetrics],
        title: 'Network Path / Load Balancer Hop Latency',
        summary: 'External VIP latency elevated while backend server responds normally on localhost.',
        status: 'open'
      });
    }
  }

  // --- Rule (c): Storage-heavy steps slow across products sharing a share ---
  const storageRule = rules.storage || {};
  if (storageRule.enabled !== false) {
    const minAffected = Number(storageRule.min_affected_products || 2);
    const storageEvidence = [];
    const storageProducts = new Set();

    // From journey steps with layer: storage
    journeys.forEach(j => {
      const steps = Array.isArray(j.steps) ? j.steps : [];
      steps.forEach(s => {
        if (s.layer === 'storage' && (s.status === 'FAILED' || Number(s.duration_ms) > 1000)) {
          storageEvidence.push(s);
          const prod = j.productId || j.product_id || j.id;
          if (prod) storageProducts.add(prod);
        }
      });
    });

    // From storage events or storage metrics
    events.forEach(e => {
      if (e.kind === 'storage_event' || e.kind === 'nas_event' || (e.entity_id && e.entity_id.startsWith('storage:'))) {
        storageEvidence.push(e);
      }
    });

    metrics.forEach(m => {
      const name = m.metricName || m.metric_name || '';
      if (name.includes('storage') || name.includes('nfs') || name.includes('iowait')) {
        if (Number(m.value) > 500 || Number(m.value) > 50) {
          storageEvidence.push(m);
          const prod = m.component || m.productId;
          if (prod) storageProducts.add(prod);
        }
      }
    });

    if (storageProducts.size >= minAffected || (storageProducts.size >= 1 && storageEvidence.some(e => e.kind === 'storage_event'))) {
      hypotheses.push({
        hypothesis_id: 'hypo-rule-storage-' + crypto.randomBytes(4).toString('hex'),
        rule_id: storageRule.id || 'rule_storage_shared',
        layer: storageRule.target_layer || 'storage',
        confidence: Number(storageRule.confidence || 0.90),
        evidence_series: storageEvidence,
        title: 'Shared Storage Subsystem Contention (NFS / NAS)',
        summary: `Storage-heavy steps degraded across ${storageProducts.size} products sharing common storage volume.`,
        status: 'open'
      });
    }
  }

  // --- Rule (f): Kubernetes workload failure (OOM, crash loop, eviction, scheduling, image pull) ---
  const k8sRule = rules.k8s_workload || {};
  if (k8sRule.enabled !== false && k8sRule.id) {
    const k8sEvidence = events.filter(e => isK8sEvent(e) && K8S_WORKLOAD_REASONS.some(r => k8sEventReason(e).includes(r)));
    const k8sTargets = new Set(k8sEvidence.map(e => e.entity_id).filter(Boolean));
    if (k8sEvidence.length >= Number(k8sRule.min_events || 1)) {
      hypotheses.push({
        hypothesis_id: 'hypo-rule-k8s-' + crypto.randomBytes(4).toString('hex'),
        rule_id: k8sRule.id,
        layer: k8sRule.target_layer || 'k8s',
        confidence: Number(k8sRule.confidence || 0.85),
        evidence_series: k8sEvidence,
        title: 'Kubernetes Workload Failure',
        summary: `${k8sEvidence.length} Kubernetes warning event(s) (${[...new Set(k8sEvidence.map(k8sEventReason))].slice(0, 3).join(', ')}) on ${k8sTargets.size || 'unknown'} object(s).`,
        status: 'open'
      });
    }
  }

  // --- Rule (g): Storage mount / Trident provisioning failure (PVC -> PV -> NFS/Trident) ---
  const mountRule = rules.storage_mount || {};
  if (mountRule.enabled !== false && mountRule.id) {
    const mountEvidence = events.filter(e => {
      if (!isK8sEvent(e) && e.kind !== 'storage_event') return false;
      const reason = k8sEventReason(e);
      const text = `${reason} ${e.message || ''}`.toLowerCase();
      return STORAGE_MOUNT_REASONS.some(r => reason.includes(r)) || text.includes('trident') || text.includes('mount.nfs');
    });
    if (mountEvidence.length >= Number(mountRule.min_events || 1)) {
      const pvcs = new Set(mountEvidence.map(e => e.entity_id).filter(Boolean));
      hypotheses.push({
        hypothesis_id: 'hypo-rule-mount-' + crypto.randomBytes(4).toString('hex'),
        rule_id: mountRule.id,
        layer: mountRule.target_layer || 'storage',
        confidence: Number(mountRule.confidence || 0.90),
        evidence_series: mountEvidence,
        title: 'Storage Mount / Trident Provisioning Failure',
        summary: `${mountEvidence.length} volume mount/provisioning event(s) across ${pvcs.size || 'unknown'} object(s); check the NFS export or Trident backend behind the PVC.`,
        status: 'open'
      });
    }
  }

  // --- Rule (d): Only one product slow across all its steps ---
  const productRule = rules.product || {};
  if (productRule.enabled !== false) {
    const failingProducts = new Set();
    const productEvidence = [];

    journeys.forEach(j => {
      const prod = j.productId || j.product_id || j.id;
      if (j.status === 'FAILED' || (j.steps && j.steps.some(s => s.status === 'FAILED'))) {
        failingProducts.add(prod);
        productEvidence.push(j);
      }
    });

    events.forEach(e => {
      if (e.kind === 'metric_anomaly' && e.entity_id && e.entity_id.startsWith('app:')) {
        failingProducts.add(e.entity_id.replace(/^app:/, ''));
        productEvidence.push(e);
      }
    });

    // If exactly one product is degraded and no network/storage rule fired
    const otherBroadRulesFired = hypotheses.some(h => ['network/AVI', 'storage', 'k8s'].includes(h.layer));
    if (failingProducts.size === 1 && !otherBroadRulesFired) {
      const singleProduct = Array.from(failingProducts)[0];
      hypotheses.push({
        hypothesis_id: 'hypo-rule-product-' + crypto.randomBytes(4).toString('hex'),
        rule_id: productRule.id || 'rule_product_isolated',
        layer: productRule.target_layer || 'product',
        confidence: Number(productRule.confidence || 0.80),
        evidence_series: productEvidence,
        title: `Isolated Application Layer Anomaly (${singleProduct})`,
        summary: `Only single product '${singleProduct}' degraded across internal steps with healthy supporting infrastructure.`,
        status: 'open'
      });
    }
  }

  // Sort hypotheses by confidence descending
  hypotheses.sort((a, b) => b.confidence - a.confidence);
  return hypotheses;
}

// In-memory problem store
const problemStore = new Map();

/**
 * M5 Task 5.4: Groups alerts within the same topology neighbourhood into problems
 */
async function groupAlertsIntoProblems(alerts = [], options = {}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return [];
  const env = options.environment || 'staging';
  const problems = [];
  const processedAlertIds = new Set();

  for (let i = 0; i < alerts.length; i++) {
    const alert = alerts[i];
    if (processedAlertIds.has(alert.id)) continue;

    const group = [alert];
    processedAlertIds.add(alert.id);

    const alertEntityId = alert.entity_id || (alert.component ? (alert.component.startsWith('app:') ? alert.component : `app:${alert.component}`) : null);
    const infraA = alertEntityId ? await findDownstreamInfra(alertEntityId).catch(() => []) : [];
    const sharedInfraIds = new Set(infraA.map(inf => inf.entityId));
    if (alert.component && (alert.component.startsWith('storage:') || alert.component.includes('storage') || alert.component.includes('nas'))) {
      sharedInfraIds.add(alert.component);
    }
    if (alertEntityId && (alertEntityId.startsWith('storage:') || alertEntityId.includes('storage') || alertEntityId.includes('nas'))) {
      sharedInfraIds.add(alertEntityId);
    }

    for (let j = i + 1; j < alerts.length; j++) {
      const other = alerts[j];
      if (processedAlertIds.has(other.id)) continue;

      const otherEntityId = other.entity_id || (other.component ? (other.component.startsWith('app:') ? other.component : `app:${other.component}`) : null);
      let isNeighbour = false;

      // 1. Same component
      if (other.component === alert.component) {
        isNeighbour = true;
      }

      // 2. Shared downstream infrastructure (e.g. both mount the same storage share)
      if (!isNeighbour && otherEntityId) {
        const infraB = await findDownstreamInfra(otherEntityId).catch(() => []);
        for (const item of infraB) {
          if (sharedInfraIds.has(item.entityId)) {
            isNeighbour = true;
            break;
          }
        }
      }

      if (isNeighbour) {
        group.push(other);
        processedAlertIds.add(other.id);
      }
    }

    // Run diagnosis on the grouped evidence. Stored evidence passed in options is
    // limited to the products/entities in this group, so a change or slow step on an
    // unrelated product cannot decide this problem's layer.
    const groupProducts = new Set();
    const groupEntities = new Set();
    for (const a of group) {
      const comp = a.component ? String(a.component).replace(/^app:/, '') : null;
      if (comp) groupProducts.add(comp);
      const ent = a.entity_id || (comp ? `app:${comp}` : null);
      if (ent) groupEntities.add(ent);
    }
    sharedInfraIds.forEach(id => groupEntities.add(id));
    const inGroup = (product, entity) => (product && groupProducts.has(String(product).replace(/^app:/, ''))) || (entity && groupEntities.has(entity));

    const evidenceData = {
      environment: env,
      events: [
        ...group.map(a => ({
          id: a.id,
          kind: 'alert',
          entity_id: a.entity_id || a.component,
          message: a.message,
          timestamp: a.timestamp
        })),
        ...(options.events || []).filter(e => inGroup(e.payload && e.payload.product, e.entity_id))
      ],
      metrics: (options.metrics || []).filter(m => inGroup(m.component || m.productId, m.entity_id)),
      journeys: (options.journeys || []).filter(j => inGroup(j.productId || j.product_id || j.id, null))
    };

    const hypotheses = diagnoseLayer(evidenceData, options);
    const topHypo = hypotheses[0] || null;

    const problemId = 'PRB-' + crypto.randomUUID().substring(0, 8);
    const suspectEntity = Array.from(sharedInfraIds)[0] || alert.entity_id || alert.component || 'unknown';

    const problem = {
      id: problemId,
      title: topHypo?.title || `Incident affecting ${group.map(a => a.component || a.entity_id).filter(Boolean).join(', ')}`,
      environment: env,
      status: 'OPEN',
      severity: group.some(a => (a.severity || '').toLowerCase() === 'critical') ? 'CRITICAL' : 'WARNING',
      top_layer: topHypo ? topHypo.layer : 'unknown',
      confidence: topHypo ? topHypo.confidence : null,
      suspect_entity: suspectEntity,
      alert_count: group.length,
      alerts: group.map(a => a.id),
      evidence_pack: {
        hypotheses,
        alerts: group
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Assign problem_id to each alert in the group
    group.forEach(a => {
      a.problem_id = problemId;
    });

    problemStore.set(problemId, problem);
    problems.push(problem);
  }

  return problems;
}

// Problems of an environment.
function getProblems(env = 'staging') {
  return Array.from(problemStore.values()).filter(p => !env || p.environment === env);
}

// One problem by id.
function getProblemById(id) {
  return problemStore.get(id) || null;
}

module.exports = {
  loadConfig,
  findDownstreamInfra,
  findDependentApps,
  correlateSymptom,
  diagnoseLayer,
  groupAlertsIntoProblems,
  getProblems,
  getProblemById,
  problemStore
};


