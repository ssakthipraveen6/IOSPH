/**
 * backend/routes/expiryRoutes.js
 *
 * Phase O7: Certificates, Licences & URL Validity Routes.
 * Mounted at:
 *   - /api/v2/expiry
 *   - /api/v2/urls
 */

'use strict';

const express = require('express');
const router = express.Router();
const expiryStore = require('../../database/expiry_store');
const { runUrlChecks } = require('../jobs/url_checks');

/**
 * GET /api/v2/expiry
 * Returns all certificate and licence items with calculated days left,
 * location mapping, status, and seat/quota meters.
 */
router.get('/', async (req, res) => {
  try {
    const env = req.sentinelEnv || 'staging';
    const items = await expiryStore.getExpiryItems();
    const { kind, product, status } = req.query;

    let filtered = items;
    if (kind) {
      filtered = filtered.filter(i => String(i.kind).toLowerCase() === String(kind).toLowerCase());
    }
    if (product) {
      filtered = filtered.filter(i => String(i.product).toLowerCase() === String(product).toLowerCase());
    }
    if (status) {
      filtered = filtered.filter(i => String(i.status).toLowerCase() === String(status).toLowerCase());
    }

    const summary = {
      total: items.length,
      certificates: items.filter(i => i.kind === 'tls_cert' || i.kind === 'saml_cert').length,
      licenses: items.filter(i => i.kind === 'license').length,
      critical: items.filter(i => i.status === 'critical').length,
      warning: items.filter(i => i.status === 'warning').length,
      info: items.filter(i => i.status === 'info').length,
      healthy: items.filter(i => i.status === 'healthy').length
    };

    res.json({
      environment: env,
      summary,
      items: filtered,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve expiry items', message: err.message });
  }
});

/**
 * GET /api/v2/urls
 * Returns URL validity probe results, status, redirect chain, and alert flags.
 */
router.get('/checks', async (req, res) => {
  try {
    const env = req.sentinelEnv || 'staging';
    const report = await runUrlChecks();
    res.json({
      environment: env,
      ...report
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to perform URL validity checks', message: err.message });
  }
});

module.exports = router;
