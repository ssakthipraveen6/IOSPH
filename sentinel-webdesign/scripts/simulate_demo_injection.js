#!/usr/bin/env node
'use strict';
/**
 * Demo injection simulator.
 *
 * Sends simulated agent traffic to a running Sentinel through the real ingest endpoints
 * (heartbeats and OTLP metrics), so every real view fills up exactly as it would with real agents.
 * Use it for demonstrations and for checking how the app copes with incoming data.
 *
 *   node scripts/simulate_demo_injection.js --url https://sentinel-stg.internal.corp --key snk_... [options]
 *   npm run demo:inject -- --url http://localhost:3001 --key snk_...
 *
 * Options
 *   --url        Sentinel base URL (default http://localhost:3001)
 *   --key        Ingest key with metrics+heartbeat scopes (or env SENTINEL_INGEST_KEY). The key decides the environment.
 *   --env        Environment you believe the key belongs to: staging (default) or prod. prod needs --allow-prod.
 *   --hosts      Simulated Linux hosts (default 40); Windows hosts = hosts / 4
 *   --interval   Seconds between pushes (default 15)
 *   --scenario   story (default: steady, then an incident, then recovery, repeating) | steady | incident
 *   --minutes    Stop after N minutes (default: run until Ctrl+C)
 *   --once       Send one round and exit
 *   --allow-prod Required to send with --env prod. Simulated data in production is rarely what you want.
 *
 * Everything it creates is named sim-*.demo.local and tagged simulated=true, so it is easy to recognise.
 * There is no randomness: the same minute always produces the same picture.
 */

const path = require('path');

const ENV_ATTR = 'deployment.environment';
// OTLP string attribute.
const str = (key, stringValue) => ({ key, value: { stringValue } });

// Command-line options.
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true; else { out[k] = next; i++; }
  }
  return out;
}

// Application ids from the manifests.
function applicationIds() {
  try {
    const apps = require(path.join(__dirname, '..', 'backend', 'config', 'yaml_config')).loadAllApplications() || {};
    return [...new Set(Object.values(apps).filter(a => a && a.kind === 'application' && a.enabled !== false).map(a => a.id))];
  } catch (_) {
    return [];
  }
}

/** Phase of the story at `elapsedMs`: steady 0-2 min, incident 2-5, recovery 5-7, steady again to 10, then repeat. */
function phaseAt(scenario, elapsedMs) {
  if (scenario === 'steady') return 'steady';
  if (scenario === 'incident') return 'incident';
  const m = (elapsedMs / 60000) % 10;
  if (m < 2) return 'steady';
  if (m < 5) return 'incident';
  if (m < 7) return 'recovery';
  return 'steady';
}

// Smooth 0-1 wave.
const wave = (t, period, phase = 0) => (Math.sin((t / period) * 2 * Math.PI + phase) + 1) / 2; // 0..1, deterministic

// Simulated host names.
function hostNames(count) {
  const lnx = Array.from({ length: count }, (_, i) => `sim-lnx-${String(i + 1).padStart(3, '0')}.demo.local`);
  const win = Array.from({ length: Math.max(1, Math.floor(count / 4)) }, (_, i) => `sim-win-${String(i + 1).padStart(3, '0')}.demo.local`);
  return { lnx, win };
}

/** The apps the story hurts during an incident, and how. */
const INCIDENT_APPS = { jfrog_artifactory: { rt: 7, ok: 91 }, cloudbees_jenkins: { rt: 4, ok: 94 }, bitbucket: { rt: 2.5, ok: 98 } };

// OTLP gauge metric.
function gauge(name, value, nowNano, attrs = []) {
  return { name, gauge: { dataPoints: [{ asDouble: Number(value.toFixed(2)), timeUnixNano: nowNano, attributes: attrs }] } };
}

/**
 * One round of OTLP resourceMetrics for every simulated host and application.
 * Pure: the same inputs always give the same output.
 */
