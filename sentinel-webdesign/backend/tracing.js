const crypto = require('crypto');

/**
 * OpenTelemetry compatible W3C distributed tracing context helper.
 * Generates and propagates 16-byte traceId and 8-byte spanId.
 */

function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

function parseTraceparent(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.trim().split('-');
  if (parts.length >= 4 && parts[0] === '00' && parts[1].length === 32) {
    return {
      version: parts[0],
      traceId: parts[1],
      parentSpanId: parts[2],
      traceFlags: parts[3]
    };
  }
  return null;
}

function tracingMiddleware(req, res, next) {
  const incoming = parseTraceparent(req.headers['traceparent']);
  const traceId = incoming ? incoming.traceId : (req.headers['x-trace-id'] || generateTraceId());
  const spanId = generateSpanId();

  req.traceId = traceId;
  req.spanId = spanId;

  const traceparent = `00-${traceId}-${spanId}-01`;
  res.setHeader('X-Trace-Id', traceId);
  res.setHeader('traceparent', traceparent);

  next();
}

module.exports = {
  generateTraceId,
  generateSpanId,
  parseTraceparent,
  tracingMiddleware
};
