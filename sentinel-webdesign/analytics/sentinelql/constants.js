'use strict';

/**
 * analytics/sentinelql/constants.js
 *
 * Allow-lists and constraints for SentinelQL lexer, parser, and ClickHouse compiler.
 */

const ALLOWED_DATASETS = new Set(['metrics', 'logs', 'spans']);

const DATASET_TABLE_MAP = {
  metrics: 'metrics',
  logs: 'logs',
  spans: 'spans'
};

const ALLOWED_COLUMNS = {
  metrics: {
    ts: 'ts',
    env: 'env',
    product: 'component',
    component: 'component',
    metric: 'metric_name',
    metric_name: 'metric_name',
    entity_id: 'entity_id',
    value: 'value',
    source: 'source',
    step: "attributes['step']"
  },
  logs: {
    ts: 'ts',
    env: 'env',
    product: 'app_id',
    app_id: 'app_id',
    service: 'app_id',
    entity_id: 'entity_id',
    level: 'level',
    message: 'message',
    trace_id: 'trace_id'
  },
  spans: {
    ts: 'start_ts',
    start_ts: 'start_ts',
    env: 'env',
    product: 'service',
    service: 'service',
    step: 'name',
    name: 'name',
    duration_ms: 'duration_ms',
    status: 'status',
    trace_id: 'trace_id',
    span_id: 'span_id',
    parent_span_id: 'parent_span_id'
  }
};

const ALLOWED_OPERATORS = new Set(['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'ILIKE', 'IN']);

const ALLOWED_AGG_FUNCTIONS = new Set([
  'count',
  'avg',
  'sum',
  'min',
  'max',
  'percentile',
  'p50',
  'p90',
  'p95',
  'p99'
]);

const MAX_ROW_LIMIT = 10000;
const DEFAULT_ROW_LIMIT = 1000;
const MAX_TIME_RANGE_SECONDS = 400 * 24 * 3600; // 400 days in seconds
const MAX_EXECUTION_TIME_SECONDS = 30;

module.exports = {
  ALLOWED_DATASETS,
  DATASET_TABLE_MAP,
  ALLOWED_COLUMNS,
  ALLOWED_OPERATORS,
  ALLOWED_AGG_FUNCTIONS,
  MAX_ROW_LIMIT,
  DEFAULT_ROW_LIMIT,
  MAX_TIME_RANGE_SECONDS,
  MAX_EXECUTION_TIME_SECONDS
};
