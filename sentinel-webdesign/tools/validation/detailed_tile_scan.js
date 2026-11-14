/**
 * Validation tool: records, for every tab in each environment, its headings, a few lines of
 * text, how many tables and status badges it shows, and whether it shows a "no data" state.
 * It describes what is on screen; it does not judge whether values are real.
 *
 * Usage: SENTINEL_UI_PASSWORD=... node tools/validation/detailed_tile_scan.js
 * Settings: see ui_common.js. Exit code 1 when a tab cannot be scanned.
 */
const fs = require('fs');
const path = require('path');
const {
  BASE_URL, ENVS, TABS, NO_DATA_MARKERS,
  launch, signIn, switchEnvironment, waitForSettled, trackApi
} = require('./ui_common');

async function scanTiles() {
  const browser = await launch();
  const report = { base_url: BASE_URL, generated_at: new Date().toISOString(), environments: {} };
  let failed = 0;

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const api = trackApi(page);
    await signIn(page);

    for (const env of ENVS) {
      const switched = await switchEnvironment(page, env);
      const tabs = [];
      report.environments[env] = { switch_confirmed: switched, tabs };
      if (!switched) { failed++; console.error(`[ENV] ${env}: session switch not confirmed`); continue; }

      for (const t of TABS) {
        api.reset();
        try {
          await page.goto(`${BASE_URL}/?env=${env}&tab=${t.id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          const settled = await waitForSettled(page, api.inflight);
          const data = await page.evaluate((markers) => {
            const container = document.querySelector('.sentinel-main-content');
            if (!container) return { error: 'No main content' };
            const headers = Array.from(container.querySelectorAll('h1, h2, h3, h4, .card-title, .stat-title, .panel-title, .section-header'))
              .map(el => el.innerText.trim())
              .filter(s => s.length > 0 && s.length < 80);
            const text = container.innerText;
            return {
              headers: Array.from(new Set(headers)).slice(0, 8),
              sample_lines: text.split('\n').map(s => s.trim()).filter(s => s.length > 15 && s.length < 120).slice(0, 4),
              no_data_markers: markers.filter(m => text.includes(m)),
              auth_failed: text.includes('AUTH_FAILED'),
              tables: container.querySelectorAll('table').length,
              status_badges: container.querySelectorAll('.status-pill, .severity-pill, .badge, .status-badge').length
            };
          }, NO_DATA_MARKERS);
          const apiFailures = api.takeFailures();
          if (data.error || !settled || apiFailures.length) failed++;
          tabs.push({ tab: t.id, label: t.label, group: t.group, settled, api_failures: apiFailures, data });
        } catch (err) {
          failed++;
          tabs.push({ tab: t.id, label: t.label, group: t.group, error: err.message });
        }
      }
      console.log(`[ENV] ${env}: scanned ${tabs.length} tabs`);
    }
  } finally {
    await browser.close();
  }

  const out = path.resolve(__dirname, 'detailed_tiles.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`Detailed tile scan finished (${failed} problem(s)). Report: ${out}`);
  process.exit(failed === 0 ? 0 : 1);
}

scanTiles().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
