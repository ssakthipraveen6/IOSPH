/**
 * Collector leader election across the two SENTINEL app nodes (M1.9).
 *
 * Both nodes serve the UI and accept pushed telemetry, but only one may run the
 * polling collectors, the anomaly analyzer and self-healing, or every probe,
 * alert and recovery would happen twice. The leader holds a session-level
 * Postgres advisory lock on a dedicated connection; if that node or its
 * connection dies, Postgres releases the lock and the other node takes over
 * on its next attempt.
 *
 * Without a configured database the node runs standalone (always leader).
 * With a configured but unreachable database, a node leads only if
 * SENTINEL_PREFERRED_LEADER=true (set it on one node), so collection does not
 * stop on both nodes during a database outage, and does not run on both.
 */
const postgres = require('./postgres');

const LOCK_KEY = 0x53454e54; // 'SENT'
const RETRY_MS = Number(process.env.SENTINEL_LEADER_RETRY_MS) || 15000;
const HEALTH_MS = Number(process.env.SENTINEL_LEADER_HEALTH_MS) || 10000;

const state = {
  started: false,
  leader: true, // standalone until start() says otherwise
  mode: 'standalone',
  client: null,
  since: null,
  lastError: null,
  timer: null
};
const listeners = new Set();

// Sets leader state and notifies listeners.
function setLeader(leader, mode) {
  const changed = state.leader !== leader;
  state.leader = leader;
  state.mode = mode;
  if (changed) {
    state.since = new Date().toISOString();
    console.log(`[LEADER] This node is now ${leader ? 'LEADER' : 'FOLLOWER'} (${mode}).`);
    listeners.forEach(fn => { try { fn(leader); } catch (_) {} });
  }
}

// Releases the lock connection.
function releaseClient() {
  if (state.client) {
    try { state.client.release(true); } catch (_) {}
    state.client = null;
  }
}

// Tries to take or keep the PostgreSQL advisory lock.
async function attempt() {
  // Already leader: confirm the lock-holding connection is alive.
  if (state.client) {
    try {
      await state.client.query('SELECT 1');
      return;
    } catch (err) {
      state.lastError = err.message;
      releaseClient();
      setLeader(false, 'lost');
    }
  }

  let pool;
  try {
    pool = await postgres.getPool();
  } catch (err) {
    pool = undefined;
    state.lastError = err.message;
  }
  if (pool === null) {
    setLeader(true, 'standalone');
    return;
  }

  let client;
  try {
    client = await pool.connect();
    const res = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    if (res.rows[0] && res.rows[0].locked) {
      state.client = client;
      client.on('error', err => {
        state.lastError = err.message;
        releaseClient();
        setLeader(false, 'lost');
      });
      setLeader(true, 'advisory_lock');
    } else {
      client.release();
      setLeader(false, 'advisory_lock');
    }
    state.lastError = null;
  } catch (err) {
    if (client) { try { client.release(true); } catch (_) {} }
    state.lastError = err.message;
    setLeader(process.env.SENTINEL_PREFERRED_LEADER === 'true', 'database_unreachable');
  }
}

// Schedules the next attempt.
function schedule() {
  const delay = state.client ? HEALTH_MS : RETRY_MS;
  state.timer = setTimeout(async () => {
    await attempt();
    if (state.started) schedule();
  }, delay);
  state.timer.unref();
}

// Starts leader election.
async function start() {
  if (state.started) return;
  state.started = true;
  state.leader = false;
  state.mode = 'starting';
  await attempt();
  schedule();
}

// Stops leader election.
async function stop() {
  state.started = false;
  if (state.timer) clearTimeout(state.timer);
  if (state.client) {
    try { await state.client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (_) {}
    releaseClient();
  }
  setLeader(true, 'standalone');
}

// True on the leader node.
function isLeader() {
  return state.leader;
}

// Registers a leader-change listener.
function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Leader status.
function getStatus() {
  return { leader: state.leader, mode: state.mode, since: state.since, lastError: state.lastError, preferredLeader: process.env.SENTINEL_PREFERRED_LEADER === 'true' };
}

module.exports = { start, stop, isLeader, onChange, getStatus, LOCK_KEY };
