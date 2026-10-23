'use strict';

/**
 * backend/services/dashboardService.js
 *
 * M7 Task 7.2: Dashboard Builder Service
 * Manages dashboard persistence in PostgreSQL with in-memory fallback,
 * JSON schema validation, and file-based export/import syncing with config/dashboards/.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Folder holding dashboard JSON files.
function dashboardsDir() {
  return process.env.SENTINEL_DASHBOARDS_DIR
    ? path.resolve(process.env.SENTINEL_DASHBOARDS_DIR)
    : path.resolve(__dirname, '../../config/dashboards');
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

// URL-safe slug.
function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 100) || 'dashboard';
}

let postgres = null;
try {
  postgres = require('@sentinel/database/postgres');
} catch (_) {
  try {
    postgres = require('../../database/postgres');
  } catch (e) {
    postgres = null;
  }
}

// In-memory store for local testing and standalone runs
const inMemoryDashboards = new Map();

const VALID_PANEL_TYPES = new Set(['stat', 'time_series', 'table', 'pie', 'bar']);

// Validates a dashboard definition.
function validateDashboard(dashboard) {
  if (!dashboard || typeof dashboard !== 'object') {
    throw new Error('Dashboard must be an object');
  }
  if (!dashboard.title || typeof dashboard.title !== 'string' || !dashboard.title.trim()) {
    throw new Error('Dashboard title is required');
  }
  if (!Array.isArray(dashboard.panels)) {
    throw new Error('Dashboard panels must be an array');
  }

  for (let i = 0; i < dashboard.panels.length; i++) {
    const p = dashboard.panels[i];
    if (!p.id) p.id = `panel-${i + 1}`;
    if (!p.title) p.title = `Panel ${i + 1}`;
    if (!VALID_PANEL_TYPES.has(p.type)) {
      throw new Error(`Invalid panel type '${p.type}'. Allowed types: ${Array.from(VALID_PANEL_TYPES).join(', ')}`);
    }
    if (!p.query || typeof p.query !== 'string' || !p.query.trim()) {
      throw new Error(`Panel '${p.title}' requires a valid SentinelQL query`);
    }
    if (!p.layout || typeof p.layout !== 'object') {
      p.layout = { x: 0, y: i * 4, w: 6, h: 4 };
    }
  }

  // A slug is also a file name under config/dashboards: only [a-z0-9-].
  if (!dashboard.slug || !SLUG_RE.test(String(dashboard.slug))) {
    dashboard.slug = slugify(dashboard.slug || dashboard.title);
  }
  if (!dashboard.id) {
    dashboard.id = `dash-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex')}`;
  }

  return dashboard;
}

// PostgreSQL pool or null.
async function getPoolSafe() {
  try {
    if (postgres && postgres.getPool) return await postgres.getPool();
  } catch (_) {}
  return null;
}

/**
 * U6: reads config/dashboards/*.json into the store. Runs on start (module load).
 * Files never overwrite a dashboard that already exists in PostgreSQL (ON CONFLICT DO NOTHING),
 * so edits made in the UI survive a restart. Returns the dashboards read.
 */
function loadFromFiles() {
  const dir = dashboardsDir();
  if (!fs.existsSync(dir)) return [];

  const loaded = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const fullPath = path.join(dir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(content);
      const validated = validateDashboard(parsed);
      if (!validated.environment) validated.environment = 'staging';
      if (!validated.created_by) validated.created_by = 'config';
      inMemoryDashboards.set(validated.id, validated);
      inMemoryDashboards.set(validated.slug, validated);
      loaded.push(validated);
    } catch (err) {
      console.warn(`[DASHBOARDS] Could not load dashboard file ${file}:`, err.message);
    }
  }
  seedStore(loaded).catch(err => console.warn('[DASHBOARDS] Seeding PostgreSQL from files failed:', err.message));
  return loaded;
}

