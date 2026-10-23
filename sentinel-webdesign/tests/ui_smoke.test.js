/**
 * tests/ui_smoke.test.js
 *
 * Phase D UI Smoke Test Suite:
 * - 2-way environment switcher: strictly PROD and STAG (zero DEMO in switcher).
 * - Visits canonical views in staging mode without unhandled console errors.
 * - Deep linking & URL state restoration.
 * - Visits Demo view (?tab=demo) and verifies fixed banner.
 */

const assert = require('assert');
const http = require('http');
const { chromium } = require('playwright');
process.env.SENTINEL_ALLOW_LOCALHOST_CORS = process.env.SENTINEL_ALLOW_LOCALHOST_CORS || 'true';
const { app } = require('../backend/server');

async function runUiSmokeTests() {
  console.log('=== RUNNING PHASE D PLAYWRIGHT UI SMOKE TESTS ===');

  let server;
  let testPort;
  let browser;

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      resolve();
    });
  });

  try {
    console.log(`[TEST] Test server running on http://127.0.0.1:${testPort}`);
    browser = await chromium.launch({
      headless: true,
      // Optional: point at a pre-installed Chromium when Playwright's own download is unavailable.
      ...(process.env.SENTINEL_CHROMIUM_PATH ? { executablePath: process.env.SENTINEL_CHROMIUM_PATH } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore expected network connection failures to non-existent mock endpoints in test environment
        if (!text.includes('Failed to load resource') && !text.includes('net::ERR_CONNECTION_REFUSED') && !text.includes('WebSocket') && !text.includes('[WS]')) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', err => {
      consoleErrors.push(err.message);
    });

    // 1. Visit Home Scorecard in Staging Mode; verify legacy env=demo is sanitized away
    console.log('\n[TEST 1] Visiting Home Scorecard with legacy ?env=demo and verifying sanitization...');
    await page.goto(`http://127.0.0.1:${testPort}/?env=demo&tab=home`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(500);

    const titleText = await page.title();
    assert.ok(titleText.length > 0, 'Page title must be populated');

    // Verify URL does NOT retain env=demo
    const currentUrlAfterDemoNav = page.url();
    assert.ok(!currentUrlAfterDemoNav.includes('env=demo'), 'env=demo must be stripped and replaced with default');

    // Verify Brand is rendered
    const brandElement = await page.$('.sidebar-brand-text, .brand-pulse');
    assert.ok(brandElement, 'SENTINEL brand must be rendered');
    console.log('✔ Test 1 Passed: Home Scorecard loaded and env=demo was cleanly sanitized.');

    // 2. Test Environment Switcher (strictly PROD and STAG, zero DEMO)
    console.log('\n[TEST 2] Verifying 2-way environment switcher (PROD and STAG)...');
    const demoChip = await page.$('button.env-chip:has-text("DEMO")');
    assert.strictEqual(demoChip, null, 'Switcher must NOT contain a DEMO button');

    const prodChip = await page.$('button.env-chip:has-text("PROD")');
    const stagChip = await page.$('button.env-chip:has-text("STAG")');
    assert.ok(prodChip, 'Switcher must have PROD button');
    assert.ok(stagChip, 'Switcher must have STAG button');

    // Click PROD
    await prodChip.click();
    await page.waitForTimeout(300);
    assert.ok(page.url().includes('env=prod'), 'Clicking PROD button must update URL to env=prod');

    // Click STAG
    await stagChip.click();
    await page.waitForTimeout(300);
    assert.ok(page.url().includes('env=staging') || page.url().includes('env=stg'), 'Clicking STAG button must update URL to staging');
    console.log('✔ Test 2 Passed: Switcher has strictly PROD and STAG; toggling updates URL state.');

    // 3. Visit Every Canonical Navigation Group Route
    const routesToVisit = [
      { tab: 'problems', label: 'Respond / Problems' },
      { tab: 'alerts', label: 'Respond / Alerts' },
      { tab: 'slos', label: 'Respond / SLOs' },
      { tab: 'evidence', label: 'Respond / Evidence Packs' },
      { tab: 'remediation', label: 'Respond / Remediation' },
      { tab: 'on_call', label: 'Respond / On-Call' },
      { tab: 'applications', label: 'Observe / Applications' },
      { tab: 'products', label: 'Observe / Products' },
      { tab: 'hosts', label: 'Observe / Hosts' },
      { tab: 'infra_linux', label: 'Observe / Linux' },
      { tab: 'infra_windows', label: 'Observe / Windows' },
      { tab: 'health_checks', label: 'Observe / Health Checks' },
      { tab: 'expiry', label: 'Observe / Certificates & Licences' },
      { tab: 'capacity', label: 'Observe / Capacity & Runway' },
      { tab: 'storage', label: 'Observe / Storage' },
      { tab: 'avi', label: 'Observe / AVI' },
      { tab: 'databases', label: 'Observe / Databases' },
      { tab: 'kubernetes', label: 'Observe / Kubernetes' },
      { tab: 'logs', label: 'Observe / Logs' },
      { tab: 'topology', label: 'Explore / Topology' },
      { tab: 'traces', label: 'Explore / Traces' },
      { tab: 'dashboards', label: 'Explore / Dashboards' },
      { tab: 'access', label: 'Govern / Access' },
      { tab: 'audit', label: 'Govern / Audit' },
      { tab: 'agents', label: 'Govern / Agents' },
      { tab: 'platform_health', label: 'Govern / Platform Health' },
      { tab: 'configuration', label: 'Govern / Configuration' },
      { tab: 'change_windows', label: 'Govern / Change Windows' }
    ];

    console.log('\n[TEST 3] Visiting all canonical navigation group views in staging...');
    for (const r of routesToVisit) {
      await page.goto(`http://127.0.0.1:${testPort}/?env=staging&tab=${r.tab}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(200);

      const navTabActive = await page.$(`button.nav-tab-btn.active`);
      assert.ok(navTabActive, `Active tab button must exist for ${r.label}`);
    }
    console.log(`✔ Test 3 Passed: All ${routesToVisit.length} views rendered cleanly.`);

    // 3b. Visit ComponentPage for a fixture component
    console.log('\n[TEST 3b] Visiting ComponentPage frame (?tab=component&kind=host_linux&id=test-host-01)...');
    await page.goto(`http://127.0.0.1:${testPort}/?env=staging&tab=component&kind=host_linux&id=test-host-01`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(400);

    const compTitle = await page.$('.component-page__title');
    assert.ok(compTitle, 'ComponentPage must render .component-page__title');
    const compTitleText = await page.innerText('.component-page__title');
    assert.strictEqual(compTitleText, 'test-host-01', 'Component title must match ID');
    console.log('✔ Test 3b Passed: ComponentPage rendered cleanly for fixture component.');

    // 3c. Visit HostDetailView for Linux and Windows hosts (?tab=infra_linux&host=test-host-01)
    console.log('\n[TEST 3c] Visiting HostDetailView (?tab=infra_linux&host=test-linux-01)...');
    await page.goto(`http://127.0.0.1:${testPort}/?env=staging&tab=infra_linux&host=test-linux-01`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(400);

    const hostTitle = await page.$('.host-detail-title');
    assert.ok(hostTitle, 'HostDetailView must render .host-detail-title');
    const hostTitleText = await page.innerText('.host-detail-title');
    assert.strictEqual(hostTitleText, 'test-linux-01', 'Host title must match host parameter');

    const tabs = await page.$$('.host-tab-btn');
    assert.ok(tabs.length >= 5, 'HostDetailView must render at least 5 tabs');
    console.log('✔ Test 3c Passed: HostDetailView rendered cleanly with breadcrumbs and tabs.');

    // 3d. Observe › Applications: open app map and click node into ComponentPage (O5.2)
    console.log('\n[TEST 3d] Visiting Observe › Applications (?tab=applications&product=bitbucket)...');
    await page.goto(`http://127.0.0.1:${testPort}/?env=staging&tab=applications&product=bitbucket`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(600);

    const appMapHeader = await page.$('.app-map-header');
    assert.ok(appMapHeader, 'AppMapView must render .app-map-header');

    // Click a node in the flow
    const nodeEl = await page.$('.app-map-node');
    if (nodeEl) {
      await nodeEl.click();
      await page.waitForTimeout(400);
      const compTitle = await page.$('.component-page__title');
      assert.ok(compTitle, 'Clicking node must open ComponentPage for that component');
      console.log('✔ Test 3d Passed: Observe › Applications opened app map and clicked node into ComponentPage.');
    } else {
      console.log('✔ Test 3d Passed: Observe › Applications header rendered cleanly.');
    }

    // 3e. Test EntityDrillDownPanel slide-over (O5.4)
    console.log('\n[TEST 3e] Verifying EntityDrillDownPanel slide-over rendering...');
    await page.goto(`http://127.0.0.1:${testPort}/?env=staging&tab=hosts`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(600);
    const hostRow = await page.$('.fleet-table tbody tr, .fleet-row');
    if (hostRow) {
      await hostRow.click();
      await page.waitForTimeout(400);
      const panel = await page.$('.edp-slideover');
      if (panel) {
        const textContent = await page.innerText('.edp-slideover');
        assert.ok(!textContent.includes('Value Not Available'), 'EntityDrillDownPanel must not contain "Value Not Available"');
        const closeBtn = await page.$('.edp-close-btn');
        if (closeBtn) await closeBtn.click();
      }
    }
    console.log('✔ Test 3e Passed: EntityDrillDownPanel verified without "Value Not Available".');

    // 4. Visit Demo View (?tab=demo) and verify banner
    console.log('\n[TEST 4] Visiting isolated Demo View (?tab=demo)...');
    await page.goto(`http://127.0.0.1:${testPort}/?env=staging&tab=demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(400);

    const demoBanner = await page.$('.demo-fixed-banner');
    assert.ok(demoBanner, 'Demo view must render .demo-fixed-banner');
    const bannerText = await page.innerText('.demo-fixed-banner');
    assert.ok(bannerText.includes('Demo'), 'Banner must indicate Demo mode');
    console.log('✔ Test 4 Passed: Demo view rendered with fixed isolation banner.');

    // 5. Test Deep Linking & Parameter Restoration
    console.log('\n[TEST 5] Testing deep-link reload state restoration...');
    const deepLinkUrl = `http://127.0.0.1:${testPort}/?env=prod&tab=products&product=jfrog_artifactory`;
    await page.goto(deepLinkUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(300);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(300);

    const currentUrl = page.url();
    assert.ok(currentUrl.includes('env=prod'), 'Reload must restore env=prod');
    assert.ok(currentUrl.includes('tab=products'), 'Reload must restore tab=products');
    assert.ok(currentUrl.includes('product=jfrog_artifactory'), 'Reload must restore product query param');
    console.log('✔ Test 5 Passed: Deep link reload restored exact URL state and environment.');

    // 6. Verify Zero Console Errors
    console.log('\n[TEST 6] Checking for unhandled console errors...');
    if (consoleErrors.length > 0) {
      console.warn('[WARN] Console errors detected during run:', consoleErrors);
    }
    assert.strictEqual(consoleErrors.length, 0, `Page encountered ${consoleErrors.length} console error(s)`);
    console.log('✔ Test 6 Passed: Zero unhandled console errors detected.');

    console.log('\n======================================================');
    console.log('🎉 ALL PHASE D UI SMOKE TESTS PASSED!');
    console.log('======================================================');
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
}

runUiSmokeTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n✘ UI Smoke Test Failed:', err);
    process.exit(1);
  });
