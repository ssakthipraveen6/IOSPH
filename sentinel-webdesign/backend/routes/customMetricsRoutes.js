/**
 * POST /api/v1/metrics/ingest — custom metrics (M1.11).
 *
 * For Jenkins / GitHub scheduled jobs and scripts that measure what agents
 * cannot (e.g. NAS share latency from a build node). Body is text/plain in the
 * line protocol described in backend/services/ingest/line_protocol.js.
 * Authenticated with an ingest API key; the key decides the environment.
 */
const express = require('express');
const db = require('../../database/db');
const { requireIngestKey } = require('../auth/ingest_keys');
const { parseBody } = require('../services/ingest/line_protocol');

const router = express.Router();

// Ingests Dynatrace line-protocol metrics (needs an ingest key with scope metrics).
router.post(
  '/ingest',
  requireIngestKey('metrics'),
  express.text({ type: ['text/plain', 'text/*'], limit: '1mb' }),
  (req, res) => {
    if (typeof req.body !== 'string') {
      return res.status(415).json({ error: 'Send the metrics as text/plain line protocol.' });
    }
    // [Phase S2] Environment only from the ingest key.
    const env = req.ingestEnv || 'staging';
    if (!['prod', 'staging'].includes(env)) {
      return res.status(400).json({ error: `Unknown environment "${env}".` });
    }

    const { points, invalidLines } = parseBody(req.body);
    points.forEach(p => { p.env = env; });
    if (points.length > 0) db.addMetricBatch(points, env);

    const status = points.length === 0 && invalidLines.length > 0 ? 400 : 202;
    return res.status(status).json({
      linesOk: points.length,
      linesInvalid: invalidLines.length,
      environment: env,
      error: invalidLines.length > 0 ? { code: 400, message: 'Some lines were rejected', invalidLines: invalidLines.slice(0, 100) } : null
    });
  }
);

module.exports = router;
