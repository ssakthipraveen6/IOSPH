#!/usr/bin/env node
/**
 * Manage ingest API keys (M1.5, L4).
 *
 *   node scripts/ingest_key.js create <name> <prod|staging|demo> [--scopes metrics,logs,heartbeat,gateway] [--allowed-environments prod,staging]
 *   node scripts/ingest_key.js list
 *   node scripts/ingest_key.js revoke <name>
 *
 * `create` prints the raw key once; only its SHA-256 hash is stored. Without a
 * database it prints the SENTINEL_INGEST_API_KEYS entry to add to config/.env instead.
 */
const postgres = require('../database/postgres');
const { hashKey, generateKey, ENVIRONMENTS } = require('../backend/auth/ingest_keys');

// True when PostgreSQL is reachable.
async function dbAvailable() {
  try {
    return !!(await postgres.getPool());
  } catch (_) {
    return false;
  }
}

// Creates a key and prints it once.
async function create(name, env, scopes, allowedEnvironments = null) {
  if (!name || !ENVIRONMENTS.includes(env)) {
    throw new Error('Usage: create <name> <prod|staging|demo> [--scopes metrics,logs,heartbeat,gateway] [--allowed-environments prod,staging]');
  }
  const raw = generateKey();
  const hash = hashKey(raw);
  if (await dbAvailable()) {
    await postgres.query(
      'INSERT INTO ingest_api_key (name, environment, key_hash, scopes, allowed_environments, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [name, env, hash, scopes, allowedEnvironments, process.env.USERNAME || process.env.USER || 'cli']
    );
    console.log(`Created ingest key "${name}" for ${env} (stored as hash in Postgres).`);
  } else {
    console.log('No database configured. Add this entry to SENTINEL_INGEST_API_KEYS in config/.env (comma-separated):');
    const scopesStr = (scopes || []).join(';');
    const allowedStr = (allowedEnvironments || []).join(';');
    console.log(`  ${name}:${env}:${hash}:${scopesStr}:${allowedStr}`);
  }
  console.log('\nRaw key (shown once, give it to the agent/gateway as SENTINEL_INGEST_API_KEY):');
  console.log(`  ${raw}`);
}

// Lists keys.
async function list() {
  if (!(await dbAvailable())) {
    console.log('No database configured; keys come from SENTINEL_INGEST_API_KEYS only.');
    return;
  }
  const res = await postgres.query('SELECT name, environment, scopes, allowed_environments, created_by, created_at, revoked_at, last_used_at FROM ingest_api_key ORDER BY name');
  console.table(res.rows);
}

// Revokes a key.
async function revoke(name) {
  if (!name) throw new Error('Usage: revoke <name>');
  if (!(await dbAvailable())) throw new Error('No database configured; remove the entry from SENTINEL_INGEST_API_KEYS instead.');
  const res = await postgres.query('UPDATE ingest_api_key SET revoked_at = now() WHERE name = $1 AND revoked_at IS NULL', [name]);
  console.log(res.rowCount ? `Revoked "${name}". Running servers stop accepting it within a minute.` : `No active key named "${name}".`);
}

// Command-line entry point.
async function main() {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  const scopesIdx = rest.indexOf('--scopes');
  const scopes = scopesIdx >= 0 && rest[scopesIdx + 1] ? rest[scopesIdx + 1].split(',') : ['metrics', 'logs', 'heartbeat'];
  const allowedIdx = rest.indexOf('--allowed-environments') >= 0 ? rest.indexOf('--allowed-environments') : rest.indexOf('--allowed-envs');
  const allowed = allowedIdx >= 0 && rest[allowedIdx + 1] ? rest[allowedIdx + 1].split(',').map(e => e.trim().toLowerCase()) : null;

  if (cmd === 'create') await create(a, (b || '').toLowerCase(), scopes, allowed);
  else if (cmd === 'list') await list();
  else if (cmd === 'revoke') await revoke(a);
  else console.log('Usage: node scripts/ingest_key.js create|list|revoke ...');
}

main()
  .then(() => postgres.closePool && postgres.closePool())
  .then(() => process.exit(0))
  .catch(err => { console.error(err.message); process.exit(1); });
