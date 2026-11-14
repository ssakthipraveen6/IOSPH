/**
 * Validation tool: signs in, walks every tab in each environment and reports whether it
 * rendered without errors and what kind of content it shows.
 *
 * A tab FAILS on a page error, a console error, a failed /api call (4xx/5xx or network),
 * a crash message, a missing main area, or when it never finishes loading.
 * The data state never claims live telemetry: this tool cannot tell measured values from
 * placeholders, so anything that is not an explicit "no data" or demo screen is reported
 * as "renders; values not checked against a source".
 *
 * Usage: SENTINEL_UI_PASSWORD=... node tools/validation/full_ui_validation.js
 * Settings: see ui_common.js. Exit code 1 when any tab fails or an environment switch fails.
 */
const fs = require('fs');
const path = require('path');
const {
  BASE_URL, ENVS, TABS, NO_DATA_MARKERS,
  launch, signIn, switchEnvironment, waitForSettled, trackApi
} = require('./ui_common');

function dataState(tabId, text) {
  if (tabId === 'demo') return 'Sample data (Demo area, labelled)';
  if (text.includes('AUTH_FAILED')) return 'AUTH_FAILED shown';
  const marker = NO_DATA_MARKERS.find(m => text.includes(m));
  if (marker) return `No data shown ("${marker}")`;
  return 'Renders; values not checked against a source';
}

async function runValidation() {
  console.log(`=== SENTINEL UI VALIDATION (${BASE_URL}) ===`);
  const browser = await launch();
  const report = { base_url: BASE_URL, generated_at: new Date().toISOString(), environments: {}, page_errors: [] };
  let failed = 0;

  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const api = trackApi(page);
    let consoleErrors = [];
    page.on('pageerror', err => { report.page_errors.push({ url: page.url(), error: err.message }); consoleErrors.push(err.message); });
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // API failures are tracked from the network directly; WebSocket reconnects are not view errors.
      if (text.includes('Failed to load resource') || text.includes('WebSocket') || text.includes('[WS]')) return;
      consoleErrors.push(text);
    });

    const user = await signIn(page);
    console.log(`✔ Signed in as ${user}`);

    for (const env of ENVS) {
      const switched = await switchEnvironment(page, env);
      console.log(`[ENV] ${env}: session switch ${switched ? 'confirmed by /api/auth/me' : 'NOT confirmed'}`);
      const results = [];
      report.environments[env] = { switch_confirmed: switched, results };
      if (!switched) { failed++; continue; }

      for (const tab of TABS) {
        api.reset();
        consoleErrors = [];
        let row;
        try {
          await page.goto(`${BASE_URL}/?env=${env}&tab=${tab.id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          const settled = await waitForSettled(page, api.inflight);
          const main = await page.$('.sentinel-main-content');
          const text = main ? await main.innerText() : '';
          const crashed = /Something went wrong|Application Error/.test(text);
          const apiFailures = api.takeFailures();
          const problems = [
            ...(main ? [] : ['main content area missing']),
            ...(settled ? [] : ['did not finish loading within 15 s']),
            ...(crashed ? ['crash message shown'] : []),
            ...apiFailures,
            ...consoleErrors
          ];
          row = {
            id: tab.id, group: tab.group, label: tab.label,
            status: problems.length === 0 ? 'WORKING' : 'FAILED',
            data_state: dataState(tab.id, text),
            problems
          };
        } catch (err) {
          row = { id: tab.id, group: tab.group, label: tab.label, status: 'FAILED', data_state: 'navigation error', problems: [err.message] };
        }
        if (row.status !== 'WORKING') failed++;
        results.push(row);
        console.log(`  ${row.status === 'WORKING' ? 'OK  ' : 'FAIL'} ${env.padEnd(7)} ${tab.label.padEnd(24)} ${row.data_state}${row.problems.length ? ' | ' + row.problems.join('; ') : ''}`);
      }
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.resolve(__dirname, 'ui_validation_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n=== ${failed === 0 ? 'ALL TABS WORKING' : `${failed} FAILURE(S)`} — report: ${reportPath} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

runValidation().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
