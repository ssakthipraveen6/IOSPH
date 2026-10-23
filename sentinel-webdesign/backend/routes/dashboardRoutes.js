'use strict';

/**
 * backend/routes/dashboardRoutes.js
 *
 * M7 Task 7.2: Dashboard Builder REST API
 * Audited CRUD operations, schema validation, and JSON export/import.
 */

const express = require('express');
const path = require('path');
const router = express.Router();
const dashboardService = require('../services/dashboardService');
const { auditLog } = require('../audit_logger');
const { requireRole, hasRole, SRE_LEAD_PLUS } = require('../auth/require_role');

// [Phase S4] Create/import: SRE Lead+. Update/delete: SRE Lead+ or the dashboard's owner.
// Every read and write is limited to the request's environment.
function canModify(user, dash) {
  return hasRole(user, SRE_LEAD_PLUS) || (!!user && !!dash && dash.created_by === user.username);
}

// List dashboards
router.get('/', async (req, res) => {
  const env = req.sentinelEnv || 'staging';
  try {
    const list = await dashboardService.listDashboards(env);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get dashboard by id or slug
router.get('/:id', async (req, res) => {
  try {
    const dash = await dashboardService.getDashboard(req.params.id, req.sentinelEnv || 'staging');
    if (!dash) {
      return res.status(404).json({ error: `Dashboard '${req.params.id}' not found` });
    }
    res.json(dash);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new dashboard
router.post('/', requireRole(SRE_LEAD_PLUS), async (req, res) => {
  const user = req.user.username;
  const env = req.sentinelEnv || 'staging';

  try {
    const data = { ...req.body, environment: env };
    delete data.id;
    delete data.created_by;
    delete data.created_at;
    const saved = await dashboardService.saveDashboard(data, user);

    auditLog(req, 'DASHBOARD_CREATED', {
      user,
      dashboardId: saved.id,
      slug: saved.slug,
      title: saved.title,
      panelsCount: saved.panels?.length || 0,
      environment: env
    });

    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update dashboard
router.put('/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
  const user = req.user.username;
  const env = req.sentinelEnv || 'staging';

  try {
    const existing = await dashboardService.getDashboard(req.params.id, env);
    if (!existing) {
      return res.status(404).json({ error: `Dashboard '${req.params.id}' not found` });
    }
    if (!canModify(req.user, existing)) {
      return res.status(403).json({ error: 'Only the owner or an SRE Lead can change this dashboard.' });
    }

    const data = { ...req.body, id: existing.id, slug: existing.slug, environment: env, created_by: existing.created_by, created_at: existing.created_at };
    const saved = await dashboardService.saveDashboard(data, user);

    auditLog(req, 'DASHBOARD_UPDATED', {
      user,
      dashboardId: saved.id,
      slug: saved.slug,
      title: saved.title,
      panelsCount: saved.panels?.length || 0,
      environment: env
    });

    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete dashboard
router.delete('/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
  const user = req.user.username;
  const env = req.sentinelEnv || 'staging';

  try {
    const existing = await dashboardService.getDashboard(req.params.id, env);
    if (!existing) {
      return res.status(404).json({ error: `Dashboard '${req.params.id}' not found` });
    }
    if (!canModify(req.user, existing)) {
      return res.status(403).json({ error: 'Only the owner or an SRE Lead can delete this dashboard.' });
    }
    await dashboardService.deleteDashboard(existing.id, env);

    auditLog(req, 'DASHBOARD_DELETED', {
      user,
      dashboardId: existing.id,
      environment: env
    });

    res.json({ ok: true, message: `Dashboard '${req.params.id}' deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export dashboard definition
router.get('/:id/export', async (req, res) => {
  try {
    const dash = await dashboardService.getDashboard(req.params.id, req.sentinelEnv || 'staging');
    if (!dash) {
      return res.status(404).json({ error: `Dashboard '${req.params.id}' not found` });
    }

    const jsonStr = dashboardService.exportDashboard(dash);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${dash.slug || 'dashboard'}.json"`);
    res.send(jsonStr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save the definition to config/dashboards/<slug>.json (U6; SRE Lead+, audited).
// Note: the file is written on the node that serves the request.
router.post('/:id/export', requireRole(SRE_LEAD_PLUS), async (req, res) => {
  const env = req.sentinelEnv || 'staging';
  try {
    const dash = await dashboardService.getDashboard(req.params.id, env);
    if (!dash) {
      return res.status(404).json({ error: `Dashboard '${req.params.id}' not found` });
    }
    const file = dashboardService.writeDashboardFile(dash);
    auditLog(req, 'DASHBOARD_EXPORTED_TO_FILE', { dashboardId: dash.id, slug: dash.slug, environment: env });
    res.json({ ok: true, file: `config/dashboards/${path.basename(file)}` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Import dashboard definition
router.post('/import', requireRole(SRE_LEAD_PLUS), async (req, res) => {
  const user = req.user.username;
  const env = req.sentinelEnv || 'staging';

  try {
    const definition = req.body;
    const imported = await dashboardService.importDashboard(definition, user, env);

    auditLog(req, 'DASHBOARD_IMPORTED', {
      user,
      dashboardId: imported.id,
      slug: imported.slug,
      title: imported.title,
      panelsCount: imported.panels?.length || 0,
      environment: env
    });

    res.status(201).json(imported);
  } catch (err) {
    res.status(400).json({ error: `Dashboard import failed: ${err.message}` });
  }
});

module.exports = router;
