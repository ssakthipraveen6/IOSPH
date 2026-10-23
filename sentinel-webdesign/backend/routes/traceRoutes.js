/**
 * backend/routes/traceRoutes.js
 *
 * Phase O6 / O6.4: Trace Explorer API [R4]
 * Queries distributed spans from ClickHouse (or memory store) and serves
 * trace listings and trace waterfall details.
 */
'use strict';

const express = require('express');
const clickhouse = require('../../database/clickhouse');
const accessPolicy = require('../auth/access_policy');

// Router for traces.
function createTraceRouter({ ch = clickhouse, inMemorySpans = [] } = {}) {
  const router = express.Router();

  // Recent traces.
  router.get('/', async (req, res) => {
    try {
      const env = req.sentinelEnv || 'staging';
      if (accessPolicy && !accessPolicy.isEntitled(req.sentinelUser, env)) {
        return res.status(403).json({ error: `Forbidden: not entitled to environment ${env}`, status: 'FORBIDDEN' });
      }

      const { product, status, limit = 50 } = req.query;
      const from = req.query.from ? Number(req.query.from) : (Date.now() - 3600 * 1000 * 24);
      const to = req.query.to ? Number(req.query.to) : Date.now();

      // If ClickHouse is configured, query spans table
      if (ch && typeof ch.isConfigured === 'function' && ch.isConfigured()) {
        const sql = `SELECT trace_id,
                            service,
                            name,
                            min(start_ts) AS start_ts,
                            max(duration_ms) AS duration_ms,
                            any(status) AS status,
                            count() AS span_count
                     FROM spans
                     WHERE env = {env:String}
                       AND start_ts >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')
                       AND start_ts <= fromUnixTimestamp64Milli({to:Int64}, 'UTC')
                     GROUP BY trace_id, service, name
                     ORDER BY start_ts DESC
                     LIMIT {limit:UInt32}`;
        const rows = await ch.query(sql, { env, from, to, limit: Number(limit) });
        return res.json({
          environment: env,
          count: rows.length,
          traces: rows.map(r => ({
            trace_id: r.trace_id,
            service: r.service,
            name: r.name,
            start_ts: r.start_ts,
            duration_ms: Number(r.duration_ms),
            status: r.status,
            span_count: Number(r.span_count)
          }))
        });
      }

      // Memory fallback for development / test
      let list = inMemorySpans.filter(s => !s.env || s.env === env);
      if (product) list = list.filter(s => s.service === product);
      if (status) list = list.filter(s => s.status === status);

      // Group by trace_id
      const byTrace = new Map();
      for (const s of list) {
        if (!byTrace.has(s.trace_id)) {
          byTrace.set(s.trace_id, {
            trace_id: s.trace_id,
            service: s.service || 'unknown',
            name: s.name || 'root',
            start_ts: s.start_ts || new Date().toISOString(),
            duration_ms: s.duration_ms || 0,
            status: s.status || 'OK',
            span_count: 0
          });
        }
        const t = byTrace.get(s.trace_id);
        t.span_count++;
        if (s.duration_ms > t.duration_ms) t.duration_ms = s.duration_ms;
        if (s.status === 'ERROR') t.status = 'ERROR';
      }

      const traces = Array.from(byTrace.values()).slice(0, Number(limit));
      res.json({ environment: env, count: traces.length, traces });
    } catch (err) {
      res.status(500).json({ error: `Trace search error: ${err.message}` });
    }
  });

  // One trace with its spans.
  router.get('/:id', async (req, res) => {
    try {
      const env = req.sentinelEnv || 'staging';
      const traceId = req.params.id;

      if (ch && typeof ch.isConfigured === 'function' && ch.isConfigured()) {
        const sql = `SELECT trace_id, span_id, parent_span_id, name, service, env,
                            start_ts, duration_ms, status, attributes
                     FROM spans
                     WHERE trace_id = {traceId:String}
                     ORDER BY start_ts ASC`;
        const rows = await ch.query(sql, { traceId });
        if (rows.length === 0) {
          return res.status(404).json({ error: `Trace '${traceId}' not found` });
        }
        return res.json({
          trace_id: traceId,
          environment: env,
          span_count: rows.length,
          spans: rows
        });
      }

      const matching = inMemorySpans.filter(s => s.trace_id === traceId);
      if (matching.length === 0) {
        return res.status(404).json({ error: `Trace '${traceId}' not found` });
      }

      res.json({
        trace_id: traceId,
        environment: env,
        span_count: matching.length,
        spans: matching
      });
    } catch (err) {
      res.status(500).json({ error: `Trace detail error: ${err.message}` });
    }
  });

  return router;
}

const defaultRouter = createTraceRouter();
module.exports = defaultRouter;
module.exports.createTraceRouter = createTraceRouter;
