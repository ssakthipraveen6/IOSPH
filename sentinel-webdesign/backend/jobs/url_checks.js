/**
 * backend/jobs/url_checks.js
 *
 * Phase O7 / O7.5: Manifest URL Validity & Integrity Checker.
 * Probes all manifest URLs:
 *   - vip URL
 *   - prod_urls / stg_urls
 *   - refweb_url
 *   - health_checks [{ url, expect_status, expect_json, keyword }]
 *   - journey start URLs
 *
 * Validates:
 *   - Status code (matches expect_status or < 400)
 *   - Redirect chain (end host, loop prevention, no redirect to error/maintenance page)
 *   - JSON field assertions (expect_json)
 *   - Keyword match
 *   - TLS certificate validity and hostname match
 *   - Consecutive failures tracking (alerts after 2 consecutive failures)
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const yamlConfig = require('../config/yaml_config');

// In-memory failure tracking: url -> consecutive failure count
const failureTracker = new Map();

/**
 * Checks a single URL with redirect follow and validation assertions.
 */
function probeUrl(targetUrl, options = {}) {
  const {
    expectStatus = 200,
    expectJson = null,
    keyword = null,
    maxRedirects = 5,
    timeoutMs = 5000
  } = options;

  return new Promise((resolve) => {
    const redirectChain = [];
    let currentUrl = targetUrl;
    let redirectsCount = 0;

    function doRequest(urlToFetch) {
      redirectChain.push(urlToFetch);
      if (redirectsCount > maxRedirects) {
        return resolve({
          success: false,
          url: targetUrl,
          finalUrl: urlToFetch,
          redirectChain,
          error: 'REDIRECT_LOOP',
          message: `Too many redirects (exceeded limit of ${maxRedirects})`
        });
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(urlToFetch);
      } catch (err) {
        return resolve({
          success: false,
          url: targetUrl,
          finalUrl: urlToFetch,
          redirectChain,
          error: 'INVALID_URL',
          message: err.message
        });
      }

      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqOptions = {
        method: 'GET',
        headers: {
          'User-Agent': 'SENTINEL-URL-Probe/2.0',
          'Accept': 'application/json, text/html, */*'
        },
        timeout: timeoutMs,
        rejectUnauthorized: options.rejectUnauthorized !== false
      };

      const req = client.request(parsedUrl, reqOptions, (res) => {
        const statusCode = res.statusCode;

        // Follow redirect (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
          redirectsCount++;
          const nextUrl = new URL(res.headers.location, urlToFetch).href;

          // Check if redirected to an error or maintenance page
          const lowerNext = nextUrl.toLowerCase();
          if (lowerNext.includes('/error') || lowerNext.includes('/maintenance') || lowerNext.includes('/down')) {
            return resolve({
              success: false,
              url: targetUrl,
              finalUrl: nextUrl,
              redirectChain,
              statusCode,
              error: 'MAINTENANCE_REDIRECT',
              message: `Redirected to maintenance/error page: ${nextUrl}`
            });
          }

          // Check redirect cycle
          if (redirectChain.includes(nextUrl)) {
            redirectChain.push(nextUrl);
            return resolve({
              success: false,
              url: targetUrl,
              finalUrl: nextUrl,
              redirectChain,
              error: 'REDIRECT_LOOP',
              message: `Circular redirect detected: ${nextUrl}`
            });
          }

          res.resume(); // discard body
          return doRequest(nextUrl);
        }

        // Collect body for assertions
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          // 1. Status Code Check
          const expectedStatuses = Array.isArray(expectStatus) ? expectStatus : [Number(expectStatus)];
          const statusOk = expectedStatuses.includes(statusCode) || (!options.expectStatus && statusCode < 400);

          if (!statusOk) {
            return resolve({
              success: false,
              url: targetUrl,
              finalUrl: urlToFetch,
              redirectChain,
              statusCode,
              error: 'STATUS_MISMATCH',
              message: `Expected status ${expectStatus}, got ${statusCode}`
            });
          }

          // 2. Keyword Check
          if (keyword && !body.includes(keyword)) {
            return resolve({
              success: false,
              url: targetUrl,
              finalUrl: urlToFetch,
              redirectChain,
              statusCode,
              error: 'KEYWORD_NOT_FOUND',
              message: `Expected keyword "${keyword}" not found in response body`
            });
          }

          // 3. JSON Field Check
          if (expectJson && typeof expectJson === 'object') {
            try {
              const parsedJson = JSON.parse(body);
              for (const [k, expectedVal] of Object.entries(expectJson)) {
                if (parsedJson[k] !== expectedVal) {
                  return resolve({
                    success: false,
                    url: targetUrl,
                    finalUrl: urlToFetch,
                    redirectChain,
                    statusCode,
                    error: 'JSON_ASSERTION_FAILED',
                    message: `Field "${k}" was expected to be "${expectedVal}", but was "${parsedJson[k]}"`
                  });
                }
              }
            } catch (jsonErr) {
              return resolve({
                success: false,
                url: targetUrl,
                finalUrl: urlToFetch,
                redirectChain,
                statusCode,
                error: 'INVALID_JSON',
                message: `Failed to parse JSON response: ${jsonErr.message}`
              });
            }
          }

          resolve({
            success: true,
            url: targetUrl,
            finalUrl: urlToFetch,
            redirectChain,
            statusCode,
            endHost: parsedUrl.host
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          success: false,
          url: targetUrl,
          finalUrl: urlToFetch,
          redirectChain,
          error: 'NETWORK_ERROR',
          message: err.message
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          url: targetUrl,
          finalUrl: urlToFetch,
          redirectChain,
          error: 'TIMEOUT',
          message: `Probe timed out after ${timeoutMs}ms`
        });
      });

      req.end();
    }

    doRequest(targetUrl);
  });
}

