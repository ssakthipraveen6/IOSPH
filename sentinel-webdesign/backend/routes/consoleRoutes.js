/**
 * backend/routes/consoleRoutes.js
 *
 * Observability console (live). Same screen shapes as the demo fixtures
 * (backend/demo/fixtures/console_*.js), built only from what Sentinel has
 * actually received:
 *
 *   GET /api/v2/console/:screen?environment=   screen = overview | jenkins | compliance
 *                                                         | geo | dependencies | reports
 *
 * Rules: nothing is invented. A field with no source is null, a list with no
 * source is empty, and a screen with no source at all answers
 * { status: 'DATA_UNAVAILABLE', reason }. The UI shows those as
 * "Data not available".
 */
'use strict';

const express = require('express');
const { requestEnvironment } = require('./_prototype');

const CATEGORY_TITLES = {
  ci_cd: 'CI / CD orchestration',
  gitops: 'CI / CD orchestration',
  workflow_engine: 'CI / CD orchestration',
  source_control: 'Source and artifacts',
  artifact_repository: 'Source and artifacts',
  security_scanner: 'Code quality and security',
  code_quality: 'Code quality and security',
  key_management: 'Code quality and security',
  performance_testing: 'Quality engineering and platform tools',
  ai_tooling: 'AI helper services'
};

const UNAVAILABLE = {
  geo: 'Replication lag and mirror sync need per-region collectors (Artifactory, Bitbucket) that are not reporting yet.',
  dependencies: 'The probe-by-region matrix needs probes running in each region; none are reporting yet.',
  reports: 'DORA, the availability calendar and the capacity forecast need weeks of stored history; none is available yet.'
};

// crit for critical/high/error severities, otherwise warn.
const sevTone = (s) => (/crit|high|error/i.test(String(s)) ? 'crit' : 'warn');