// Seeds the database with file dashboards.
async function seedStore(dashboards) {
  if (!dashboards.length) return 0;
  const pool = await getPoolSafe();
  if (!pool) return 0;
  let n = 0;
  for (const d of dashboards) {
    const now = new Date().toISOString();
    const r = await pool.query(
      `INSERT INTO dashboards (id, slug, title, description, tags, panels, created_at, updated_at, created_by, environment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [d.id, d.slug, d.title, d.description || '', JSON.stringify(d.tags || []), JSON.stringify(d.panels || []),
        d.created_at || now, d.updated_at || now, d.created_by || 'config', d.environment || 'staging']
    );
    n += (r && r.rowCount) || 0;
  }
  return n;
}

/**
 * U6: writes the dashboard's export to config/dashboards/<slug>.json. Refuses to replace a
 * file that belongs to a different dashboard (same slug, other id).
 */
function writeDashboardFile(dashboard) {
  const dir = dashboardsDir();
  const slug = String(dashboard.slug || '');
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid dashboard slug '${slug}'`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.json`);
  if (fs.existsSync(file)) {
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    if (existing && existing.id && existing.id !== dashboard.id) {
      const err = new Error(`config/dashboards/${slug}.json belongs to another dashboard (${existing.id})`);
      err.status = 409;
      throw err;
    }
  }
  fs.writeFileSync(file, exportDashboard(dashboard) + '\n', 'utf8');
  return file;
}

// Initial sync on start
loadFromFiles();

// Lists dashboards for an environment.
async function listDashboards(environment = 'staging') {
  let pool = null;
  try {
    if (postgres && postgres.getPool) pool = await postgres.getPool();
  } catch (_) {
    pool = null;
  }

  if (pool) {
    try {
      const res = await pool.query(
        'SELECT id, slug, title, description, tags, jsonb_array_length(panels) AS panel_count, updated_at, created_by, environment FROM dashboards WHERE environment = $1 ORDER BY title ASC',
        [environment]
      );
      if (res.rows.length > 0) {
        return res.rows.map(r => ({
          ...r,
          tags: Array.isArray(r.tags) ? r.tags : JSON.parse(r.tags || '[]')
        }));
      }
    } catch (err) {
      // fallback to memory
    }
  }

  // Fallback to in-memory store
  const unique = new Map();
  for (const d of inMemoryDashboards.values()) {
    if (!unique.has(d.id)) {
      unique.set(d.id, {
        id: d.id,
        slug: d.slug,
        title: d.title,
        description: d.description || '',
        tags: d.tags || [],
        panel_count: Array.isArray(d.panels) ? d.panels.length : 0,
        updated_at: d.updated_at || new Date().toISOString(),
        created_by: d.created_by || 'system',
        environment: d.environment || 'staging'
      });
    }
  }

  return Array.from(unique.values()).filter(d => !d.environment || d.environment === environment);
}

/**
 * Fetches one dashboard by id or slug. With `environment`, only a dashboard of that
 * environment is returned (Phase S4: no reading another environment's dashboards).
 */
async function getDashboard(idOrSlug, environment = null) {
  let pool = null;
  try {
    if (postgres && postgres.getPool) pool = await postgres.getPool();
  } catch (_) {
    pool = null;
  }

  if (pool) {
    try {
      const res = await pool.query(
        environment
          ? 'SELECT id, slug, title, description, tags, panels, created_at, updated_at, created_by, environment FROM dashboards WHERE (id = $1 OR slug = $1) AND environment = $2 LIMIT 1'
          : 'SELECT id, slug, title, description, tags, panels, created_at, updated_at, created_by, environment FROM dashboards WHERE id = $1 OR slug = $1 LIMIT 1',
        environment ? [idOrSlug, environment] : [idOrSlug]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          ...row,
          tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
          panels: typeof row.panels === 'string' ? JSON.parse(row.panels) : row.panels
        };
      }
    } catch (err) {
      // fallback to memory
    }
  }

  // Memory fallback
  const found = inMemoryDashboards.get(idOrSlug) || null;
  if (found && environment && (found.environment || 'staging') !== environment) return null;
  return found;
}

// Saves a dashboard.
async function saveDashboard(dashboardData, user = 'operator') {
  const validated = validateDashboard(dashboardData);
  // A slug names one dashboard: never let a new one take over another's slug.
  const clash = await getDashboard(validated.slug);
  if (clash && clash.id !== validated.id) {
    validated.slug = `${validated.slug}-${crypto.randomBytes(3).toString('hex')}`;
  }
  validated.updated_at = new Date().toISOString();
  if (!validated.created_at) validated.created_at = validated.updated_at;
  if (!validated.created_by) validated.created_by = user;

  let pool = null;
  try {
    if (postgres && postgres.getPool) pool = await postgres.getPool();
  } catch (_) {
    pool = null;
  }

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO dashboards (id, slug, title, description, tags, panels, created_at, updated_at, created_by, environment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           tags = EXCLUDED.tags,
           panels = EXCLUDED.panels,
           updated_at = EXCLUDED.updated_at`,
        [
          validated.id,
          validated.slug,
          validated.title,
          validated.description || '',
          JSON.stringify(validated.tags || []),
          JSON.stringify(validated.panels || []),
          validated.created_at,
          validated.updated_at,
          validated.created_by,
          validated.environment || 'staging'
        ]
      );
    } catch (err) {
      // record in memory
    }
  }

  inMemoryDashboards.set(validated.id, validated);
  inMemoryDashboards.set(validated.slug, validated);

  return validated;
}

// Deletes a dashboard.
async function deleteDashboard(idOrSlug, environment = null) {
  const existing = await getDashboard(idOrSlug, environment);
  if (!existing) return false;

  let pool = null;
  try {
    if (postgres && postgres.getPool) pool = await postgres.getPool();
  } catch (_) {
    pool = null;
  }

  if (pool) {
    try {
      await pool.query('DELETE FROM dashboards WHERE id = $1', [existing.id]);
    } catch (_) {}
  }

  inMemoryDashboards.delete(existing.id);
  inMemoryDashboards.delete(existing.slug);
  return true;
}

// Export format of a dashboard.
function exportDashboard(dashboard) {
  const exportData = {
    id: dashboard.id,
    slug: dashboard.slug,
    title: dashboard.title,
    description: dashboard.description || '',
    tags: dashboard.tags || [],
    environment: dashboard.environment || 'staging',
    panels: dashboard.panels || []
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * Imports a definition into `environment`. The importer becomes the owner; an id that
 * already belongs to another dashboard is not overwritten (a new id is assigned).
 */
async function importDashboard(jsonStringOrObj, user = 'operator', environment = 'staging') {
  const parsed = typeof jsonStringOrObj === 'string' ? JSON.parse(jsonStringOrObj) : { ...jsonStringOrObj };
  parsed.environment = environment;
  delete parsed.created_by;
  delete parsed.created_at;
  if (parsed.id && await getDashboard(parsed.id)) delete parsed.id;
  return await saveDashboard(parsed, user);
}

module.exports = {
  listDashboards,
  getDashboard,
  saveDashboard,
  deleteDashboard,
  exportDashboard,
  importDashboard,
  validateDashboard,
  loadFromFiles,
  writeDashboardFile,
  dashboardsDir
};
