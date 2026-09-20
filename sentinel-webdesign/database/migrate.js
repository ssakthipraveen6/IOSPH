const fs = require('fs');
const path = require('path');
const postgres = require('./postgres');

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

async function runMigrate() {
  const action = (process.argv[2] || 'up').toLowerCase();
  console.log(`[MIGRATION] Running migration runner: action=${action}`);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }

  let pool;
  try {
    pool = await postgres.getPool();
  } catch (err) {
    console.warn(`[MIGRATION] PostgreSQL connection unavailable: ${err.message}. Skipping database migration.`);
    return;
  }

  if (!pool) {
    console.log('[MIGRATION] No PostgreSQL pool configured. Migrations skipped.');
    return;
  }

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.warn(`[MIGRATION] Could not connect to PostgreSQL (${err.message}). Migrations skipped.`);
    return;
  }

  try {
    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const appliedRes = await client.query('SELECT name FROM schema_migrations ORDER BY id ASC;');
    const appliedNames = new Set(appliedRes.rows.map(r => r.name));

    const allFiles = fs.readdirSync(MIGRATIONS_DIR).sort();
    const upFiles = allFiles.filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'));

    if (action === 'status') {
      console.log('\n--- Migration Status ---');
      upFiles.forEach(f => {
        const status = appliedNames.has(f) ? 'APPLIED' : 'PENDING';
        console.log(`[${status}] ${f}`);
      });
      console.log('------------------------\n');
      return;
    }

    if (action === 'up') {
      for (const file of upFiles) {
        if (!appliedNames.has(file)) {
          console.log(`[MIGRATION] Applying: ${file}`);
          const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
          await client.query('BEGIN');
          try {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (name) VALUES ($1);', [file]);
            await client.query('COMMIT');
            console.log(`[MIGRATION] Successfully applied: ${file}`);
          } catch (err) {
            await client.query('ROLLBACK');
            console.error(`[MIGRATION] Failed applying ${file}:`, err.message);
            throw err;
          }
        } else {
          console.log(`[MIGRATION] Already applied: ${file}`);
        }
      }
    } else if (action === 'down') {
      const lastApplied = appliedRes.rows[appliedRes.rows.length - 1];
      if (!lastApplied) {
        console.log('[MIGRATION] No applied migrations to revert.');
        return;
      }
      const downFile = lastApplied.name.replace(/\.sql$/, '.down.sql');
      const downPath = path.join(MIGRATIONS_DIR, downFile);
      if (!fs.existsSync(downPath)) {
        throw new Error(`Reverse migration file not found: ${downFile}`);
      }
      console.log(`[MIGRATION] Reverting: ${lastApplied.name} using ${downFile}`);
      const sql = fs.readFileSync(downPath, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE name = $1;', [lastApplied.name]);
        await client.query('COMMIT');
        console.log(`[MIGRATION] Successfully reverted: ${lastApplied.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[MIGRATION] Failed reverting ${lastApplied.name}:`, err.message);
        throw err;
      }
    } else {
      console.error(`Unknown migration action "${action}". Use 'up', 'down', or 'status'.`);
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrate().catch(err => {
    console.error('[MIGRATION] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runMigrate };
