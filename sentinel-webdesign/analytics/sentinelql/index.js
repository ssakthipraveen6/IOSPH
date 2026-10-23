'use strict';

/**
 * analytics/sentinelql/index.js
 *
 * SentinelQL Public API: Lexer, Parser, Parameterised ClickHouse Compiler & Executor.
 */

const { tokenize } = require('./lexer');
const { parse } = require('./parser');
const { compile } = require('./compiler');
const constants = require('./constants');

let clickhouse = null;
try {
  clickhouse = require('@sentinel/database/clickhouse');
} catch (_) {
  try {
    clickhouse = require('../../database/clickhouse');
  } catch (e) {
    clickhouse = null;
  }
}

/**
 * Compiles a SentinelQL query string into parameterized ClickHouse SQL and params.
 *
 * @param {string} queryStr - The SentinelQL query string.
 * @param {object} options - Compilation options { environment, allowedProducts, database }.
 * @returns {{ sql: string, params: object, settings: object, meta: object, ast: object }}
 */
function compileQuery(queryStr, options = {}) {
  const tokens = tokenize(queryStr);
  const ast = parse(tokens);
  // [Phase S7] Compile against the configured ClickHouse database, not a fixed name.
  let database = options.database;
  if (!database && clickhouse && typeof clickhouse.getDatabase === 'function') {
    try { database = clickhouse.getDatabase(); } catch (_) { database = undefined; }
  }
  const compiled = compile(ast, { ...options, database });
  return {
    ...compiled,
    ast
  };
}

/**
 * Parses and executes a SentinelQL query against ClickHouse.
 *
 * @param {string} queryStr
 * @param {object} options { environment, allowedProducts, limit, client }
 * @returns {Promise<{ ok: boolean, data: Array, meta: object }>}
 */
async function executeQuery(queryStr, options = {}) {
  const start = Date.now();
  const compiled = compileQuery(queryStr, options);
  const ch = options.client || clickhouse;

  if (!ch || !ch.isConfigured || !ch.isConfigured()) {
    return {
      ok: true,
      data: [],
      meta: {
        query: queryStr,
        compiledSql: compiled.sql,
        rowCount: 0,
        executionTimeMs: Date.now() - start,
        status: 'DATA_UNAVAILABLE',
        reason: 'ClickHouse is not configured (CLICKHOUSE_URL is blank)'
      }
    };
  }

  try {
    const rows = await ch.query(compiled.sql, compiled.params, {
      settings: compiled.settings
    });
    return {
      ok: true,
      data: rows,
      meta: {
        query: queryStr,
        compiledSql: compiled.sql,
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
        environment: options.environment || 'staging'
      }
    };
  } catch (err) {
    return {
      ok: false,
      data: [],
      error: err.message,
      meta: {
        query: queryStr,
        compiledSql: compiled.sql,
        rowCount: 0,
        executionTimeMs: Date.now() - start
      }
    };
  }
}

module.exports = {
  tokenize,
  parse,
  compile: compileQuery,
  compileQuery,
  execute: executeQuery,
  executeQuery,
  constants
};
