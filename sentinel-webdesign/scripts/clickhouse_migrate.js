#!/usr/bin/env node
'use strict';
/**
 * Apply database/clickhouse/migrations/NNN_*.sql in order over ClickHouse's HTTP
 * interface, recording each applied version in <db>.schema_migrations.
 *
 *   node scripts/clickhouse_migrate.js            apply pending migrations
 *   node scripts/clickhouse_migrate.js --dry-run  print the SQL that would run (no network)
 *   node scripts/clickhouse_migrate.js --status   list applied / pending
 *
 * Connection comes from database/clickhouse.js (CLICKHOUSE_URL ... or the
 * `clickhouse:` block in config/global.yaml). When no URL is configured the
 * script exits 0 and says so — ClickHouse is optional, like every other backend.
 *
 * Migration files: `{db}` is replaced with the configured database name; each
 * statement ends with `;` at the end of a line; lines starting with `--` are comments.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ch = require('../database/clickhouse');

const MIGRATIONS_DIR = path.resolve(__dirname, '../database/clickhouse/migrations');
const FILE_RE = /^(\d+)_([A-Za-z0-9_-]+)\.sql$/;

// Migration files in order.
function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .map(f => {
      const m = FILE_RE.exec(f);
      if (!m) return null;
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      return {
        version: Number(m[1]),
        name: m[2],
        file: f,
        content,
        checksum: crypto.createHash('sha256').update(content).digest('hex'),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

// SQL statements of a file.
function splitStatements(sql, database) {
  const body = sql
    .split(/\r?\n/)
    .filter(line => !/^\s*--/.test(line))
    .join('\n')
    .replace(/\{db\}/g, database);
  return body
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Statements that create the database.
function bootstrapStatements(database) {
  return [
    `CREATE DATABASE IF NOT EXISTS ${database}`,
    `CREATE TABLE IF NOT EXISTS ${database}.schema_migrations
(
    version    UInt32,
    name       String,
    checksum   String,
    applied_at DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(applied_at)
ORDER BY version`,
  ];
}

// Command-line options.
function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    status: argv.includes('--status'),
  };
}

// Applies pending migrations (or prints them with --dry-run).
async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const migrations = listMigrations();
  const cfg = ch.getConfig();
  const database = cfg.database;

  if (args.dryRun) {
    console.log(`-- [CH-MIGRATE] dry run: ${migrations.length} migration(s), database=${database}` +
      (cfg.url ? '' : ' (ClickHouse not configured; printing SQL only)'));
    for (const s of bootstrapStatements(database)) console.log(`${s};\n`);
    for (const m of migrations) {
      console.log(`-- ===== ${m.file} (version ${m.version}) =====`);
      for (const s of splitStatements(m.content, database)) console.log(`${s};\n`);
    }
    return 0;
  }

  if (!cfg.url) {
    console.log('[CH-MIGRATE] ClickHouse is not configured (CLICKHOUSE_URL blank and no clickhouse.url in config/global.yaml). Nothing to do.');
    return 0;
  }

  console.log(`[CH-MIGRATE] Target ${cfg.url} database=${database}`);
  for (const s of bootstrapStatements(database)) await ch.command(s, {}, { database: '' });

  const appliedRows = await ch.query(
    'SELECT version, checksum FROM schema_migrations FINAL ORDER BY version');
  const applied = new Map(appliedRows.map(r => [Number(r.version), r.checksum]));

  if (args.status) {
    for (const m of migrations) {
      const st = applied.has(m.version)
        ? (applied.get(m.version) === m.checksum ? 'applied' : 'applied (file changed since)')
        : 'pending';
      console.log(`  ${String(m.version).padStart(3, '0')} ${m.name.padEnd(24)} ${st}`);
    }
    return 0;
  }

  let count = 0;
  for (const m of migrations) {
    if (applied.has(m.version)) {
      if (applied.get(m.version) !== m.checksum) {
        console.warn(`[CH-MIGRATE] WARNING ${m.file} changed after it was applied; not re-running. Write a new migration instead.`);
      }
      continue;
    }
    console.log(`[CH-MIGRATE] Applying ${m.file} ...`);
    for (const s of splitStatements(m.content, database)) {
      await ch.command(s, {}, { timeoutMs: 60000 });
    }
    await ch.command(
      'INSERT INTO schema_migrations (version, name, checksum) SELECT {version:UInt32}, {name:String}, {checksum:String}',
      { version: m.version, name: m.name, checksum: m.checksum });
    count++;
  }
  console.log(count === 0 ? '[CH-MIGRATE] Schema is up to date.' : `[CH-MIGRATE] Applied ${count} migration(s).`);
  return 0;
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(err => {
    console.error(`[CH-MIGRATE] FAILED: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, listMigrations, splitStatements };
