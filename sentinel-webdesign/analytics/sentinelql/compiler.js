'use strict';

/**
 * analytics/sentinelql/compiler.js
 *
 * Compiles a SentinelQL AST into a secure, parameterised ClickHouse SQL query.
 * Injects environment and role/entitlement filters server-side.
 */

const { DATASET_TABLE_MAP, MAX_ROW_LIMIT, DEFAULT_ROW_LIMIT, MAX_EXECUTION_TIME_SECONDS } = require('./constants');

// ClickHouse interval keyword for a time unit.
function unitToClickHouseInterval(unit) {
  const u = (unit || '').toLowerCase();
  switch (u) {
    case 's': return 'SECOND';
    case 'm': return 'MINUTE';
    case 'h': return 'HOUR';
    case 'd': return 'DAY';
    default: return 'MINUTE';
  }
}

// Compiles a parsed SentinelQL query into ClickHouse SQL.
function compile(ast, options = {}) {
  if (!ast || typeof ast !== 'object') {
    throw new Error('SentinelQL: invalid AST provided for compilation');
  }

  const environment = options.environment || 'staging';
  const allowedProducts = Array.isArray(options.allowedProducts) ? options.allowedProducts : null;
  const database = options.database || 'sentinel';

  const tableName = DATASET_TABLE_MAP[ast.dataset];
  if (!tableName) {
    throw new Error(`SentinelQL: no ClickHouse table mapped for dataset '${ast.dataset}'`);
  }

  const timeCol = ast.dataset === 'spans' ? 'start_ts' : 'ts';
  const productCol = ast.dataset === 'metrics' ? 'component' : (ast.dataset === 'logs' ? 'app_id' : 'service');

  const params = {};
  let paramIdx = 0;

  function addParam(val, type = 'String') {
    const key = `p_${paramIdx++}`;
    params[key] = val;
    return `{${key}: ${type}}`;
  }

  // 1. WHERE clauses
  const whereClauses = [];

  // (a) Server-side injected environment constraint
  const envPlaceholder = addParam(environment, 'String');
  whereClauses.push(`env = ${envPlaceholder}`);

  // (b) Server-side injected allowed products constraint (if applicable)
  if (allowedProducts && allowedProducts.length > 0) {
    const allowedParam = addParam(allowedProducts, 'Array(String)');
    whereClauses.push(`has(${allowedParam}, ${productCol})`);
  }

  // (c) User filters from AST
  if (Array.isArray(ast.filters) && ast.filters.length > 0) {
    for (const filter of ast.filters) {
      const col = filter.field;
      const op = filter.op;
      const val = filter.value;

      if (op === 'IN') {
        const inVals = Array.isArray(val) ? val : [val];
        const inParam = addParam(inVals, 'Array(String)');
        whereClauses.push(`has(${inParam}, toString(${col}))`);
      } else if (op === 'LIKE' || op === 'ILIKE') {
        const likeParam = addParam(String(val), 'String');
        const matchFn = op === 'ILIKE' ? 'ilike' : 'like';
        whereClauses.push(`${matchFn}(${col}, ${likeParam})`);
      } else {
        const paramType = typeof val === 'number' ? (Number.isInteger(val) ? 'Int64' : 'Float64') : 'String';
        const valPlaceholder = addParam(val, paramType);
        whereClauses.push(`${col} ${op} ${valPlaceholder}`);
      }
    }
  }

  // (d) Time window constraint
  if (ast.since) {
    const intervalUnit = unitToClickHouseInterval(ast.since.unit);
    whereClauses.push(`${timeCol} >= now() - INTERVAL ${parseInt(ast.since.amount, 10)} ${intervalUnit}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // 2. Aggregations vs Raw Select
  let selectSql = '';
  let groupBySql = '';
  let orderBySql = '';

  if (ast.aggregation) {
    const agg = ast.aggregation;
    let aggExpr = '';

    switch (agg.fn) {
      case 'count':
        aggExpr = 'count() AS count';
        break;
      case 'avg':
        aggExpr = `avg(${agg.field}) AS avg_${agg.field}`;
        break;
      case 'sum':
        aggExpr = `sum(${agg.field}) AS sum_${agg.field}`;
        break;
      case 'min':
        aggExpr = `min(${agg.field}) AS min_${agg.field}`;
        break;
      case 'max':
        aggExpr = `max(${agg.field}) AS max_${agg.field}`;
        break;
      case 'percentile': {
        const p = (agg.arg !== null && agg.arg !== undefined) ? agg.arg / 100.0 : 0.95;
        const pNorm = Math.min(Math.max(p, 0.01), 0.99);
        aggExpr = `quantile(${pNorm})(${agg.field}) AS p${Math.round(pNorm * 100)}_${agg.field}`;
        break;
      }
      case 'p50':
        aggExpr = `quantile(0.50)(${agg.field}) AS p50_${agg.field}`;
        break;
      case 'p90':
        aggExpr = `quantile(0.90)(${agg.field}) AS p90_${agg.field}`;
        break;
      case 'p95':
        aggExpr = `quantile(0.95)(${agg.field}) AS p95_${agg.field}`;
        break;
      case 'p99':
        aggExpr = `quantile(0.99)(${agg.field}) AS p99_${agg.field}`;
        break;
      default:
        aggExpr = 'count() AS count';
    }

    const selectParts = [];
    const groupByParts = [];

    // Time bucketing if 'every' is specified
    if (ast.every) {
      const bucketIntervalUnit = unitToClickHouseInterval(ast.every.unit);
      const bucketExpr = `toStartOfInterval(${timeCol}, INTERVAL ${parseInt(ast.every.amount, 10)} ${bucketIntervalUnit}) AS bucket_ts`;
      selectParts.push(bucketExpr);
      groupByParts.push('bucket_ts');
    }

    // Group by fields (e.g. by step, metric)
    if (Array.isArray(ast.by) && ast.by.length > 0) {
      for (const byItem of ast.by) {
        const col = typeof byItem === 'object' ? byItem.col : byItem;
        const alias = typeof byItem === 'object' ? byItem.alias : byItem;
        if (col !== alias) {
          selectParts.push(`${col} AS ${alias}`);
          groupByParts.push(alias);
        } else {
          selectParts.push(col);
          groupByParts.push(col);
        }
      }
    }

    selectParts.push(aggExpr);
    selectSql = selectParts.join(', ');

    if (groupByParts.length > 0) {
      groupBySql = `GROUP BY ${groupByParts.join(', ')}`;
      orderBySql = ast.every ? 'ORDER BY bucket_ts ASC' : `ORDER BY ${groupByParts[0]} ASC`;
    }
  } else {
    // Raw select
    selectSql = '*';
    orderBySql = `ORDER BY ${timeCol} DESC`;
  }

  // Row limit (capped at MAX_ROW_LIMIT)
  const limitVal = Math.min(parseInt(ast.limit, 10) || DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT);
  const limitPlaceholder = addParam(limitVal, 'UInt32');
  const limitSql = `LIMIT ${limitPlaceholder}`;

  const queryParts = [
    `SELECT ${selectSql}`,
    `FROM ${database}.${tableName}`,
    whereSql,
    groupBySql,
    orderBySql,
    limitSql
  ].filter(p => p && p.trim().length > 0);

  const compiledSql = queryParts.join(' ');

  return {
    sql: compiledSql,
    params,
    settings: {
      max_execution_time: MAX_EXECUTION_TIME_SECONDS
    },
    meta: {
      dataset: ast.dataset,
      targetTable: `${database}.${tableName}`,
      environment,
      limit: limitVal,
      timeCol
    }
  };
}

module.exports = {
  compile
};
