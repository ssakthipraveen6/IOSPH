/**
 * synthetics/steps/http.js
 *
 * HTTP step runner with millisecond-precision performance timing and assertions.
 */

const { performance } = require('perf_hooks');

// Runs an HTTP step and checks its response.
async function executeHttpStep(step, context = {}) {
  const t0 = performance.now();
  let fullUrl = step.url || step.request?.url || '/';
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    const base = (context.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
    const path = fullUrl.startsWith('/') ? fullUrl : `/${fullUrl}`;
    fullUrl = `${base}${path}`;
  }

  const method = (step.method || step.request?.method || 'GET').toUpperCase();
  const headers = { ...(step.headers || step.request?.headers || {}) };

  // Secure credential injection if provided in context
  if (context.credential) {
    if (step.auth_type === 'basic') {
      const b64 = Buffer.from(context.credential).toString('base64');
      headers['Authorization'] = `Basic ${b64}`;
    } else if (step.auth_type === 'header' && step.auth_header) {
      headers[step.auth_header] = context.credential;
    } else if (!headers['Authorization']) {
      headers['Authorization'] = `Bearer ${context.credential}`;
    }
  }

  const timeoutMs = step.timeout_ms || context.stepTimeoutMs || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let body = step.body || step.request?.body || undefined;
  if (body && typeof body === 'object' && !(body instanceof Buffer)) {
    body = JSON.stringify(body);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(fullUrl, {
      method,
      headers,
      body,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const text = await res.text();
    const durationMs = performance.now() - t0;

    // Assertions
    const asserts = step.assert || step.assertions || {};
    if (asserts.status !== undefined && res.status !== asserts.status) {
      return {
        success: false,
        status: 'ERROR',
        durationMs,
        error: `HTTP status mismatch: expected ${asserts.status}, got ${res.status}`,
        httpStatus: res.status
      };
    }

    if (asserts.body_contains && !text.includes(asserts.body_contains)) {
      return {
        success: false,
        status: 'ERROR',
        durationMs,
        error: `Response body missing required substring: "${asserts.body_contains}"`,
        httpStatus: res.status
      };
    }

    if (asserts.max_ms !== undefined && durationMs > asserts.max_ms) {
      return {
        success: false,
        status: 'ERROR',
        durationMs,
        error: `Latency threshold exceeded: ${durationMs.toFixed(1)}ms > ${asserts.max_ms}ms`,
        httpStatus: res.status
      };
    }

    return {
      success: true,
      status: 'OK',
      durationMs,
      httpStatus: res.status,
      bodyLength: text.length
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = performance.now() - t0;
    const isTimeout = err.name === 'AbortError';
    return {
      success: false,
      status: 'ERROR',
      durationMs,
      error: isTimeout ? `HTTP request timed out after ${timeoutMs}ms` : err.message
    };
  }
}

module.exports = {
  executeHttpStep
};