function buildRound({ env, hosts, apps, elapsedMs, scenario, nowMs }) {
  const phase = phaseAt(scenario, elapsedMs);
  const t = elapsedMs / 1000;
  const nano = String(BigInt(nowMs) * 1000000n);
  const resources = [];
  const hostAttrs = (h) => [str('host.name', h), str(ENV_ATTR, env), str('simulated', 'true')];
  const all = [...hosts.lnx.map(h => ({ h, os: 'linux' })), ...hosts.win.map(h => ({ h, os: 'windows' }))];
  all.forEach(({ h, os }, i) => {
    const hot = phase === 'incident' && i % 7 === 2; // a handful of hosts run hot during the incident
    const cpu = hot ? 0.93 : 0.22 + 0.3 * wave(t, 240, i);
    const mem = hot ? 0.9 : 0.4 + 0.25 * wave(t, 360, i * 0.7);
    const disk = hot ? 0.92 : 0.45 + 0.2 * wave(t, 3600, i * 0.3);
    resources.push({
      resource: { attributes: hostAttrs(h) },
      scopeMetrics: [{ metrics: [
        gauge('system.cpu.utilization', cpu, nano),
        gauge('system.memory.utilization', mem, nano),
        gauge('system.filesystem.utilization', disk, nano, [str('mountpoint', os === 'windows' ? 'C:' : '/')])
      ] }]
    });
  });
  apps.forEach((id, i) => {
    const hurt = phase === 'incident' ? INCIDENT_APPS[id] : null;
    const rt = (60 + 70 * wave(t, 180, i)) * (hurt ? hurt.rt : 1);
    const ok = hurt ? hurt.ok : 99.6 + 0.4 * wave(t, 300, i);
    const rate = 30 + 40 * wave(t, 420, i * 1.3);
    resources.push({
      resource: { attributes: [str('application.id', id), str(ENV_ATTR, env), str('simulated', 'true')] },
      scopeMetrics: [{ metrics: [gauge('responseTime', rt, nano), gauge('successRate', ok, nano), gauge('requests', rate, nano)] }]
    });
  });
  return { phase, payload: { resourceMetrics: resources } };
}

// POSTs JSON with the ingest key.
async function postJson(url, key, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentinel-Api-Key': key }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

// Sends rounds of simulated metrics and heartbeats.
async function run(opts) {
  const url = String(opts.url || 'http://localhost:3001').replace(/\/+$/, '');
  const key = opts.key || process.env.SENTINEL_INGEST_KEY;
  const env = String(opts.env || 'staging').toLowerCase();
  const count = Math.max(1, parseInt(opts.hosts || 40, 10));
  const intervalMs = Math.max(1, Number(opts.interval || 15)) * 1000;
  const scenario = ['story', 'steady', 'incident'].includes(opts.scenario) ? opts.scenario : 'story';
  const log = opts.log || ((m) => console.log(m));
  if (!key) throw new Error('An ingest key is required (--key or SENTINEL_INGEST_KEY). Create one with: npm run ingest-key');
  if (env === 'prod' && !opts['allow-prod']) throw new Error('Refusing to send simulated data to prod. Add --allow-prod if you really mean it.');
  const apps = opts.apps || applicationIds();
  const hosts = hostNames(count);
  const started = Date.now();
  const stopAt = opts.minutes ? started + Number(opts.minutes) * 60000 : null;

  for (const h of hosts.lnx) await postJson(`${url}/api/v2/shipper/heartbeat`, key, { host: h, version: '2.4.0', os: 'linux', config_hash: 'sim' });
  for (const h of hosts.win) await postJson(`${url}/api/v2/shipper/heartbeat`, key, { host: h, version: '2.4.0', os: 'windows', config_hash: 'sim' });
  log(`[sim] ${hosts.lnx.length} Linux + ${hosts.win.length} Windows hosts and ${apps.length} applications registered at ${url} (${env}, scenario ${scenario})`);

  let rounds = 0;
  for (;;) {
    const now = Date.now();
    const { phase, payload } = buildRound({ env, hosts, apps, elapsedMs: now - started, scenario, nowMs: now });
    const r = await postJson(`${url}/v1/metrics`, key, payload);
    rounds++;
    log(`[sim] round ${rounds}: phase ${phase}, ${r.count ?? '?'} points accepted`);
    if (opts.once || (stopAt && Date.now() + intervalMs > stopAt) || opts.signal?.aborted) break;
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return { rounds, hosts, apps };
}

module.exports = { run, buildRound, phaseAt, hostNames, parseArgs };

if (require.main === module) {
  run(parseArgs(process.argv.slice(2))).then(() => process.exit(0)).catch(e => { console.error(`[sim] ${e.message}`); process.exit(1); });
}
