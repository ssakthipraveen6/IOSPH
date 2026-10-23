'use strict';

/**
 * backend/routes/demoRoutes.js
 *
 * Router for the isolated Demo view (/api/demo).
 * Serves fixed sample fixtures exclusively. Never queries live data platforms or stores.
 * Strictly GET-only (other HTTP methods return 405).
 */

const express = require('express');
const router = express.Router();

// Import all isolated demo fixtures
const homeFixture = require('../demo/fixtures/home');
const problemsFixture = require('../demo/fixtures/problems');
const alertsFixture = require('../demo/fixtures/alerts');
const productsFixture = require('../demo/fixtures/products');
const aviFixture = require('../demo/fixtures/avi');
const databasesFixture = require('../demo/fixtures/databases');
const kubernetesFixture = require('../demo/fixtures/kubernetes');
const hostsFixture = require('../demo/fixtures/hosts');
const topologyFixture = require('../demo/fixtures/topology');
const evidenceFixture = require('../demo/fixtures/evidence');
const dashboardsFixture = require('../demo/fixtures/dashboards');
const correlationFixture = require('../demo/fixtures/correlation');
const apmFixture = require('../demo/fixtures/apm');
const governanceFixture = require('../demo/fixtures/governance');
const consoleFixtures = {
  overview: require('../demo/fixtures/console_overview'),
  jenkins: require('../demo/fixtures/console_jenkins'),
  geo: require('../demo/fixtures/console_geo'),
  compliance: require('../demo/fixtures/console_compliance'),
  dependencies: require('../demo/fixtures/console_dependencies'),
  reports: require('../demo/fixtures/console_reports')
};

// Check if demo is enabled in global configuration
function isDemoEnabled() {
  try {
    const { loadGlobalConfig } = require('../config/yaml_config');
    const cfg = loadGlobalConfig() || {};
    if (cfg.demo && cfg.demo.enabled === false) return false;
    if (cfg.views_enabled && cfg.views_enabled.demo === false) return false;
    return true;
  } catch (_) {
    return true;
  }
}

// Middleware: Enforce GET-only and check demo enabled
router.use((req, res, next) => {
  if (!isDemoEnabled()) {
    return res.status(404).json({
      error: 'Demo view is disabled in configuration',
      status: 404
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({
      error: 'Method Not Allowed. Demo API is strictly read-only.',
      status: 405
    });
  }

  next();
});

// Wraps fixture data with the demo flag.
function wrap(data) {
  return {
    demo: true,
    generated_at: new Date().toISOString(),
    data
  };
}

// 1. Home
router.get('/home', (req, res) => {
  res.json(wrap(homeFixture));
});

// 2. Problems
router.get('/problems', (req, res) => {
  res.json(wrap(problemsFixture));
});

// One sample problem.
router.get('/problems/:id', (req, res) => {
  const prob = problemsFixture.find(p => p.id === req.params.id) || problemsFixture[0];
  res.json(wrap(prob));
});

// 3. Alerts
router.get('/alerts', (req, res) => {
  res.json(wrap(alertsFixture));
});

// 4. Products
router.get('/products', (req, res) => {
  res.json(wrap(productsFixture.products));
});

// One sample product.
router.get('/products/:id', (req, res) => {
  const prod = productsFixture.products.find(p => p.id === req.params.id) || productsFixture.products[0];
  res.json(wrap(prod));
});

// 5. AVI Load Balancers
router.get('/avi', (req, res) => {
  res.json(wrap(aviFixture));
});

// 6. Databases
router.get('/databases', (req, res) => {
  res.json(wrap(databasesFixture));
});

// 7. Kubernetes
router.get('/kubernetes', (req, res) => {
  res.json(wrap(kubernetesFixture));
});

// 8. Hosts
router.get('/hosts', (req, res) => {
  res.json(wrap(hostsFixture));
});

// 9. Topology
router.get('/topology', (req, res) => {
  res.json(wrap(topologyFixture));
});

// 10. Evidence Pack
router.get('/evidence/:id', (req, res) => {
  res.json(wrap(evidenceFixture));
});

// 11. Dashboards
router.get('/dashboards', (req, res) => {
  res.json(wrap(dashboardsFixture.dashboards));
});

// 12. Correlation
router.get('/correlation', (req, res) => {
  res.json(wrap(correlationFixture));
});

// 13. APM
router.get('/apm', (req, res) => {
  res.json(wrap(apmFixture));
});

// 14. Governance
router.get('/governance', (req, res) => {
  res.json(wrap(governanceFixture));
});

// 15. Observability console screens (overview, jenkins, geo, compliance, dependencies, reports)
router.get('/console/:screen', (req, res) => {
  const fixture = Object.prototype.hasOwnProperty.call(consoleFixtures, req.params.screen)
    ? consoleFixtures[req.params.screen]
    : null;
  if (!fixture) {
    return res.status(404).json({ error: `Unknown console demo screen '${req.params.screen}'`, status: 404 });
  }
  res.json(wrap(fixture));
});

module.exports = router;
