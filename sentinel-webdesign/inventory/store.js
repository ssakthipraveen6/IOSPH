/**
 * inventory/store.js
 *
 * Unified entity and graph edge repository supporting both PostgreSQL
 * and resilient in-memory/JSON fallback with automatic synchronization.
 */

const fs = require('fs');
const path = require('path');
const postgres = require('@sentinel/database/postgres');

const RUNTIME_DIR = process.env.SENTINEL_RUNTIME_DIR ? path.resolve(process.env.SENTINEL_RUNTIME_DIR) : path.resolve(__dirname, '../.runtime');
const INVENTORY_CACHE_FILE = path.join(RUNTIME_DIR, 'inventory_cache.json');

// In-memory inventory state
const state = {
  entities: new Map(), // entity_id -> entity
  edges: new Map()     // `${from_entity}|${to_entity}|${edge_type}` -> edge
};

let isSaving = false;
let saveScheduled = false;

// Canonical Demo Topology Seed Nodes
const DEMO_ENTITIES = [
  { entity_id: 'app:bitbucket', kind: 'application', name: 'Atlassian Bitbucket', app_id: 'bitbucket', environment: 'demo', region: 'EMEA', status: 'HEALTHY', parent_id: null },
  { entity_id: 'app:jenkins', kind: 'application', name: 'CloudBees Jenkins', app_id: 'jenkins', environment: 'demo', region: 'EMEA', status: 'HEALTHY', parent_id: null },
  { entity_id: 'app:artifactory', kind: 'application', name: 'JFrog Artifactory', app_id: 'artifactory', environment: 'demo', region: 'AMER', status: 'HEALTHY', parent_id: null },
  { entity_id: 'app:argocd', kind: 'application', name: 'ArgoCD Hub', app_id: 'argocd', environment: 'demo', region: 'GLOBAL', status: 'HEALTHY', parent_id: null },
  { entity_id: 'infra:avi_load_balancer', kind: 'infrastructure', name: 'AVI Load Balancer (VIP Grid)', app_id: 'avi', environment: 'demo', region: 'GLOBAL', status: 'HEALTHY', parent_id: null },
  { entity_id: 'infra:database', kind: 'infrastructure', name: 'Primary PostgreSQL Database', app_id: 'database', environment: 'demo', region: 'GLOBAL', status: 'HEALTHY', parent_id: null },
  { entity_id: 'infra:nas_performance', kind: 'infrastructure', name: 'Enterprise NAS Storage Pool', app_id: 'nas', environment: 'demo', region: 'GLOBAL', status: 'HEALTHY', parent_id: null },
  { entity_id: 'host:lon-bb-01', kind: 'host', name: 'lon-bb-lnx-01 (Bitbucket Primary)', app_id: 'bitbucket', environment: 'demo', region: 'EMEA', status: 'HEALTHY', parent_id: 'app:bitbucket' },
  { entity_id: 'host:lon-bb-02', kind: 'host', name: 'lon-bb-lnx-02 (Bitbucket Cluster)', app_id: 'bitbucket', environment: 'demo', region: 'EMEA', status: 'HEALTHY', parent_id: 'app:bitbucket' },
  { entity_id: 'host:k8s-agent-01', kind: 'host', name: 'k8s-jenkins-agent-pool-01', app_id: 'jenkins', environment: 'demo', region: 'EMEA', status: 'HEALTHY', parent_id: 'app:jenkins' },
  { entity_id: 'host:amer-art-01', kind: 'host', name: 'amer-jfrog-srv-01', app_id: 'artifactory', environment: 'demo', region: 'AMER', status: 'HEALTHY', parent_id: 'app:artifactory' }
];

const DEMO_EDGES = [
  { from_entity: 'app:bitbucket', to_entity: 'infra:avi_load_balancer', edge_type: 'routes_traffic_to', confidence: 1.0, source: 'demo' },
  { from_entity: 'app:bitbucket', to_entity: 'infra:database', edge_type: 'reads_writes', confidence: 1.0, source: 'demo' },
  { from_entity: 'app:bitbucket', to_entity: 'infra:nas_performance', edge_type: 'mounts', confidence: 1.0, source: 'demo' },
  { from_entity: 'host:lon-bb-01', to_entity: 'app:bitbucket', edge_type: 'belongs_to', confidence: 1.0, source: 'demo' },
  { from_entity: 'app:jenkins', to_entity: 'infra:avi_load_balancer', edge_type: 'routes_traffic_to', confidence: 1.0, source: 'demo' },
  { from_entity: 'app:artifactory', to_entity: 'infra:database', edge_type: 'reads_writes', confidence: 1.0, source: 'demo' }
];

