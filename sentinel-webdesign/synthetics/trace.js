/**
 * synthetics/trace.js
 *
 * Distributed W3C Trace and Metrics integration for Sentinel Golden Journeys.
 * Emits spans into ClickHouse (`spans` table) and step metrics into Timescale/ClickHouse.
 */

const crypto = require('crypto');

// New trace id.
function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

// New span id.
function generateSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Creates W3C span representation suitable for ClickHouse spans table.
 */
function createSpan({
  traceId,
  spanId,
  parentSpanId = '',
  name,
  service,
  env,
  startTs,
  durationMs,
  status = 'OK',
  attributes = {}
}) {
  return {
    trace_id: traceId,
    span_id: spanId || generateSpanId(),
    parent_span_id: parentSpanId || '',
    name: String(name),
    service: String(service),
    env: String(env || 'staging'),
    start_ts: typeof startTs === 'string' ? startTs : new Date(startTs || Date.now()).toISOString(),
    duration_ms: Math.max(0, Number(durationMs || 0)),
    status: String(status),
    attributes: {
      ...attributes
    }
  };
}

module.exports = {
  generateTraceId,
  generateSpanId,
  createSpan
};
