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
    confidence: parseFloat(bestCandidate.score.toFixed(2)),
    blast_radius: bestCandidate.blastRadius,
    rationale,
    environment: env,
    status: 'open',
    title: `Shared Infrastructure Root Cause: ${bestCandidate.infraEntityId}`,
    summary: `${bestCandidate.blastRadius} downstream applications degraded simultaneously due to anomaly on ${bestCandidate.infraEntityId}.`
  };

  await eventStore.saveHypothesis(hypothesis);
  return hypothesis;
}

module.exports = {
  loadConfig,
  findDownstreamInfra,
  findDependentApps,
  correlateSymptom
};