// Creates the .runtime folder.
function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    try { fs.mkdirSync(RUNTIME_DIR, { recursive: true }); } catch (_) {}
  }
}

// Loads the inventory cache file.
function loadCache() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (fs.existsSync(INVENTORY_CACHE_FILE)) {
        const raw = fs.readFileSync(INVENTORY_CACHE_FILE, 'utf8');
        if (!raw || raw.trim().length === 0) {
          const start = Date.now();
          while (Date.now() - start < 30) {}
          continue;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.entities)) {
          parsed.entities.forEach(e => state.entities.set(e.entity_id, e));
        }
        if (Array.isArray(parsed.edges)) {
          parsed.edges.forEach(edge => {
            const key = `${edge.from_entity}|${edge.to_entity}|${edge.edge_type}`;
            state.edges.set(key, edge);
          });
        }
        return;
      }
    } catch (err) {
      if (attempt < 2) {
        const start = Date.now();
        while (Date.now() - start < 30) {}
        continue;
      }
      console.warn('[INVENTORY] Could not load local inventory cache:', err.message);
    }
  }
}

let saveTimer = null;
let lastSaveTime = 0;
const SAVE_DEBOUNCE_MS = Number(process.env.INVENTORY_SAVE_DEBOUNCE_MS ?? 5000);

