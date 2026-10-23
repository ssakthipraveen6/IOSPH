/**
 * backend/routes/healthCheckRoutes.js
 *
 * Phase O6 / O6.1: Health Checks API
 * Restores Enterprise Health Matrix [R1] using the synthetics runner.
 *
 * Routes:
 *   GET  /api/v2/health-checks/overview   Grid of checks x status, latency, last failure, 24h strip
 *   GET  /api/v2/health-checks/:id/history Run history for a specific check
 *   POST /api/v2/health-checks/:id/run     Run a check on-demand
 *   POST /api/v2/health-checks/run-all     Trigger all checks (leader)
 */
'use strict';

const express = require('express');
const { getGlobalRunner } = require('../../synthetics/runner');
const accessPolicy = require('../auth/access_policy');

// Router for health checks (synthetic journeys).
function createHealthCheckRouter({ runner = null } = {}) {
  const router = express.Router();
  // The synthetic runner in use.
  const getRunner = () => runner || getGlobalRunner();

  // Summary of all checks.
  router.get(['/overview', '/summary'], async (req, res) => {
    try {
      const env = req.sentinelEnv || 'staging';
      if (accessPolicy && !accessPolicy.isEntitled(req.sentinelUser, env)) {
        return res.status(403).json({ error: `Forbidden: not entitled to environment ${env}`, status: 'FORBIDDEN' });
      }

      const r = getRunner();
      const checks = r.getHealthCheckSummary(env);
      const defs = r.loadAllHealthCheckDefinitions ? r.loadAllHealthCheckDefinitions() : [];
      res.json({
        environment: env,
        count: checks.length,
        checks,
        summary: checks,
        definitions: defs
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to get health checks overview: ${err.message}` });
    }
  });

  // History of one check.
  router.get('/:id/history', async (req, res) => {
    try {
      const env = req.sentinelEnv || 'staging';
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      const r = getRunner();
      const runs = r.getHealthCheckRuns(req.params.id, { env, limit });
      res.json({
        checkId: req.params.id,
        environment: env,
        runs
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to get health check history: ${err.message}` });
    }
  });

  // Runs one check now.
  router.post('/:id/run', async (req, res) => {
    try {
      const env = req.sentinelEnv || 'staging';
      const r = getRunner();
      const allDefs = r.loadAllHealthCheckDefinitions();
      const def = allDefs.find(c => c.id === req.params.id);
      if (!def) {
        return res.status(404).json({ error: `Health check '${req.params.id}' not found` });
      }

      const result = await r.runHealthCheck(def, env);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: `Health check execution failed: ${err.message}` });
    }
  });

  // Runs every check now.
  router.post('/run-all', async (req, res) => {
    try {
      const env = req.sentinelEnv || 'staging';
      const r = getRunner();
      const results = await r.runAllHealthChecks(env);
      res.json({
        environment: env,
        executed: results.length,
        results
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to run all health checks: ${err.message}` });
    }
  });

  return router;
}

const defaultRouter = createHealthCheckRouter();
module.exports = defaultRouter;
module.exports.createHealthCheckRouter = createHealthCheckRouter;
