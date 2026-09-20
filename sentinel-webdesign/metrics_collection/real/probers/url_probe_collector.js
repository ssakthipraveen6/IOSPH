/**
 * metrics_collection/real/probers/url_probe_collector.js
 *
 * Generic URL-Only Prober Collector for unowned systems without agents or APIs (T5.5 / C6).
 * Measures real latency, verifies HTTP status code, inspects TLS validity,
 * and performs optional content assertions (e.g. for Aquasec, external portals).
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Probes a single URL target with high precision latency measurement and TLS checks.
 */
function probeUrl(targetConfig) {
  return new Promise((resolve) => {
    const {
      url: targetUrl,
      component = 'url_target',
      expectedStatus = 200,
      contentAssertion = null,
      timeoutMs = 4000
    } = targetConfig;

    if (!targetUrl) {
      return resolve({
        component,
        url: null,
        status: 'DATA_UNAVAILABLE',
        error: 'Target URL is required',
        latencyMs: null
      });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return resolve({
        component,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `Invalid URL: ${e.message}`,
        latencyMs: null
      });
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const startHr = process.hrtime.bigint();

    const req = client.request(
      parsed,
      {
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'Sentinel-Unified-Prober/2.0 (HealthCheck)'
        }
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          if (body.length < 32768) {
            body += chunk;
          }
        });

        res.on('end', () => {
          const endHr = process.hrtime.bigint();
          const latencyMs = Number((endHr - startHr) / 1000000n);

          let tlsValid = null;
          let tlsExpiresAt = null;

          if (isHttps && res.socket && res.socket.getPeerCertificate) {
            try {
              const cert = res.socket.getPeerCertificate();
              if (cert && cert.valid_to) {
                tlsExpiresAt = new Date(cert.valid_to).toISOString();
                tlsValid = new Date(cert.valid_to).getTime() > Date.now();
              }
            } catch (_) {}
          }

          const httpStatus = res.statusCode;
          const statusMatches = Array.isArray(expectedStatus)
            ? expectedStatus.includes(httpStatus)
            : httpStatus === expectedStatus;

          let assertionPassed = true;
          if (contentAssertion) {
            assertionPassed = typeof contentAssertion === 'string'
              ? body.includes(contentAssertion)
              : Boolean(contentAssertion.test && contentAssertion.test(body));
          }

          let status = 'HEALTHY';
          if (!statusMatches) {
            status = httpStatus >= 500 ? 'CRITICAL' : 'DEGRADED';
          } else if (!assertionPassed) {
            status = 'DEGRADED';
          }

          resolve({
            component,
            url: targetUrl,
            status,
            httpStatus,
            latencyMs,
            tlsValid,
            tlsExpiresAt,
            assertionPassed,
            timestamp: new Date().toISOString()
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const endHr = process.hrtime.bigint();
      const latencyMs = Number((endHr - startHr) / 1000000n);
      resolve({
        component,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `Probe timed out after ${timeoutMs}ms`,
        latencyMs,
        timestamp: new Date().toISOString()
      });
    });

    req.on('error', (err) => {
      const endHr = process.hrtime.bigint();
      const latencyMs = Number((endHr - startHr) / 1000000n);
      resolve({
        component,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: err.message,
        latencyMs,
        timestamp: new Date().toISOString()
      });
    });

    req.end();
  });
}

/**
 * Runs batch URL probes across multiple target configs and emits standardized metrics.
 */
async function collectUrlProbes(targets = [], db = null, env = 'staging') {
  const results = [];
  const metricsBatch = [];

  for (const target of targets) {
    const res = await probeUrl(target);
    results.push(res);

    if (res.latencyMs !== null) {
      metricsBatch.push({
        component: res.component,
        metricName: 'probe_latency_ms',
        value: res.latencyMs,
        timestamp: res.timestamp,
        env
      });
    }

    if (res.httpStatus !== undefined) {
      metricsBatch.push({
        component: res.component,
        metricName: 'http_status_code',
        value: res.httpStatus,
        timestamp: res.timestamp,
        env
      });
    }
  }

  if (db && metricsBatch.length > 0 && typeof db.addMetricBatch === 'function') {
    db.addMetricBatch(metricsBatch, env);
  }

  return results;
}

module.exports = {
  probeUrl,
  collectUrlProbes
};