// Age of a timestamp as short text.
function ageText(ts, nowMs) {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return null;
  const m = Math.max(0, Math.round((nowMs - t) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`;
}

/** probe(name) -> null (no numbers received) | 'up' | 'down' (latest successRate is 0). */
function buildOverview({ apps, alerts, probe, nowMs }) {
  const open = alerts.filter(a => !/resolved|closed/i.test(String(a.status)) && !a.resolvedAt);
  const byTitle = new Map();
  // The manifest map also holds alias keys (jenkins -> cloudbees_jenkins). One tile per id.
  const names = new Map();
  for (const [key, app] of Object.entries(apps)) {
    if (!app || !app.id) continue;
    if (!names.has(app.id)) names.set(app.id, new Set([app.id]));
    names.get(app.id).add(key);
  }
  const done = new Set();
  for (const app of Object.values(apps)) {
    if (!app || app.enabled === false || app.kind !== 'application' || done.has(app.id)) continue;
    done.add(app.id);
    const known = names.get(app.id);
    const mine = open.filter(a => known.has(a.component));
    const probes = [...known].map(n => probe(n)).filter(Boolean);
    const down = probes.includes('down');
    const seen = probes.length > 0;
    let state = null;
    if (down || mine.some(a => sevTone(a.severity) === 'crit')) state = 'crit';
    else if (mine.length) state = 'warn';
    else if (seen) state = 'ok';
    const hosts = (app.layers && Array.isArray(app.layers.hosts)) ? app.layers.hosts.length : null;
    const title = CATEGORY_TITLES[app.category] || 'Other applications';
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push({
      id: app.id,
      name: app.display_name || app.id,
      scope: app.tier || '',
      state,
      metric: { label: 'Open alerts', value: seen || mine.length ? String(mine.length) : '—' },
      k1: { label: 'Telemetry', value: down ? 'probe failing' : (seen ? 'receiving' : 'none received') },
      k2: { label: 'Hosts declared', value: hosts === null ? '—' : String(hosts) },
      trend: [],
      drill: app.id === 'cloudbees_jenkins' ? 'jenkins' : `app:${app.id}`
    });
  }
  const rank = { crit: 3, warn: 2, ok: 1 };
  const groups = [...byTitle.entries()].map(([title, list]) => ({
    title,
    apps: list,
    state: list.reduce((w, a) => ((rank[a.state] || 0) > (rank[w] || 0) ? a.state : w), null)
  }));
  const all = groups.flatMap(g => g.apps);
  return {
    app_count: all.length,
    regions: [],
    kpis: [
      { label: 'Applications reporting', value: `${all.filter(a => a.state).length} / ${all.length}`, note: 'Telemetry received for the application', state: null },
      { label: 'Open alerts', value: String(open.length), note: `${open.filter(a => sevTone(a.severity) === 'crit').length} critical`, state: open.some(a => sevTone(a.severity) === 'crit') ? 'crit' : (open.length ? 'warn' : null) }
    ],
    chain: [],
    groups,
    chart: null,
    region_health: [],
    alerts: open.slice(0, 50).map(a => ({
      sev: a.severity, state: sevTone(a.severity), service: a.component, signal: a.message,
      region: a.region || '—', age: ageText(a.timestamp, nowMs) || '—', owner: a.owner || '—', route: a.route || '—'
    }))
  };
}

// Builds the Jenkins screen from the last topology poll.
function buildJenkins(snap) {
  if (!snap || !snap.declared) return null;
  const ctrls = snap.controllers.map(c => {
    const ok = c.status === 'OK';
    const ex = c.executors;
    let state = null;
    if (ok) state = ex && ex.total > 0 && ex.busy >= ex.total ? 'crit' : (c.queue && c.queue.length > 20 ? 'warn' : 'ok');
    else if (c.status === 'AUTH_FAILED') state = 'crit';
    return {
      id: c.id, oc: c.oc, env: c.flavour || '—', state,
      executors: ex || { busy: 0, total: 0 }, queue: c.queue ? c.queue.length : null,
      heap_pct: null, success_pct: null, status: c.status, error: c.error
    };
  });
  const ocIds = [...new Set(ctrls.map(c => c.oc))];
  const agents = ocIds.map(oc => ({
    oc,
    cells: snap.controllers.filter(c => c.oc === oc).flatMap(c => c.computers.map(x => ({
      name: x.name, state: x.offline ? 'offline' : (x.temporarily_offline ? 'maintenance' : (x.idle ? 'idle' : 'busy'))
    })))
  }));
  const t = snap.totals;
  return {
    note: `Last polled ${snap.polled_at}. ${snap.answered} of ${snap.declared} controllers answered.`,
    kpis: [
      { label: 'Controllers answering', value: `${snap.answered} / ${snap.declared}`, note: snap.auth_failed ? `${snap.auth_failed} refused the token` : '', state: snap.answered === snap.declared ? 'ok' : 'warn' },
      { label: 'Build queue', value: t ? String(t.queue) : '—', note: '', state: null },
      { label: 'Executors busy', value: t ? `${t.executors_busy} / ${t.executors_total}` : '—', note: '', state: null },
      { label: 'Agents online', value: t ? `${t.agents_online} / ${t.agents_online + t.agents_offline}` : '—', note: '', state: null }
    ],
    operations_centers: ocIds.map(id => ({ id, controllers: ctrls.filter(c => c.oc === id) })),
    build_clusters: [],
    agents,
    ubuntu_agents: [],
    windows_pools: [],
    jump_servers: [],
    queue: snap.controllers.filter(c => c.queue && c.queue.length > 0).map(c => ({
      job: `${c.queue.length} waiting`, controller: c.id, wait_s: c.queue.oldest_wait_s || 0, hot: (c.queue.oldest_wait_s || 0) > 600, label: '—', reason: 'oldest item'
    })).sort((a, b) => b.wait_s - a.wait_s)
  };
}

const KIND_TYPE = { tls_cert: 'Certificate', saml_cert: 'Certificate', license: 'Licence' };

// Builds the compliance screen from the expiry store.
function buildCompliance(items) {
  if (!items.length) return null;
  const expiry = items.filter(i => i.daysLeft !== null && i.daysLeft !== undefined)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map(i => ({ item: i.name || i.subject, type: KIND_TYPE[i.kind] || i.kind, app: i.product, date: i.not_after ? i.not_after.slice(0, 10) : '—', days_left: i.daysLeft, owner: '—', ticket: '—' }));
  const licences = items.filter(i => i.kind === 'license' && i.seats_total).map(i => ({
    name: i.product, unit: 'seats', used: i.seats_used, cap: i.seats_total, pct: Math.round((i.seats_used / i.seats_total) * 100)
  }));
  const soon = expiry.filter(e => e.days_left <= 30);
  return {
    note: 'From the expiry store. Versions, configuration drift and disaster-recovery tests are not collected yet.',
    kpis: [
      { label: 'Expiring ≤ 30 days', value: String(soon.length), note: `${soon.filter(e => e.type === 'Certificate').length} certificate · ${soon.filter(e => e.type === 'Licence').length} licence`, state: soon.length ? 'crit' : 'ok' },
      { label: 'Licences ≥ 85% used', value: String(licences.filter(l => l.pct >= 85).length), note: `${licences.length} tracked`, state: licences.some(l => l.pct >= 85) ? 'warn' : 'ok' }
    ],
    expiry, licences, versions: [], controller_drift: [], disaster_recovery: []
  };
}

/** Per-application detail: manifest facts plus everything received for that application. */
function buildAppDetail({ app, aliases, rows, alerts, expiry, env, nowMs }) {
  const known = new Set(aliases);
  const mine = alerts.filter(a => known.has(a.component) && !/resolved|closed/i.test(String(a.status)) && !a.resolvedAt);
  const numeric = rows.filter(r => r && typeof r.value === 'number' && Number.isFinite(r.value));
  const byName = new Map();
  for (const r of numeric) {
    if (!byName.has(r.metricName)) byName.set(r.metricName, []);
    byName.get(r.metricName).push(r);
  }
  const metrics = [...byName.entries()].map(([name, list]) => {
    list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const last = list[list.length - 1];
    return { name, latest: last.value, points: list.length, last_seen: last.timestamp, series: list.slice(-60).map(r => r.value) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const latest = (n) => { const m = metrics.find(x => x.name === n); return m ? m.latest : null; };
  const success = latest('successRate');
  const down = success === 0;
  let state = null;
  if (down || mine.some(a => sevTone(a.severity) === 'crit')) state = 'crit';
  else if (mine.length) state = 'warn';
  else if (metrics.length) state = 'ok';
  const epKey = env === 'prod' ? 'prod' : 'stg';
  const endpoints = Object.entries((app.endpoints && app.endpoints[epKey]) || {}).map(([k, v]) => ({ name: k, url: v }));
  const declaredHosts = (app.layers && Array.isArray(app.layers.hosts)) ? app.layers.hosts : [];
  const certs = expiry.filter(i => known.has(i.product) || known.has(String(i.product || '').toLowerCase()))
    .map(i => ({ name: i.name || i.subject, kind: i.kind, days_left: i.daysLeft, not_after: i.not_after, status: i.status }));
  return {
    app: { id: app.id, name: app.display_name || app.id, category: app.category || null, tier: app.tier || null },
    state,
    kpis: [
      { label: 'State', value: state === 'crit' ? 'Degraded' : state === 'warn' ? 'Warning' : state === 'ok' ? 'Healthy' : 'Unknown', note: metrics.length ? (down ? 'Probe success rate is 0' : 'Telemetry receiving') : 'No numbers received', state },
      { label: 'Open alerts', value: String(mine.length), note: `${mine.filter(a => sevTone(a.severity) === 'crit').length} critical`, state: mine.length ? (mine.some(a => sevTone(a.severity) === 'crit') ? 'crit' : 'warn') : null },
      { label: 'Response time', value: latest('responseTime') === null ? '—' : `${latest('responseTime')} ms`, note: '', state: null },
      { label: 'Success rate', value: success === null ? '—' : `${success}%`, note: '', state: success === null ? null : (success === 0 ? 'crit' : null) },
      { label: 'Hosts declared', value: String(declaredHosts.length), note: '', state: null }
    ],
    metrics,
    endpoints,
    declared_hosts: declaredHosts,
    alerts: mine.map(a => ({ sev: a.severity, state: sevTone(a.severity), signal: a.message, age: ageText(a.timestamp, nowMs) || '—' })),
    certificates: certs
  };
}

// Router for /api/v2/console.
function createConsoleRouter(deps = {}) {
  const yamlConfig = deps.yamlConfig || require('../config/yaml_config');
  const db = deps.db || require('@sentinel/database');
  const expiryStore = deps.expiryStore || require('../../database/expiry_store');
  const jenkinsTopology = deps.jenkinsTopology || require('../../metrics_collection/real/applications/jenkins_topology');
  const router = express.Router();

  // Per-application detail screen.
  router.get('/app/:id', async (req, res) => {
    const env = requestEnvironment(req);
    try {
      const apps = yamlConfig.loadAllApplications() || {};
      const app = apps[req.params.id] || Object.values(apps).find(a => a && a.id === req.params.id);
      if (!app || app.kind !== 'application') return res.status(404).json({ error: `Unknown application '${req.params.id}'` });
      const aliases = [...new Set([app.id, ...Object.entries(apps).filter(([, v]) => v && v.id === app.id).map(([k]) => k)])];
      const rows = aliases.flatMap(n => (db.getMetrics(n, 2000, env) || []));
      const data = buildAppDetail({ app, aliases, rows, alerts: db.getAlerts(env) || [], expiry: await expiryStore.getExpiryItems(), env, nowMs: Date.now() });
      return res.json({ environment: env, generated_at: new Date().toISOString(), data });
    } catch (err) {
      return res.status(503).json({ status: 'DATA_UNAVAILABLE', environment: env, reason: err.message });
    }
  });

  // One console screen (overview, jenkins, compliance; others answer DATA_UNAVAILABLE).
  router.get('/:screen', async (req, res) => {
    const env = requestEnvironment(req);
    const screen = req.params.screen;
    const unavailable = (reason) => res.json({ status: 'DATA_UNAVAILABLE', environment: env, reason });
    try {
      if (UNAVAILABLE[screen]) return unavailable(UNAVAILABLE[screen]);
      if (screen === 'overview') {
        const apps = yamlConfig.loadAllApplications() || {};
        const alerts = db.getAlerts(env) || [];
        const probe = (name) => {
          try {
            const rows = (db.getMetrics(name, 200, env) || []).filter(r => r && typeof r.value === 'number' && Number.isFinite(r.value));
            if (!rows.length) return null;
            const sr = rows.filter(r => r.metricName === 'successRate');
            return sr.length && sr[sr.length - 1].value === 0 ? 'down' : 'up';
          } catch (_) { return null; }
        };
        const data = buildOverview({ apps, alerts, probe, nowMs: Date.now() });
        if (!data.app_count) return unavailable('No applications are declared under config/apps.');
        return res.json({ environment: env, generated_at: new Date().toISOString(), data });
      }
      if (screen === 'jenkins') {
        const data = buildJenkins(jenkinsTopology.getLastSnapshot());
        if (!data) return unavailable('No Jenkins controller has been polled yet. Declare operations_centers and controllers under topology in config/apps/cloudbees-jenkins.yaml.');
        return res.json({ environment: env, generated_at: new Date().toISOString(), data });
      }
      if (screen === 'compliance') {
        const data = buildCompliance(await expiryStore.getExpiryItems());
        if (!data) return unavailable('No certificate or licence has been checked yet.');
        return res.json({ environment: env, generated_at: new Date().toISOString(), data });
      }
      return res.status(404).json({ error: `Unknown console screen '${screen}'` });
    } catch (err) {
      return res.status(503).json({ status: 'DATA_UNAVAILABLE', environment: env, reason: err.message });
    }
  });

  return router;
}

module.exports = createConsoleRouter();
module.exports.createConsoleRouter = createConsoleRouter;
module.exports.buildOverview = buildOverview;
module.exports.buildAppDetail = buildAppDetail;
module.exports.buildJenkins = buildJenkins;
module.exports.buildCompliance = buildCompliance;