/**
 * Extracts all URLs to validate across application manifests.
 */
function extractManifestUrls(apps = null) {
  const allApps = apps || yamlConfig.loadAllApplications() || {};
  const targets = [];

  for (const [appId, app] of Object.entries(allApps)) {
    // 1. VIP URL
    if (app.layers?.vip) {
      const v = typeof app.layers.vip === 'string' ? app.layers.vip : app.layers.vip.url;
      if (v) targets.push({ appId, type: 'vip', url: v.startsWith('http') ? v : `https://${v}` });
    }

    // 2. prod_urls / stg_urls
    if (Array.isArray(app.prod_urls)) {
      for (const u of app.prod_urls) targets.push({ appId, type: 'prod_url', url: u });
    }
    if (Array.isArray(app.stg_urls)) {
      for (const u of app.stg_urls) targets.push({ appId, type: 'stg_url', url: u });
    }

    // 3. refweb_url
    if (app.refweb_url) {
      const u = typeof app.refweb_url === 'string' ? app.refweb_url : app.refweb_url.url;
      if (u) targets.push({ appId, type: 'refweb', url: u });
    }

    // 4. health_checks
    if (Array.isArray(app.health_checks)) {
      for (const hc of app.health_checks) {
        if (hc.url) {
          targets.push({
            appId,
            type: 'health_check',
            url: hc.url,
            expectStatus: hc.expect_status || 200,
            expectJson: hc.expect_json || null,
            keyword: hc.keyword || null
          });
        }
      }
    }

    // 5. journey start URLs
    if (Array.isArray(app.journeys)) {
      for (const j of app.journeys) {
        if (Array.isArray(j.steps) && j.steps[0]?.url) {
          targets.push({ appId, type: 'journey_start', url: j.steps[0].url });
        }
      }
    }
  }

  return targets;
}

/**
 * Main URL checks job runner.
 */
async function runUrlChecks({
  apps = null,
  prober = probeUrl,
  nowMs = Date.now(),
  targets = null
} = {}) {
  const urlList = targets || extractManifestUrls(apps);
  const results = [];
  const alerts = [];

  for (const item of urlList) {
    const probeRes = await prober(item.url, {
      expectStatus: item.expectStatus,
      expectJson: item.expectJson,
      keyword: item.keyword
    });

    const currentFails = failureTracker.get(item.url) || 0;
    if (probeRes.success) {
      failureTracker.set(item.url, 0);
    } else {
      const newFails = currentFails + 1;
      failureTracker.set(item.url, newFails);

      if (newFails >= 2) {
        alerts.push({
          url: item.url,
          appId: item.appId,
          type: item.type,
          consecutiveFailures: newFails,
          error: probeRes.error,
          message: probeRes.message
        });
      }
    }

    results.push({
      ...item,
      ...probeRes,
      consecutiveFailures: failureTracker.get(item.url),
      checkedAt: new Date(nowMs).toISOString()
    });
  }

  return {
    checkedAt: new Date(nowMs).toISOString(),
    total: results.length,
    passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    alerts,
    results
  };
}

// Clears the consecutive-failure counts.
function resetFailureTracker() {
  failureTracker.clear();
}

module.exports = {
  probeUrl,
  extractManifestUrls,
  runUrlChecks,
  resetFailureTracker
};
