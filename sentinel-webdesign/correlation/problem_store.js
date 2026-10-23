/**
 * correlation/problem_store.js — P6
 *
 * Problems live in the Postgres `problem` table (migration 015) so both app nodes
 * read the same list. Without a configured database the in-memory map in
 * correlation/index.js is used (single node / development).
 */

let postgres = null;
try {
  postgres = require('@sentinel/database/postgres');
} catch (_) {
  try { postgres = require('../database/postgres'); } catch (__) { postgres = null; }
}

let poolOverride; // undefined = use postgres.getPool(); null = force memory; object = injected pool (tests)

// Overrides the PostgreSQL pool (tests).
function setPool(pool) {
  poolOverride = pool;
}

// PostgreSQL pool or null.
async function getPool() {
  if (poolOverride !== undefined) return poolOverride;
  if (!postgres || typeof postgres.getPool !== 'function') return null;
  try {
    return await postgres.getPool();
  } catch (_) {
    return null;
  }
}

// In-memory problem map.
function memory() {
  return require('./index').problemStore;
}

// Problem from a database row.
function fromRow(r) {
  if (!r) return null;
  const pack = typeof r.evidence_pack === 'string' ? JSON.parse(r.evidence_pack) : (r.evidence_pack || {});
  const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);
  return {
    id: r.id,
    title: r.title,
    environment: r.environment,
    status: r.status,
    severity: r.severity,
    top_layer: r.top_layer,
    confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
    suspect_entity: r.suspect_entity,
    alert_count: Number(r.alert_count || 0),
    alerts: Array.isArray(pack.alert_ids) ? pack.alert_ids : (pack.alerts || []).map(a => a.id),
    evidence_pack: pack,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    resolved_at: pack.resolved_at || null
  };
}

// Saves a problem (memory and PostgreSQL).
async function save(problem) {
  memory().set(problem.id, problem);
  const pool = await getPool();
  if (!pool) return { stored: 'memory' };
  const pack = { ...(problem.evidence_pack || {}), alert_ids: problem.alerts || [], resolved_at: problem.resolved_at || null };
  try {
    await pool.query(
      `INSERT INTO problem (id, title, environment, status, severity, top_layer, confidence, suspect_entity, alert_count, evidence_pack, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, status = EXCLUDED.status, severity = EXCLUDED.severity,
         top_layer = EXCLUDED.top_layer, confidence = EXCLUDED.confidence, suspect_entity = EXCLUDED.suspect_entity,
         alert_count = EXCLUDED.alert_count, evidence_pack = EXCLUDED.evidence_pack, updated_at = EXCLUDED.updated_at`,
      [
        problem.id,
        String(problem.title || problem.id).slice(0, 255),
        problem.environment,
        problem.status,
        problem.severity,
        problem.top_layer,
        problem.confidence,
        problem.suspect_entity,
        problem.alert_count,
        JSON.stringify(pack),
        new Date(problem.created_at || Date.now()),
        new Date(problem.updated_at || Date.now())
      ]
    );
    return { stored: 'postgres' };
  } catch (err) {
    console.warn('[PROBLEMS] Postgres write failed, kept in memory:', err.message);
    return { stored: 'memory', error: err.message };
  }
}

// Lists problems of an environment.
async function list(env, { status = null, limit = 200 } = {}) {
  const pool = await getPool();
  if (pool) {
    try {
      const params = [env];
      let sql = 'SELECT * FROM problem WHERE environment = $1';
      if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
      params.push(limit);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const res = await pool.query(sql, params);
      return (res && res.rows ? res.rows : []).map(fromRow);
    } catch (err) {
      console.warn('[PROBLEMS] Postgres read failed, using memory:', err.message);
    }
  }
  return Array.from(memory().values())
    .filter(p => !env || p.environment === env)
    .filter(p => !status || (p.status && String(p.status).toLowerCase() === String(status).toLowerCase()))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

// One problem by id.
async function get(id) {
  const pool = await getPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM problem WHERE id = $1', [id]);
      if (res && res.rows && res.rows[0]) return fromRow(res.rows[0]);
    } catch (err) {
      console.warn('[PROBLEMS] Postgres read failed, using memory:', err.message);
    }
  }
  return memory().get(id) || null;
}

module.exports = { save, recordProblem: save, list, get, setPool, _fromRow: fromRow };