// Writes the cache now.
function flushCacheSync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  ensureRuntimeDir();
  const data = {
    entities: Array.from(state.entities.values()),
    edges: Array.from(state.edges.values()),
    updatedAt: new Date().toISOString()
  };
  const content = JSON.stringify(data, null, 2);
  const tmpFile = `${INVENTORY_CACHE_FILE}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    fs.renameSync(tmpFile, INVENTORY_CACHE_FILE);
  } catch (_) {
    try {
      fs.writeFileSync(INVENTORY_CACHE_FILE, content, 'utf8');
    } catch (_) {}
  }
  lastSaveTime = Date.now();
}

// Writes the cache (debounced).
function saveCache() {
  const now = Date.now();
  if (now - lastSaveTime >= SAVE_DEBOUNCE_MS) {
    flushCacheSync();
  } else if (!saveTimer) {
    const delay = Math.max(SAVE_DEBOUNCE_MS - (now - lastSaveTime), 10);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushCacheSync();
    }, delay);
    if (saveTimer.unref) saveTimer.unref();
  }
}

loadCache();

// [M1.10] Both app nodes write entities through to Postgres; each node also reads
// them back periodically so an agent registered on one node appears on the other.
const SYNC_INTERVAL_MS = 60 * 1000;

// ISO date.
function iso(v) {
  return v instanceof Date ? v.toISOString() : (v || null);
}

// Loads entities from PostgreSQL.
async function syncFromPostgres() {
  try {
    const pool = await postgres.getPool();
    if (!pool) return false;
    const ents = await pool.query(
      `SELECT entity_id, kind, name, app_id, region, environment, parent_id, labels, source, status, first_seen, last_seen
         FROM entity WHERE last_seen > now() - interval '7 days'`
    );
    ents.rows.forEach(r => {
      const existing = state.entities.get(r.entity_id);
      const lastSeen = iso(r.last_seen);
      if (!existing || (lastSeen && existing.last_seen && lastSeen > existing.last_seen)) {
        state.entities.set(r.entity_id, {
          entity_id: r.entity_id, kind: r.kind, name: r.name, app_id: r.app_id, region: r.region,
          environment: r.environment, parent_id: r.parent_id, labels: r.labels || {}, source: r.source,
          status: r.status, first_seen: iso(r.first_seen), last_seen: lastSeen
        });
      }
    });
    const edges = await pool.query(
      `SELECT from_entity, to_entity, edge_type, confidence, source, last_seen
         FROM entity_edge WHERE last_seen > now() - interval '7 days'`
    );
    edges.rows.forEach(r => {
      const key = `${r.from_entity}|${r.to_entity}|${r.edge_type}`;
      if (!state.edges.has(key)) {
        state.edges.set(key, { ...r, confidence: Number(r.confidence), last_seen: iso(r.last_seen) });
      }
    });
    return true;
  } catch (_) {
    return false; // database unreachable: keep serving the local cache
  }
}

// Repeats the PostgreSQL sync in the background.
const syncTimer = setInterval(() => { syncFromPostgres(); }, SYNC_INTERVAL_MS);
syncTimer.unref();
setImmediate(() => { syncFromPostgres(); });

const inventoryStore = {
  syncFromPostgres,

  /**
   * Upserts an entity into the store.
   * Writes through to PostgreSQL if available, otherwise commits to local cache.
   */
  async upsertEntity(entity) {
    if (!entity || !entity.entity_id) {
      throw new Error('Entity must include entity_id');
    }

    const now = new Date().toISOString();
    const existing = state.entities.get(entity.entity_id);

    const record = {
      entity_id: entity.entity_id,
      kind: entity.kind || 'unknown',
      name: entity.name || entity.entity_id,
      app_id: entity.app_id || null,
      region: entity.region || null,
      environment: entity.environment || global.runtimeEnvironment || 'staging',
      parent_id: entity.parent_id || null,
      labels: entity.labels ? { ...(existing?.labels || {}), ...entity.labels } : (existing?.labels || {}),
      source: entity.source || 'manual',
      status: entity.status || existing?.status || 'Active',
      first_seen: existing ? existing.first_seen : (entity.first_seen || now),
      last_seen: now
    };

    state.entities.set(record.entity_id, record);
    saveCache();

    // PostgreSQL write-through
    try {
      const pool = await postgres.getPool();
      if (pool) {
        await pool.query(`
          INSERT INTO entity (
            entity_id, kind, name, app_id, region, environment, parent_id, labels, source, status, first_seen, last_seen
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (entity_id) DO UPDATE SET
            name = EXCLUDED.name,
            app_id = COALESCE(EXCLUDED.app_id, entity.app_id),
            region = COALESCE(EXCLUDED.region, entity.region),
            environment = EXCLUDED.environment,
            parent_id = COALESCE(EXCLUDED.parent_id, entity.parent_id),
            labels = entity.labels || EXCLUDED.labels,
            status = EXCLUDED.status,
            last_seen = EXCLUDED.last_seen;
        `, [
          record.entity_id,
          record.kind,
          record.name,
          record.app_id,
          record.region,
          record.environment,
          record.parent_id,
          JSON.stringify(record.labels),
          record.source,
          record.status,
          record.first_seen,
          record.last_seen
        ]);
      }
    } catch (_) {
      // Degrades gracefully to local state
    }

    return record;
  },

  /**
   * Upserts a relationship edge between two entities.
   */
  async upsertEdge(edge) {
    if (!edge || !edge.from_entity || !edge.to_entity || !edge.edge_type) {
      throw new Error('Edge must include from_entity, to_entity, and edge_type');
    }

    const key = `${edge.from_entity}|${edge.to_entity}|${edge.edge_type}`;
    const now = new Date().toISOString();

    const record = {
      from_entity: edge.from_entity,
      to_entity: edge.to_entity,
      edge_type: edge.edge_type,
      confidence: edge.confidence !== undefined ? Number(edge.confidence) : 1.0,
      source: edge.source || 'manual',
      last_seen: now
    };

    state.edges.set(key, record);
    saveCache();

    try {
      const pool = await postgres.getPool();
      if (pool) {
        await pool.query(`
          INSERT INTO entity_edge (
            from_entity, to_entity, edge_type, confidence, source, last_seen
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (from_entity, to_entity, edge_type) DO UPDATE SET
            confidence = EXCLUDED.confidence,
            source = EXCLUDED.source,
            last_seen = EXCLUDED.last_seen;
        `, [
          record.from_entity,
          record.to_entity,
          record.edge_type,
          record.confidence,
          record.source,
          record.last_seen
        ]);
      }
    } catch (_) {
      // Degrades gracefully to local state
    }

    return record;
  },

  /**
   * [Q4] Removes one edge (memory, cache and Postgres). Used by sources that own
   * a replace-on-refresh set of edges (inventory/sources/vip_discovery.js) so stale
   * discoveries do not linger. Returns true when the edge existed locally.
   */
  async removeEdge(fromEntity, toEntity, edgeType) {
    const key = `${fromEntity}|${toEntity}|${edgeType}`;
    const existed = state.edges.delete(key);
    if (existed) saveCache();
    try {
      const pool = await postgres.getPool();
      if (pool) {
        await pool.query('DELETE FROM entity_edge WHERE from_entity = $1 AND to_entity = $2 AND edge_type = $3', [fromEntity, toEntity, edgeType]);
      }
    } catch (_) {
      // Degrades gracefully to local state
    }
    return existed;
  },

  /**
   * [Q4] Removes one entity (memory, cache and Postgres). Callers remove its edges first.
   */
  async removeEntity(entityId) {
    const existed = state.entities.delete(entityId);
    if (existed) saveCache();
    try {
      const pool = await postgres.getPool();
      if (pool) {
        await pool.query('DELETE FROM entity WHERE entity_id = $1', [entityId]);
      }
    } catch (_) {
      // Degrades gracefully to local state
    }
    return existed;
  },

  /**
   * Queries entities with optional filtering and pagination.
   */
  async getEntities({
    kind,
    app_id,
    environment,
    region,
    status,
    search,
    limit = 100,
    offset = 0
  } = {}) {
    let list = Array.from(state.entities.values());

    if (environment && environment.toLowerCase() === 'demo') {
      const demoMatches = list.filter(e => e.environment && e.environment.toLowerCase() === 'demo');
      if (demoMatches.length === 0) {
        list = [...list, ...DEMO_ENTITIES];
      }
    }

    if (kind) {
      list = list.filter(e => e.kind.toLowerCase() === kind.toLowerCase());
    }
    if (app_id) {
      list = list.filter(e => e.app_id && e.app_id.toLowerCase() === app_id.toLowerCase());
    }
    if (environment) {
      list = list.filter(e => e.environment && e.environment.toLowerCase() === environment.toLowerCase());
    }
    if (region) {
      list = list.filter(e => e.region && e.region.toLowerCase() === region.toLowerCase());
    }
    if (status) {
      list = list.filter(e => e.status && e.status.toLowerCase() === status.toLowerCase());
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.entity_id.toLowerCase().includes(q) ||
        (e.app_id && e.app_id.toLowerCase().includes(q))
      );
    }

    const total = list.length;
    const paginated = list.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      entities: paginated
    };
  },

  /**
   * Retrieves an entity by its ID, enriched with its direct incoming and outgoing edges.
   */
  async getEntityById(entityId) {
    let entity = state.entities.get(entityId);
    if (!entity) {
      loadCache();
      entity = state.entities.get(entityId);
    }
    if (!entity) return null;

    const outgoing = [];
    const incoming = [];

    state.edges.forEach(edge => {
      if (edge.from_entity === entityId) outgoing.push(edge);
      if (edge.to_entity === entityId) incoming.push(edge);
    });

    return {
      ...entity,
      edges: {
        outgoing,
        incoming
      }
    };
  },

  async getEntity(entityId) {
    return this.getEntityById(entityId);
  },

  /**
   * Performs an N-hop graph traversal starting from a root entity.
   */
  async getEntityGraph(rootId, maxDepth = 2) {
    const root = state.entities.get(rootId);
    if (!root) return null;

    const visitedEntities = new Set([rootId]);
    const collectedEntities = [root];
    const collectedEdges = [];
    let currentLevel = [rootId];

    for (let depth = 0; depth < maxDepth; depth++) {
      const nextLevel = [];

      state.edges.forEach(edge => {
        if (currentLevel.includes(edge.from_entity)) {
          collectedEdges.push(edge);
          if (!visitedEntities.has(edge.to_entity)) {
            visitedEntities.add(edge.to_entity);
            const target = state.entities.get(edge.to_entity);
            if (target) {
              collectedEntities.push(target);
              nextLevel.push(edge.to_entity);
            }
          }
        }
        if (currentLevel.includes(edge.to_entity)) {
          collectedEdges.push(edge);
          if (!visitedEntities.has(edge.from_entity)) {
            visitedEntities.add(edge.from_entity);
            const source = state.entities.get(edge.from_entity);
            if (source) {
              collectedEntities.push(source);
              nextLevel.push(edge.from_entity);
            }
          }
        }
      });

      currentLevel = nextLevel;
      if (currentLevel.length === 0) break;
    }

    // Deduplicate edges
    const uniqueEdgeMap = new Map();
    collectedEdges.forEach(e => {
      uniqueEdgeMap.set(`${e.from_entity}|${e.to_entity}|${e.edge_type}`, e);
    });

    return {
      rootId,
      depth: maxDepth,
      entities: collectedEntities,
      edges: Array.from(uniqueEdgeMap.values())
    };
  },

  /**
   * Marks entities as 'Stale' if last_seen is older than the TTL.
   */
  async markStaleEntities(ttlMs = 30 * 60 * 1000) {
    const cutoff = Date.now() - ttlMs;
    let staleCount = 0;

    state.entities.forEach(entity => {
      if (entity.status !== 'Stale' && entity.status !== 'Decommissioned') {
        const lastSeenMs = new Date(entity.last_seen).getTime();
        if (lastSeenMs < cutoff) {
          entity.status = 'Stale';
          staleCount++;
        }
      }
    });

    if (staleCount > 0) {
      saveCache();
    }
    return staleCount;
  },

  /**
   * Clears state (primarily for test resets).
   */
  clear() {
    state.entities.clear();
    state.edges.clear();
    if (fs.existsSync(INVENTORY_CACHE_FILE)) {
      try { fs.unlinkSync(INVENTORY_CACHE_FILE); } catch (_) {}
    }
  }
};

module.exports = inventoryStore;
