/**
 * Shared helpers for the browser validation tools: tab list, browser launch, sign-in,
 * environment switch and waiting until a tab has finished loading its data.
 *
 * Settings (environment variables):
 *   SENTINEL_UI_URL        base URL (default http://127.0.0.1:3001)
 *   SENTINEL_UI_USER       sign-in user (default admin_sentinel)
 *   SENTINEL_UI_PASSWORD   sign-in password (required; never stored in this repository)
 *   SENTINEL_CHROMIUM_PATH browser to use (default: Chrome or Edge if installed, else Playwright's own)
 *   SENTINEL_UI_ENVS       environments to walk (default staging,prod)
 */
const fs = require('fs');
const { chromium } = require('playwright');

const BASE_URL = (process.env.SENTINEL_UI_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const ENVS = (process.env.SENTINEL_UI_ENVS || 'staging,prod').split(',').map(s => s.trim()).filter(Boolean);

// Tab ids as App.jsx routes them.
const TABS = [
  { id: 'home', group: 'Overview', label: 'Scorecard' },
  { id: 'problems', group: 'Respond', label: 'Problems' },
  { id: 'alerts', group: 'Respond', label: 'Alerts' },
  { id: 'slos', group: 'Respond', label: 'SLOs' },
  { id: 'evidence', group: 'Respond', label: 'Evidence Packs' },
  { id: 'remediation', group: 'Respond', label: 'Remediation' },
  { id: 'on_call', group: 'Respond', label: 'On-Call' },
  { id: 'applications', group: 'Observe', label: 'Applications' },
  { id: 'products', group: 'Observe', label: 'Products' },
  { id: 'hosts', group: 'Observe', label: 'Hosts' },
  { id: 'infra_linux', group: 'Observe', label: 'Linux' },
  { id: 'infra_windows', group: 'Observe', label: 'Windows' },
  { id: 'health_checks', group: 'Observe', label: 'Health Checks' },
  { id: 'expiry', group: 'Observe', label: 'Certificates & Licences' },
  { id: 'capacity', group: 'Observe', label: 'Capacity & Runway' },
  { id: 'storage', group: 'Observe', label: 'Storage' },
  { id: 'avi', group: 'Observe', label: 'AVI' },
  { id: 'databases', group: 'Observe', label: 'Databases' },
  { id: 'kubernetes', group: 'Observe', label: 'Kubernetes' },
  { id: 'logs', group: 'Observe', label: 'Logs' },
  { id: 'topology', group: 'Explore', label: 'Topology' },
  { id: 'traces', group: 'Explore', label: 'Traces' },
  { id: 'dashboards', group: 'Explore', label: 'Dashboards' },
  { id: 'access', group: 'Govern', label: 'Access' },
  { id: 'audit', group: 'Govern', label: 'Audit' },
  { id: 'agents', group: 'Govern', label: 'Agents' },
  { id: 'platform_health', group: 'Govern', label: 'Platform Health' },
  { id: 'configuration', group: 'Govern', label: 'Configuration' },
  { id: 'change_windows', group: 'Govern', label: 'Change Windows' },
  { id: 'security', group: 'Govern', label: 'Security' },
  { id: 'console', group: 'Console', label: 'Console' },
  { id: 'demo', group: 'Demo', label: 'Demo' }
];

// Texts the app shows when a source has nothing; matching one means "no data", never "live data".
const NO_DATA_MARKERS = [
  'Data not available', 'DATA_UNAVAILABLE', 'Data unavailable', 'NO DATA', 'No data',
  'not configured', 'No rota uploaded', 'No open problems', 'No scorecards', 'No agents reporting',
  'No hosts discovered', 'No Kubernetes clusters', 'not collected', 'Value Not Available'
];

function findBrowser() {
  if (process.env.SENTINEL_CHROMIUM_PATH) return process.env.SENTINEL_CHROMIUM_PATH;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find(c => fs.existsSync(c)) || null;
}

async function launch() {
  const execPath = findBrowser();
  return chromium.launch({
    headless: true,
    ...(execPath ? { executablePath: execPath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
}

function credentials() {
  const user = process.env.SENTINEL_UI_USER || 'admin_sentinel';
  const password = process.env.SENTINEL_UI_PASSWORD;
  if (!password) {
    throw new Error('Set SENTINEL_UI_PASSWORD (and SENTINEL_UI_USER if not admin_sentinel) before running.');
  }
  return { user, password };
}

async function signIn(page) {
  const { user, password } = credentials();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#login-username', { timeout: 20000 });
  await page.fill('#login-username', user);
  await page.fill('#login-password', password);
  await page.click('button.login-submit');
  await page.waitForSelector('.sidebar-brand-text, .brand-pulse', { timeout: 20000 });
  return user;
}

// Environment of the signed-in session, as the server sees it.
async function sessionEnvironment(page) {
  return page.evaluate(() => fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)).then(m => (m && m.environment) || null));
}

/**
 * Switches the session to `env` through the header switch, then confirms it with /api/auth/me.
 * Returns true only when the server reports the new environment.
 */
async function switchEnvironment(page, env) {
  if ((await sessionEnvironment(page)) === env) return true;
  const label = env === 'prod' ? /^PROD$/ : /^STAG/;
  const button = page.locator('button').filter({ hasText: label }).first();
  if (await button.count() === 0) return false;
  await button.click();
  for (let i = 0; i < 20; i++) {
    if ((await sessionEnvironment(page)) === env) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/**
 * Waits until the tab has loaded: no API request in flight for 800 ms and no loading
 * placeholder left, up to `timeoutMs`. Returns false when it never settled.
 */
async function waitForSettled(page, inflight, timeoutMs = 15000) {
  const start = Date.now();
  let quietSince = null;
  while (Date.now() - start < timeoutMs) {
    // Loading placeholders by class, not by text: page content such as "role_mapping" must not match.
    const loading = await page.locator('.shr-loading, [class*="-loading"], [class*="__loading"], [class*="__spinner"]').count().catch(() => 0);
    if (inflight.size === 0 && loading === 0) {
      quietSince = quietSince || Date.now();
      if (Date.now() - quietSince >= 800) return true;
    } else {
      quietSince = null;
    }
    await page.waitForTimeout(100);
  }
  return false;
}

// Tracks /api requests of the page: those in flight, and those that failed.
function trackApi(page) {
  const inflight = new Set();
  let failures = [];
  const isApi = req => new URL(req.url()).pathname.startsWith('/api/');
  page.on('request', req => { if (isApi(req)) inflight.add(req); });
  page.on('requestfinished', async req => {
    if (!isApi(req)) return;
    inflight.delete(req);
    const res = await req.response().catch(() => null);
    if (res && res.status() >= 400) failures.push(`${res.status()} ${req.method()} ${new URL(req.url()).pathname}`);
  });
  page.on('requestfailed', req => {
    if (!isApi(req)) return;
    inflight.delete(req);
    const text = (req.failure() || {}).errorText || '';
    if (/ERR_ABORTED/.test(text)) return; // cancelled by navigating to the next tab
    failures.push(`FAILED ${req.method()} ${new URL(req.url()).pathname} (${(req.failure() || {}).errorText || 'error'})`);
  });
  return {
    inflight,
    // Call before navigating: forgets requests of the previous page.
    reset() { inflight.clear(); failures = []; },
    takeFailures() { const f = failures; failures = []; return [...new Set(f)]; }
  };
}

module.exports = {
  BASE_URL, ENVS, TABS, NO_DATA_MARKERS,
  launch, signIn, switchEnvironment, sessionEnvironment, waitForSettled, trackApi
};
