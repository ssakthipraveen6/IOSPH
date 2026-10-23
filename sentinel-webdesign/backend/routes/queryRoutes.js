'use strict';

/**
 * backend/routes/queryRoutes.js
 *
 * M7 Task 7.1: SentinelQL Query API
 * Audited, read-only analytics endpoint compiling SentinelQL to parameterised ClickHouse SQL.
 */

const express = require('express');
const router = express.Router();
const sentinelql = require('@sentinel/sentinelql');
const { auditLog } = require('../audit_logger');

// Runs a SentinelQL query (audited).
router.post('/query', async (req, res) => {
  const { query, limit } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Query parameter is required and must be a non-empty string' });
  }

  const environment = req.sentinelEnv || 'staging';
  const allowedProducts = req.user && req.user.allowedProducts ? req.user.allowedProducts : null;

  try {
    const result = await sentinelql.execute(query, {
      environment,
      allowedProducts,
      limit: limit ? parseInt(limit, 10) : undefined
    });

    // Audit every analytical query execution
    auditLog(req, 'SENTINELQL_QUERY', {
      user: req.user?.username || 'anonymous',
      environment,
      query: query.slice(0, 500),
      rowCount: result.meta?.rowCount || 0,
      executionTimeMs: result.meta?.executionTimeMs || 0,
      status: result.ok ? 'SUCCESS' : 'ERROR'
    });

    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error,
        meta: result.meta
      });
    }

    return res.json(result);
  } catch (err) {
    auditLog(req, 'SENTINELQL_QUERY_FAILED', {
      user: req.user?.username || 'anonymous',
      environment,
      query: query.slice(0, 500),
      error: err.message
    });

    return res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

module.exports = router;
