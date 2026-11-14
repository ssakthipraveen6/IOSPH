/**
 * tests/ui_login.test.js
 *
 * Sign-in gate and per-user environments in the browser (work order N4, N5, R1):
 *   1. Signed out: the login page shows and no dashboard data is requested.
 *   2. A wrong password shows the server's error.
 *   3. stg_operator sees only the STAG chip and lands on staging.
 *   4. Sign out returns to the login page and the old session no longer works.
 *   5. prod_operator sees only the PROD chip and lands on prod.
 *   6. A session revoked in the background sends the user to the login page with a notice.
 *   7. Super Admin sees both chips and can switch twice without being signed out.
 *   8. A failed problems feed shows "Data unavailable", not a healthy zero (R1).
 */

const assert = require('assert');
const { chromium } = require('playwright');
process.env.SENTINEL_ALLOW_LOCALHOST_CORS = process.env.SENTINEL_ALLOW_LOCALHOST_CORS || 'true';
const { app } = require('../backend/server');

const PASSWORD = 'Login-Test-Pw1';

// Fills and submits the login form.
async function signIn(page, username, password) {
  await page.waitForSelector('#login-username', { timeout: 15000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('button.login-submit');
}

// Returns the labels of the environment chips in the header.
async function chipLabels(page) {
  return page.$$eval('button.env-chip', els => els.map(e => e.textContent.trim()));
}

async function run() {
  console.log('=== RUNNING SIGN-IN AND ENVIRONMENT ACCESS UI TESTS ===');
  let server;
  let browser;
  const port = await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;

  try {
    let execPath = process.env.SENTINEL_CHROMIUM_PATH;
    if (!execPath && process.platform === 'win32') {
      const fs = require('fs');
      const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          execPath = c;
          break;
        }
      }
    }
    browser = await chromium.launch({
      headless: true,
      ...(execPath ? { executablePath: execPath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    // 1. Signed out
    let context = await browser.newContext();
    let page = await context.newPage();
    const dataRequests = [];
    page.on('request', req => {
      const u = req.url();
      if (/\/api\/(health|alerts|problems|scorecards|metrics)\b/.test(u)) dataRequests.push(u);
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login-username', { timeout: 15000 });
    await page.waitForTimeout(800);
    assert.strictEqual(await page.locator('.sentinel-sidebar').count(), 0, 'no app shell while signed out');
    assert.strictEqual(dataRequests.length, 0, `no dashboard data requested while signed out: ${dataRequests.join(', ')}`);
    console.log('✔ 1. Signed out: login page only, no data requests.');

    // 2. Wrong password (on the deny list of the staging test users)
    await signIn(page, 'stg_operator', 'wrong_password');
    await page.getByRole('alert').filter({ hasText: 'Invalid LDAP credentials or bind failed.' }).waitFor({ timeout: 10000 });
    console.log('✔ 2. Wrong password shows the server error.');

    // 3. stg_operator: STAG only
    await signIn(page, 'stg_operator', PASSWORD);
    await page.waitForSelector('.sentinel-sidebar', { timeout: 15000 });
    assert.deepStrictEqual(await chipLabels(page), ['STAG'], 'stg_operator sees only STAG');
    assert.ok(page.url().includes('env=staging'), `stg_operator lands on staging: ${page.url()}`);
    console.log('✔ 3. stg_operator sees only STAG and lands on staging.');

    // 4. Sign out
    await page.locator('.logged-user-card').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForSelector('#login-username', { timeout: 10000 });
    const meAfter = await page.evaluate(async () => (await fetch('/api/auth/me')).status);
    assert.strictEqual(meAfter, 401, 'session is revoked after sign out');
    console.log('✔ 4. Sign out returns to the login page; the session is revoked.');

    // 5. prod_operator: PROD only
    await signIn(page, 'prod_operator', PASSWORD);
    await page.waitForSelector('.sentinel-sidebar', { timeout: 15000 });
    assert.deepStrictEqual(await chipLabels(page), ['PROD'], 'prod_operator sees only PROD');
    assert.ok(page.url().includes('env=prod'), `prod_operator lands on prod: ${page.url()}`);
    console.log('✔ 5. prod_operator sees only PROD and lands on prod.');

    // 6. Session revoked in the background
    await page.evaluate(async () => {
      const csrf = (document.cookie.match(/sentinel_csrf=([^;]+)/) || [])[1] || '';
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': decodeURIComponent(csrf) } });
    });
    await page.evaluate(() => fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    await page.getByText('Your session ended. Sign in again.').waitFor({ timeout: 10000 });
    assert.ok(await page.locator('#login-username').isVisible(), 'login page is shown again');
    console.log('✔ 6. A revoked session returns to the login page with a notice.');
    await context.close();

    // 7. Super Admin: both chips, two switches
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await signIn(page, 'admin_sentinel', PASSWORD);
    await page.waitForSelector('.sentinel-sidebar', { timeout: 15000 });
    assert.deepStrictEqual((await chipLabels(page)).sort(), ['PROD', 'STAG'], 'Super Admin sees both chips');
    for (const [label, env] of [['PROD', 'prod'], ['STAG', 'staging']]) {
      await page.locator('button.env-chip', { hasText: label }).click();
      await page.waitForFunction(e => window.location.search.includes(`env=${e}`), env, { timeout: 10000 });
      await page.waitForTimeout(800);
      assert.strictEqual(await page.locator('#login-username').count(), 0, `still signed in after switching to ${env}`);
    }
    console.log('✔ 7. Super Admin switches PROD and back without being signed out.');

    // 8. R1: failed problems feed
    await page.route('**/api/problems**', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await page.goto(`${base}/?env=staging&tab=home`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sentinel-sidebar', { timeout: 15000 });
    await page.getByText('Data unavailable').first().waitFor({ timeout: 10000 });
    assert.strictEqual(await page.getByText('All layers operating within baseline').count(), 0, 'no healthy claim when the feed failed');
    console.log('✔ 8. A failed problems feed shows "Data unavailable".');
    await context.close();

    console.log('\nui_login: ALL PASSED');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run()
  .then(() => setTimeout(() => process.exit(0), 50))
  .catch(err => { console.error('❌ ui_login failed:', err); setTimeout(() => process.exit(1), 50); });
