/**
 * synthetics/steps/browser.js
 *
 * Headless Playwright browser journey step with failure screenshots.
 */

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.resolve(__dirname, '../../.runtime/journeys');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Deletes old screenshots.
function cleanOldScreenshots() {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) return;
    const now = Date.now();
    const traceDirs = fs.readdirSync(SCREENSHOT_DIR);
    for (const d of traceDirs) {
      const fullDir = path.join(SCREENSHOT_DIR, d);
      try {
        const stat = fs.statSync(fullDir);
        if (now - stat.mtimeMs > SEVEN_DAYS_MS) {
          fs.rmSync(fullDir, { recursive: true, force: true });
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// Runs a browser step.
async function executeBrowserStep(step, context = {}) {
  const t0 = performance.now();
  cleanOldScreenshots();

  let playwright = null;
  try {
    playwright = require('playwright');
  } catch (_) {
    try {
      playwright = require('playwright-core');
    } catch (_) {}
  }

  if (!playwright) {
    return {
      success: false,
      status: 'ERROR',
      durationMs: performance.now() - t0,
      error: 'Playwright engine not installed or unavailable in current environment'
    };
  }

  let browser = null;
  let page = null;
  const traceId = context.traceId || 'trace_default';
  const stepId = step.id || 'step';

  try {
    browser = await playwright.chromium.launch({ headless: true });
    page = await browser.newPage();

    let targetUrl = step.url || step.goto || '/';
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      const base = (context.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
      const pathPart = targetUrl.startsWith('/') ? targetUrl : `/${targetUrl}`;
      targetUrl = `${base}${pathPart}`;
    }

    await page.goto(targetUrl, { timeout: step.timeout_ms || 15000 });

    if (Array.isArray(step.actions)) {
      for (const act of step.actions) {
        if (act.type === 'click' && act.selector) {
          await page.click(act.selector, { timeout: act.timeout_ms || 5000 });
        } else if (act.type === 'fill' && act.selector) {
          await page.fill(act.selector, act.value || '', { timeout: act.timeout_ms || 5000 });
        } else if (act.type === 'wait' && act.selector) {
          await page.waitForSelector(act.selector, { timeout: act.timeout_ms || 5000 });
        }
      }
    }

    if (step.assert?.selector) {
      await page.waitForSelector(step.assert.selector, { timeout: 5000 });
    }

    const durationMs = performance.now() - t0;
    return {
      success: true,
      status: 'OK',
      durationMs
    };
  } catch (err) {
    const durationMs = performance.now() - t0;
    let screenshotPath = null;
    if (page) {
      try {
        const destDir = path.join(SCREENSHOT_DIR, traceId);
        fs.mkdirSync(destDir, { recursive: true });
        screenshotPath = path.join(destDir, `${stepId}.png`);
        await page.screenshot({ path: screenshotPath });
      } catch (_) {}
    }
    return {
      success: false,
      status: 'ERROR',
      durationMs,
      error: err.message,
      screenshotPath: screenshotPath ? path.relative(path.resolve(__dirname, '../..'), screenshotPath) : null
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

module.exports = {
  executeBrowserStep,
  cleanOldScreenshots
};
